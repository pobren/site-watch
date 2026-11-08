// The public API at /api/v1, for your own scripts, dashboards and tools such as Zapier, Make or n8n. Docs:
// https://paulobrien.dev/watch/api/ (the same rules as Mail App, ReaderCount and DMARC Reports).
//
//   GET    /api/v1                         what's here
//   GET    /api/v1/monitors                everything you watch, with status, uptime, certificate and renewal
//   GET    /api/v1/monitors/{id}           one of them, with its recent outages
//   POST   /api/v1/monitors                start watching something (a key that can change things)
//   POST   /api/v1/monitors/{id}/check     check it now
//   POST   /api/v1/monitors/{id}/pause     pause it for { "minutes": 60 }
//   POST   /api/v1/monitors/{id}/resume    start checking again
//   DELETE /api/v1/monitors/{id}           stop watching it
//   GET    /api/v1/alerts                  the latest alerts
//   GET    /api/v1/pages                   your status pages and their notices
//   POST   /api/v1/pages/{id}/notices      post a notice on a status page
//   POST   /api/v1/notices/{id}/resolve    mark a notice resolved
//
// Keys are made on the Account tab (keys.ts). Writes go through the same code as the app's own buttons (act in
// api.ts), so the same plan limits and checks apply. There are no CORS headers on purpose: a key belongs on a server.

import { act, shape } from "./api.ts";
import { iso } from "./core.ts";
import { isLive, type AccountRow, type Env, type MonitorRow } from "./db.ts";
import { checkKey, keyFrom, KEY_PREFIX, API_LIMIT } from "./keys.ts";

export const DOCS = "https://paulobrien.dev/watch/api/";

const ENDPOINTS = [
	"GET /api/v1/monitors", "GET /api/v1/monitors/{id}", "POST /api/v1/monitors", "POST /api/v1/monitors/{id}/check", "POST /api/v1/monitors/{id}/pause",
	"POST /api/v1/monitors/{id}/resume", "DELETE /api/v1/monitors/{id}", "GET /api/v1/alerts", "GET /api/v1/pages", "POST /api/v1/pages/{id}/notices",
	"POST /api/v1/notices/{id}/resolve",
];

function answer(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers },
	});
}
const problem = (status: number, error: string, headers: Record<string, string> = {}) => answer({ error, docs: DOCS }, status, headers);

/** One monitor as the API and the AI connector give it. */
export function apiMonitor(r: MonitorRow, origin: string, now = new Date()) {
	const m = shape(r, origin, now);
	return {
		id: m.id, kind: m.kind, name: m.name, label: m.label, url: m.url, host: m.host, port: m.port, every: m.every, fast: m.fast,
		status: m.status, why: m.why, downSince: m.since, responseMs: m.ms, uptime: { "30d": m.uptime30, "90d": m.uptime90 },
		checkedAt: m.checkedAt, pausedUntil: m.pausedUntil, pingUrl: m.pingUrl, lastPing: m.lastPing,
		certificate: m.cert ? { expires: m.cert.expires, daysLeft: m.cert.daysLeft, issuer: m.cert.issuer, renewsItself: m.cert.auto } : null,
		domain: m.reg ? { name: m.reg.domain, expires: m.reg.expires, daysLeft: m.reg.daysLeft, registrar: m.reg.registrar } : null,
		outages: m.outages,
	};
}

export async function listMonitors(db: D1Database, accountId: string, origin: string) {
	const { results } = await db.prepare("SELECT * FROM monitors WHERE account_id = ? ORDER BY created_at, id").bind(accountId).all<MonitorRow>();
	return results.map((r) => apiMonitor(r, origin));
}

export async function getMonitor(db: D1Database, accountId: string, id: string, origin: string) {
	const r = await db.prepare("SELECT * FROM monitors WHERE id = ? AND account_id = ?").bind(id, accountId).first<MonitorRow>();
	return r ? apiMonitor(r, origin) : null;
}

export async function listAlerts(db: D1Database, accountId: string, limit = 25) {
	const n = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 25));
	const { results } = await db.prepare("SELECT id, at, monitor_id, subject, text, urgent, sent FROM alerts WHERE account_id = ? ORDER BY id DESC LIMIT ?").bind(accountId, n)
		.all<{ id: number; at: string; monitor_id: string | null; subject: string; text: string; urgent: number; sent: string }>();
	return results.map((a) => ({ id: a.id, at: a.at, monitorId: a.monitor_id, subject: a.subject, text: a.text, urgent: a.urgent === 1, sentTo: a.sent }));
}

type NoticeRow = { id: number; page_id: string; title: string; body: string; impact: string; created_at: string; resolved_at: string | null };
const apiNotice = (n: NoticeRow) => ({ id: n.id, pageId: n.page_id, title: n.title, body: n.body, impact: n.impact, createdAt: n.created_at, resolvedAt: n.resolved_at });

export async function listPages(db: D1Database, accountId: string, origin: string) {
	const [pages, notices] = await Promise.all([
		db.prepare("SELECT * FROM pages WHERE account_id = ? ORDER BY created_at").bind(accountId).all<{ id: string; slug: string; title: string; intro: string | null; host: string | null; monitors: string }>(),
		db.prepare("SELECT n.* FROM notices n JOIN pages p ON p.id = n.page_id WHERE p.account_id = ? AND (n.resolved_at IS NULL OR n.resolved_at > ?) ORDER BY n.created_at DESC")
			.bind(accountId, iso(new Date(Date.now() - 14 * 86_400_000))).all<NoticeRow>(),
	]);
	return pages.results.map((p) => ({
		id: p.id, title: p.title, intro: p.intro, address: p.host ? `https://${p.host}/` : `${origin}/status/${p.slug}`, monitors: JSON.parse(p.monitors) as string[],
		notices: notices.results.filter((n) => n.page_id === p.id).map(apiNotice),
	}));
}

