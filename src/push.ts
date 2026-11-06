// Browser push: alerts that pop up on a computer or phone even when the page is closed, with no app to install.
// The browser gives us an address at its push service (Google, Mozilla, Apple or Microsoft) and two keys; we
// encrypt each alert for that browser (RFC 8291) and sign the request with this install's own key (VAPID, RFC 8292).
// The push service never sees what the alert says. Nothing here needs an account anywhere: the install makes its
// own key pair the first time someone turns push on, and keeps it in the database.

import { getMeta } from "./db.ts";

const enc = new TextEncoder();

export const b64url = (b: ArrayBuffer | Uint8Array) => {
	const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
	let s = "";
	for (const x of bytes) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const unb64url = (s: string) => {
	const t = s.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(t + "===".slice((t.length + 3) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const concat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let i = 0;
	for (const p of parts) {
		out.set(p, i);
		i += p.length;
	}
	return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** What the browser hands over when push is switched on. */
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

/** Checks a subscription from the browser: a real push service address and keys of the right length. */
export function cleanSub(raw: unknown): PushSub | null {
	const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const keys = (b.keys && typeof b.keys === "object" ? b.keys : {}) as Record<string, unknown>;
	if (typeof b.endpoint !== "string" || b.endpoint.length > 1000 || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
	let u: URL;
	try {
		u = new URL(b.endpoint);
	} catch {
		return null;
	}
	if (u.protocol !== "https:") return null;
	try {
		if (unb64url(keys.p256dh).length !== 65 || unb64url(keys.auth).length !== 16) return null;
	} catch {
		return null;
	}
	return { endpoint: u.toString(), keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Encrypts one message for one browser (RFC 8291, aes128gcm, a single record). */
export async function encrypt(sub: PushSub, payload: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array> {
	const uaPublic = unb64url(sub.keys.p256dh);
	const authSecret = unb64url(sub.keys.auth);
	const ours = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
	const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ours.publicKey)) as ArrayBuffer);
	const theirs = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs } as SubtleCryptoDeriveKeyAlgorithm, ours.privateKey, 256));
	const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
	const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
	const header = new Uint8Array(21);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = asPublic.length;
	return concat(header, asPublic, sealed);
}

/** This install's VAPID key pair, made the first time it's needed. */
export interface Vapid { publicKey: string; privateJwk: JsonWebKey }

export async function vapidKeys(db: D1Database): Promise<Vapid> {
	const saved = await getMeta(db, "vapid");
	if (saved) return JSON.parse(saved);
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	const v: Vapid = {
		publicKey: b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
		privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
	};
	// Two first uses at once: whichever saved first wins, and both use that one.
	await db.prepare("INSERT INTO meta (key, value) VALUES ('vapid', ?) ON CONFLICT (key) DO NOTHING").bind(JSON.stringify(v)).run();
	return JSON.parse((await getMeta(db, "vapid"))!);
}

/** The signed token that tells the push service the message is from us (RFC 8292). */
export async function vapidHeader(v: Vapid, endpoint: string, contact: string, now = Date.now()): Promise<string> {
	const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
	const body = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact })));
	const key = await crypto.subtle.importKey("jwk", v.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
	return `vapid t=${head}.${body}.${b64url(sig)}, k=${v.publicKey}`;
}

/** What the notification shows. Kept short: push services take about 4KB. */
export interface PushMessage { title: string; body: string; url: string | null; urgent: boolean; tag?: string }

/** "sent", "gone" (the browser turned push off, so forget it) or "failed". */
export async function sendPush(db: D1Database, sub: PushSub, msg: PushMessage, contact: string): Promise<"sent" | "gone" | "failed"> {
	const v = await vapidKeys(db);
	const payload = JSON.stringify({ ...msg, title: msg.title.slice(0, 120), body: msg.body.slice(0, 600) });
	try {
		const res = await fetch(sub.endpoint, {
			method: "POST",
			headers: {
				authorization: await vapidHeader(v, sub.endpoint, contact),
				"content-encoding": "aes128gcm",
				"content-type": "application/octet-stream",
				ttl: "86400",
				urgency: msg.urgent ? "high" : "normal",
			},
			body: await encrypt(sub, payload),
			signal: AbortSignal.timeout(10_000),
		});
		await res.body?.cancel();
		if (res.status === 404 || res.status === 410) return "gone";
		return res.ok ? "sent" : "failed";
	} catch {
		return "failed";
	}
}

/** The service worker the browser runs in the background to show alerts. Served at /sw.js. */
export const SERVICE_WORKER = `self.addEventListener("push", (e) => {
	let m = {};
	try { m = e.data ? e.data.json() : {}; } catch { m = { title: "Alert", body: e.data ? e.data.text() : "" }; }
	e.waitUntil(self.registration.showNotification(m.title || "Alert", {
		body: m.body || "", tag: m.tag || undefined, renotify: !!m.tag, requireInteraction: !!m.urgent,
		icon: "/icon-192.png", badge: "/badge-72.png", data: { url: m.url || "/" },
	}));
});
self.addEventListener("notificationclick", (e) => {
	e.notification.close();
	const url = (e.notification.data && e.notification.data.url) || "/";
	e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
		for (const c of list) if (new URL(c.url).origin === self.location.origin && "focus" in c) { c.navigate(url); return c.focus(); }
		return self.clients.openWindow(url);
	}));
});
`;
