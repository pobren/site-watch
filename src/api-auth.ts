// Set-up, sign-in, sign-out and forgotten passwords. The rest of the API is in api.ts.

import { sendEmail } from "./alerts.ts";
import { checkPassword, clearCookie, clearFailures, currentAccount, hashPassword, noteFailure, passwordProblem, sessionCookie, setupCodeMatches, signOutEverywhere, tooManyTries } from "./auth.ts";
import { cleanEmail, iso } from "./core.ts";
import { install, newId, type AccountRow, type Env } from "./db.ts";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const read = (request: Request) => request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

const validTz = (tz: unknown) => {
	if (typeof tz !== "string") return null;
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: tz });
		return tz;
	} catch {
		return null;
	}
};

/** Handles the routes that work without a session. Null for the rest. */
export async function handleAuth(request: Request, env: Env, path: string, url: URL): Promise<Response | null> {
	const db = env.DB;
	const secure = url.protocol === "https:";
	if (path === "/api/whoami") {
		const owner = await db.prepare("SELECT 1 FROM accounts WHERE role = 'owner'").first();
		const me = await currentAccount(request, db);
		const inst = await install(db);
		return json({ signedIn: !!me, role: me?.role ?? null, hasOwner: !!owner, brand: inst.brand, sell: inst.sell && !!env.STRIPE_SECRET_KEY });
	}
	if (request.method !== "POST") return null;

	if (path === "/api/setup") {
		// Makes the owner's account, or resets the owner's password with the same link.
		const b = await read(request);
		if (!setupCodeMatches(env.SETUP_TOKEN, b.code)) return json({ error: "That set-up link isn't right. Check the SETUP_TOKEN secret on the Worker in Cloudflare and use the link with that code." }, 403);
		const email = cleanEmail(b.email);
		if (!email) return json({ error: "Please enter your email address. You'll sign in with it." }, 400);
		const problem = passwordProblem(b.password);
		if (problem) return json({ error: problem }, 400);
		const hash = await hashPassword(b.password as string);
		const owner = await db.prepare("SELECT * FROM accounts WHERE role = 'owner'").first<AccountRow>();
		if (owner) {
			await db.prepare("UPDATE accounts SET email = ?, password = ?, session_ver = session_ver + 1 WHERE id = ?").bind(email, hash, owner.id).run();
		} else {
			await db.prepare("INSERT INTO accounts (id, email, password, role, status, alert_to, tz, created_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)")
				.bind(newId(8), email, hash, email, validTz(b.tz) ?? "UTC", iso(new Date())).run();
		}
		await clearFailures(db, email);
		const me = (await db.prepare("SELECT * FROM accounts WHERE role = 'owner'").first<AccountRow>())!;
		return json({ ok: true }, 200, { "set-cookie": await sessionCookie(db, me, secure) });
	}

	if (path === "/api/signin") {
		const b = await read(request);
		const email = cleanEmail(b.email);
		if (!email) return json({ error: "Please enter your email address." }, 400);
		if (await tooManyTries(db, email)) return json({ error: "Too many wrong passwords. Please wait 15 minutes and try again." }, 429);
		const a = await db.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first<AccountRow>();
		if (!a?.password || typeof b.password !== "string" || !(await checkPassword(b.password, a.password))) {
			await noteFailure(db, email);
			return json({ error: "That email address or password isn't right." }, 401);
		}
		await clearFailures(db, email);
		return json({ ok: true }, 200, { "set-cookie": await sessionCookie(db, a, secure) });
	}

	if (path === "/api/signout") return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });

	if (path === "/api/forgot") {
		// Always the same answer, so nobody can find out who has an account.
		const b = await read(request);
		const email = cleanEmail(b.email);
		const inst = await install(db);
		const a = email ? await db.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first<AccountRow>() : null;
		if (a && inst.alertFrom) {
			const token = newId(24);
			await db.prepare("UPDATE accounts SET reset_token = ?, reset_until = ? WHERE id = ?").bind(token, iso(new Date(Date.now() + 3_600_000)), a.id).run();
			await sendEmail(env, inst.alertFrom, a.email, `Choose a new password for ${inst.brand.name}`,
				`Someone asked to choose a new password for ${a.email}. If it was you, open this link in the next hour:\n\n${url.origin}/reset?token=${token}\n\nIf it wasn't you, there's nothing to do: your password hasn't changed.`, inst.brand.name);
		}
		return json({ ok: true, owner: !inst.alertFrom });
	}

	if (path === "/api/reset") {
		const b = await read(request);
		const token = typeof b.token === "string" && /^[0-9a-f]{48}$/.test(b.token) ? b.token : "";
		const a = token ? await db.prepare("SELECT * FROM accounts WHERE reset_token = ? AND reset_until > ?").bind(token, iso(new Date())).first<AccountRow>() : null;
		if (!a) return json({ error: "That link has expired or been used. Please ask for a new one." }, 400);
		const problem = passwordProblem(b.password);
		if (problem) return json({ error: problem }, 400);
		await db.prepare("UPDATE accounts SET password = ?, reset_token = NULL, reset_until = NULL, session_ver = session_ver + 1 WHERE id = ?").bind(await hashPassword(b.password as string), a.id).run();
		const me = (await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(a.id).first<AccountRow>())!;
		return json({ ok: true }, 200, { "set-cookie": await sessionCookie(db, me, secure) });
	}

	if (path === "/api/signout-all" || path === "/api/password") {
		const me = await currentAccount(request, db);
		if (!me) return json({ error: "Please sign in." }, 401);
		if (path === "/api/password") {
			const b = await read(request);
			if (!me.password || typeof b.current !== "string" || !(await checkPassword(b.current, me.password))) return json({ error: "Your current password isn't right." }, 401);
			const problem = passwordProblem(b.next);
			if (problem) return json({ error: problem }, 400);
			await db.prepare("UPDATE accounts SET password = ? WHERE id = ?").bind(await hashPassword(b.next as string), me.id).run();
		}
		await signOutEverywhere(db, me.id);
		if (path === "/api/signout-all") return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });
		return json({ ok: true }, 200, { "set-cookie": await sessionCookie(db, { id: me.id, session_ver: me.session_ver + 1 }, secure) });
	}
	return null;
}
