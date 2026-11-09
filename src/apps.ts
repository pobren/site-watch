// Apps on phones and computers (the Site Patrol app for iPhone, iPad and Mac, or your own). People sign up on the
// website; an app then signs in with an email address and password, or by scanning a QR code from the Account tab.
// Either way it gets its own app key, which it sends as "Authorization: Bearer swapp_..." and which works with the
// same /api/* the website uses, so the app sees and does exactly what the website does.
//
//   GET    /api/app/info            the install's name, colours and whether app alerts are set up (no sign-in)
//   POST   /api/app/signin          { email, password, name, platform } -> { key }
//   POST   /api/app/redeem          { code, name, platform } -> { key }, with a code from the QR code
//   POST   /api/app/qr              (signed in) a sign-in code that works once, for 5 minutes, and its QR code
//   POST   /api/app/push            (app) { token, sandbox } turns on alerts for this device
//   POST   /api/app/signout         (app) signs this app out and stops its alerts
//   DELETE /api/app/devices/{id}    (signed in) signs an app out from the website
//   POST   /api/account/delete      (signed in) { password } deletes your own account and everything in it

import qrcode from "qrcode-generator";
import { apnsReady, cleanDeviceToken } from "./apns.ts";
import { APP_KEY_PREFIX, checkPassword, clearFailures, currentAccount, currentApp, noteFailure, tooManyTries, type AppDeviceRow, type MemberRow } from "./auth.ts";
import { cleanEmail, iso, planAllows } from "./core.ts";
import { install, newId, planById, type AccountRow, type Env } from "./db.ts";
import { sha256 } from "./keys.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (error: string, status = 400) => json({ error }, status);
const read = (request: Request) => request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

/** Apps each account can have signed in. Signing in one more signs out the one used longest ago. */
export const MAX_APPS = 10;
/** How long a QR sign-in code works. */
export const CODE_MS = 5 * 60_000;
export const PLATFORMS = ["iphone", "ipad", "mac", "android", "windows", "other"] as const;

export const cleanPlatform = (x: unknown) => (PLATFORMS.includes(x as (typeof PLATFORMS)[number]) ? (x as string) : "other");
export const cleanDeviceName = (x: unknown) => {
	const s = typeof x === "string" ? x.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
	return s || "My app";
};

/** The address a QR code holds. The app reads the install's address and the code from it. */
export const connectLink = (origin: string, code: string) => `${origin}/app/connect?code=${code}`;

