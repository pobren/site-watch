// Site Watch: watches your websites, mail servers, ports and scheduled jobs from your own Cloudflare account, and
// tells you by email, Slack, Teams, Google Chat, Discord or webhook when something stops working.
//
//   /                    the app (set-up, sign-in and the dashboard are one page: ui.ts)
//   /api/*               its JSON (api.ts, api-auth.ts, billing.ts)
//   /hb/<code>           a scheduled job checking in (no sign-in: the code is the secret)
//   /status/<address>    public status pages (status.ts), or / on a status page's own domain
//   /stripe/webhook      Stripe, when selling to clients is on (billing.ts)
//
// Every minute the cron (cron.ts) checks whatever is due.

import { deliver } from "./alerts.ts";
import { handleApi } from "./api.ts";
import { contextOf, runScheduled } from "./cron.ts";
import { alertFor, iso, isDown, step, stateOf } from "./core.ts";
import { accountById, ensureSchema, install, isLive, type Env, type MonitorRow } from "./db.ts";
import { findPage, renderStatus } from "./status.ts";
import { appPage } from "./ui.ts";

const VERSION = "1.0.0";

const SECURITY = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "same-origin",
	"x-frame-options": "DENY",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
	const out = new Response(res.body, res);
	for (const [k, v] of Object.entries({ ...SECURITY, ...extra })) if (!out.headers.has(k)) out.headers.set(k, v);
	return out;
}

/** A job checking in. Any method works, so `curl`, a browser or a webhook can call it. */
async function heartbeat(env: Env, token: string, ctx: ExecutionContext): Promise<Response> {
	const row = await env.DB.prepare("SELECT * FROM monitors WHERE token = ? AND kind = 'heartbeat'").bind(token).first<MonitorRow>();
	if (!row) return new Response("Not found\n", { status: 404 });
	const now = new Date();
	await env.DB.prepare("UPDATE monitors SET last_ping = ? WHERE id = ?").bind(iso(now), row.id).run();
	// If it was down, say it's back straight away rather than at the next look.
	const s = stateOf(row.state);
	if (isDown(s) || s.fails) {
		ctx.waitUntil((async () => {
			const account = await accountById(env.DB, row.account_id);
			if (!account || !isLive(account)) return;
			const { next, events } = step(s, { state: "up" }, now);
			await env.DB.prepare("UPDATE monitors SET state = ?, checked_at = ? WHERE id = ?").bind(JSON.stringify(next), iso(now), row.id).run();
			const c = await contextOf(env);
			for (const e of events) await deliver(env, account, alertFor(row, e, account.tz, c.link, c.app), row.id, now);
		})());
	}
	return new Response("OK\n", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (!env.DB) return new Response("Site Watch needs its D1 database: add a D1 binding called DB (see the README).", { status: 500 });
		await ensureSchema(env.DB);

		const hb = /^\/hb\/([0-9a-f]{32})\/?$/.exec(path);
		if (hb) return heartbeat(env, hb[1], ctx);

		if (path.startsWith("/api/") || path === "/stripe/webhook") {
			try {
				return withHeaders(await handleApi(request, env, path, url));
			} catch (e) {
				console.error(e);
				return withHeaders(Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 }));
			}
		}

		if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
		const page = await findPage(env.DB, path, url.hostname);
		if (page) return withHeaders(await renderStatus(env.DB, page), { "x-frame-options": "SAMEORIGIN" });

		if (["/", "/setup", "/signup", "/signin", "/reset"].includes(path)) {
			const inst = await install(env.DB);
			return withHeaders(new Response(appPage(inst.brand, VERSION), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }));
		}
		if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\nAllow: /status/\n", { headers: { "content-type": "text/plain" } });
		return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runScheduled(env, controller.scheduledTime));
	},
} satisfies ExportedHandler<Env>;
