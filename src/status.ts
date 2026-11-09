// Public status pages: /status/<address>, or the home page of a custom domain set on the page (status.example.com).
// Each shows whether things are working now, 90 days of daily uptime bars, and any notices.

import { overall, shownOf, statusOf, stateOf, uptime, dailyBars, iso, type Shown } from "./core.ts";
import { install, isLive, accountById, hasPro, type MonitorRow } from "./db.ts";

interface PageRow { id: string; account_id: string; slug: string; title: string; intro: string | null; host: string | null; monitors: string; logo?: string | null; support?: string | null; colour?: string | null }
interface NoticeRow { id: number; title: string; body: string; impact: string; created_at: string; resolved_at: string | null }

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const WORDS: Record<Shown, string> = { up: "Working", down: "Down", degraded: "Problems", maintenance: "Maintenance", unknown: "Checking" };

export async function findPage(db: D1Database, path: string, host: string, pageDomain?: string): Promise<PageRow | null> {
	const m = /^\/status\/([a-z0-9-]{2,40})\/?$/.exec(path);
	if (m) return db.prepare("SELECT * FROM pages WHERE slug = ?").bind(m[1]).first<PageRow>();
	if (path === "/" || path === "") {
		const h = host.toLowerCase();
		const sub = pageDomain && h.endsWith(`.${pageDomain}`) ? h.slice(0, -pageDomain.length - 1) : null;
		if (sub && /^[a-z0-9-]{2,40}$/.test(sub)) return db.prepare("SELECT * FROM pages WHERE slug = ?").bind(sub).first<PageRow>();
		return db.prepare("SELECT * FROM pages WHERE host = ?").bind(h).first<PageRow>();
	}
	return null;
}

