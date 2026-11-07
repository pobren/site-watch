// Site Watch: watches your websites, mail servers, ports and scheduled jobs from your own Cloudflare account, and
// tells you by email, Slack, Teams, Google Chat, Discord or webhook when something stops working.
//
//   /                    the app (set-up, sign-in and the dashboard are one page: ui.ts)
//   /api/*               its JSON (api.ts, api-auth.ts, billing.ts)
//   /api/v1/*            the public API, with an API key (v1.ts, keys.ts)
//   /mcp                 the AI connector (mcp.ts), with its OAuth sign-in (connect.ts, oauth.ts)
//   /hb/<code>           a scheduled job checking in (no sign-in: the code is the secret)
//   /status/<address>    public status pages (status.ts), or / on a status page's own domain
//   /stripe/webhook      Stripe, when selling to clients is on (billing.ts)
//   /sw.js               the service worker that shows browser alerts (push.ts)
//   /api/app/*           apps on phones and computers: sign-in, QR codes and alerts through Apple (apps.ts, apns.ts)
//   /app/connect         where a sign-in QR code points
//
// Every minute the cron (cron.ts) checks whatever is due, itself or through a Cloudflare Queue on big installs.
// With static files (the ASSETS binding), people who aren't signed in see the home page at / instead of sign-in.

import { deliver } from "./alerts.ts";
import { handleApi } from "./api.ts";
import { contextOf, runQueue, runScheduled } from "./cron.ts";
import { alertFor, iso, isDown, step, stateOf } from "./core.ts";
import { accountById, ensureSchema, install, isLive, type CheckBatch, type Env, type MonitorRow } from "./db.ts";
import { SERVICE_WORKER } from "./push.ts";
import { configure, WL } from "./whitelabel.ts";
import { handleConnector, isConnectorPath } from "./connect.ts";
import { findPage, renderStatus } from "./status.ts";
import { handleV1 } from "./v1.ts";
import { appPage, connectPage } from "./ui.ts";

const VERSION = "1.5.0";

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
		configure(env);
		const url = new URL(request.url);
		const path = url.pathname;
		if (!env.DB) return new Response("Site Watch needs its D1 database: add a D1 binding called DB (see the README).", { status: 500 });
		await ensureSchema(env.DB);

		const hb = /^\/hb\/([0-9a-f]{32})\/?$/.exec(path);
		if (hb) return heartbeat(env, hb[1], ctx);

		if (path === "/api/v1" || path.startsWith("/api/v1/")) {
			try {
				return withHeaders(await handleV1(request, env, url));
			} catch (e) {
				console.error(e);
				return withHeaders(Response.json({ error: "Something went wrong on our side. Please try again.", docs: WL.docs }, { status: 500 }));
			}
		}
		if (isConnectorPath(path)) return withHeaders(await handleConnector(request, env, url, VERSION));

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

		// The QR code on the Account tab holds this address. The app reads it; a phone's camera opens the app here once
		// it's installed (universal links), or this page, which says what to do.
		if (path === "/app/connect") {
			const b = (await install(env.DB)).brand;
			return withHeaders(new Response(connectPage(b.name, b.colour), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }));
		}
		if (path === "/.well-known/apple-app-site-association" && env.APNS_TEAM_ID && env.APNS_TOPIC) {
			const id = `${env.APNS_TEAM_ID}.${env.APNS_TOPIC}`;
			return Response.json({ applinks: { details: [{ appIDs: [id], components: [{ "/": "/app/connect", comment: "Sign in to the app with a QR code" }] }] }, webcredentials: { apps: [id] } });
		}

		if (path === "/sw.js") return new Response(SERVICE_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } });

		// Lets phones add the app to the Home Screen (needed for alerts on iPhone). Static files can replace it.
		if (path === "/manifest.webmanifest") {
			const own = env.ASSETS ? await env.ASSETS.fetch(request) : null;
			if (own?.ok) return own;
			const b = (await install(env.DB)).brand;
			return Response.json({ name: b.name, short_name: b.name, start_url: "/app", display: "standalone", background_color: "#ffffff", theme_color: b.colour, icons: b.logo ? [{ src: b.logo, sizes: "any" }] : [] }, { headers: { "content-type": "application/manifest+json" } });
		}

		// A home page for visitors who aren't signed in, when the install has one.
		const signedIn = /(?:^|;\s*)sw_session=/.test(request.headers.get("cookie") ?? "");
		if (path === "/" && env.ASSETS && !signedIn) {
			const home = await env.ASSETS.fetch(request);
			if (home.ok) return withHeaders(home);
		}
		if (["/", "/app", "/setup", "/signup", "/signin", "/reset", "/verify"].includes(path)) {
			const inst = await install(env.DB);
			return withHeaders(new Response(appPage(inst.brand, VERSION, WL.docs), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }));
		}
		if (env.ASSETS) {
			const file = await env.ASSETS.fetch(request);
			if (file.status !== 404) return withHeaders(file);
		}
		if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\nAllow: /status/\n", { headers: { "content-type": "text/plain" } });
		return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		configure(env);
		ctx.waitUntil(runScheduled(env, controller.scheduledTime));
	},

	async queue(batch: MessageBatch<CheckBatch>, env: Env): Promise<void> {
		configure(env);
		await runQueue(env, batch.messages);
	},
} satisfies ExportedHandler<Env, CheckBatch>;
