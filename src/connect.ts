// The AI connector's addresses: /mcp itself, and the OAuth sign-in around it (/register, /token, /authorize and the
// two /.well-known files). An app such as Claude finds the sign-in on its own from the 401 that /mcp gives.

import { currentAccount } from "./auth.ts";
import { install, type Env } from "./db.ts";
import { checkKey, keyFrom, KEY_PREFIX, sha256 } from "./keys.ts";
import { handleMcp } from "./mcp.ts";
import { bearerAccount, checkAuthRequest, denied, issueCode, OAUTH_CORS, register, resourceMetadata, serverMetadata, token, unauthorised, type AuthRequest } from "./oauth.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const isConnectorPath = (p: string) => p === "/mcp" || p === "/register" || p === "/token" || p === "/authorize" || p.startsWith("/.well-known/oauth-");

/** Registrations from one address in a minute, before /register says slow down. */
const REGISTER_LIMIT = 10;
const recent = new Map<string, number[]>();
function tooMany(ip: string, now: number): boolean {
	const list = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
	list.push(now);
	recent.set(ip, list);
	if (recent.size > 1000) recent.clear();
	return list.length > REGISTER_LIMIT;
}

export async function handleConnector(request: Request, env: Env, url: URL, version: string): Promise<Response> {
	const p = url.pathname;
	const now = Date.now();
	const db = env.DB;
	if (p === "/authorize") return authorize(request, env, url, now);
	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OAUTH_CORS });
	if (p.startsWith("/.well-known/oauth-protected-resource")) return resourceMetadata(url.origin);
	if (p.startsWith("/.well-known/oauth-authorization-server")) return serverMetadata(url.origin);
	if (p === "/register" && request.method === "POST") {
		if (tooMany(request.headers.get("cf-connecting-ip") ?? "", now)) return Response.json({ error: "slow_down", error_description: "Too many apps registered from here. Try again in a minute." }, { status: 429, headers: OAUTH_CORS });
		return register(request, db, now);
	}
	if (p === "/token" && request.method === "POST") return token(request, db, now);
	if (p === "/mcp") {
		// An API key works too, for apps where you can add a header instead of signing in.
		const key = keyFrom(request);
		let accountId: string | null = null;
		if (key.startsWith(KEY_PREFIX)) {
			const check = await checkKey(db, key, now);
			if (!check.ok) return Response.json({ error: check.error }, { status: check.status, headers: OAUTH_CORS });
			accountId = check.account.id;
		} else accountId = await bearerAccount(request, db, now);
		if (!accountId) return unauthorised(url.origin);
		const res = await handleMcp(request, db, accountId, url.origin, version);
		for (const [k, v] of Object.entries(OAUTH_CORS)) res.headers.set(k, v);
		return res;
	}
	return new Response("Not found", { status: 404 });
}

const see = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
const sameOrigin = (request: Request, url: URL) => request.headers.get("origin") === url.origin || (request.headers.get("referer") ?? "").startsWith(url.origin + "/");
const consentToken = async (request: Request) => sha256(`${request.headers.get("cookie") ?? ""}:allow`);

async function authorize(request: Request, env: Env, url: URL, now: number): Promise<Response> {
	const db = env.DB;
	const params = request.method === "POST" ? new URLSearchParams((await request.formData()) as unknown as Record<string, string>) : url.searchParams;
	const inst = await install(db);
	const page = (title: string, body: string, status = 200) =>
		new Response(
			`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(inst.brand.name)}</title>
<style>body{margin:0;font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f1f5f9}main{max-width:520px;margin:48px auto;padding:0 16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}h1{font-size:26px;line-height:1.2;margin:0 0 12px}.hint{color:#475569;font-size:15px}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button{display:inline-flex;align-items:center;gap:8px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;padding:10px 18px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;min-height:44px}button.go{background:${esc(inst.brand.colour)};border-color:${esc(inst.brand.colour)};color:#fff}svg{width:18px;height:18px}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`,
			{ status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin" } },
		);
	const checked = await checkAuthRequest(db, params);
	if ("page" in checked) return page("Can't connect", `<h1>Can't connect</h1><p>${esc(checked.page)}</p>`, 400);
	if ("redirect" in checked) return see(checked.redirect);
	const req: AuthRequest = checked.ok;
	const account = await currentAccount(request, db);
	if (!account) {
		if (request.method === "POST") return new Response("Sign in first", { status: 401 });
		return see(`/signin?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const csrf = await consentToken(request);
	if (request.method === "POST") {
		if (!sameOrigin(request, url) || params.get("csrf") !== csrf) return new Response("Forbidden", { status: 403 });
		if (params.get("decision") !== "allow") return see(denied(req));
		return see(await issueCode(db, req, account.id, url.origin, now));
	}
	if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
	const keep = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
		.filter((k) => params.has(k))
		.map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k))}">`)
		.join("");
	const where = new URL(req.redirectUri).hostname;
	const tick = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
	const cross = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
	return page(
		"Allow access",
		`<h1>Let ${esc(req.clientName)} read ${esc(inst.brand.name)}?</h1><p>Signed in as <b>${esc(account.email)}</b>.</p>
<form method="post" action="/authorize">${keep}<input type="hidden" name="csrf" value="${csrf}">
<p>${esc(req.clientName)} (${esc(where)}) will be able to see what you watch, whether it's working, its uptime and your recent alerts and status pages.</p>
<p class="hint">It can't change anything. You can disconnect it at any time on the Account tab.</p>
<div class="btns"><button class="go" type="submit" name="decision" value="allow">${tick}Allow</button><button type="submit" name="decision" value="deny">${cross}Cancel</button></div></form>`,
	);
}
