// The app's one page: set-up, sign-in, sign-up and the dashboard, drawn in the browser from /api/state.
// Plain JavaScript with no build step, so the Worker serves it as it is. Text is always put on the page as text
// (never as HTML), so nothing anyone types can run as code.

import type { Brand } from "./db.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function appPage(brand: Brand, version: string, docs = "https://paulobrien.dev/watch/api/"): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="${esc(brand.name)}"><link rel="apple-touch-icon" href="/icon-192.png">
<title>${esc(brand.name)}</title><meta name="robots" content="noindex">
<link rel="icon" href="${brand.logo ? esc(brand.logo) : `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${brand.colour}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`)}`}">
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="${esc(brand.colour)}">
<style>${CSS.replace("--brand:#0f766e", `--brand:${brand.colour}`)}</style></head>
<body><div id="app"><p class="loading">Loading…</p></div>
<script>window.SW=${JSON.stringify({ version, docs }).replace(/</g, "\\u003c")};</script>
<script>${JS}</script></body></html>`;
}

/** Where a sign-in QR code points, for someone who scans it with their phone's camera instead of the app. */
export function connectPage(name: string, colour: string): string {
	const n = esc(name);
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to the ${n} app</title><meta name="robots" content="noindex">
<style>body{margin:0;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f1f5f9;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;max-width:440px}h1{font-size:26px;line-height:1.2;margin:0 0 12px}ol{padding-left:22px;margin:0}li{margin:8px 0}b{color:${esc(colour)}}</style></head>
<body><div class="card"><h1>Sign in to the ${n} app</h1><p>This code is for the ${n} app. To use it:</p>
<ol><li>Open the <b>${n}</b> app on this phone.</li><li>Tap <b>Scan a QR code</b>.</li><li>Point it at the code on your computer screen.</li></ol></div></body></html>`;
}

const CSS = `
:root{--brand:#0f766e;--ink:#0f172a;--soft:#475569;--faint:#94a3b8;--line:#e2e8f0;--bg:#f1f5f9;--card:#fff;--up:#15803d;--down:#b91c1c;--warn:#b45309;--info:#1d4ed8}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--brand)}
.loading{padding:40px;text-align:center;color:var(--soft)}
.top{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.top .in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;color:var(--ink);text-decoration:none;margin-right:auto}
.logo img{height:32px;width:auto}.logo svg{color:var(--brand)}
nav{display:flex;gap:4px;flex-wrap:wrap}
nav button{background:none;border:0;padding:8px 12px;border-radius:10px;font:inherit;font-weight:700;color:var(--soft);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
nav button.on{background:color-mix(in srgb,var(--brand) 12%,#fff);color:var(--brand)}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{font-size:22px;margin:0 0 12px}h3{font-size:18px;margin:0 0 8px}
.lead{color:var(--soft);margin:0 0 20px;font-size:17px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:10px 16px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;min-height:44px}
.btn.main{background:var(--brand);border-color:var(--brand);color:#fff}
.btn.danger{color:var(--down)}.btn.small{padding:6px 10px;min-height:36px;font-size:14px}
.btn:disabled{opacity:.6;cursor:wait}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}

label{display:block;font-weight:700;margin:14px 0 6px}
.hint{font-weight:400;color:var(--soft);font-size:14px;margin-top:4px}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:var(--ink)}
textarea{min-height:90px}
input[type=checkbox]{width:auto;margin-right:8px;transform:scale(1.2)}
.check{display:flex;align-items:center;font-weight:600;margin:10px 0}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.err{background:#fef2f2;color:var(--down);border:1px solid #fecaca;padding:12px 14px;border-radius:12px;margin:12px 0;font-weight:600}
.ok{background:#f0fdf4;color:var(--up);border:1px solid #bbf7d0;padding:12px 14px;border-radius:12px;margin:12px 0;font-weight:600}
.note{background:#f8fafc;border:1px solid var(--line);padding:12px 14px;border-radius:12px;margin:12px 0;color:var(--soft)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px}.stat b{display:block;font-size:30px;line-height:1.1}.stat span{color:var(--soft);font-weight:600}
.mon{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start}
.dot{width:14px;height:14px;border-radius:50%;margin-top:6px;background:var(--faint)}
.s-up{background:var(--up)}.s-down{background:var(--down)}.s-cert,.s-unsure,.s-blocked{background:var(--warn)}.s-paused{background:var(--info)}
.t-up{color:var(--up)}.t-down{color:var(--down)}.t-cert,.t-unsure,.t-blocked{color:var(--warn)}.t-paused{color:var(--info)}.t-checking{color:var(--soft)}
.mon .title{font-weight:800;font-size:18px;word-break:break-word}
.mon .sub{color:var(--soft);font-size:14px;word-break:break-all}
.why{margin-top:6px;font-weight:600}
.facts{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:14px;color:var(--soft)}.facts b{color:var(--ink)}
.bars{display:flex;gap:2px;height:26px;margin-top:12px}.bars i{flex:1;border-radius:2px;min-width:2px;background:#e2e8f0}
.kind{display:inline-block;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--soft);background:#f1f5f9;border-radius:6px;padding:2px 8px;margin-left:6px;vertical-align:middle}
.more{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:8px}
.tile{border:2px solid var(--line);background:#fff;border-radius:16px;padding:16px;text-align:left;font:inherit;cursor:pointer}
.tile b{display:flex;align-items:center;gap:8px;font-size:18px}.tile span{color:var(--soft);font-size:14px}
.tile.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 6%,#fff)}
.copy{display:flex;gap:8px}.copy input{font-family:ui-monospace,Menlo,monospace;font-size:14px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:14px;color:var(--soft)}
.alert-item{padding:12px 0;border-bottom:1px solid var(--line)}.alert-item:last-child{border:0}
.alert-item pre{white-space:pre-wrap;font:inherit;color:var(--soft);margin:6px 0 0}
.centre{max-width:460px;margin:48px auto}
.plans{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.centre.wide{max-width:720px}
.seg{display:inline-flex;background:#f1f5f9;border-radius:999px;padding:4px;gap:4px;margin:2px 0 14px}
.seg button{border:0;background:none;font:inherit;font-weight:700;font-size:14px;padding:8px 16px;border-radius:999px;color:var(--soft);cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap}
.seg button[aria-pressed=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.14)}
.ptiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.ptile{position:relative;display:flex;flex-direction:column;justify-content:flex-start;border:2px solid var(--line);background:#fff;border-radius:18px;padding:18px;text-align:left;font:inherit;color:inherit;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.ptile:hover{border-color:color-mix(in srgb,var(--brand) 45%,var(--line))}
.ptile.on{border-color:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 14%,transparent)}
.ptop{display:flex;align-items:center;gap:10px;font-size:18px}
.radio{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;flex:none;color:#fff}
.ptile.on .radio{background:var(--brand);border-color:var(--brand)}
.pprice{margin:12px 0 14px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}.pprice strong{font-size:32px;line-height:1;font-weight:800}.pprice span{color:var(--soft);font-weight:600}
.pticks{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:15px}.pticks li{display:flex;gap:8px;align-items:flex-start}.pticks svg{color:var(--up);flex:none;margin-top:3px}
.step{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);margin:24px 0 10px}
.pay{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:14px;color:var(--soft);font-size:14px;font-weight:600}
.pay-by{display:flex;align-items:center;gap:6px}.pay-by .stripe{display:inline-flex;align-items:center;gap:3px;color:#635bff;font-weight:800}
.pay-cards{display:flex;gap:6px;flex-wrap:wrap}.pay-card{display:grid;place-items:center;width:50px;height:34px;border:1px solid var(--line);border-radius:6px;background:#fff}
.foot{color:var(--faint);font-size:13px;text-align:center;margin-top:32px}
.spark{width:100%;height:40px;margin-top:8px}
/* Feels like an app on phones: tabs along the bottom, a big status card, pull down to refresh. */
.status{border-radius:22px;padding:22px;margin-bottom:16px;color:#fff;display:flex;gap:16px;align-items:center;background:var(--up)}
.status.s-down{background:var(--down)}.status.s-warn{background:var(--warn)}
.status .big{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;flex:none}
.status h1{margin:0;color:#fff}.status p{margin:2px 0 0;opacity:.9}
.tabbar{display:none}
.ptr{position:fixed;left:50%;top:0;transform:translate(-50%,-60px);z-index:20;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 14px;font-weight:700;font-size:14px;color:var(--soft);box-shadow:0 6px 20px rgba(15,23,42,.12);display:flex;gap:6px;align-items:center;transition:transform .15s}
@media(max-width:720px){
 .top nav{display:none}
 .top .in{padding-top:max(12px,env(safe-area-inset-top))}
 main{padding-bottom:calc(96px + env(safe-area-inset-bottom))}
 .tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:10;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
 .tabbar button{flex:1;background:none;border:0;font:inherit;font-size:11px;font-weight:700;color:var(--faint);display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;cursor:pointer;min-width:0}
 .tabbar button,.tabbar button.on{background:none;padding:6px 0;border-radius:0}
 .tabbar button.on{color:var(--brand)}
 .tabbar button.add svg{background:var(--brand);color:#fff;border-radius:12px;padding:6px;width:36px;height:36px;margin:-10px 0 0}
 .stats{grid-template-columns:repeat(2,1fr)}
 .card{border-radius:18px}
}
@media(max-width:640px){.seg button{padding:8px 11px;font-size:13px}.two{grid-template-columns:1fr}.mon{grid-template-columns:auto 1fr}.mon .acts{grid-column:1/-1}.bars i:nth-child(-n+60){display:none}h1{font-size:26px}}
`;