/** Everything under /api/v1. */
export async function handleV1(request: Request, env: Env, url: URL): Promise<Response> {
	const db = env.DB;
	const path = url.pathname.replace(/\/+$/, "") || "/api/v1";
	const method = request.method;
	if (method === "OPTIONS") return problem(405, "The API is for servers and scripts, not web pages, so it has no browser (CORS) headers.");
	if (path === "/api/v1") return answer({ name: "Site Watch API", version: "v1", docs: DOCS, endpoints: ENDPOINTS });
	if (url.searchParams.has("key") || url.searchParams.has("api_key")) {
		return problem(400, `Send your key in the Authorization header (Authorization: Bearer ${KEY_PREFIX}...), not in the address, where it ends up in logs and browser history.`);
	}
	const key = keyFrom(request);
	if (!key) return problem(401, `Add your API key: Authorization: Bearer ${KEY_PREFIX}... Make one on the Account tab, under API keys.`, { "www-authenticate": "Bearer" });
	const check = await checkKey(db, key);
	if (!check.ok) {
		const h: Record<string, string> = check.status === 401 ? { "www-authenticate": 'Bearer error="invalid_token"' } : { "retry-after": String(check.wait), "x-ratelimit-limit": String(API_LIMIT), "x-ratelimit-remaining": "0" };
		return problem(check.status, check.error, h);
	}
	const me: AccountRow = check.account;
	const limits = { "x-ratelimit-limit": String(API_LIMIT), "x-ratelimit-remaining": String(check.remaining) };
	const ok = (body: unknown, status = 200) => answer(body, status, limits);
	const no = (status: number, error: string) => problem(status, error, limits);
	const origin = url.origin;

	// Reads.
	if (method === "GET" || method === "HEAD") {
		if (path === "/api/v1/monitors") return ok({ monitors: await listMonitors(db, me.id, origin) });
		const one = /^\/api\/v1\/monitors\/([0-9a-f]{16})$/.exec(path);
		if (one) {
			const m = await getMonitor(db, me.id, one[1], origin);
			return m ? ok({ monitor: m }) : no(404, "We couldn't find that monitor. It may have been removed.");
		}
		if (path === "/api/v1/alerts") return ok({ alerts: await listAlerts(db, me.id, Number(url.searchParams.get("limit") ?? 25)) });
		if (path === "/api/v1/pages") return ok({ pages: await listPages(db, me.id, origin) });
		return no(404, `There's nothing at ${path}. See ${DOCS} for what there is.`);
	}

	// Changes: the key must be allowed to change things.
	if (method !== "POST" && method !== "DELETE") return no(405, "Use GET to read, POST to make or change, and DELETE to remove.");
	if (!check.change) return no(403, "This key can only read. Make a key that can change things on the Account tab.");
	const b = method === "POST" ? await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>) : {};
	// Runs the app's own code for this change, and passes on any error it gives.
	const run = async (appPath: string): Promise<{ res: Response; data: Record<string, unknown> }> => {
		const res = await act(env, me, appPath, method, b, url, request);
		return { res, data: await res.clone().json<Record<string, unknown>>().catch(() => ({})) };
	};
	const failed = (r: { res: Response; data: Record<string, unknown> }) => no(r.res.status, String(r.data.error ?? "That didn't work."));

	if (path === "/api/v1/monitors" && method === "POST") {
		const r = await run("/api/monitors");
		if (!r.res.ok) return failed(r);
		return ok({ monitor: await getMonitor(db, me.id, String(r.data.added), origin) }, 201);
	}
	const mon = /^\/api\/v1\/monitors\/([0-9a-f]{16})(\/(check|pause|resume))?$/.exec(path);
	if (mon) {
		if (method === "DELETE" && !mon[2]) {
			const r = await run(`/api/monitors/${mon[1]}`);
			return r.res.ok ? ok({ deleted: true, id: mon[1] }) : failed(r);
		}
		if (method === "POST" && mon[3]) {
			if (mon[3] === "check" && !isLive(me)) return no(402, "Your plan isn't active, so checks are paused.");
			const r = await run(`/api/monitors/${mon[1]}/${mon[3]}`);
			return r.res.ok ? ok({ monitor: await getMonitor(db, me.id, mon[1], origin) }) : failed(r);
		}
	}
	const pg = /^\/api\/v1\/pages\/([0-9a-f]{12})\/notices$/.exec(path);
	if (pg && method === "POST") {
		const r = await run(`/api/pages/${pg[1]}/notices`);
		if (!r.res.ok) return failed(r);
		const n = await db.prepare("SELECT * FROM notices WHERE page_id = ? ORDER BY id DESC LIMIT 1").bind(pg[1]).first<NoticeRow>();
		return ok({ notice: n ? apiNotice(n) : null }, 201);
	}
	const nt = /^\/api\/v1\/notices\/(\d+)\/resolve$/.exec(path);
	if (nt && method === "POST") {
		const r = await run(`/api/notices/${nt[1]}/resolve`);
		if (!r.res.ok) return failed(r);
		const n = await db.prepare("SELECT * FROM notices WHERE id = ?").bind(Number(nt[1])).first<NoticeRow>();
		return ok({ notice: n ? apiNotice(n) : null });
	}
	return no(404, `There's nothing at ${method} ${path}. See ${DOCS} for what there is.`);
}