/** A QR code as an SVG picture (black on white, with a quiet border), for an <img>. */
export function qrSvg(text: string): string {
	const q = qrcode(0, "M");
	q.addData(text);
	q.make();
	const n = q.getModuleCount();
	let d = "";
	for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
	const size = n + 8;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Makes an app key for a device. The key itself is only ever returned here. */
/** Signs an app in for an account's own login, or for one of its team (member). */
async function newApp(db: D1Database, a: Pick<AccountRow, "id" | "session_ver">, nameIn: unknown, platformIn: unknown, member: Pick<MemberRow, "id" | "session_ver"> | null = null): Promise<string> {
	const key = APP_KEY_PREFIX + newId(24);
	const ver = member ? member.session_ver : a.session_ver;
	const who = member ? "member_id = ?" : "member_id IS NULL";
	const whoArgs = member ? [member.id] : [];
	// Apps signed out by "Sign out everywhere" go for good now.
	await db.prepare(`DELETE FROM app_devices WHERE account_id = ? AND ${who} AND session_ver != ?`).bind(a.id, ...whoArgs, ver).run();
	const { results } = await db.prepare(`SELECT id FROM app_devices WHERE account_id = ? AND ${who} ORDER BY COALESCE(last_used, created_at) DESC`).bind(a.id, ...whoArgs).all<{ id: string }>();
	for (const old of results.slice(MAX_APPS - 1)) await forgetApp(db, a.id, old.id);
	await db.prepare("INSERT INTO app_devices (id, account_id, name, platform, token_hash, session_ver, created_at, member_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(newId(8), a.id, cleanDeviceName(nameIn), cleanPlatform(platformIn), await sha256(key), ver, iso(new Date()), member?.id ?? null).run();
	return key;
}

/** Signs one app out and stops its alerts. */
export async function forgetApp(db: D1Database, accountId: string, deviceId: string): Promise<void> {
	await db.batch([
		db.prepare("DELETE FROM channels WHERE account_id = ? AND kind = 'apns' AND json_extract(secret, '$.device') = ?").bind(accountId, deviceId),
		db.prepare("DELETE FROM app_devices WHERE id = ? AND account_id = ?").bind(deviceId, accountId),
	]);
}

/** The apps an account has signed in, for the Account tab. */
export async function listApps(db: D1Database, accountId: string, sessionVer: number) {
	const { results } = await db.prepare(`SELECT d.id, d.name, d.platform, d.created_at, d.last_used, d.session_ver,
		(SELECT COUNT(*) FROM channels c WHERE c.kind = 'apns' AND json_extract(c.secret, '$.device') = d.id) AS alerts
		FROM app_devices d WHERE d.account_id = ? AND d.session_ver = ? ORDER BY d.created_at DESC`).bind(accountId, sessionVer).all<AppDeviceRow & { alerts: number }>();
	return results.map((d) => ({ id: d.id, name: d.name, platform: d.platform, created: d.created_at, lastUsed: d.last_used, alerts: d.alerts > 0 }));
}

/** Deletes one client's account and everything in it. */
export async function deleteAccount(db: D1Database, id: string): Promise<void> {
	await db.batch([
		db.prepare("DELETE FROM notices WHERE page_id IN (SELECT id FROM pages WHERE account_id = ?)").bind(id),
		...["pages", "monitors", "channels", "alerts", "api_keys", "oauth_codes", "oauth_tokens", "app_devices", "app_codes", "subscribers", "sub_sends", "members"].map((t) => db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).bind(id)),
		db.prepare("DELETE FROM accounts WHERE id = ? AND role = 'client'").bind(id),
	]);
}

/** Ends a client's Stripe subscription straight away. True when there's nothing left to pay. */
async function endSubscription(env: Env, a: AccountRow): Promise<boolean> {
	if (!a.stripe_sub || !["active", "trialing", "past_due"].includes(a.status)) return true;
	if (!env.STRIPE_SECRET_KEY) return false;
	const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(a.stripe_sub)}`, {
		method: "DELETE", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "stripe-version": "2024-06-20" },
	});
	await res.body?.cancel();
	return res.ok || res.status === 404;
}

/** Handles /api/app/* and /api/account/delete. Null for everything else. */
export async function handleApps(request: Request, env: Env, path: string, url: URL): Promise<Response | null> {
	if (!path.startsWith("/api/app/") && path !== "/api/account/delete") return null;
	const db = env.DB;
	const method = request.method;

	if (path === "/api/app/info" && method === "GET") {
		const inst = await install(db);
		return json({ app: "site-watch", name: inst.brand.name, colour: inst.brand.colour, logo: inst.brand.logo, support: inst.brand.support, alerts: apnsReady(env), signup: inst.sell ? `${url.origin}/signup` : null });
	}
	if (method !== "POST" && method !== "DELETE") return bad("Not found", 404);

	if (path === "/api/app/signin" && method === "POST") {
		const b = await read(request);
		const email = cleanEmail(b.email);
		if (!email) return bad("Please enter your email address.");
		if (await tooManyTries(db, email)) return bad("Too many wrong passwords. Please wait 15 minutes and try again.", 429);
		const a = await db.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first<AccountRow>();
		// Not an account's own login: perhaps a team member's (team.ts). Alert-only people never sign in.
		const m = a ? null : await db.prepare("SELECT * FROM members WHERE email = ? AND role != 'alerts' AND accepted_at IS NOT NULL").bind(email).first<MemberRow>().catch(() => null);
		const hash = a?.password ?? m?.password;
		if (!hash || typeof b.password !== "string" || !(await checkPassword(b.password, hash))) {
			await noteFailure(db, email);
			return bad("That email address or password isn't right.", 401);
		}
		await clearFailures(db, email);
		if (m) return json({ key: await newApp(db, { id: m.account_id, session_ver: 0 }, b.name, b.platform, m) });
		return json({ key: await newApp(db, a!, b.name, b.platform) });
	}

	if (path === "/api/app/redeem" && method === "POST") {
		const b = await read(request);
		const code = typeof b.code === "string" && /^[0-9a-f]{32}$/.test(b.code) ? b.code : "";
		const row = code ? await db.prepare("DELETE FROM app_codes WHERE code_hash = ? RETURNING account_id, expires").bind(await sha256(code)).first<{ account_id: string; expires: number }>() : null;
		const a = row && row.expires > Date.now() ? await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(row.account_id).first<AccountRow>() : null;
		if (!a) return bad("That code has expired or been used. Make a new one on the Account page of the website.", 400);
		return json({ key: await newApp(db, a, b.name, b.platform) });
	}

	// Everything below needs a signed-in website or app.
	const app = await currentApp(request, db);
	const me = app?.account ?? (await currentAccount(request, db));
	if (!me) return bad("Please sign in.", 401);

	if (path === "/api/app/qr" && method === "POST") {
		const code = newId(16);
		await db.batch([
			db.prepare("DELETE FROM app_codes WHERE expires < ? OR account_id = ?").bind(Date.now(), me.id),
			db.prepare("INSERT INTO app_codes (code_hash, account_id, expires) VALUES (?, ?, ?)").bind(await sha256(code), me.id, Date.now() + CODE_MS),
		]);
		const link = connectLink(url.origin, code);
		return json({ link, code, expires: iso(new Date(Date.now() + CODE_MS)), qr: `data:image/svg+xml;base64,${btoa(qrSvg(link))}` });
	}

	const dv = /^\/api\/app\/devices\/([0-9a-f]{16})$/.exec(path);
	if (dv && method === "DELETE") {
		await forgetApp(db, me.id, dv[1]);
		return json({ ok: true });
	}

	if (path === "/api/account/delete" && method === "POST") {
		const b = await read(request);
		if (me.role === "owner") return bad("This is the owner's account, so it can't be deleted here. To close the whole install, delete the Worker and its database in Cloudflare.", 403);
		if (!me.password || typeof b.password !== "string" || !(await checkPassword(b.password, me.password))) return bad("Your password isn't right.", 401);
		if (!(await endSubscription(env, me))) return bad("We couldn't cancel your subscription just now, so nothing has been deleted. Please try again, or cancel it under Manage billing first.", 502);
		await deleteAccount(db, me.id);
		return json({ ok: true, deleted: true });
	}

	// The rest is for an app, about itself.
	if (!app) return bad("Please sign in to the app.", 401);
	const device = app.device;

	if (path === "/api/app/push" && method === "POST") {
		const b = await read(request);
		const token = cleanDeviceToken(b.token);
		if (!token) return bad("This device didn't give us what it needs for alerts. Please try again.");
		if (!apnsReady(env)) return bad("App alerts aren't set up on this install yet.", 503);
		if (me.role === "client" && !planAllows(await planById(db, me.plan), "apns")) return bad("Alerts in the app aren't on your plan.", 403);
		const secret = JSON.stringify({ device: device.id, sandbox: b.sandbox === true });
		await db.batch([
			db.prepare("DELETE FROM channels WHERE kind = 'apns' AND (url = ? OR (account_id = ? AND json_extract(secret, '$.device') = ?))").bind(token, me.id, device.id),
			db.prepare("INSERT INTO channels (account_id, kind, name, url, secret, created_at) VALUES (?, 'apns', ?, ?, ?, ?)").bind(me.id, device.name, token, secret, iso(new Date())),
		]);
		return json({ ok: true });
	}

	if (path === "/api/app/signout" && method === "POST") {
		await forgetApp(db, me.id, device.id);
		return json({ ok: true });
	}
	return bad("Not found", 404);
}