// The browser side. Kept as a string; it uses only what every current browser has.
const JS = String.raw`
(() => {
const ICONS = {
	pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
	page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
	globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
	mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
	plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
	heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
	pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
	play: '<path d="m6 3 14 9-14 9z"/>',
	edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
	trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
	copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
	send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
	save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
	out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
	in: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
	down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
	open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
	card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
	cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
	tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
	lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
	phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
	chev: '<path d="m6 9 6 6 6-6"/>',
	users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
};
const icon = (n, size = 18) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[n] || ""; return s; };

function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === null || v === undefined || v === false) continue;
		if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
		else if (k === "class") el.className = v;
		else if (k === "value") el.value = v;
		else if (k === "checked") el.checked = !!v;
		else if (k === "style") el.setAttribute("style", v);
		else el.setAttribute(k, v === true ? "" : v);
	}
	for (const kid of kids.flat(9)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
	return el;
}
const btn = (label, ic, onclick, cls = "") => h("button", { class: "btn " + cls, type: "button", onclick }, icon(ic), label);
const field = (label, input, hint) => h("div", null, h("label", null, label), input, hint ? h("div", { class: "hint" }, hint) : null);
const msg = (kind, text) => h("div", { class: kind, role: kind === "err" ? "alert" : "status" }, text);

async function api(path, body, method) {
	const res = await fetch(path, { method: method || (body === undefined ? "GET" : "POST"), headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
	const data = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
	if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status, data });
	return data;
}

/** Runs an action from a button: disables it, shows any error beside it, and redraws with the new state. */
async function act(button, fn, okText) {
	const box = button.closest(".card") || document.querySelector("main");
	box.querySelectorAll(":scope > .err, :scope > .ok").forEach((e) => e.remove());
	button.disabled = true;
	try {
		const data = await fn();
		if (data && data.monitors) state = data;
		draw();
		if (okText) flash(okText);
		return data;
	} catch (e) {
		if (e.status === 401) return start();
		button.disabled = false;
		box.append(msg("err", e.message));
	}
}
let flashText = "";
function flash(t) { flashText = t; draw(); setTimeout(() => { flashText = ""; }, 100); }

const app = document.getElementById("app");
let who = null, state = null, tab = (location.hash.slice(1) || "overview"), open = new Set(), editing = null;
const brand = () => (state && state.brand) || (who && who.brand) || { name: "Site Watch", colour: "#0f766e" };
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };
const when = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const ago = (iso) => { if (!iso) return "never"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " hr ago" : Math.round(m / 1440) + " days ago"; };
const WORDS = { up: "Working", down: "Down", cert: "Certificate problem", blocked: "Turning our checks away", unsure: "Not answering once", paused: "Paused", checking: "Checking…" };
const KIND = { website: "Website", api: "API", dns: "DNS", mail: "Mail server", port: "Port", heartbeat: "Heartbeat" };
const KIND_ICON = { website: "globe", api: "code", dns: "list", mail: "mail", port: "plug", heartbeat: "heart" };
const everyWords = (m) => m < 1 ? Math.round(m * 60) + " seconds" : m % 1440 === 0 ? (m === 1440 ? "day" : m / 1440 + " days") : m % 60 === 0 ? (m === 60 ? "hour" : m / 60 + " hours") : m === 1 ? "minute" : m + " minutes";

function logo() {
	const b = brand();
	return h("a", { class: "logo", href: "/" }, b.logo ? h("img", { src: b.logo, alt: "" }) : icon("pulse", 28), b.name);
}

function copyBox(value) {
	const input = h("input", { value, readonly: true, onclick: (e) => e.target.select() });
	return h("div", { class: "copy" }, input, btn("Copy", "copy", async (e) => { try { await navigator.clipboard.writeText(value); e.currentTarget.lastChild.textContent = "Copied"; } catch { input.select(); } }, "small"));
}

// -- Before sign-in ----------------------------------------------------------------------

// Cloudflare Turnstile under a form, when the owner has switched it on (whoami gives the site key). Cloudflare's
// script loads the first time a form needs it. Most people see nothing; a few are asked to tick a box.
let tsApi = null;
function tsLoad() {
	return tsApi || (tsApi = new Promise((ok, bad) => {
		window.swTsReady = () => ok(window.turnstile);
		const s = document.createElement("script");
		s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=swTsReady";
		s.async = true;
		s.onerror = () => { tsApi = null; bad(new Error("load")); };
		document.head.append(s);
	}));
}
/** Adds the widget to a form. Returns a function that gives a fresh answer for the next try ("" if none came). */
function robotCheck(form) {
	const key = who && who.turnstile;
	if (!key) return async () => undefined;
	const box = h("div", { class: "ts-box" });
	form.querySelector(".btns").before(box);
	let id = null, token = "";
	const waiting = [];
	const hand = (v) => waiting.splice(0).forEach((f) => f(v));
	tsLoad().then((t) => { id = t.render(box, { sitekey: key, appearance: "interaction-only", callback: (v) => { token = v; hand(v); }, "expired-callback": () => { token = ""; }, "error-callback": () => hand("") }); }).catch(() => hand(""));
	return () => new Promise((ok) => {
		const give = (v) => { token = ""; if (id !== null) setTimeout(() => window.turnstile.reset(id), 0); ok(v); };
		if (token) return give(token);
		const timer = setTimeout(() => give(""), 20000);
		waiting.push((v) => { clearTimeout(timer); give(v); });
	});
}

function centre(...kids) { app.replaceChildren(h("main", null, h("div", { class: "centre" }, h("div", { style: "margin-bottom:20px" }, logo()), ...kids))); }

function setupView() {
	const code = new URLSearchParams(location.search).get("setup") || new URLSearchParams(location.search).get("code") || "";
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button"), async () => { await api("/api/setup", { code, email: email.value, password: pw.value, tz: tz(), ts: await robot() }); location.href = "/"; }); } },
		h("h1", null, who.hasOwner ? "Reset the owner's password" : "Set up " + brand().name),
		h("p", { class: "lead" }, who.hasOwner ? "This link can choose a new email address and password for the owner's account." : "Make your account. You'll sign in with this email address and password."),
		!code ? msg("err", "This link has no set-up code. Open /setup?code= followed by the SETUP_TOKEN secret you chose.") : null,
		field("Your email address", email, "Alerts go here too. You can change that later."),
		field("Choose a password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("check"), who.hasOwner ? "Save and sign in" : "Make my account")));
	const robot = robotCheck(card);
	centre(card);
}

function signinView(note) {
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { await api("/api/signin", { email: email.value, password: pw.value, ts: await robot() }); const next = new URLSearchParams(location.search).get("next") || ""; if (next.startsWith("/authorize?")) { location.href = next; return; } history.replaceState(null, "", "/"); start(); }); } },
		h("h1", null, "Sign in"),
		note ? msg("ok", note) : null,
		field("Email address", email), field("Password", pw),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("in"), "Sign in"), btn("Forgotten your password?", "key", forgotView)),
		who && who.sell ? h("p", null, "New here? ", h("a", { href: "/signup" }, "Choose a plan and sign up")) : null);
	const robot = robotCheck(card);
	centre(card);
}

function forgotView() {
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { const r = await api("/api/forgot", { email: email.value, ts: await robot() }); card.replaceChildren(h("h1", null, "Check your email"), h("p", null, "If there's an account for that address, we've sent a link to choose a new password. It works for an hour."), r.owner ? h("p", { class: "hint" }, "Email isn't set up on this install yet. The owner can reset their password with their set-up link instead.") : null, h("div", { class: "btns" }, btn("Back to sign in", "in", () => signinView()))); }); } },
		h("h1", null, "Choose a new password"), field("Your email address", email),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("send"), "Send me a link"), btn("Back", "in", () => signinView())));
	const robot = robotCheck(card);
	centre(card);
}

function resetView() {
	const token = new URLSearchParams(location.search).get("token") || "";
	const joining = new URLSearchParams(location.search).get("join") === "1";
	const nm = h("input", { autocomplete: "name" });
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { await api("/api/reset", { token, password: pw.value, name: nm.value }); location.href = "/"; }); } },
		h("h1", null, joining ? "Join the team" : "Choose a new password"), joining ? h("p", null, "Choose a password for your own login. You'll sign in with the email address the invitation went to.") : null,
		joining ? field("Your name", nm) : null, field(joining ? "Password" : "New password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("save"), "Save and sign in")));
	centre(card);
}

const CHANNEL_WORDS = { email: "email alerts", push: "email and browser alerts", all: "alerts by email, browser, Slack, Teams, Google Chat, Discord and webhook" };
const planLine = (p) => p.monitors + (p.monitors === 1 ? " monitor" : " monitors") + ", checked every " + everyWords(p.minEvery) + (p.fast ? " (" + p.fast + " every 30 seconds)" : "") + ", " + CHANNEL_WORDS[p.channels || "all"] + (p.alertsPerDay ? " (up to " + p.alertsPerDay + " a day)" : "") + (p.pages ? ", " + p.pages + " status page" + (p.pages === 1 ? "" : "s") : "") + (p.phoneAlerts ? ", " + p.phoneAlerts + " text or WhatsApp alerts a month" : "") + (p.subscribers ? ", " + p.subscribers.toLocaleString("en-GB") + " status page subscribers" : "") + (p.locked ? ", password protected status pages" : "") + (p.speeds ? ", speed from 3 regions for " + p.speeds : "") + (p.seats > 1 ? ", " + p.seats + " team logins" : "") + (p.alertPeople ? ", alerts for " + p.alertPeople + " more people" : "");

const BRANDS = {"visa":["Visa","1A1F71","M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z"],"mastercard":["Mastercard","EB001B","M11.343 18.031c.058.049.12.098.181.146-1.177.783-2.59 1.238-4.107 1.238C3.32 19.416 0 16.096 0 12c0-4.095 3.32-7.416 7.416-7.416 1.518 0 2.931.456 4.105 1.238-.06.051-.12.098-.165.15C9.6 7.489 8.595 9.688 8.595 12c0 2.311 1.001 4.51 2.748 6.031zm5.241-13.447c-1.52 0-2.931.456-4.105 1.238.06.051.12.098.165.15C14.4 7.489 15.405 9.688 15.405 12c0 2.31-1.001 4.507-2.748 6.031-.058.049-.12.098-.181.146 1.177.783 2.588 1.238 4.107 1.238C20.68 19.416 24 16.096 24 12c0-4.094-3.32-7.416-7.416-7.416zM12 6.174c-.096.075-.189.15-.28.231C10.156 7.764 9.169 9.765 9.169 12c0 2.236.987 4.236 2.551 5.595.09.08.185.158.28.232.096-.074.189-.152.28-.232 1.563-1.359 2.551-3.359 2.551-5.595 0-2.235-.987-4.236-2.551-5.595-.09-.08-.184-.156-.28-.231z"],"americanexpress":["American Express","2E77BC","M16.015 14.378c0-.32-.135-.496-.344-.622-.21-.12-.464-.135-.81-.135h-1.543v2.82h.675v-1.027h.72c.24 0 .39.024.478.125.12.13.104.38.104.55v.35h.66v-.555c-.002-.25-.017-.376-.108-.516-.06-.08-.18-.18-.33-.234l.02-.008c.18-.072.48-.297.48-.747zm-.87.407l-.028-.002c-.09.053-.195.058-.33.058h-.81v-.63h.824c.12 0 .24 0 .33.05.098.048.156.147.15.255 0 .12-.045.215-.134.27zM20.297 15.837H19v.6h1.304c.676 0 1.05-.278 1.05-.884 0-.28-.066-.448-.187-.582-.153-.133-.392-.193-.73-.207l-.376-.015c-.104 0-.18 0-.255-.03-.09-.03-.15-.105-.15-.21 0-.09.017-.166.09-.21.083-.046.177-.066.272-.06h1.23v-.602h-1.35c-.704 0-.958.437-.958.84 0 .9.776.855 1.407.87.104 0 .18.015.225.06.046.03.082.106.082.18 0 .077-.035.15-.08.18-.06.053-.15.07-.277.07zM0 0v10.096L.81 8.22h1.75l.225.464V8.22h2.043l.45 1.02.437-1.013h6.502c.295 0 .56.057.756.236v-.23h1.787v.23c.307-.17.686-.23 1.12-.23h2.606l.24.466v-.466h1.918l.254.465v-.466h1.858v3.948H20.87l-.36-.6v.585h-2.353l-.256-.63h-.583l-.27.614h-1.213c-.48 0-.84-.104-1.08-.24v.24h-2.89v-.884c0-.12-.03-.12-.105-.135h-.105v1.036H6.067v-.48l-.21.48H4.69l-.202-.48v.465H2.235l-.256-.624H1.4l-.256.624H0V24h23.786v-7.108c-.27.135-.613.18-.973.18H21.09v-.255c-.21.165-.57.255-.914.255H14.71v-.9c0-.12-.018-.12-.12-.12h-.075v1.022h-1.8v-1.066c-.298.136-.643.15-.928.136h-.214v.915h-2.18l-.54-.617-.57.6H4.742v-3.93h3.61l.518.602.554-.6h2.412c.28 0 .74.03.942.225v-.24h2.177c.202 0 .644.045.903.225v-.24h3.265v.24c.163-.164.508-.24.803-.24h1.89v.24c.194-.15.464-.24.84-.24h1.176V0H0zM21.156 14.955c.004.005.006.012.01.016.01.01.024.01.032.02l-.042-.035zM23.828 13.082h.065v.555h-.065zM23.865 15.03v-.005c-.03-.025-.046-.048-.075-.07-.15-.153-.39-.215-.764-.225l-.36-.012c-.12 0-.194-.007-.27-.03-.09-.03-.15-.105-.15-.21 0-.09.03-.16.09-.204.076-.045.15-.05.27-.05h1.223v-.588h-1.283c-.69 0-.96.437-.96.84 0 .9.78.855 1.41.87.104 0 .18.015.224.06.046.03.076.106.076.18 0 .07-.034.138-.09.18-.045.056-.136.07-.27.07h-1.288v.605h1.287c.42 0 .734-.118.9-.36h.03c.09-.134.135-.3.135-.523 0-.24-.045-.39-.135-.526zM18.597 14.208v-.583h-2.235V16.458h2.235v-.585h-1.57v-.57h1.533v-.584h-1.532v-.51M13.51 8.787h.685V11.6h-.684zM13.126 9.543l-.007.006c0-.314-.13-.5-.34-.624-.217-.125-.47-.135-.81-.135H10.43v2.82h.674v-1.034h.72c.24 0 .39.03.487.12.122.136.107.378.107.548v.354h.677v-.553c0-.25-.016-.375-.11-.516-.09-.107-.202-.19-.33-.237.172-.07.472-.3.472-.75zm-.855.396h-.015c-.09.054-.195.056-.33.056H11.1v-.623h.825c.12 0 .24.004.33.05.09.04.15.128.15.25s-.047.22-.134.266zM15.92 9.373h.632v-.6h-.644c-.464 0-.804.105-1.02.33-.286.3-.362.69-.362 1.11 0 .512.123.833.36 1.074.232.238.645.31.97.31h.78l.255-.627h1.39l.262.627h1.36v-2.11l1.272 2.11h.95l.002.002V8.786h-.684v1.963l-1.18-1.96h-1.02V11.4L18.11 8.744h-1.004l-.943 2.22h-.3c-.177 0-.362-.03-.468-.134-.125-.15-.186-.36-.186-.662 0-.285.08-.51.194-.63.133-.135.272-.165.516-.165zm1.668-.108l.464 1.118v.002h-.93l.466-1.12zM2.38 10.97l.254.628H4V9.393l.972 2.205h.584l.973-2.202.015 2.202h.69v-2.81H6.118l-.807 1.904-.876-1.905H3.343v2.663L2.205 8.787h-.997L.01 11.597h.72l.26-.626h1.39zm-.688-1.705l.46 1.118-.003.002h-.915l.457-1.12zM11.856 13.62H9.714l-.85.923-.825-.922H5.346v2.82H8l.855-.932.824.93h1.302v-.94h.838c.6 0 1.17-.164 1.17-.945l-.006-.003c0-.78-.598-.93-1.128-.93zM7.67 15.853l-.014-.002H6.02v-.557h1.47v-.574H6.02v-.51H7.7l.733.82-.764.824zm2.642.33l-1.03-1.147 1.03-1.108v2.253zm1.553-1.258h-.885v-.717h.885c.24 0 .42.098.42.344 0 .243-.15.372-.42.372zM9.967 9.373v-.586H7.73V11.6h2.237v-.58H8.4v-.564h1.527V9.88H8.4v-.507"],"applepay":["Apple Pay","000000","M2.15 4.318a42.16 42.16 0 0 0-.454.003c-.15.005-.303.013-.452.04a1.44 1.44 0 0 0-1.06.772c-.07.138-.114.278-.14.43-.028.148-.037.3-.04.45A10.2 10.2 0 0 0 0 6.222v11.557c0 .07.002.138.003.207.004.15.013.303.04.452.027.15.072.291.142.429a1.436 1.436 0 0 0 .63.63c.138.07.278.115.43.142.148.027.3.036.45.04l.208.003h20.194l.207-.003c.15-.004.303-.013.452-.04.15-.027.291-.071.428-.141a1.432 1.432 0 0 0 .631-.631c.07-.138.115-.278.141-.43.027-.148.036-.3.04-.45.002-.07.003-.138.003-.208l.001-.246V6.221c0-.07-.002-.138-.004-.207a2.995 2.995 0 0 0-.04-.452 1.446 1.446 0 0 0-1.2-1.201 3.022 3.022 0 0 0-.452-.04 10.448 10.448 0 0 0-.453-.003zm0 .512h19.942c.066 0 .131.002.197.003.115.004.25.01.375.032.109.02.2.05.287.094a.927.927 0 0 1 .407.407.997.997 0 0 1 .094.288c.022.123.028.258.031.374.002.065.003.13.003.197v11.552c0 .065 0 .13-.003.196-.003.115-.009.25-.032.375a.927.927 0 0 1-.5.693 1.002 1.002 0 0 1-.286.094 2.598 2.598 0 0 1-.373.032l-.2.003H1.906c-.066 0-.133-.002-.196-.003a2.61 2.61 0 0 1-.375-.032c-.109-.02-.2-.05-.288-.094a.918.918 0 0 1-.406-.407 1.006 1.006 0 0 1-.094-.288 2.531 2.531 0 0 1-.032-.373 9.588 9.588 0 0 1-.002-.197V6.224c0-.065 0-.131.002-.197.004-.114.01-.248.032-.375.02-.108.05-.199.094-.287a.925.925 0 0 1 .407-.406 1.03 1.03 0 0 1 .287-.094c.125-.022.26-.029.375-.032.065-.002.131-.002.196-.003zm4.71 3.7c-.3.016-.668.199-.88.456-.191.22-.36.58-.316.918.338.03.675-.169.888-.418.205-.258.345-.603.308-.955zm2.207.42v5.493h.852v-1.877h1.18c1.078 0 1.835-.739 1.835-1.812 0-1.07-.742-1.805-1.808-1.805zm.852.719h.982c.739 0 1.161.396 1.161 1.089 0 .692-.422 1.092-1.164 1.092h-.979zm-3.154.3c-.45.01-.83.28-1.05.28-.235 0-.593-.264-.981-.257a1.446 1.446 0 0 0-1.23.747c-.527.908-.139 2.255.374 2.995.249.366.549.769.944.754.373-.014.52-.242.973-.242.454 0 .586.242.98.235.41-.007.667-.366.915-.733.286-.417.403-.82.41-.841-.007-.008-.79-.308-.797-1.209-.008-.754.615-1.113.644-1.135-.352-.52-.9-.578-1.09-.593a1.123 1.123 0 0 0-.092-.002zm8.204.397c-.99 0-1.606.533-1.652 1.256h.777c.072-.358.369-.586.845-.586.502 0 .803.266.803.711v.309l-1.097.064c-.951.054-1.488.484-1.488 1.184 0 .72.548 1.207 1.332 1.207.526 0 1.032-.281 1.264-.727h.019v.659h.788v-2.76c0-.803-.62-1.317-1.591-1.317zm1.94.072l1.446 4.009c0 .003-.073.24-.073.247-.125.41-.33.571-.711.571-.069 0-.206 0-.267-.015v.666c.06.011.267.019.335.019.83 0 1.226-.312 1.568-1.283l1.5-4.214h-.868l-1.012 3.259h-.015l-1.013-3.26zm-1.167 2.189v.316c0 .521-.45.917-1.024.917-.442 0-.731-.228-.731-.579 0-.342.278-.56.769-.593z"],"googlepay":["Google Pay","5F6368","M3.963 7.235A3.963 3.963 0 00.422 9.419a3.963 3.963 0 000 3.559 3.963 3.963 0 003.541 2.184c1.07 0 1.97-.352 2.627-.957.748-.69 1.18-1.71 1.18-2.916a4.722 4.722 0 00-.07-.806H3.964v1.526h2.14a1.835 1.835 0 01-.79 1.205c-.356.241-.814.379-1.35.379-1.034 0-1.911-.697-2.225-1.636a2.375 2.375 0 010-1.517c.314-.94 1.191-1.636 2.225-1.636a2.152 2.152 0 011.52.594l1.132-1.13a3.808 3.808 0 00-2.652-1.033zm6.501.55v6.9h.886V11.89h1.465c.603 0 1.11-.196 1.522-.588a1.911 1.911 0 00.635-1.464 1.92 1.92 0 00-.635-1.456 2.125 2.125 0 00-1.522-.598zm2.427.85a1.156 1.156 0 01.823.365 1.176 1.176 0 010 1.686 1.171 1.171 0 01-.877.357H11.35V8.635h1.487a1.156 1.156 0 01.054 0zm4.124 1.175c-.842 0-1.477.308-1.907.925l.781.491c.288-.417.68-.626 1.175-.626a1.255 1.255 0 01.856.323 1.009 1.009 0 01.366.785v.202c-.34-.193-.774-.289-1.3-.289-.617 0-1.11.145-1.479.434-.37.288-.554.677-.554 1.165a1.476 1.476 0 00.525 1.156c.35.308.785.463 1.305.463.61 0 1.098-.27 1.465-.81h.038v.655h.848v-2.909c0-.61-.19-1.09-.568-1.44-.38-.35-.896-.525-1.551-.525zm2.263.154l1.946 4.422-1.098 2.38h.915L24 9.963h-.965l-1.368 3.391h-.02l-1.406-3.39zm-2.146 2.368c.494 0 .88.11 1.156.33 0 .372-.147.696-.44.973a1.413 1.413 0 01-.997.414 1.081 1.081 0 01-.69-.232.708.708 0 01-.293-.578c0-.257.12-.47.363-.647.24-.173.54-.26.9-.26Z"],"stripe":["Stripe","635BFF","M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"]};
// A payment logo, in the card scheme's own colour.
const brandMark = (k, size = 20) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("role", "img"); s.setAttribute("aria-label", BRANDS[k][0]); s.innerHTML = '<path fill="#' + BRANDS[k][1] + '" d="' + BRANDS[k][2] + '"/>'; return s; };
// "Secure payment by Stripe" with the cards and wallets Stripe Checkout takes.
const payStrip = () => h("div", { class: "pay" }, h("span", { class: "pay-by" }, icon("lock", 16), "Secure payment by", h("span", { class: "stripe" }, brandMark("stripe", 16), "Stripe")),
	h("span", { class: "pay-cards" }, ["visa", "mastercard", "americanexpress", "applepay", "googlepay"].map((k) => h("span", { class: "pay-card", title: BRANDS[k][0] }, brandMark(k, 30)))));
let signupPlans = [];
const TICK_ALERTS = { email: "Email alerts", push: "Email and browser alerts", all: "Alerts on your phone, email and team chat" };
const planTicks = (p) => [p.monitors === 1 ? "1 website" : p.monitors + " websites, servers or jobs", "Checked every " + everyWords(p.minEvery), p.fast ? "Every 30 seconds for " + (p.fast === 1 ? "1 of them" : p.fast + " of them") : null, TICK_ALERTS[p.channels || "all"] + (p.alertsPerDay ? ", up to " + p.alertsPerDay + " a day" : ""), p.pages ? p.pages + " status page" + (p.pages === 1 ? "" : "s") : null].filter(Boolean);
// "£5 a month" shows as a big "£5" and a small "a month".
const priceBits = (p, yearly) => { if (p.free) { const other = ((state && state.plans) || signupPlans).find((x) => !x.free && x.price); const cur = other ? (other.price.match(/^[^\d\s]+/) || [""])[0] : ""; return cur ? [cur + "0", "for ever"] : ["Free", ""]; } const t = (yearly && p.priceYear ? p.priceYear : p.price) || ""; const m = t.match(/^(\S+)\s+(.+)$/); return m ? [m[1], m[2]] : [t, ""]; };
const planTile = (p, on, yearly, onclick) => { const [big, small] = priceBits(p, yearly); return h(onclick ? "button" : "div", { type: onclick ? "button" : undefined, class: "ptile" + (on ? " on" : ""), "aria-pressed": onclick ? String(on) : undefined, onclick },
	h("div", { class: "ptop" }, onclick ? h("span", { class: "radio" }, on ? icon("check", 14) : null) : null, h("b", null, p.name)),
	h("div", { class: "pprice" }, h("strong", null, big), small ? h("span", null, small) : null),
	h("ul", { class: "pticks" }, planTicks(p).map((t) => h("li", null, icon("check", 16), t)))); };
// "£5 a month" and "£50 a year" means 2 months free.
const monthsFree = (plans) => { const n = (t) => parseFloat(String(t || "").replace(/[^\d.]/g, "")); for (const p of plans) { const m = n(p.price), y = n(p.priceYear); if (m > 0 && y > 0 && y < m * 12) { const f = Math.round((m * 12 - y) / m); if (f >= 1 && Math.abs(m * 12 - y - f * m) < 0.01) return f; } } return 0; };
const periodSwitch = (yearly, set, free) => h("div", { class: "seg", role: "group", "aria-label": "Pay monthly or yearly" },
	h("button", { type: "button", "aria-pressed": String(!yearly), onclick: () => set(false) }, icon("cal", 16), "Monthly"),
	h("button", { type: "button", "aria-pressed": String(yearly), onclick: () => set(true) }, icon("tag", 16), free ? "Yearly, " + free + " month" + (free === 1 ? "" : "s") + " free" : "Yearly"));

async function signupView() {
	const { plans } = await api("/api/plans");
	signupPlans = plans;
	if (!plans.length) return centre(h("div", { class: "card" }, h("h1", null, "Sign-up isn't open"), h("p", null, "Please ask whoever sent you here."), h("div", { class: "btns" }, btn("Sign in", "in", () => signinView()))));
	// A link from a home page can choose the plan: /signup?plan=pro&yearly=1 (by the plan's name or id).
	const q = new URLSearchParams(location.search);
	const want = (q.get("plan") || "").toLowerCase();
	let chosen = (plans.find((p) => p.id === want || p.name.toLowerCase() === want) || plans[0]).id;
	let yearly = q.get("yearly") === "1";
	const anyYear = plans.some((p) => p.priceYear);
	const tiles = h("div", { class: "ptiles" });
	const period = h("div");
	const submit = h("button", { class: "btn main", type: "submit" });
	const after = h("div");
	const drawTiles = () => {
		const cur = plans.find((p) => p.id === chosen);
		tiles.replaceChildren(...plans.map((p) => planTile(p, p.id === chosen, yearly, () => { chosen = p.id; drawTiles(); })));
		period.replaceChildren(anyYear ? periodSwitch(yearly, (y) => { yearly = y; drawTiles(); }, monthsFree(plans)) : "");
		submit.replaceChildren(icon(cur.free ? "check" : "lock"), cur.free ? "Start free" : "Continue to payment");
		after.replaceChildren(cur.free ? h("p", { class: "hint" }, "No card needed. You can upgrade any time from your account.") : payStrip());
	};
	drawTiles();
	const name = h("input", { autocomplete: "organization" });
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(submit, async () => { const r = await api("/api/signup", { plan: chosen, yearly, name: name.value, email: email.value, password: pw.value, tz: tz(), ts: await robot() }); location.href = r.checkout || r.next || "/"; }); } },
		h("h1", null, "Sign up"), h("p", { class: "lead" }, plans.some((p) => p.free) ? "Start free with no card, or choose a paid plan and pay securely by card." : "Choose a plan, make your account, then pay securely by card."),
		h("div", { class: "step" }, "1. Choose your plan"), period, tiles,
		h("div", { class: "step" }, "2. Make your account"),
		h("div", { class: "two" }, field("Your name or business", name), field("Email address", email, "You'll sign in with it, and alerts go here.")), field("Choose a password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, submit), after,
		h("p", null, "Already have an account? ", h("a", { href: "/signin" }, "Sign in")));
	const robot = robotCheck(card);
	centre(card);
	app.querySelector(".centre").classList.add("wide");
}

async function verifyView() {
	const token = new URLSearchParams(location.search).get("token") || "";
	try {
		await api("/api/verify", { token });
		location.href = "/?confirmed=1";
	} catch (e) {
		centre(h("div", { class: "card" }, h("h1", null, "We couldn't confirm that"), msg("err", e.message), h("div", { class: "btns" }, h("a", { class: "btn main", href: "/signin" }, icon("in"), "Sign in"))));
	}
}

// Browser alerts: the browser asks permission, makes a push subscription with this install's key, and we keep it
// as a channel. On iPhone and iPad this works once the site is added to the Home Screen (Share, Add to Home Screen).
const pushReady = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone;
async function turnOnPush() {
	if (!pushReady()) throw new Error(isApple() ? "On iPhone and iPad, add this site to your Home Screen first (tap Share, then Add to Home Screen), open it from there and try again." : "This browser can't show alerts. Try Chrome, Edge, Firefox or Safari.");
	const ok = await Notification.requestPermission();
	if (ok !== "granted") throw new Error("Alerts were blocked. Allow notifications for this site in your browser's settings, then try again.");
	const reg = await navigator.serviceWorker.register("/sw.js");
	await navigator.serviceWorker.ready;
	const { key } = await api("/api/push/key", {});
	const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4)), (c) => c.charCodeAt(0));
	const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw }));
	const device = /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android phone" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows computer" : "This browser";
	return api("/api/push", { subscription: sub.toJSON(), name: device });
}

// -- Signed in ---------------------------------------------------------------------------

function shell(content) {
	const tabs = [["overview", "Overview", "pulse"], ["add", "Add", "plus"], ["alerts", "Alerts", "bell"], ["pages", "Status pages", "page"], ["account", "Account", "user"]];
	// Viewers on a team can look but not add (team.ts).
	if (state.me.member && state.me.member.role === "viewer") tabs.splice(1, 1);
	if (state.me.role === "owner" && !state.me.member) tabs.push(["admin", "Admin", "cog"]);
	app.replaceChildren(
		h("div", { class: "top" }, h("div", { class: "in" }, logo(), h("nav", null, tabs.map(([id, label, ic]) => h("button", { class: tab === id ? "on" : "", onclick: () => go(id) }, icon(ic), label))))),
		h("main", null, flashText ? msg("ok", flashText) : null, content, h("p", { class: "foot" }, brand().name + " " + window.SW.version)),
		h("nav", { class: "tabbar", "aria-label": "Sections" }, tabs.map(([id, label, ic]) => h("button", { class: (tab === id ? "on " : "") + (id === "add" ? "add" : ""), "aria-current": tab === id ? "page" : null, onclick: () => go(id) }, icon(ic, id === "add" ? 36 : 24), SHORT[id] || label))));
}
const SHORT = { overview: "Watching", pages: "Pages" };

// Pull down from the top of the page to check for news, like a phone app.
let pullY = null, pullBox = null;
window.addEventListener("touchstart", (e) => { pullY = state && window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
window.addEventListener("touchmove", (e) => {
	if (pullY === null) return;
	const d = e.touches[0].clientY - pullY;
	if (!pullBox) { pullBox = h("div", { class: "ptr", role: "status" }, icon("refresh", 16), "Pull to refresh"); document.body.append(pullBox); }
	pullBox.style.transform = "translate(-50%," + (Math.min(d, 90) - 60) + "px)";
	pullBox.lastChild.textContent = d > 70 ? "Let go to refresh" : "Pull to refresh";
}, { passive: true });
window.addEventListener("touchend", async (e) => {
	if (pullY === null || !pullBox) { pullY = null; return; }
	const d = e.changedTouches[0].clientY - pullY, box = pullBox;
	pullY = null; pullBox = null;
	if (d > 70) {
		box.lastChild.textContent = "Refreshing…"; box.style.transform = "translate(-50%,16px)";
		try { state = await api("/api/state"); draw(); } catch {}
	}
	box.style.transform = "translate(-50%,-60px)"; setTimeout(() => box.remove(), 200);
});

function go(t) { tab = t; editing = null; newKey = null; location.hash = t; draw(); window.scrollTo(0, 0); }

function draw() {
	if (!state) return;
	const views = { overview, add, alerts, pages, account, admin };
	shell((views[tab] || overview)());
}

function bars(list) {
	return h("div", { class: "bars", "aria-label": "Daily uptime, last 90 days" }, list.map((v) => h("i", { title: v === null ? "No checks" : v + "% up", style: v === null ? "" : "background:" + (v >= 99.9 ? "var(--up)" : v >= 98 ? "#84cc16" : v >= 90 ? "var(--warn)" : "var(--down)") })));
}

function spark(points) {
	if (points.length < 2) return null;
	const max = Math.max(...points.map((p) => p.ms), 1);
	const w = 300, hgt = 40;
	const d = points.map((p, i) => (i ? "L" : "M") + (i * w / (points.length - 1)).toFixed(1) + " " + (hgt - 2 - (p.ms / max) * (hgt - 6)).toFixed(1)).join(" ");
	const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	s.setAttribute("viewBox", "0 0 " + w + " " + hgt); s.setAttribute("preserveAspectRatio", "none"); s.setAttribute("class", "spark");
	s.innerHTML = '<path d="' + d + '" fill="none" stroke="var(--brand)" stroke-width="2" vector-effect="non-scaling-stroke"/>';
	return s;
}

function overview() {
	const m = state.monitors;
	if (state.me.unverified) return h("div", null, h("h1", null, "Please confirm your email address"), h("p", { class: "lead" }, "We've sent a link to " + state.me.email + ". Once you click it, we start checking. You can add your website now."),
		h("div", { class: "btns" }, btn("Add your website", "plus", () => go("add"), "main"), btn("Send the email again", "send", (e) => act(e.currentTarget, () => api("/api/verify/again", {}), "Sent. Check your inbox and spam folder."))));
	if (!state.me.live) return h("div", null, h("h1", null, "Your plan isn't active"), h("p", { class: "lead" }, "Your checks are paused until it is. Choose a plan or update your payment on the Account tab."), btn("Open Account", "user", () => go("account"), "main"));
	if (!m.length) return h("div", null, h("h1", null, "Welcome to " + brand().name), h("p", { class: "lead" }, "Add your first website, mail server, port or scheduled job and we'll start watching it straight away."), btn("Add something to watch", "plus", () => go("add"), "main"));
	const count = (f) => m.filter(f).length;
	const down = count((x) => x.status === "down"), probs = count((x) => ["cert", "blocked", "unsure"].includes(x.status));
	const lic = state.admin && state.admin.licence;
	const last = m.map((x) => x.checkedAt).filter(Boolean).sort().pop();
	return h("div", null,
		h("div", { class: "status" + (down ? " s-down" : probs ? " s-warn" : ""), role: "status" },
			h("span", { class: "big" }, icon(down ? "alert" : probs ? "alert" : "check", 30)),
			h("div", null, h("h1", null, down ? down + " down right now" : probs ? "Something needs a look" : "Everything's working"),
				h("p", null, down ? "We keep checking and will tell you the moment it's back." : (last ? "Last checked " + ago(last) + "." : "Your first checks are on their way.")))),
		h("p", { class: "lead" }, state.regions && state.regions.length ? "Checked from Cloudflare's network. Something only counts as down after two failed checks in a row, confirmed from another region (" + state.regions.join(", ") + ")." : "Checked from Cloudflare's network. Something only counts as down after two failed checks in a row."),
		h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", { class: "t-up" }, count((x) => x.status === "up")), h("span", null, "Working")), h("div", { class: "stat" }, h("b", { class: "t-down" }, down), h("span", null, "Down")), h("div", { class: "stat" }, h("b", { class: "t-unsure" }, probs), h("span", null, "Need a look")), h("div", { class: "stat" }, h("b", null, m.length), h("span", null, "Watching"))),
		lic && lic.websites > lic.limit ? h("div", { class: "note" }, "You're watching " + lic.websites + " websites. The free licence covers one person or organisation's own websites, up to " + lic.limit + ". For more, ", h("a", { href: "https://paulobrien.dev/contact/", target: "_blank", rel: "noopener" }, "ask about a commercial licence"), ".") : null,
		m.map(monitorCard));
}

// One click to tell visitors on every status page that shows this monitor (and their subscribers).
function postOutageButton(x) {
	const pgs = state.pages.filter((p) => p.monitors.includes(x.id));
	if (!pgs.length || (state.me.member && state.me.member.role === "viewer")) return null;
	const already = state.notices.some((n) => !n.resolved_at && pgs.some((p) => p.id === n.page_id) && n.title.startsWith(x.label));
	if (already) return null;
	return btn("Post to status page", "page", (e) => { if (confirm("Post a notice that " + x.label + " is down on " + pgs.map((p) => p.title).join(" and ") + "?")) act(e.currentTarget, async () => { let r; for (const p of pgs) r = await api("/api/pages/" + p.id + "/notices", { title: x.label + " is down", body: "We know about it and we're working on it. We'll update this page when it's fixed.", impact: "major" }); return r; }, "Posted"); }, "small");
}

// Uptime for any dates in the last 90 days, as a spreadsheet (CSV) of each day.
function uptimeDownload(x) {
	const today = new Date().toISOString().slice(0, 10);
	const from = h("input", { type: "date", value: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), max: today });
	const to = h("input", { type: "date", value: today, max: today });
	return h("details", { style: "margin-top:12px" }, h("summary", { style: "cursor:pointer;font-weight:700" }, "Uptime for any dates"),
		h("div", { class: "two" }, field("From", from), field("To", to)),
		h("p", { class: "hint" }, "A spreadsheet of each day's checks and uptime, from the last 90 days."),
		h("div", { class: "btns" }, btn("Download", "down", () => { location.href = "/api/monitors/" + x.id + "/uptime.csv?from=" + from.value + "&to=" + to.value; }, "small")));
}

function monitorCard(x) {
	const isOpen = open.has(x.id);
	const facts = [];
	if (x.uptime30 !== null) facts.push(h("span", null, "Up ", h("b", null, x.uptime30 + "%"), " (30 days)"));
	if (x.ms !== null && x.kind !== "heartbeat") facts.push(h("span", null, "Answered in ", h("b", null, x.ms + " ms")));
	if (x.kind === "heartbeat") facts.push(h("span", null, "Last check-in ", h("b", null, ago(x.lastPing))));
	else facts.push(h("span", null, "Checked ", h("b", null, ago(x.checkedAt)), " · every " + everyWords(x.fast ? 0.5 : x.every)));
	if (x.cert) facts.push(h("span", { class: x.cert.daysLeft <= 7 ? "t-down" : x.cert.daysLeft <= 21 && !x.cert.auto ? "t-unsure" : "" }, "Certificate ", h("b", null, x.cert.daysLeft + " days"), x.cert.auto ? " (renews itself)" : ""));
	if (x.reg && x.reg.expires) facts.push(h("span", { class: x.reg.daysLeft <= 7 ? "t-down" : x.reg.daysLeft <= 30 ? "t-unsure" : "" }, "Domain renewal ", h("b", null, x.reg.daysLeft + " days")));
	const sub = x.kind === "website" || x.kind === "api" ? x.url : x.kind === "dns" ? x.host + " " + ((x.rules && x.rules.type) || "A") + " records" : x.kind === "heartbeat" ? "Checks in every " + everyWords(x.every) : x.host + " port " + x.port;
	return h("div", { class: "card" },
		h("div", { class: "mon" },
			h("span", { class: "dot s-" + x.status, title: WORDS[x.status] }),
			h("div", null,
				h("div", { class: "title" }, x.label, h("span", { class: "kind" }, KIND[x.kind])),
				x.name || x.kind !== "website" ? h("div", { class: "sub" }, sub) : null,
				h("div", { class: "why t-" + x.status }, WORDS[x.status], x.why && x.status !== "up" ? ": " + x.why : "", x.since ? " (since " + when(x.since) + ")" : "", x.pausedUntil ? " until " + when(x.pausedUntil) : ""),
				x.regional ? h("div", { class: "hint" }, "Only failing from our main check. Our checks from " + x.regional.join(" and ") + " can reach it, so we haven't sent an alert. We'll ask them again every 10 minutes.") : null,
				h("div", { class: "facts" }, facts)),
			h("div", { class: "acts" }, btn(isOpen ? "Less" : "More", "chev", () => { isOpen ? open.delete(x.id) : open.add(x.id); draw(); }, "small"))),
		bars(x.bars),
		isOpen ? h("div", { class: "more" },
			x.pingUrl ? h("div", null, h("h3", null, "Check-in address"), h("p", { class: "hint" }, "Have your job visit this address each time it finishes, for example: curl -fsS " + x.pingUrl), copyBox(x.pingUrl)) : null,
			x.responses.length > 1 ? h("div", null, h("h3", { style: "margin-top:12px" }, "Response time, last 24 hours"), spark(x.responses)) : null,
			x.speeds && x.speeds.length ? h("div", null, h("h3", { style: "margin-top:12px" }, "Speed from around the world, last 24 hours"),
				h("table", null, h("tr", null, h("th", null, "From"), h("th", null, "Average"), h("th", null, "Slowest hour")),
					x.responses.length ? h("tr", null, h("td", null, "Our main check"), h("td", null, Math.round(x.responses.reduce((n, r) => n + r.ms, 0) / x.responses.length) + " ms"), h("td", null, Math.max(...x.responses.map((r) => r.ms)) + " ms")) : null,
					x.speeds.map((r) => h("tr", null, h("td", null, r.region.charAt(0).toUpperCase() + r.region.slice(1)), h("td", null, r.avg + " ms"), h("td", null, r.worst + " ms")))),
				h("p", { class: "hint" }, "Checked every 5 minutes from each region, so you can see how fast it is for visitors far away.")) : null,
			x.lastFail ? h("details", { style: "margin-top:12px" }, h("summary", { style: "cursor:pointer;font-weight:700" }, "What we saw when it last failed (" + when(x.lastFail.at) + ")"),
				h("p", null, x.lastFail.status ? "Status " + x.lastFail.status + (x.lastFail.why ? ": " + x.lastFail.why : "") : x.lastFail.why || ""),
				Object.keys(x.lastFail.headers).length ? h("table", null, Object.entries(x.lastFail.headers).map(([k, v]) => h("tr", null, h("th", null, k), h("td", { style: "word-break:break-all" }, v)))) : null,
				x.lastFail.body ? h("pre", { style: "white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:var(--bg,#f8fafc);border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:13px" }, x.lastFail.body) : null) : null,
			uptimeDownload(x),
			h("h3", { style: "margin-top:12px" }, "Recent outages"),
			x.outages.length ? h("ul", null, x.outages.map((o) => h("li", null, when(o.from) + " to " + when(o.to) + ": " + o.why))) : h("p", { class: "hint" }, "None recorded."),
			x.reg && x.reg.registrar ? h("p", { class: "hint" }, x.reg.domain + " is registered with " + x.reg.registrar + (x.reg.expires ? " until " + new Date(x.reg.expires).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "") + ".") : null,
			editing === x.id ? editForm(x) : null,
			h("div", { class: "btns" },
				x.status === "down" ? postOutageButton(x) : null,
				x.kind !== "heartbeat" ? btn("Check now", "refresh", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/check", {}), "Checked")) : null,
				x.pausedUntil ? btn("Resume", "play", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/resume", {}))) : btn("Pause for an hour", "pause", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/pause", { minutes: 60 }))),
				!x.pausedUntil ? btn("Pause for a day", "pause", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/pause", { minutes: 1440 }))) : null,
				btn("Edit", "edit", () => { editing = editing === x.id ? null : x.id; draw(); }),
				btn("Remove", "trash", (e) => { if (confirm("Stop watching " + x.label + "? Its history goes too.")) act(e.currentTarget, () => api("/api/monitors/" + x.id, undefined, "DELETE")); }, "danger"))) : null);
}

function everySelect(kind, value) {
	const list = kind === "heartbeat" ? state.choices.heartbeatEvery : (state.choices.fast !== 0 ? [0.5] : []).concat(state.choices.every);
	return h("select", null, list.map((n) => h("option", { value: n, selected: n === value }, "Every " + everyWords(n))));
}

function rulesFields(r) {
	r = r || {};
	return {
		status: h("input", { inputmode: "numeric", placeholder: "Any under 500", value: r.status || "" }),
		contains: h("input", { value: r.contains || "" }),
		missing: h("input", { value: r.missing || "" }),
		maxMs: h("input", { inputmode: "decimal", placeholder: "15", value: r.maxMs ? r.maxMs / 1000 : "" }),
	};
}
const rulesOf = (f) => ({ status: f.status.value, contains: f.contains.value, missing: f.missing.value, maxMs: f.maxMs.value ? Math.round(Number(f.maxMs.value) * 1000) : "" });
const rulesBlock = (f) => h("details", null, h("summary", { style: "font-weight:700;cursor:pointer;margin-top:12px" }, "Extra rules (optional)"),
	h("div", { class: "two" }, field("Must contain", f.contains, "Words that are always on the page, such as your footer."), field("Must not contain", f.missing, "Such as Database error."), field("Status code", f.status, "Such as 200."), field("Slower than this counts as down (seconds)", f.maxMs)));

// API checks: the method, headers (one "Name: value" a line), body and a JSON value to expect, on top of the usual rules.
function apiFields(r) {
	r = r || {};
	const headersText = Object.entries(r.headers || {}).map(([k, v]) => k + ": " + v).join("\n");
	const f = {
		method: h("select", null, state.choices.apiMethods.map((m) => h("option", { value: m, selected: m === (r.method || "GET") }, m))),
		headers: h("textarea", { rows: 3, placeholder: "Authorization: Bearer your-token" }, headersText),
		body: h("textarea", { rows: 3, placeholder: '{"ping": true}' }, r.body || ""),
		path: h("input", { placeholder: "status", value: r.json ? r.json.path : "" }),
		equals: h("input", { placeholder: "ok", value: r.json ? r.json.equals : "" }),
		rules: rulesFields(r),
	};
	f.headersStart = headersText;
	return f;
}
function apiRulesOf(f) {
	const out = { ...rulesOf(f.rules), method: f.method.value, body: f.body.value };
	// Headers come back masked: only send them when they've been changed.
	if (f.headers.value !== f.headersStart) out.headers = Object.fromEntries(f.headers.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const at = l.indexOf(":"); return at > 0 ? [l.slice(0, at).trim(), l.slice(at + 1).trim()] : [l, ""]; }));
	if (f.path.value.trim()) out.json = { path: f.path.value.trim(), equals: f.equals.value };
	return out;
}
const apiBlock = (f) => [field("Method", f.method),
	h("details", null, h("summary", { style: "font-weight:700;cursor:pointer;margin-top:12px" }, "Headers, body and expected answer (optional)"),
		field("Headers", f.headers, "One a line, such as Authorization: Bearer your-token. Saved values are hidden after saving."),
		field("Body", f.body, "Sent with POST, PUT and PATCH."),
		h("div", { class: "two" }, field("JSON value", f.path, "Its path, such as status or data.ok."), field("Must equal", f.equals, "Such as ok or true.")),
		h("div", { class: "two" }, field("Must contain", f.rules.contains), field("Must not contain", f.rules.missing), field("Status code", f.rules.status, "Without one, anything under 400 counts as working."), field("Slower than this counts as down (seconds)", f.rules.maxMs)))];

function dnsFields(r) {
	r = r || {};
	return { type: h("select", null, state.choices.dnsTypes.map((t) => h("option", { value: t, selected: t === (r.type || "A") }, t))), expect: h("input", { placeholder: "Optional, such as 192.0.2.10 or mx.example.com", value: r.expect || "" }) };
}
const dnsRulesOf = (f) => ({ type: f.type.value, expect: f.expect.value });
const dnsBlock = (f) => h("div", { class: "two" }, field("Record type", f.type), field("Must include", f.expect, "Alerts if the answer stops including this. Leave empty to alert only when the records vanish."));

function editForm(x) {
	const name = h("input", { value: x.name || "" });
	const every = everySelect(x.kind, x.fast ? 0.5 : x.every);
	const rf = x.kind === "website" ? rulesFields(x.rules) : null;
	const af = x.kind === "api" ? apiFields(x.rules) : null;
	const df = x.kind === "dns" ? dnsFields(x.rules) : null;
	const extras = h("input", { type: "checkbox", checked: x.extras });
	const card = h("div", { class: "note" },
		field("Name", name), field(x.kind === "heartbeat" ? "How often it runs" : "How often to check", every),
		rf ? rulesBlock(rf) : null, af ? apiBlock(af) : null, df ? dnsBlock(df) : null,
		x.kind === "website" ? h("label", { class: "check" }, extras, "Watch the certificate and the domain's renewal date") : null,
		h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/monitors/" + x.id, { name: name.value, every: Number(every.value), ...(rf ? { rules: rulesOf(rf), extras: extras.checked } : af ? { rules: apiRulesOf(af) } : df ? { rules: dnsRulesOf(df) } : {}) }); editing = null; return r; }, "Saved"), "main")));
	return card;
}

let addKind = "website";
function add() {
	const lim = state.limits;
	const tiles = [["website", "Website", "globe", "A web page answers, has the right words and loads in time. Plus its certificate and domain renewal."],
		["api", "API", "code", "An API answers your request, with your own method, headers and body, and returns the JSON you expect."],
		["dns", "DNS", "list", "A domain's DNS records are still there, and still point where they should."],
		["mail", "Mail server", "mail", "Your mail server answers and offers encryption, for sending (587, 465) or reading (993, 143, 995, 110)."],
		["port", "Port", "plug", "Any other server and port answers, such as a database or SSH."],
		["heartbeat", "Heartbeat", "heart", "A backup or scheduled job checks in when it runs. Tells you when it doesn't."]];
	const name = h("input", { placeholder: addKind === "heartbeat" ? "Nightly backup" : "Optional" });
	const url = h("input", { placeholder: "https://example.com/", inputmode: "url" });
	const host = h("input", { placeholder: addKind === "mail" ? "mail.example.com" : addKind === "dns" ? "example.com" : "server.example.com" });
	const port = addKind === "mail" ? h("select", null, state.choices.mailPorts.map((p) => h("option", { value: p.port }, p.port + ": " + p.name))) : h("input", { inputmode: "numeric", placeholder: "22" });
	const every = everySelect(addKind, addKind === "heartbeat" ? 1440 : Math.max(5, state.choices.every[0]));
	const rf = rulesFields();
	const af = addKind === "api" ? apiFields() : null;
	const df = addKind === "dns" ? dnsFields() : null;
	const extras = h("input", { type: "checkbox", checked: true });
	const used = state.monitors.length;
	const form = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(form.querySelector("button[type=submit]"), async () => {
		const body = { kind: addKind, name: name.value, every: Number(every.value) };
		if (addKind === "website") Object.assign(body, { url: url.value, rules: rulesOf(rf), extras: extras.checked });
		if (addKind === "mail" || addKind === "port") Object.assign(body, { host: host.value, port: Number(port.value) });
		if (addKind === "api") Object.assign(body, { url: url.value, rules: apiRulesOf(af) });
		if (addKind === "dns") Object.assign(body, { host: host.value, rules: dnsRulesOf(df) });
		const r = await api("/api/monitors", body);
		open.add(r.added); tab = "overview"; location.hash = "overview";
		return r;
	}, "Added. It's been checked once already."); } },
		addKind === "website" ? [field("Web address", url, "The home page, or any page such as a login or shop page."), field("Name", name), field("How often to check", every), rulesBlock(rf), h("label", { class: "check" }, extras, "Watch the certificate and the domain's renewal date")] : null,
		addKind === "mail" || addKind === "port" ? [field("Server name", host), field("Port", port, addKind === "mail" ? "Port 25 can't be checked from Cloudflare, which doesn't allow it." : "Any port except 25."), field("Name", name), field("How often to check", every)] : null,
		addKind === "api" ? [field("API address", url, "Such as https://api.example.com/health."), field("Name", name), field("How often to check", every), ...apiBlock(af)] : null,
		addKind === "dns" ? [field("Domain or name", host, "Such as example.com or mail.example.com."), dnsBlock(df), field("Name", name), field("How often to check", every)] : null,
		addKind === "heartbeat" ? [field("Name", name, "So you know which job it is."), field("How often the job runs", every), h("p", { class: "hint" }, "Once it's added you'll get an address for the job to visit each time it runs.")] : null,
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("plus"), "Start watching")));
	return h("div", null, h("h1", null, "Add something to watch"),
		h("p", { class: "lead" }, lim.monitors !== null ? "You're using " + used + " of the " + lim.monitors + " on your plan." : "Choose what to watch."),
		h("div", { class: "tiles" }, tiles.map(([id, label, ic, text]) => h("button", { type: "button", class: "tile" + (addKind === id ? " on" : ""), onclick: () => { addKind = id; draw(); } }, h("b", null, icon(ic), label), h("span", null, text)))),
		form);
}

// Text message and WhatsApp alerts: add a phone, type its code, see what's left this month, buy a top up.
function phoneCard() {
	const p = state.phones;
	if (!p || (!p.ready.sms && !p.ready.whatsapp)) return state.me.role === "owner" ? h("div", { class: "card" }, h("h2", null, icon("phone"), " Text messages and WhatsApp"), msg("note", "Add your Twilio keys to this Worker to send alerts by text and WhatsApp (see Text and WhatsApp alerts in the README).")) : null;
	const upgrade = state.me.role === "client" && state.plans && state.plans.some((x) => !x.free && x.phoneAlerts);
	if (!p.allowed) return h("div", { class: "card" }, h("h2", null, icon("phone"), " Text messages and WhatsApp"), msg("note", "Alerts by text message and WhatsApp are on the paid plans." + (upgrade ? " Upgrade on the Account tab." : "")));
	const num = h("input", { type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: "+44 7700 900123" });
	const via = h("select", null, p.ready.whatsapp ? h("option", { value: "whatsapp" }, "WhatsApp") : null, p.ready.sms ? h("option", { value: "sms" }, "Text message") : null);
	const left = p.included === null ? null : Math.max(0, p.included - p.used) + p.credits;
	const usage = p.included === null ? "No monthly limit on your own account. " + p.used + " sent this month." : p.used + " of " + p.included + " used this month" + (p.credits ? ", plus " + p.credits + " top up alerts until " + new Date(p.creditsUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "") + ".";
	const phones = state.channels.filter((c) => c.kind === "sms" || c.kind === "whatsapp");
	return h("div", { class: "card" }, h("h2", null, icon("phone"), " Text messages and WhatsApp"),
		h("p", null, "For the urgent ones only: when something goes down, and when it's back. Several at once arrive as one message."),
		h("p", null, h("b", null, usage), left === 0 ? " Alerts carry on by email and on your devices until the 1st." : ""),
		p.packs.length ? h("div", { class: "btns" }, p.packs.map((x) => btn("Add " + x.alerts + " alerts (" + x.label + ")", "card", (e) => act(e.currentTarget, async () => { const r = await api("/api/billing/topup", { pack: x.i }); location.href = r.checkout; }), "small"))) : null,
		p.pending.map((x) => { const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "123456", style: "max-width:160px" });
			return h("div", { class: "note" }, h("b", null, "We've sent a code to " + x.where), " by " + (x.kind === "sms" ? "text message" : "WhatsApp") + ". Type it here within 10 minutes.", h("div", { class: "two" }, field("Code", code)),
				h("div", { class: "btns" }, btn("Confirm", "check", (e) => act(e.currentTarget, () => api("/api/phones/" + x.id + "/confirm", { code: code.value }), "Phone confirmed. Alerts will come here."), "main small"),
					btn("Send a new code", "send", (e) => act(e.currentTarget, () => api("/api/phones/" + x.id + "/code", {}), "New code sent"), "small"),
					btn("Remove", "trash", (e) => act(e.currentTarget, () => api("/api/channels/" + x.id, undefined, "DELETE")), "small danger"))); }),
		phones.length < p.max ? [h("h3", { style: "margin-top:16px" }, "Add a phone"), h("div", { class: "two" }, field("Mobile number", num, "With its country code. " + (p.countries.includes("1") && !p.usFrom ? "US and Canadian numbers: WhatsApp only for now." : "")), field("Send by", via)),
			h("div", { class: "btns" }, btn("Send me a code", "send", (e) => act(e.currentTarget, () => api("/api/phones", { number: num.value, via: via.value }), "Code sent. Type it in above."), "main"))]
			: h("p", { class: "hint" }, "That's " + p.max + " phones, the most for one account."),
		h("p", { class: "hint" }, "Each message to each phone uses one alert, and so does the Test button. Your phones are listed with your other channels below."));
}

function alerts() {
	const s = state.settings;
	const to = h("input", { type: "email", value: s.alertTo || "" });
	const zone = h("input", { value: s.tz, list: "zones" });
	const per = h("input", { inputmode: "numeric", value: s.alertsPerDay });
	const kinds = [["slack", "Slack"], ["teams", "Microsoft Teams"], ["google", "Google Chat"], ["discord", "Discord"], ["webhook", "Your own webhook"]];
	const ck = h("select", null, kinds.map(([v, l]) => h("option", { value: v }, l)));
	const cn = h("input", { placeholder: "Optional" });
	const cu = h("input", { placeholder: "https://", inputmode: "url" });
	const lim = state.limits || {};
	const canPush = lim.channels !== "email", canChat = lim.channels !== "email" && lim.channels !== "push";
	const upgrade = state.me.role === "client" && state.plans && state.plans.some((p) => !p.free);
	const pushCard = h("div", { class: "card" }, h("h2", null, "On your phone and computer"),
		h("p", null, "Alerts pop up on this device straight away, even when this page is closed. Turn them on in each browser you use."),
		canPush ? [h("div", { class: "btns" }, btn("Turn on alerts on this device", "bell", (e) => act(e.currentTarget, turnOnPush, "Alerts are on for this device. Send it a test below."), "main")),
			isApple() ? h("p", { class: "hint" }, "On iPhone and iPad: tap Share, then Add to Home Screen, and turn alerts on from the icon it adds.") : null]
			: msg("note", "Alerts on your phone and computer are on the paid plans." + (upgrade ? " Upgrade on the Account tab." : "")));
	return h("div", null, h("h1", null, "Alerts"), h("p", { class: "lead" }, "Where we tell you when something goes down, comes back, or has a certificate or renewal coming up."),
		pushCard,
		phoneCard(),
		h("div", { class: "card" }, h("h2", null, "By email"),
			!s.emailReady ? msg("note", state.me.role === "owner" ? "Email isn't set up yet: choose the address alerts come from on the Admin tab. You can use the channels below meanwhile." : "Email alerts aren't available here yet. You can use the channels below.") : null,
			field("Send alerts to", to), h("div", { class: "two" }, field("Your time zone", zone, "For the times in alerts."), field("Most alerts a day", per, lim.alertsPerDay ? "Your plan sends up to " + lim.alertsPerDay + " a day." : "A safety net if something keeps going up and down.")),
			h("datalist", { id: "zones" }, (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).map((z) => h("option", { value: z }))),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/settings", { alertTo: to.value, tz: zone.value, alertsPerDay: Number(per.value) }), "Saved"), "main"),
				btn("Send a test alert", "send", (e) => act(e.currentTarget, async () => { const r = await api("/api/alerts/test", {}); return r; }, "Test sent. Check your email and channels.")))),
		h("div", { class: "card" }, h("h2", null, canChat ? "Devices, chat and webhooks" : "Your devices"),
			state.channels.length ? h("table", null, h("tr", null, h("th", null, "Channel"), h("th", null, "Where"), h("th", null, "")),
				state.channels.map((c) => h("tr", null, h("td", null, h("b", null, c.name), h("div", { class: "hint" }, c.kindName + (c.on ? "" : " · switched off" + (c.fails ? " after " + c.fails + " failed posts" : "")))),
					h("td", null, c.where, c.secret ? h("div", { class: "hint" }, "Signing secret: ", h("code", null, c.secret)) : null),
					h("td", null, h("div", { class: "btns", style: "margin:0" }, btn("Test", "send", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id + "/test", {}), "Sent to " + c.name), "small"),
						btn(c.on ? "Switch off" : "Switch on", c.on ? "pause" : "play", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id, { on: !c.on })), "small"),
						btn("Remove", "trash", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id, undefined, "DELETE")), "small danger")))))) : h("p", { class: "hint" }, "No channels yet."),
			canChat ? [h("h3", { style: "margin-top:16px" }, "Add a channel"), h("div", { class: "two" }, field("Service", ck), field("Name", cn)), field("Webhook address", cu, "Paste the incoming webhook address the service gives you."),
			h("div", { class: "btns" }, btn("Add channel", "plus", (e) => act(e.currentTarget, () => api("/api/channels", { kind: ck.value, name: cn.value, url: cu.value }), "Channel added. Send it a test.")))]
			: h("p", { class: "hint" }, "Slack, Teams, Google Chat, Discord and webhooks are on the paid plans." + (upgrade ? " Upgrade on the Account tab." : ""))),
		h("div", { class: "card" }, h("h2", null, "Recent alerts"), state.alerts.length ? state.alerts.map((a) => h("details", { class: "alert-item" }, h("summary", { style: "cursor:pointer" }, h("b", { class: a.urgent ? "t-down" : "" }, a.subject), h("span", { class: "hint" }, " · " + when(a.at) + " · " + (a.sent === "held" ? "held (daily limit)" : a.sent || "nowhere to send it"))), h("pre", null, a.text))) : h("p", { class: "hint" }, "None yet.")));
}

// Status page subscribers: loaded when the list is opened, kept until the page changes tab.
const subLists = {};
const fmt = (n) => Number(n).toLocaleString("en-GB");
function subsBlock(pg) {
	const s = state.subs || {};
	if (s.subscribers === 0) return h("div", null, h("h3", { style: "margin-top:16px" }, "Subscribers"), h("p", { class: "hint" }, "Your plan doesn't include status page subscribers. Pro and Business plans let people get updates by email, chat room or feed."));
	const take = h("input", { type: "checkbox", checked: pg.subscribe !== 0 });
	const auto = h("input", { type: "checkbox", checked: pg.auto_notify !== 0 });
	const save = (e) => act(e.currentTarget, () => savePage(pg, { subscribe: take.checked, autoNotify: auto.checked }), "Saved");
	const used = s.emails === null ? fmt(s.used || 0) + " emails sent this month" : fmt(s.used || 0) + " of " + fmt(s.emails) + " emails used this month";
	const list = subLists[pg.id];
	const paste = h("textarea", { placeholder: "One email address a line, or pasted from a spreadsheet" });
	const load = () => api("/api/pages/" + pg.id + "/subscribers").then((r) => { subLists[pg.id] = r.subscribers; draw(); }).catch(() => { subLists[pg.id] = []; draw(); });
	return h("div", null, h("h3", { style: "margin-top:16px" }, "Subscribers"),
		h("p", { class: "hint" }, fmt(pg.subscribers || 0) + " confirmed" + (s.subscribers === null ? "" : " (your plan includes " + fmt(s.subscribers) + " email subscribers across your pages)") + ". " + used + "."),
		h("label", { class: "check" }, take, "Let visitors subscribe to updates"),
		h("label", { class: "check" }, auto, "Tell subscribers automatically when something on this page goes down and comes back"),
		h("div", { class: "btns" }, btn("Save", "save", save, "small")),
		h("details", { ontoggle: (e) => { if (e.currentTarget.open && !subLists[pg.id]) load(); }, open: !!list },
			h("summary", { style: "cursor:pointer;font-weight:700" }, "See and add subscribers"),
			list ? (list.length ? h("table", null, h("tbody", null, list.map((x) => h("tr", null,
				h("td", null, x.target, x.confirmed_at ? null : h("span", { class: "kind" }, "waiting to confirm"), x.monitors ? h("span", { class: "kind" }, x.monitors.length + " chosen") : null),
				h("td", null, when(x.created_at)),
				h("td", null, btn("Remove", "trash", (e) => act(e.currentTarget, async () => { const r = await api("/api/subscribers/" + x.id, undefined, "DELETE"); subLists[pg.id] = list.filter((y) => y.id !== x.id); return r; }, "Removed"), "small danger")))))) : h("p", { class: "hint" }, "Nobody has subscribed yet.")) : h("p", { class: "hint" }, "Loading..."),
			field("Add email addresses", paste, "People you add here are subscribed straight away, so only add people who asked for updates."),
			h("div", { class: "btns" }, btn("Add subscribers", "plus", (e) => act(e.currentTarget, async () => { const r = await api("/api/pages/" + pg.id + "/subscribers", { emails: paste.value }); delete subLists[pg.id]; load(); return r; }, "Added")))));
}

// Saves one setting on a status page, sending what the page already has for everything else.
const savePage = (pg, more) => api("/api/pages", Object.assign({ id: pg.id, title: pg.title, slug: pg.slug, intro: pg.intro || "", host: pg.host || "", monitors: pg.monitors }, more));

function extrasBlock(pg) {
	const x = state.extras || {};
	const pw = h("input", { type: "password", autocomplete: "new-password", placeholder: pg.locked ? "A new password" : "At least 8 characters" });
	const lockPart = x.lock || pg.locked ? h("div", null, h("h3", { style: "margin-top:16px" }, "Password"),
		h("p", { class: "hint" }, pg.locked ? "This page is private. Visitors need the password, and it has no badge or widget." : "Make this page private, for your staff or a client only. Visitors type the password once a month."),
		x.lock ? field(pg.locked ? "Change the password" : "Page password", pw) : null,
		h("div", { class: "btns" }, x.lock ? btn(pg.locked ? "Change password" : "Set password", "lock", (e) => act(e.currentTarget, () => savePage(pg, { password: pw.value }), "Password saved"), "small") : null,
			pg.locked ? btn("Remove password", "trash", (e) => act(e.currentTarget, () => savePage(pg, { removePassword: true }), "The page is public again"), "small danger") : null)) : null;
	const mailPart = x.emailUpdates ? h("div", null, h("h3", { style: "margin-top:16px" }, "Post notices by email"),
		pg.updateEmail ? [copyBox(pg.updateEmail),
			h("p", { class: "hint" }, "Send an email from " + state.me.email + " to this address and it's posted as a notice, and sent to subscribers. Start the subject with \"Maintenance:\" or \"Major:\" to set the type, or \"Resolved\" to close the latest notice. Keep the address private."),
			h("div", { class: "btns" }, btn("New address", "refresh", (e) => act(e.currentTarget, () => savePage(pg, { mailUpdates: true }), "New address made"), "small"), btn("Turn off", "trash", (e) => act(e.currentTarget, () => savePage(pg, { mailUpdates: false }), "Turned off"), "small danger"))]
			: [h("p", { class: "hint" }, "Get a private email address for this page. Anything you send there from your own email is posted as a notice, which is handy from your phone."),
			h("div", { class: "btns" }, btn("Turn on", "mail", (e) => act(e.currentTarget, () => savePage(pg, { mailUpdates: true }), "Turned on"), "small"))]) : null;
	const badgeHtml = '<a href="' + (pg.host ? "https://" + pg.host + "/" : pg.address) + '"><img src="' + pg.badge + '" alt="Status"></a>';
	const widgetHtml = '<iframe src="' + pg.widget + '" title="Status" style="border:0;width:300px;height:64px"></iframe>';
	const badgePart = !pg.locked ? h("details", { style: "margin-top:16px" }, h("summary", { style: "cursor:pointer;font-weight:700" }, "Badge and widget for your website"),
		h("p", { class: "hint" }, "Paste one of these into your own website to show whether everything's working. They update by themselves."),
		h("p", null, h("img", { src: pg.badge, alt: "Status badge" })), field("Badge", copyBox(badgeHtml)), field("Widget", copyBox(widgetHtml))) : null;
	return [lockPart, mailPart, badgePart];
}

function pages() {
	const ed = editing && editing.page !== undefined ? editing : null;
	const p = ed && ed.page ? state.pages.find((x) => x.id === ed.page) : null;
	const title = h("input", { value: p ? p.title : "" });
	const slug = h("input", { value: p ? p.slug : "", placeholder: "made from the title" });
	const intro = h("textarea", null, p ? p.intro || "" : "");
	const hostI = h("input", { value: p ? p.host || "" : "", placeholder: "status.example.com" });
	const picks = state.monitors.map((m) => h("input", { type: "checkbox", value: m.id, checked: p ? p.monitors.includes(m.id) : true }));
	const form = ed ? h("div", { class: "card" }, h("h2", null, p ? "Edit " + p.title : "New status page"),
		field("Title", title), field("Address", slug, "Letters, numbers and dashes. The page is at /status/ followed by this."), field("A line under the title (optional)", intro),
		field("Its own domain (optional)", hostI, "Add the domain to this Worker in Cloudflare (Settings, Domains & Routes), then put it here so the page shows on its home page."),
		h("label", null, "Show these"), state.monitors.map((m, i) => h("label", { class: "check" }, picks[i], m.label, h("span", { class: "kind" }, KIND[m.kind]))),
		h("p", { class: "hint" }, "Only names show on the page, never server addresses or check-in links. Give things friendly names on the Overview tab."),
		h("div", { class: "btns" }, btn("Save page", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/pages", { id: p ? p.id : undefined, title: title.value, slug: slug.value, intro: intro.value, host: hostI.value, monitors: picks.filter((c) => c.checked).map((c) => c.value) }); editing = null; return r; }, "Saved"), "main"), btn("Cancel", "x", () => { editing = null; draw(); }))) : null;
	return h("div", null, h("h1", null, "Status pages"), h("p", { class: "lead" }, "A public page showing whether things are working, with 90 days of history and your notices."),
		form,
		!ed ? h("div", { class: "btns", style: "margin-bottom:16px" }, btn("New status page", "plus", () => { editing = { page: null }; draw(); }, "main")) : null,
		state.pages.map((pg) => {
			const ntitle = h("input", { placeholder: "Email is slow this morning" });
			const nbody = h("textarea", { placeholder: "What's happening, and when you expect it fixed" });
			const nstart = h("input", { type: "datetime-local" });
			const nend = h("input", { type: "datetime-local" });
			const nwindow = h("div", { class: "two", style: "display:none" }, field("Starts (optional)", nstart), field("Ends", nend, "Alerts for this page's monitors wait until it ends, and it resolves itself."));
			const nimpact = h("select", { onchange: (e) => { nwindow.style.display = e.target.value === "maintenance" ? "" : "none"; } }, h("option", { value: "minor" }, "Minor problem"), h("option", { value: "major" }, "Major problem"), h("option", { value: "maintenance" }, "Planned maintenance"));
			const iso = (v) => (v ? new Date(v).toISOString() : "");
			const tell = h("input", { type: "checkbox", checked: (pg.subscribers || 0) > 0 });
			const notes = state.notices.filter((n) => n.page_id === pg.id);
			return h("div", { class: "card" }, h("h2", null, pg.title), copyBox(pg.host ? "https://" + pg.host + "/" : pg.address),
				h("div", { class: "btns" }, h("a", { class: "btn", href: pg.address, target: "_blank", rel: "noopener" }, icon("open"), "Open"), btn("Edit", "edit", () => { editing = { page: pg.id }; draw(); window.scrollTo(0, 0); }), btn("Delete", "trash", (e) => { if (confirm("Delete this status page?")) act(e.currentTarget, () => api("/api/pages/" + pg.id, undefined, "DELETE")); }, "danger")),
				h("h3", { style: "margin-top:16px" }, "Notices"),
				notes.length ? notes.map((n) => h("div", { class: "note" }, h("b", null, n.title), " · " + n.impact + " · " + (n.ends_at ? when(n.starts_at) + " to " + when(n.ends_at) : when(n.created_at)) + (n.resolved_at ? " · resolved " + when(n.resolved_at) : ""), n.body ? h("div", null, n.body) : null,
					h("div", { class: "btns" }, !n.resolved_at ? btn("Mark resolved", "check", (e) => act(e.currentTarget, () => api("/api/notices/" + n.id + "/resolve", {})), "small") : null, btn("Delete", "trash", (e) => act(e.currentTarget, () => api("/api/notices/" + n.id, undefined, "DELETE")), "small danger")))) : h("p", { class: "hint" }, "None in the last 14 days."),
				h("details", null, h("summary", { style: "cursor:pointer;font-weight:700" }, "Post a notice"), field("Title", ntitle), field("Details", nbody), field("Type", nimpact), nwindow,
					(pg.subscribers || 0) > 0 ? h("label", { class: "check" }, tell, "Email and post this to the page's " + fmt(pg.subscribers) + " subscribers") : null,
					h("div", { class: "btns" }, btn("Post notice", "send", (e) => act(e.currentTarget, () => api("/api/pages/" + pg.id + "/notices", { title: ntitle.value, body: nbody.value, impact: nimpact.value, tell: tell.checked, startsAt: nimpact.value === "maintenance" && nend.value ? iso(nstart.value) || new Date().toISOString() : "", endsAt: nimpact.value === "maintenance" ? iso(nend.value) : "" }), "Posted")))),
				subsBlock(pg), extrasBlock(pg));
		}));
}

// The team (team.ts): logins for colleagues, and people who only get alerts. For the account's own login.
const ROLE_WORDS = { admin: "Admin", viewer: "Viewer", alerts: "Alerts only" };
function teamCard() {
	const t = state.team;
	if (!t) return null;
	const loginsUsed = 1 + t.members.filter((m) => m.role !== "alerts").length;
	const alertsUsed = t.members.filter((m) => m.role === "alerts").length;
	const canLogins = t.seats === null || t.seats > 1 || !!t.extraPrice;
	const canAlerts = t.alertPeople === null || t.alertPeople > 0;
	if (!canLogins && !canAlerts && !t.members.length) return null;
	const email = h("input", { type: "email", placeholder: "sam@example.com" });
	const name = h("input", { placeholder: "Sam" });
	const role = h("select", null, canLogins ? h("option", { value: "viewer" }, "Viewer: can look but not change anything") : null, canLogins ? h("option", { value: "admin" }, "Admin: can add and change things, but not billing or the team") : null, canAlerts ? h("option", { value: "alerts" }, "Alerts only: no login, just the alert emails") : null);
	const room = (t.seats === null ? "" : "Logins: " + loginsUsed + " of " + t.seats + " included, counting yours" + (t.extraPrice ? ". Extra logins are added to your subscription" : "") + ". ") + (t.alertPeople === null ? "" : "Alerts only: " + alertsUsed + " of " + t.alertPeople + ".");
	return h("div", { class: "card" }, h("h2", null, icon("users"), " Your team"),
		h("p", null, "Give colleagues their own login, or send alerts to more people. Everyone signs in with their own email and password."),
		room ? h("p", { class: "hint" }, room) : null,
		t.members.length ? h("table", null, h("tr", null, h("th", null, "Who"), h("th", null, "Role"), h("th", null, "")),
			t.members.map((m) => {
				const r = m.role === "alerts" ? null : h("select", { style: "min-width:110px", onchange: (e) => act(e.target, () => api("/api/team/" + m.id, { role: e.target.value }), "Role changed") }, ["admin", "viewer"].map((x) => h("option", { value: x, selected: x === m.role }, ROLE_WORDS[x])));
				return h("tr", null, h("td", null, h("b", null, m.name || m.email), m.name ? h("div", { class: "hint" }, m.email) : null, m.accepted ? null : h("span", { class: "kind" }, "invited")),
					h("td", null, r || ROLE_WORDS[m.role]), h("td", null, btn("Remove", "trash", (e) => { if (confirm("Remove " + (m.name || m.email) + " from your team?")) act(e.currentTarget, () => api("/api/team/" + m.id, undefined, "DELETE"), "Removed"); }, "small danger")));
			})) : null,
		canLogins || canAlerts ? h("details", null, h("summary", { style: "cursor:pointer;font-weight:700" }, "Add someone"),
			h("div", { class: "two" }, field("Email address", email), field("Name (optional)", name)), field("What they can do", role),
			h("div", { class: "btns" }, btn("Send invitation", "send", (e) => act(e.currentTarget, () => api("/api/team", { email: email.value, name: name.value, role: role.value }), "Invitation sent"), "main"))) : null);
}

function account() {
	const me = state.me;
	if (me.member) return memberAccount(me);
	const name = h("input", { value: me.name || "" });
	const reports = h("input", { type: "checkbox", checked: me.reports !== false });
	const cur = h("input", { type: "password", autocomplete: "current-password" });
	const next = h("input", { type: "password", autocomplete: "new-password" });
	return h("div", null, h("h1", null, "Account"), h("p", { class: "lead" }, "Signed in as " + me.email + "."),
		me.role === "client" ? planCard(me) : null,
		teamCard(),
		h("div", { class: "card" }, h("h2", null, "Your details"), field("Name", name),
			state.extras && state.extras.reports ? h("label", { class: "check" }, reports, "Email me an uptime report on the first of each month") : null,
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/settings", { name: name.value, reports: reports.checked }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Change your password"), field("Current password", cur), field("New password", next, "At least 10 characters."),
			h("div", { class: "btns" }, btn("Change password", "key", (e) => act(e.currentTarget, async () => { await api("/api/password", { current: cur.value, next: next.value }); return api("/api/state"); }, "Password changed. Other devices are signed out.")))),
		appsCard(),
		apiCard(),
		h("div", { class: "card" }, h("h2", null, "Your data"), h("p", null, "Download everything as a JSON file: what you watch, its history, your channels and status pages."),
			h("div", { class: "btns" }, h("a", { class: "btn", href: "/api/export" }, icon("down"), "Download my data"))),
		h("div", { class: "btns" }, btn("Sign out", "out", async () => { await api("/api/signout", {}); location.href = "/signin"; }), btn("Sign out everywhere", "out", async () => { await api("/api/signout-all", {}); location.href = "/signin"; })),
		state.apps && state.apps.canDelete ? deleteCard() : null);
}

// A team member's own Account tab: their name, alerts, password and signing out.
function memberAccount(me) {
	const m = me.member;
	const name = h("input", { value: m.name || "" });
	const alerts = h("input", { type: "checkbox", checked: !!m.alerts });
	const cur = h("input", { type: "password", autocomplete: "current-password" });
	const next = h("input", { type: "password", autocomplete: "new-password" });
	return h("div", null, h("h1", null, "Account"), h("p", { class: "lead" }, "Signed in as " + m.email + ", " + (m.role === "admin" ? "an admin" : "a viewer") + " on " + (me.name || me.email) + "'s account."),
		h("div", { class: "card" }, h("h2", null, "Your details"), field("Name", name),
			h("label", { class: "check" }, alerts, "Email me the alerts too"),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/settings", { name: name.value, alerts: alerts.checked }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Change your password"), field("Current password", cur), field("New password", next, "At least 10 characters."),
			h("div", { class: "btns" }, btn("Change password", "key", (e) => act(e.currentTarget, async () => { await api("/api/password", { current: cur.value, next: next.value }); return api("/api/state"); }, "Password changed"), "main"))),
		h("div", { class: "btns" }, btn("Sign out", "out", async () => { await api("/api/signout", {}); location.href = "/signin"; }), btn("Sign out everywhere", "out", async () => { await api("/api/signout-all", {}); location.href = "/signin"; })));
}

// Apps on phones and computers: a QR code to sign one in, and the ones signed in now.
let qr = null;
const PLATFORM = { iphone: "iPhone", ipad: "iPad", mac: "Mac", android: "Android", windows: "Windows", other: "App" };
function appsCard() {
	const a = state.apps || { list: [] };
	const showQr = (e) => act(e.currentTarget, async () => { qr = await api("/api/app/qr", {}); setTimeout(() => { if (qr && Date.parse(qr.expires) <= Date.now()) { qr = null; draw(); } }, 5 * 60_000 + 500); });
	return h("div", { class: "card" }, h("h2", null, icon("phone"), " Apps on your phone and computer"),
		h("p", null, "Sign in on the app with your email address and password, or scan a code instead."),
		qr ? h("div", { class: "note", style: "text-align:center" },
			h("img", { src: qr.qr, alt: "QR code to sign in on the app", width: 220, height: 220, style: "image-rendering:pixelated;max-width:100%" }),
			h("p", null, h("b", null, "Open the app, tap Scan a QR code and point it here.")),
			h("p", { class: "hint" }, "It works once, for 5 minutes. Only show it to yourself."),
			h("div", { class: "btns", style: "justify-content:center" }, btn("Done", "check", () => { qr = null; draw(); }, "main")))
			: h("div", { class: "btns" }, btn("Sign in on your phone", "phone", showQr, "main")),
		a.list.length ? h("table", null, h("tr", null, h("th", null, "App"), h("th", null, "Alerts"), h("th", null, "Last used"), h("th", null, "")),
			a.list.map((d) => h("tr", null, h("td", null, h("b", null, d.name), h("div", { class: "hint" }, PLATFORM[d.platform] || "App")),
				h("td", null, d.alerts ? "On" : "Off"), h("td", null, ago(d.lastUsed || d.created)),
				h("td", null, btn("Sign out", "out", (e) => act(e.currentTarget, async () => { await api("/api/app/devices/" + d.id, undefined, "DELETE"); return api("/api/state"); }, "Signed out " + d.name), "small danger")))))
			: null,
		a.alerts || state.me.role !== "owner" ? null : h("p", { class: "hint" }, "Alerts in the app need setting up on this install first (see App alerts in the README)."));
}

// Deleting your own account: everything goes, and any subscription ends.
function deleteCard() {
	const pw = h("input", { type: "password", autocomplete: "current-password" });
	return h("div", { class: "card" }, h("h2", null, "Delete my account"),
		h("p", null, "This deletes your account and everything in it straight away: what you watch, its history, alerts, status pages and apps. Any subscription is cancelled. It can't be undone."),
		field("Your password", pw),
		h("div", { class: "btns" }, btn("Delete my account", "trash", (e) => { if (confirm("Delete your account and everything in it? This can't be undone.")) act(e.currentTarget, async () => { await api("/api/account/delete", { password: pw.value }); location.href = "/"; }); }, "danger")));
}

// A client's plan: what they're on, and the paid plans they can move up to (monthly or yearly) when they're not paying.
function planCard(me) {
	const plans = state.plans || [];
	const mine = plans.find((p) => p.id === me.plan);
	const paying = me.status === "active" || me.status === "trialing";
	const paid = plans.filter((p) => !p.free);
	const pay = (p, yearly) => (e) => act(e.currentTarget, async () => { const r = await api("/api/billing/checkout", { plan: p.id, yearly }); location.href = r.checkout; });
	return h("div", { class: "card" }, h("h2", null, "Your plan"),
		h("p", null, h("b", null, mine ? mine.name : "No plan"), " · ", me.unverified ? "waiting for you to confirm your email" : me.live ? (mine && mine.free ? "free" : "active") : "not active",
			me.periodEnd && paying ? " · renews or ends on " + new Date(me.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""),
		mine ? h("p", { class: "hint" }, planLine(mine)) : null,
		!paying && paid.length ? h("div", { class: "ptiles", style: "margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(260px,380px))" }, paid.map((p) => h("div", null, planTile(p, false, false),
			h("div", { class: "btns" }, btn(p.priceYear ? "Pay monthly" : "Choose " + p.name, "lock", pay(p, false), "main small"), p.priceYear ? btn("Pay yearly (" + p.priceYear + ")", "lock", pay(p, true), "small") : null)))) : null,
		!paying && paid.length ? payStrip() : null,
		h("div", { class: "btns" }, me.hasBilling ? btn("Manage billing", "card", (e) => act(e.currentTarget, async () => { const r = await api("/api/billing/portal", {}); location.href = r.portal; }), "main") : null),
		h("p", { class: "hint" }, "Cards, receipts, changing plan and cancelling are handled securely by Stripe."));
}

// API keys and the AI connector. A new key is shown once, straight after it's made.
let newKey = null;
function apiCard() {
	const c = state.connector;
	const kname = h("input", { placeholder: "Zapier, Backup script…" });
	const change = h("input", { type: "checkbox" });
	return h("div", { class: "card" }, h("h2", null, "API and AI connector"),
		h("p", null, "Use what you watch in your own scripts and tools, or ask Claude about it. ", h("a", { href: window.SW.docs, target: "_blank", rel: "noopener" }, "How the API works")),
		h("label", null, "Your API address"), copyBox(c.api),
		newKey ? h("div", { class: "ok" }, h("b", null, "Copy your new key now. "), "It won't be shown again.", copyBox(newKey)) : null,
		h("h3", { style: "margin-top:16px" }, "API keys"),
		state.apiKeys.length ? h("table", null, h("tr", null, h("th", null, "Key"), h("th", null, "Can"), h("th", null, "Last used"), h("th", null, "")),
			state.apiKeys.map((k) => h("tr", null, h("td", null, h("b", null, k.name), h("div", { class: "hint" }, h("code", null, k.hint + "…"))), h("td", null, k.change ? "Read and change" : "Read only"), h("td", null, ago(k.lastUsed)),
				h("td", null, btn("Delete", "trash", (e) => { if (confirm("Delete this key? Anything using it stops working straight away.")) act(e.currentTarget, async () => { newKey = null; return api("/api/keys/" + k.id, undefined, "DELETE"); }, "Key deleted"); }, "small danger"))))) : h("p", { class: "hint" }, "No keys yet."),
		h("div", { class: "two" }, field("Name for a new key", kname), h("label", { class: "check", style: "align-self:end" }, change, "It can change things (add, pause and remove monitors, post notices)")),
		h("div", { class: "btns" }, btn("Make a key", "key", (e) => act(e.currentTarget, async () => { const r = await api("/api/keys", { name: kname.value, change: change.checked }); newKey = r.newKey; return r; }, "Key made"), "main")),
		h("h3", { style: "margin-top:16px" }, "AI connector"),
		h("p", null, "In Claude, open Settings, then Connectors, then Add custom connector, and paste this address. Claude asks you to sign in here once. It can only read."),
		copyBox(c.address),
		c.linked ? h("div", { class: "btns" }, btn("Disconnect AI apps", "x", (e) => act(e.currentTarget, () => api("/api/connector/disconnect", {}), "Disconnected"))) : h("p", { class: "hint" }, "Nothing connected yet."));
}

function admin() {
	const a = state.admin, b = state.brand;
	const from = h("input", { type: "email", value: a.alertFrom || "", placeholder: "alerts@example.com" });
	const bn = h("input", { value: b.name }), bl = h("input", { value: b.logo && !b.logo.startsWith("data:") ? b.logo : "", placeholder: "https://example.com/logo.svg" });
	const bc = h("input", { type: "color", value: b.colour, style: "height:44px;padding:4px" }), bs = h("input", { value: b.support || "", placeholder: "help@example.com" });
	const hide = h("input", { type: "checkbox", checked: b.hideCredit });
	const sell = h("input", { type: "checkbox", checked: a.sell });
	const pe = editing && editing.plan !== undefined ? editing : null;
	const pl = pe && pe.plan ? a.plans.find((x) => x.id === pe.plan) : null;
	const pf = { name: h("input", { value: pl ? pl.name : "" }), priceLabel: h("input", { value: pl ? pl.price || "" : "", placeholder: "£9 a month" }), stripePrice: h("input", { value: pl ? pl.stripePrice || "" : "", placeholder: "price_..." }),
		monitors: h("input", { inputmode: "numeric", value: pl ? pl.monitors : 5 }), minEvery: h("select", null, [1, 5, 10, 15, 30, 60].map((n) => h("option", { value: n, selected: (pl ? pl.minEvery : 5) === n }, "Every " + everyWords(n)))),
		pages: h("input", { inputmode: "numeric", value: pl ? pl.pages : 1 }), blurb: h("input", { value: pl ? pl.blurb || "" : "" }), on: h("input", { type: "checkbox", checked: pl ? pl.on : true }), position: h("input", { inputmode: "numeric", value: pl ? pl.position : 0 }),
		free: h("input", { type: "checkbox", checked: pl ? pl.free : false }), stripePriceYear: h("input", { value: pl ? pl.stripePriceYear || "" : "", placeholder: "price_... (optional)" }), priceYear: h("input", { value: pl ? pl.priceYear || "" : "", placeholder: "£50 a year" }),
		alertsPerDay: h("input", { inputmode: "numeric", value: pl && pl.alertsPerDay ? pl.alertsPerDay : "", placeholder: "No limit" }),
		phoneAlerts: h("input", { inputmode: "numeric", value: pl && pl.phoneAlerts ? pl.phoneAlerts : "", placeholder: "None" }),
		subscribers: h("input", { inputmode: "numeric", value: pl && pl.subscribers ? pl.subscribers : "", placeholder: "None" }),
		subEmails: h("input", { inputmode: "numeric", value: pl && pl.subEmails ? pl.subEmails : "", placeholder: "None" }),
		subHooks: h("input", { inputmode: "numeric", value: pl && pl.subHooks ? pl.subHooks : "", placeholder: "None" }),
		locked: h("input", { type: "checkbox", checked: !!(pl && pl.locked) }),
		speeds: h("input", { inputmode: "numeric", value: pl && pl.speeds ? pl.speeds : "", placeholder: "None" }),
		seats: h("input", { inputmode: "numeric", value: pl && pl.seats ? pl.seats : "", placeholder: "Just theirs" }),
		seatPrice: h("input", { value: pl && pl.seatPrice ? pl.seatPrice : "", placeholder: "price_..." }),
		seatPriceYear: h("input", { value: pl && pl.seatPriceYear ? pl.seatPriceYear : "", placeholder: "price_..." }),
		alertPeople: h("input", { inputmode: "numeric", value: pl && pl.alertPeople ? pl.alertPeople : "", placeholder: "None" }),
		fast: h("input", { inputmode: "numeric", value: pl && pl.fast ? pl.fast : "", placeholder: "None" }),
		channels: h("select", null, [["all", "Every channel"], ["push", "Email and browser alerts"], ["email", "Email only"]].map(([v, l]) => h("option", { value: v, selected: (pl ? pl.channels : "all") === v }, l))) };
	const cap = h("input", { inputmode: "numeric", value: a.signupCap });
	return h("div", null, h("h1", null, "Admin"), h("p", { class: "lead" }, "Settings for this whole install."),
		h("div", { class: "card" }, h("h2", null, "Sending email"),
			!a.emailBinding ? msg("err", "The EMAIL binding is missing from the Worker, so no email can be sent. See the README.") : null,
			field("Alerts come from", from, "An address on your own domain, such as alerts@yourdomain.com. With the domain onboarded to Cloudflare Email Sending, alerts can go to anyone. With Email Routing only, each address alerts go to must be verified there first."),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/admin/install", { alertFrom: from.value }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Branding"), h("p", { class: "hint" }, "Your name, logo and colours on the app, status pages, emails and chat alerts."),
			h("div", { class: "two" }, field("App name", bn), field("Main colour", bc)), field("Logo address", bl, "An https:// address for a square or wide logo (SVG or PNG)."), field("Support email or web address", bs, "Shown on status pages and to clients."),
			h("label", { class: "check" }, hide, "Hide \"Runs on Site Watch\" on status pages"),
			h("div", { class: "btns" }, btn("Save branding", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/admin/brand", { name: bn.value, logo: bl.value || (b.logo && b.logo.startsWith("data:") ? b.logo : ""), colour: bc.value, support: bs.value, hideCredit: hide.checked }); setTimeout(() => location.reload(), 300); return r; }, "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Sell to clients"),
			h("p", null, "Let clients sign up, choose one of your plans and pay you by Stripe. Payments go straight to your own Stripe account. Each client gets their own sign-in and only sees their own things."),
			msg("note", "The free licence covers your own use. Offering this to clients, or under your own brand to others, needs a commercial licence: talk to us at paulobrien.dev/contact/."),
			!a.stripeKey || !a.stripeWebhook ? msg("note", "Free plans work now. For paid plans, add the STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET secrets to this Worker in Cloudflare (Settings, Variables and Secrets). Until then only free plans are offered. The README has the steps.") : msg("ok", "Stripe keys found."),
			h("label", null, "Stripe webhook address"), copyBox(a.webhookUrl), h("p", { class: "hint" }, "In Stripe, add this as a webhook endpoint for: checkout.session.completed, customer.subscription.created, customer.subscription.updated and customer.subscription.deleted."),
			h("label", { class: "check" }, sell, "Open sign-up to clients"), a.sell ? [h("label", null, "Sign-up page"), copyBox(a.signupUrl)] : null,
			field("Most new accounts a day", cap, "For everyone together, so a script can't fill the database. Each address can also make 3 a day at most."),
			h("p", { class: "hint" }, a.queue ? "Checks run through your Cloudflare Queue, so there's room for thousands of websites." : "Checks run about 40 a minute. For more, add a Cloudflare Queue (see the README, Lots of websites)."),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/admin/install", { sell: sell.checked, signupCap: Number(cap.value) }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Plans"), h("p", { class: "hint" }, "Make a product with a monthly or yearly price in Stripe, then paste its price ID here. The price text is what the sign-up page shows."),
			a.plans.length ? h("table", null, h("tr", null, h("th", null, "Plan"), h("th", null, "Includes"), h("th", null, "")), a.plans.map((x) => h("tr", null,
				h("td", null, h("b", null, x.name), h("div", { class: "hint" }, (x.price || "No price text") + (x.on ? "" : " · switched off") + (x.free ? " · free" : x.stripePrice ? "" : " · no Stripe price yet"))),
				h("td", null, x.monitors + " monitors, every " + everyWords(x.minEvery) + ", " + x.pages + " status page" + (x.pages === 1 ? "" : "s")),
				h("td", null, h("div", { class: "btns", style: "margin:0" }, btn("Edit", "edit", () => { editing = { plan: x.id }; draw(); }, "small"), btn("Delete", "trash", (e) => act(e.currentTarget, () => api("/api/admin/plans/" + x.id, undefined, "DELETE")), "small danger")))))) : h("p", { class: "hint" }, "No plans yet."),
			pe ? h("div", { class: "note" }, h("h3", null, pl ? "Edit " + pl.name : "New plan"), h("div", { class: "two" }, field("Name", pf.name), field("Price text", pf.priceLabel), field("Stripe price ID", pf.stripePrice), field("Yearly price text", pf.priceYear), field("Yearly Stripe price ID", pf.stripePriceYear), field("Monitors", pf.monitors), field("Fastest checks", pf.minEvery), field("Status pages", pf.pages), field("Alerts can go to", pf.channels), field("Most alerts a day", pf.alertsPerDay), field("Text and WhatsApp alerts a month", pf.phoneAlerts), field("Checked every 30 seconds", pf.fast), field("Status page email subscribers", pf.subscribers), field("Emails to subscribers a month", pf.subEmails), field("Chat rooms and webhooks following pages", pf.subHooks), field("Speed from 3 regions for", pf.speeds), field("Logins included, counting theirs", pf.seats), field("Stripe price ID for each extra login (monthly)", pf.seatPrice), field("Stripe price ID for each extra login (yearly)", pf.seatPriceYear), field("People who only get alerts", pf.alertPeople), field("Order on the page", pf.position), field("Short description", pf.blurb)),
				h("label", { class: "check" }, pf.free, "Free plan: no Stripe price, people confirm their email address instead"),
				h("label", { class: "check" }, pf.locked, "Status pages can have a password"),
				h("label", { class: "check" }, pf.on, "Offer this plan on the sign-up page"),
				h("div", { class: "btns" }, btn("Save plan", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/admin/plans", { id: pl ? pl.id : undefined, name: pf.name.value, priceLabel: pf.priceLabel.value, stripePrice: pf.stripePrice.value, stripePriceYear: pf.stripePriceYear.value, priceLabelYear: pf.priceYear.value, free: pf.free.checked, alertsPerDay: pf.alertsPerDay.value, phoneAlerts: pf.phoneAlerts.value, fast: pf.fast.value, subscribers: pf.subscribers.value, subEmails: pf.subEmails.value, subHooks: pf.subHooks.value, locked: pf.locked.checked, speeds: pf.speeds.value, seats: pf.seats.value, seatPrice: pf.seatPrice.value, seatPriceYear: pf.seatPriceYear.value, alertPeople: pf.alertPeople.value, channels: pf.channels.value, monitors: Number(pf.monitors.value), minEvery: Number(pf.minEvery.value), pages: Number(pf.pages.value), position: Number(pf.position.value), blurb: pf.blurb.value, on: pf.on.checked }); editing = null; return r; }, "Plan saved"), "main"), btn("Cancel", "x", () => { editing = null; draw(); })))
				: h("div", { class: "btns" }, btn("New plan", "plus", () => { editing = { plan: null }; draw(); }))),
		adminPhones(a.phones),
		h("div", { class: "card" }, h("h2", null, "Clients"), a.clients.length ? h("table", null, h("tr", null, h("th", null, "Client"), h("th", null, "Plan"), h("th", null, "")), a.clients.map((c) => h("tr", null,
			h("td", null, h("b", null, c.name || c.email), h("div", { class: "hint" }, c.email + " · joined " + when(c.created_at) + " · watching " + c.monitors)),
			h("td", null, ((a.plans.find((p) => p.id === c.plan) || {}).name || "None"), h("div", { class: ["active", "trialing", "free"].includes(c.status) ? "t-up" : "t-unsure" }, c.status === "none" ? "not paid" : c.status === "unverified" ? "email not confirmed" : c.status.replace("_", " "))),
			h("td", null, h("div", { class: "btns", style: "margin:0" }, ["active", "trialing", "free"].includes(c.status) ? btn("Hold", "pause", (e) => act(e.currentTarget, () => api("/api/admin/clients/" + c.id, { status: "none" })), "small") : btn("Make active free", "play", (e) => act(e.currentTarget, () => api("/api/admin/clients/" + c.id, { status: "active" })), "small"),
				btn("Delete", "trash", (e) => { if (confirm("Delete " + c.email + " and everything they watch? Cancel their subscription in Stripe too.")) act(e.currentTarget, () => api("/api/admin/clients/" + c.id, undefined, "DELETE")); }, "small danger")))))) : h("p", { class: "hint" }, "No clients yet.")),
		h("div", { class: "card" }, h("h2", null, "Licence"), h("p", null, "Site Watch is free for one person or organisation's own websites, up to " + a.licence.limit + ". You're watching " + a.licence.websites + ". Going over that, running it for clients or offering it as a service needs a commercial licence."),
			h("div", { class: "btns" }, h("a", { class: "btn", href: "https://paulobrien.dev/contact/", target: "_blank", rel: "noopener" }, icon("open"), "Ask about a commercial licence"))));
}

// Admin: whether Twilio is set up, and the top up packs clients can buy.
function adminPhones(ph) {
	const rows = [0, 1, 2].map((i) => { const x = ph.packs[i] || {}; return { alerts: h("input", { inputmode: "numeric", value: x.alerts || "", placeholder: "100" }), price: h("input", { value: x.price || "", placeholder: "price_..." }), label: h("input", { value: x.label || "", placeholder: "As shown to clients" }) }; });
	return h("div", { class: "card" }, h("h2", null, icon("phone"), " Text and WhatsApp alerts"),
		ph.ready.sms || ph.ready.whatsapp ? msg("ok", "Twilio is set up: " + [ph.ready.whatsapp ? "WhatsApp" : null, ph.ready.sms ? "text messages" + (ph.usFrom ? "" : " (not to US numbers yet)") : null].filter(Boolean).join(" and ") + ". Phones in +" + ph.countries.join(", +") + ".")
			: msg("note", "Add your Twilio keys to this Worker to switch these on. The README has the steps."),
		h("p", null, "Each plan's monthly allowance is set on the plan. The whole install sends " + ph.dailyMax + " phone messages a day at most, and each account 30, so a bad day can't run up a big bill."),
		h("h3", null, "Top ups"), h("p", { class: "hint" }, "Make a one off price for each in Stripe and paste its ID. Clients on a plan with phone alerts can buy them; they last a year. Leave a row empty to leave it out."),
		rows.map((r, i) => h("div", { class: "two", style: "grid-template-columns:repeat(auto-fit,minmax(160px,1fr))" }, field("Top up " + (i + 1) + ": alerts", r.alerts), field("Stripe price ID", r.price), field("Price text", r.label))),
		h("div", { class: "btns" }, btn("Save top ups", "save", (e) => act(e.currentTarget, () => api("/api/admin/phones", { packs: rows.map((r) => ({ alerts: Number(r.alerts.value), price: r.price.value, label: r.label.value })) }), "Saved"), "main")));
}

async function start() {
	try { who = await api("/api/whoami"); } catch (e) { app.replaceChildren(msg("err", e.message)); return; }
	document.documentElement.style.setProperty("--brand", who.brand.colour);
	const path = location.pathname;
	if (path === "/setup") return setupView();
	if (path === "/reset") return resetView();
	if (path === "/verify") return verifyView();
	if (path === "/signup" && !who.signedIn) return signupView();
	if (!who.hasOwner) return centre(h("div", { class: "card" }, h("h1", null, "Almost there"), h("p", null, "Open your set-up link to make the owner's account: this address followed by /setup?code= and the SETUP_TOKEN secret you chose when you installed.")));
	if (!who.signedIn) return signinView();
	if (path !== "/") history.replaceState(null, "", "/" + location.hash);
	state = await api("/api/state");
	const paid = new URLSearchParams(location.search).get("paid");
	if (paid === "1") flashText = "Thanks! Your payment is going through. Your plan switches on in a few seconds.";
	if (new URLSearchParams(location.search).get("confirmed") === "1") flashText = "Thanks, your email address is confirmed. We've started checking.";
	if (location.search) history.replaceState(null, "", "/" + location.hash);
	draw();
	if (paid === "1") setTimeout(async () => { state = await api("/api/state"); flashText = ""; draw(); }, 5000);
}
setInterval(async () => { if (state && !document.hidden && !editing && !document.activeElement.matches("input,textarea,select")) { try { state = await api("/api/state"); draw(); } catch {} } }, 60000);
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t && t !== tab && state) { tab = t; draw(); } });
start();
})();
`;