export async function statusData(db: D1Database, page: PageRow, now = new Date()) {
	const ids: string[] = JSON.parse(page.monitors);
	const rows = ids.length
		? (await db.prepare(`SELECT * FROM monitors WHERE account_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(page.account_id, ...ids).all<MonitorRow>()).results
		: [];
	const order = new Map(ids.map((id, i) => [id, i]));
	rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
	const items = rows.map((r) => {
		const s = stateOf(r.state);
		const paused = !!r.paused_until && r.paused_until > iso(now);
		const shown = shownOf(statusOf(s, !!r.checked_at, paused));
		// Only the name goes on the public page: never the server's address or the heartbeat link.
		const name = r.name ?? (r.kind === "website" || r.kind === "api" ? new URL(r.url!).hostname : r.kind === "heartbeat" ? "Scheduled job" : r.kind === "dns" ? r.host! : "Server");
		return { name, state: shown, uptime90: uptime(s, now, 90), bars: dailyBars(s, now).map((b) => b.up) };
	});
	const { results: notices } = await db.prepare("SELECT * FROM notices WHERE page_id = ? AND (resolved_at IS NULL OR resolved_at > ?) ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT 20")
		.bind(page.id, iso(new Date(now.getTime() - 14 * 86_400_000))).all<NoticeRow>();
	const open = notices.filter((n) => !n.resolved_at);
	let all = overall(items.map((i) => i.state));
	if (open.some((n) => n.impact === "major") && all.state === "up") all = { state: "degraded", text: "Some problems" };
	else if (open.some((n) => n.impact === "maintenance") && all.state === "up") all = { state: "maintenance", text: "Maintenance under way" };
	return { title: page.title, intro: page.intro, logo: page.logo ?? null, support: page.support ?? null, colour: page.colour ?? null, overall: all, items, notices, updated: iso(now) };
}

/** How long a notice was up, in words: "under a minute", "35 minutes", "2 hours 10 minutes", "3 days 4 hours". */
export const lasted = (from: string, to: string) => {
	const m = Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60000));
	const n = (v: number, w: string) => `${v} ${w}${v === 1 ? "" : "s"}`;
	if (m < 1) return "Under a minute";
	if (m < 60) return n(m, "minute");
	const h = Math.floor(m / 60), d = Math.floor(h / 24);
	if (d) return h % 24 ? `${n(d, "day")} ${n(h % 24, "hour")}` : n(d, "day");
	return m % 60 ? `${n(h, "hour")} ${n(m % 60, "minute")}` : n(h, "hour");
};
const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export async function renderStatus(db: D1Database, page: PageRow): Promise<Response> {
	const account = await accountById(db, page.account_id);
	if (!account || !isLive(account)) return new Response("This status page isn't available.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
	const d = await statusData(db, page);
	// Logo, colour and contact are Pro: a page on a free plan shows none of them.
	if (!(await hasPro(db, account))) { d.logo = null; d.support = null; d.colour = null; }
	const { brand, origin } = await install(db);
	const colour: Record<Shown, string> = { up: "#15803d", down: "#b91c1c", degraded: "#b45309", maintenance: "#1d4ed8", unknown: "#64748b" };
	const kindColour = (n: NoticeRow) => n.impact === "maintenance" ? colour.maintenance : n.impact === "major" ? colour.down : colour.degraded;
	const kindWord = (n: NoticeRow) => n.impact === "maintenance" ? "Maintenance" : n.impact === "major" ? "Major problem" : "Minor problem";
	// Each notice: a Live or Resolved tag, its kind, when it started and (once over) when it was resolved and how long it lasted.
	const noticeCard = (n: NoticeRow) => {
		const done = !!n.resolved_at;
		const c = done ? colour.up : kindColour(n);
		const tags = `<div class="tags"><span class="tag" style="background:${c};color:#fff">${done ? "Resolved" : n.impact === "maintenance" ? "In progress" : "Live"}</span><span class="tag" style="color:${kindColour(n)};border-color:${kindColour(n)}">${kindWord(n)}</span></div>`;
		const times = `<dl class="times"><div><dt>Started</dt><dd>${when(n.created_at)}</dd></div>${done ? `<div><dt>Resolved</dt><dd>${when(n.resolved_at!)}</dd></div><div><dt>Lasted</dt><dd>${lasted(n.created_at, n.resolved_at!)}</dd></div>` : ""}</dl>`;
		return `<div class="card notice" style="border-left:5px solid ${c}">${tags}<h3>${esc(n.title)}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ""}${times}</div>`;
	};
	const bar = (v: number | null) => `<i style="background:${v === null ? "#e2e8f0" : v >= 99.9 ? colour.up : v >= 98 ? "#84cc16" : v >= 90 ? colour.degraded : colour.down}" title="${v === null ? "No checks" : `${v}% up`}"></i>`;
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)}</title><meta name="description" content="${esc(d.overall.text)}"><meta http-equiv="refresh" content="60">
<style>
:root{--brand:${esc(d.colour || brand.colour)};--ink:#0f172a;--soft:#475569;--line:#e2e8f0;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;border-top:6px solid var(--brand);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:860px;margin:0 auto;padding:32px 16px 48px}
header{display:flex;align-items:center;gap:14px;margin-bottom:20px}header img{height:48px;width:auto;max-width:200px;object-fit:contain}
h1{font-size:28px;margin:0;line-height:1.2}.intro{color:var(--soft);margin:0 0 20px}
.banner{display:flex;align-items:center;gap:12px;padding:20px;border-radius:14px;color:#fff;font-size:22px;font-weight:700;margin-bottom:24px}
.banner svg{flex:none}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.name{font-weight:700;font-size:18px}
.pill{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:15px}.dot{width:12px;height:12px;border-radius:50%}
.bars{display:flex;gap:2px;margin-top:12px;height:34px}.bars i{flex:1;border-radius:3px;min-width:2px}
.under{display:flex;justify-content:space-between;color:var(--soft);font-size:13px;margin-top:6px}
.notice h3{margin:0 0 4px;font-size:18px}.notice p{margin:6px 0 0;white-space:pre-wrap}.notice small{color:var(--soft)}
.tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.tag{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 10px;border-radius:999px;border:1.5px solid transparent}
.times{display:flex;gap:24px;flex-wrap:wrap;margin:14px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:14px}.times dt{color:var(--soft);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.times dd{margin:2px 0 0;font-weight:600}
h2{font-size:20px;margin:28px 0 12px}footer{margin-top:32px;color:var(--soft);font-size:14px;text-align:center}footer a{color:inherit}
@media(max-width:560px){.bars i:nth-child(-n+60){display:none}.span90{display:none}.span30{display:inline!important}}
</style></head><body><main>
<header>${d.logo ? `<img src="${esc(d.logo)}" alt="">` : ""}<h1>${esc(d.title)}</h1></header>
${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ""}
<div class="banner" style="background:${colour[d.overall.state]}">${d.overall.state === "up"
		? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
		: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'}${esc(d.overall.text)}</div>
${d.notices.filter((n) => !n.resolved_at).map(noticeCard).join("")}
${d.items.map((i) => `<div class="card"><div class="row"><span class="name">${esc(i.name)}</span><span class="pill" style="color:${colour[i.state]}"><span class="dot" style="background:${colour[i.state]}"></span>${WORDS[i.state]}</span></div>
<div class="bars">${i.bars.map(bar).join("")}</div><div class="under"><span><span class="span90">90 days ago</span><span class="span30" style="display:none">30 days ago</span></span><span>${i.uptime90 === null ? "" : `${i.uptime90}% up`}</span><span>Today</span></div></div>`).join("") || '<div class="card">Nothing on this page yet.</div>'}
${d.notices.some((n) => n.resolved_at) ? `<h2>Recently</h2>${d.notices.filter((n) => n.resolved_at).map(noticeCard).join("")}` : ""}
<footer>Updated ${when(d.updated)}. This page refreshes itself every minute.${d.support ? `<br>Questions? ${d.support.includes("@") ? `<a href="mailto:${esc(d.support)}">${esc(d.support)}</a>` : `<a href="${esc(d.support)}">${esc(d.support.replace(/^https:\/\//, ""))}</a>`}` : ""}<br>Monitored by ${origin ? `<a href="${esc(origin)}">${esc(brand.name)}</a>` : esc(brand.name)}${brand.hideCredit ? "" : ' · Runs on <a href="https://paulobrien.dev/watch/">Site Watch</a>'}</footer>
</main></body></html>`;
	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" } });
}

