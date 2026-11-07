// Alerts on iPhone, iPad and Mac through the Site Patrol app (or any app built on this API): Apple's push service
// (APNs). Each alert is one HTTPS request to Apple, signed with a token made from the install's Apple key, so
// nothing goes through anyone else. Apple doesn't charge for push.
//
// Secrets on the Worker, from the Apple Developer account that publishes the app:
//   APNS_KEY      the .p8 key file's text (Certificates, Identifiers & Profiles > Keys, with Apple Push Notifications on)
//   APNS_KEY_ID   the key's 10 character ID
//   APNS_TEAM_ID  the account's 10 character Team ID
//   APNS_TOPIC    the app's bundle ID, such as app.sitepatrol.ios
// Without them, apps can still sign in and show everything; they just can't get alerts.

import { getMeta, setMeta } from "./db.ts";
import { b64url } from "./push.ts";

export interface ApnsEnv { APNS_KEY?: string; APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_TOPIC?: string }

export const apnsReady = (env: ApnsEnv) => !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);

const enc = new TextEncoder();
/** Apple wants a new token at most every 20 minutes and refuses one over an hour old, so we keep each for 50. */
const TOKEN_MS = 50 * 60_000;

/** The .p8 file's text (with or without its BEGIN and END lines) as a signing key. */
export async function importP8(p8: string): Promise<CryptoKey> {
	const body = p8.replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
	const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** A provider token (an ES256 JWT) for Apple. */
export async function providerToken(key: CryptoKey, keyId: string, teamId: string, now = Date.now()): Promise<string> {
	const head = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId })));
	const body = b64url(enc.encode(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) })));
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
	return `${head}.${body}.${b64url(sig)}`;
}

/** The current token, shared by every copy of the Worker through the database so Apple isn't sent too many new ones. */
async function currentToken(db: D1Database, env: ApnsEnv, now = Date.now()): Promise<string> {
	const saved = await getMeta(db, "apns_token");
	if (saved) {
		const t = JSON.parse(saved) as { token: string; at: number; kid: string };
		if (now - t.at < TOKEN_MS && t.kid === env.APNS_KEY_ID) return t.token;
	}
	const token = await providerToken(await importP8(env.APNS_KEY!), env.APNS_KEY_ID!, env.APNS_TEAM_ID!, now);
	await setMeta(db, "apns_token", JSON.stringify({ token, at: now, kid: env.APNS_KEY_ID }));
	return token;
}

/** A device token from the app: 64 or more hex characters. */
export const cleanDeviceToken = (x: unknown) => (typeof x === "string" && /^[0-9a-f]{64,200}$/i.test(x.trim()) ? x.trim().toLowerCase() : null);

export interface AppAlert { title: string; body: string; urgent: boolean; monitorId?: string | null; tag?: string }

/** What Apple shows. Down alerts are Time Sensitive, so they can break through Focus if the person allows it. */
export function apnsPayload(a: AppAlert): string {
	return JSON.stringify({
		aps: {
			alert: { title: a.title.slice(0, 120), body: a.body.slice(0, 600) },
			sound: "default",
			"interruption-level": a.urgent ? "time-sensitive" : "active",
			...(a.monitorId ? { "thread-id": a.monitorId } : {}),
		},
		monitor: a.monitorId ?? null,
	});
}

/** "sent", "gone" (the app was removed or alerts turned off, so forget this device) or "failed". */
export async function sendApns(db: D1Database, env: ApnsEnv, device: string, sandbox: boolean, a: AppAlert): Promise<"sent" | "gone" | "failed"> {
	if (!apnsReady(env)) return "failed";
	const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
	try {
		const headers: Record<string, string> = {
			authorization: `bearer ${await currentToken(db, env)}`,
			"apns-topic": env.APNS_TOPIC!,
			"apns-push-type": "alert",
			"apns-priority": "10",
			"apns-expiration": String(Math.floor(Date.now() / 1000) + 86_400),
			"content-type": "application/json",
		};
		if (a.tag) headers["apns-collapse-id"] = a.tag.slice(0, 64);
		const res = await fetch(`https://${host}/3/device/${device}`, { method: "POST", headers, body: apnsPayload(a), signal: AbortSignal.timeout(10_000) });
		if (res.ok) {
			await res.body?.cancel();
			return "sent";
		}
		const why = await res.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
		if (res.status === 410 || why.reason === "BadDeviceToken" || why.reason === "Unregistered") return "gone";
		// A token Apple says is out of date: make a new one next time.
		if (why.reason === "ExpiredProviderToken" || why.reason === "InvalidProviderToken") await setMeta(db, "apns_token", null);
		console.error("APNs", res.status, why.reason);
		return "failed";
	} catch {
		return "failed";
	}
}
