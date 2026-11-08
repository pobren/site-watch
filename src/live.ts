// The Live view link: /live/<link>. Every check in an account on one dark screen that never scrolls, for an office
// wall, a TV's browser or a second screen, refreshing itself every minute. The owner makes (or turns off) the link from
// an app or the API, and anyone with it can watch without signing in, so it shows names and states only: never server
// addresses, heartbeat links or alert wording.

import { iso, isDown, labelOf, responseTimes, stateOf, statusOf, uptime } from "./core.ts";
import { accountById, install, isLive, type AccountRow, type MonitorRow } from "./db.ts";
import { esc } from "./status.ts";

const WORD: Record<string, string> = { up: "Working", down: "Down", cert: "Certificate problem", blocked: "Turning checks away", unsure: "Not answering once", paused: "Paused", checking: "Checking" };
const RANK: Record<string, number> = { down: 0, cert: 1, blocked: 1, unsure: 1, checking: 2, up: 3, paused: 4 };

export async function renderLive(db: D1Database, token: string): Promise<Response> {
	const gone = () => new Response("This Live view link has been turned off.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
	const row = await db.prepare("SELECT id FROM accounts WHERE live_token = ?").bind(token).first<{ id: string }>();
	if (!row) return gone();
	const account = (await accountById(db, row.id)) as AccountRow | null;
	if (!account || !isLive(account)) return gone();
	const { brand } = await install(db);
	const now = new Date();
	const mons = (await db.prepare("SELECT * FROM monitors WHERE account_id = ? ORDER BY created_at, id").bind(account.id).all<MonitorRow>()).results;
	const items = mons.map((r) => {
		const s = stateOf(r.state);
		const paused = !!r.paused_until && r.paused_until > iso(now);
		const status = statusOf(s, !!r.checked_at, paused);
		// The name the owner gave it, or the website's address; servers and heartbeats show just their kind.
		const name = r.name ?? (r.kind === "website" ? labelOf(r) : r.kind === "heartbeat" ? "Scheduled job" : r.kind === "mail" ? "Mail server" : "Server");
		return { name, status, down: isDown(s), ms: s.ms, up30: uptime(s, now, 30), line: responseTimes(s).slice(-24).map((p) => p.ms) };
	}).sort((a, b) => (RANK[a.status] ?? 5) - (RANK[b.status] ?? 5));
	const down = items.filter((i) => i.status === "down").length;
	const warn = items.filter((i) => ["cert", "blocked", "unsure"].includes(i.status)).length;
	const headline = down ? (down === 1 ? "1 is down" : `${down} are down`) : warn ? (warn === 1 ? "1 needs a look" : `${warn} need a look`) : items.length === 1 ? "Working" : `All ${items.length} working`;

	const spark = (ms: number[]) => {
		if (ms.length < 2) return "";
		const max = Math.max(...ms, 1), w = 100, h = 34;
		const pts = ms.map((v, i) => `${((i / (ms.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
		return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
	};
	const tile = (i: (typeof items)[number]) => {
		const cls = i.status === "down" ? "down" : ["cert", "blocked", "unsure"].includes(i.status) ? "warn" : i.status === "paused" ? "paused" : "up";
		const up = i.up30 === null ? "" : `<span>${i.up30 >= 99.95 ? i.up30.toFixed(0) : i.up30.toFixed(2)}% · 30 days</span>`;
		return `<div class="t ${cls}"><div class="r"><i></i><b class="st">${esc(WORD[i.status] ?? i.status)}</b>${i.ms !== null ? `<span class="ms">${Math.round(i.ms)} ms</span>` : ""}</div><div class="n">${esc(i.name)}</div><div class="sp">${spark(i.line)}</div><div class="p">${up}</div></div>`;
	};
	const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="60"><meta name="theme-color" content="#0b0f17">
<title>Live view · ${esc(brand.name)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0f17;--panel:#111827;--line:#1f2937;--ink:#f3f4f6;--soft:#9ca3af;--up:#22c55e;--up-ink:#86efac;--warn:#f59e0b;--warn-ink:#fcd34d;--down:#f87171;--down-ink:#fca5a5}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;flex-wrap:wrap;align-items:center;gap:14px 24px;padding:20px clamp(16px,3vw,40px);border-bottom:1px solid var(--line)}
header img{width:44px;height:44px;border-radius:10px}
.ti small{display:block;color:var(--soft);font-weight:800;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}
.ti b{display:block;font-size:clamp(1.3rem,2.4vw,1.8rem)}.ti b.bad{color:var(--down-ink)}
.gap{flex:1}.dot{width:12px;height:12px;border-radius:50%;background:var(--up);box-shadow:0 0 0 5px rgba(34,197,94,.22);display:inline-block;margin-right:10px}
.dot.bad{background:var(--down);box-shadow:0 0 0 5px rgba(248,113,113,.25)}.live{color:#d1d5db;display:flex;align-items:center}
#clock{font:700 clamp(2rem,4vw,2.8rem)/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;padding:24px clamp(16px,3vw,40px)}
.t{background:var(--panel);border:2px solid var(--line);border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:9px;min-height:148px}
.t.warn{background:#1c1608;border-color:#a16207}.t.down{background:#2a0d10;border-color:#dc2626}
.r{display:flex;align-items:center;gap:10px}.r i{width:12px;height:12px;border-radius:50%;background:var(--up)}
.warn .r i{background:var(--warn)}.down .r i{background:var(--down)}.paused .r i{background:#60a5fa}
.st{font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--up-ink)}
.ms{margin-left:auto;font:700 .95rem ui-monospace,Menlo,monospace;color:var(--up-ink)}
.warn .st,.warn .ms{color:var(--warn-ink)}.down .st,.down .ms{color:var(--down-ink)}.paused .st,.paused .ms{color:#93c5fd}
.n{font-size:1.3rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp{height:34px;color:#4ade80}.warn .sp{color:#fbbf24}.down .sp{color:var(--down)}.sp svg{width:100%;height:34px;display:block}
.p{font-size:.82rem;color:var(--soft);font-weight:600}
.e{color:var(--soft);padding:60px 0;text-align:center;grid-column:1/-1}
footer{display:flex;flex-wrap:wrap;gap:8px 28px;padding:14px clamp(16px,3vw,40px);border-top:1px solid var(--line);color:var(--soft);font-size:.88rem}
</style></head><body>
<header>${brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : ""}<div class="ti"><small>Live view</small><b${down ? ' class="bad"' : ""}>${esc(headline)}</b></div><span class="gap"></span>
<span class="live"><span class="dot${down ? " bad" : ""}"></span>Live · refreshes every minute</span><span id="clock"></span></header>
<main>${items.length ? items.map(tile).join("") : `<p class="e">Nothing watched yet.</p>`}</main>
<footer><span>${esc(brand.name)}</span><span class="gap"></span><span>Updated ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: account.tz || "UTC" })}</span></footer>
<script>const c=document.getElementById("clock"),t=()=>c.textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});t();setInterval(t,1000);try{navigator.wakeLock&&navigator.wakeLock.request("screen")}catch(e){}</script>
</body></html>`;
	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}
