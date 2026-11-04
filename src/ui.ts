// The app's one page: set-up, sign-in, sign-up and the dashboard, drawn in the browser from /api/state.
// Plain JavaScript with no build step, so the Worker serves it as it is. Text is always put on the page as text
// (never as HTML), so nothing anyone types can run as code.

import type { Brand } from "./db.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function appPage(brand: Brand, version: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brand.name)}</title><meta name="robots" content="noindex">
<link rel="icon" href="${brand.logo ? esc(brand.logo) : `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${brand.colour}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`)}`}">
<style>${CSS.replace("--brand:#0f766e", `--brand:${brand.colour}`)}</style></head>
<body><div id="app"><p class="loading">Loading…</p></div>
<script>window.SW=${JSON.stringify({ version }).replace(/</g, "\\u003c")};</script>
<script>${JS}</script></body></html>`;
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
.foot{color:var(--faint);font-size:13px;text-align:center;margin-top:32px}
.spark{width:100%;height:40px;margin-top:8px}
@media(max-width:640px){.two{grid-template-columns:1fr}.mon{grid-template-columns:auto 1fr}.mon .acts{grid-column:1/-1}.bars i:nth-child(-n+60){display:none}h1{font-size:26px}}
`;

// The browser side. Kept as a string; it uses only what every current browser has.
const JS = String.raw`
(() => {
const ICONS = {
	pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
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
	save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
	out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
	in: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
	down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
	open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
	card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
	key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
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
const KIND = { website: "Website", mail: "Mail server", port: "Port", heartbeat: "Heartbeat" };
const KIND_ICON = { website: "globe", mail: "mail", port: "plug", heartbeat: "heart" };
const everyWords = (m) => m % 1440 === 0 ? (m === 1440 ? "day" : m / 1440 + " days") : m % 60 === 0 ? (m === 60 ? "hour" : m / 60 + " hours") : m === 1 ? "minute" : m + " minutes";

function logo() {
	const b = brand();
	return h("a", { class: "logo", href: "/" }, b.logo ? h("img", { src: b.logo, alt: "" }) : icon("pulse", 28), b.name);
}

function copyBox(value) {
	const input = h("input", { value, readonly: true, onclick: (e) => e.target.select() });
	return h("div", { class: "copy" }, input, btn("Copy", "copy", async (e) => { try { await navigator.clipboard.writeText(value); e.currentTarget.lastChild.textContent = "Copied"; } catch { input.select(); } }, "small"));
}

// -- Before sign-in ----------------------------------------------------------------------

function centre(...kids) { app.replaceChildren(h("main", null, h("div", { class: "centre" }, h("div", { style: "margin-bottom:20px" }, logo()), ...kids))); }

function setupView() {
	const code = new URLSearchParams(location.search).get("setup") || new URLSearchParams(location.search).get("code") || "";
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button"), async () => { await api("/api/setup", { code, email: email.value, password: pw.value, tz: tz() }); location.href = "/"; }); } },
		h("h1", null, who.hasOwner ? "Reset the owner's password" : "Set up " + brand().name),
		h("p", { class: "lead" }, who.hasOwner ? "This link can choose a new email address and password for the owner's account." : "Make your account. You'll sign in with this email address and password."),
		!code ? msg("err", "This link has no set-up code. Open /setup?code= followed by the SETUP_TOKEN secret you chose.") : null,
		field("Your email address", email, "Alerts go here too. You can change that later."),
		field("Choose a password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("check"), who.hasOwner ? "Save and sign in" : "Make my account")));
	centre(card);
}

function signinView(note) {
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { await api("/api/signin", { email: email.value, password: pw.value }); history.replaceState(null, "", "/"); start(); }); } },
		h("h1", null, "Sign in"),
		note ? msg("ok", note) : null,
		field("Email address", email), field("Password", pw),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("in"), "Sign in"), btn("Forgotten your password?", "key", forgotView)),
		who && who.sell ? h("p", null, "New here? ", h("a", { href: "/signup" }, "Choose a plan and sign up")) : null);
	centre(card);
}

function forgotView() {
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { const r = await api("/api/forgot", { email: email.value }); card.replaceChildren(h("h1", null, "Check your email"), h("p", null, "If there's an account for that address, we've sent a link to choose a new password. It works for an hour."), r.owner ? h("p", { class: "hint" }, "Email isn't set up on this install yet. The owner can reset their password with their set-up link instead.") : null, h("div", { class: "btns" }, btn("Back to sign in", "in", () => signinView()))); }); } },
		h("h1", null, "Choose a new password"), field("Your email address", email),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("send"), "Send me a link"), btn("Back", "in", () => signinView())));
	centre(card);
}

function resetView() {
	const token = new URLSearchParams(location.search).get("token") || "";
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button"), async () => { await api("/api/reset", { token, password: pw.value }); location.href = "/"; }); } },
		h("h1", null, "Choose a new password"), field("New password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("save"), "Save and sign in")));
	centre(card);
}

async function signupView() {
	const { plans } = await api("/api/plans");
	if (!plans.length) return centre(h("div", { class: "card" }, h("h1", null, "Sign-up isn't open"), h("p", null, "Please ask whoever sent you here."), h("div", { class: "btns" }, btn("Sign in", "in", () => signinView()))));
	let chosen = plans[0].id;
	const tiles = h("div", { class: "plans" });
	const drawTiles = () => tiles.replaceChildren(...plans.map((p) => h("button", { type: "button", class: "tile" + (p.id === chosen ? " on" : ""), onclick: () => { chosen = p.id; drawTiles(); } },
		h("b", null, icon(p.id === chosen ? "check" : "pulse"), p.name), p.price ? h("div", { style: "font-size:20px;font-weight:800;margin:6px 0" }, p.price) : null,
		h("span", null, p.monitors + " things to watch, checked every " + everyWords(p.minEvery) + (p.pages ? ", " + p.pages + " status page" + (p.pages === 1 ? "" : "s") : "")), p.blurb ? h("div", { class: "hint" }, p.blurb) : null)));
	drawTiles();
	const name = h("input", { autocomplete: "organization" });
	const email = h("input", { type: "email", autocomplete: "email", required: true });
	const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 10, required: true });
	const card = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(card.querySelector("button[type=submit]"), async () => { const r = await api("/api/signup", { plan: chosen, name: name.value, email: email.value, password: pw.value, tz: tz() }); location.href = r.checkout; }); } },
		h("h1", null, "Sign up"), h("p", { class: "lead" }, "Choose a plan, make your account, then pay securely with Stripe."), tiles,
		field("Your name or business", name), field("Email address", email, "You'll sign in with it, and alerts go here."), field("Choose a password", pw, "At least 10 characters."),
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("card"), "Continue to payment")),
		h("p", null, "Already have an account? ", h("a", { href: "/signin" }, "Sign in")));
	centre(card);
}

// -- Signed in ---------------------------------------------------------------------------

function shell(content) {
	const tabs = [["overview", "Overview", "pulse"], ["add", "Add", "plus"], ["alerts", "Alerts", "bell"], ["pages", "Status pages", "page"], ["account", "Account", "user"]];
	if (state.me.role === "owner") tabs.push(["admin", "Admin", "cog"]);
	app.replaceChildren(
		h("div", { class: "top" }, h("div", { class: "in" }, logo(), h("nav", null, tabs.map(([id, label, ic]) => h("button", { class: tab === id ? "on" : "", onclick: () => go(id) }, icon(ic), label))))),
		h("main", null, flashText ? msg("ok", flashText) : null, content, h("p", { class: "foot" }, brand().name + " " + window.SW.version)));
}
function go(t) { tab = t; editing = null; location.hash = t; draw(); window.scrollTo(0, 0); }

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
	if (!state.me.live) return h("div", null, h("h1", null, "Your plan isn't active"), h("p", { class: "lead" }, "Your checks are paused until it is. Choose a plan or update your payment on the Account tab."), btn("Open Account", "user", () => go("account"), "main"));
	if (!m.length) return h("div", null, h("h1", null, "Welcome to " + brand().name), h("p", { class: "lead" }, "Add your first website, mail server, port or scheduled job and we'll start watching it straight away."), btn("Add something to watch", "plus", () => go("add"), "main"));
	const count = (f) => m.filter(f).length;
	const down = count((x) => x.status === "down"), probs = count((x) => ["cert", "blocked", "unsure"].includes(x.status));
	const lic = state.admin && state.admin.licence;
	return h("div", null,
		h("h1", null, down ? down + " down right now" : probs ? "Something needs a look" : "Everything's working"),
		h("p", { class: "lead" }, "Checked from Cloudflare's network. Something only counts as down after two failed checks in a row."),
		h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", { class: "t-up" }, count((x) => x.status === "up")), h("span", null, "Working")), h("div", { class: "stat" }, h("b", { class: "t-down" }, down), h("span", null, "Down")), h("div", { class: "stat" }, h("b", { class: "t-unsure" }, probs), h("span", null, "Need a look")), h("div", { class: "stat" }, h("b", null, m.length), h("span", null, "Watching"))),
		lic && lic.websites > lic.limit ? h("div", { class: "note" }, "You're watching " + lic.websites + " websites. The free licence covers one person or organisation's own websites, up to " + lic.limit + ". For more, ", h("a", { href: "https://paulobrien.dev/contact/", target: "_blank", rel: "noopener" }, "ask about a commercial licence"), ".") : null,
		m.map(monitorCard));
}

function monitorCard(x) {
	const isOpen = open.has(x.id);
	const facts = [];
	if (x.uptime30 !== null) facts.push(h("span", null, "Up ", h("b", null, x.uptime30 + "%"), " (30 days)"));
	if (x.ms !== null && x.kind !== "heartbeat") facts.push(h("span", null, "Answered in ", h("b", null, x.ms + " ms")));
	if (x.kind === "heartbeat") facts.push(h("span", null, "Last check-in ", h("b", null, ago(x.lastPing))));
	else facts.push(h("span", null, "Checked ", h("b", null, ago(x.checkedAt)), " · every " + everyWords(x.every)));
	if (x.cert) facts.push(h("span", { class: x.cert.daysLeft <= 7 ? "t-down" : x.cert.daysLeft <= 21 && !x.cert.auto ? "t-unsure" : "" }, "Certificate ", h("b", null, x.cert.daysLeft + " days"), x.cert.auto ? " (renews itself)" : ""));
	if (x.reg && x.reg.expires) facts.push(h("span", { class: x.reg.daysLeft <= 7 ? "t-down" : x.reg.daysLeft <= 30 ? "t-unsure" : "" }, "Domain renewal ", h("b", null, x.reg.daysLeft + " days")));
	const sub = x.kind === "website" ? x.url : x.kind === "heartbeat" ? "Checks in every " + everyWords(x.every) : x.host + " port " + x.port;
	return h("div", { class: "card" },
		h("div", { class: "mon" },
			h("span", { class: "dot s-" + x.status, title: WORDS[x.status] }),
			h("div", null,
				h("div", { class: "title" }, x.label, h("span", { class: "kind" }, KIND[x.kind])),
				x.name || x.kind !== "website" ? h("div", { class: "sub" }, sub) : null,
				h("div", { class: "why t-" + x.status }, WORDS[x.status], x.why && x.status !== "up" ? ": " + x.why : "", x.since ? " (since " + when(x.since) + ")" : "", x.pausedUntil ? " until " + when(x.pausedUntil) : ""),
				h("div", { class: "facts" }, facts)),
			h("div", { class: "acts" }, btn(isOpen ? "Less" : "More", "chev", () => { isOpen ? open.delete(x.id) : open.add(x.id); draw(); }, "small"))),
		bars(x.bars),
		isOpen ? h("div", { class: "more" },
			x.pingUrl ? h("div", null, h("h3", null, "Check-in address"), h("p", { class: "hint" }, "Have your job visit this address each time it finishes, for example: curl -fsS " + x.pingUrl), copyBox(x.pingUrl)) : null,
			x.responses.length > 1 ? h("div", null, h("h3", { style: "margin-top:12px" }, "Response time, last 24 hours"), spark(x.responses)) : null,
			h("h3", { style: "margin-top:12px" }, "Recent outages"),
			x.outages.length ? h("ul", null, x.outages.map((o) => h("li", null, when(o.from) + " to " + when(o.to) + ": " + o.why))) : h("p", { class: "hint" }, "None recorded."),
			x.reg && x.reg.registrar ? h("p", { class: "hint" }, x.reg.domain + " is registered with " + x.reg.registrar + (x.reg.expires ? " until " + new Date(x.reg.expires).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "") + ".") : null,
			editing === x.id ? editForm(x) : null,
			h("div", { class: "btns" },
				x.kind !== "heartbeat" ? btn("Check now", "refresh", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/check", {}), "Checked")) : null,
				x.pausedUntil ? btn("Resume", "play", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/resume", {}))) : btn("Pause for an hour", "pause", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/pause", { minutes: 60 }))),
				!x.pausedUntil ? btn("Pause for a day", "pause", (e) => act(e.currentTarget, () => api("/api/monitors/" + x.id + "/pause", { minutes: 1440 }))) : null,
				btn("Edit", "edit", () => { editing = editing === x.id ? null : x.id; draw(); }),
				btn("Remove", "trash", (e) => { if (confirm("Stop watching " + x.label + "? Its history goes too.")) act(e.currentTarget, () => api("/api/monitors/" + x.id, undefined, "DELETE")); }, "danger"))) : null);
}

function everySelect(kind, value) {
	const list = kind === "heartbeat" ? state.choices.heartbeatEvery : state.choices.every;
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

function editForm(x) {
	const name = h("input", { value: x.name || "" });
	const every = everySelect(x.kind, x.every);
	const rf = x.kind === "website" ? rulesFields(x.rules) : null;
	const extras = h("input", { type: "checkbox", checked: x.extras });
	const card = h("div", { class: "note" },
		field("Name", name), field(x.kind === "heartbeat" ? "How often it runs" : "How often to check", every),
		rf ? rulesBlock(rf) : null,
		x.kind === "website" ? h("label", { class: "check" }, extras, "Watch the certificate and the domain's renewal date") : null,
		h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/monitors/" + x.id, { name: name.value, every: Number(every.value), ...(rf ? { rules: rulesOf(rf), extras: extras.checked } : {}) }); editing = null; return r; }, "Saved"), "main")));
	return card;
}

let addKind = "website";
function add() {
	const lim = state.limits;
	const tiles = [["website", "Website", "globe", "A web page answers, has the right words and loads in time. Plus its certificate and domain renewal."],
		["mail", "Mail server", "mail", "Your mail server answers and offers encryption, for sending (587, 465) or reading (993, 143, 995, 110)."],
		["port", "Port", "plug", "Any other server and port answers, such as a database or SSH."],
		["heartbeat", "Heartbeat", "heart", "A backup or scheduled job checks in when it runs. Tells you when it doesn't."]];
	const name = h("input", { placeholder: addKind === "heartbeat" ? "Nightly backup" : "Optional" });
	const url = h("input", { placeholder: "https://example.com/", inputmode: "url" });
	const host = h("input", { placeholder: addKind === "mail" ? "mail.example.com" : "server.example.com" });
	const port = addKind === "mail" ? h("select", null, state.choices.mailPorts.map((p) => h("option", { value: p.port }, p.port + ": " + p.name))) : h("input", { inputmode: "numeric", placeholder: "22" });
	const every = everySelect(addKind, addKind === "heartbeat" ? 1440 : Math.max(5, state.choices.every[0]));
	const rf = rulesFields();
	const extras = h("input", { type: "checkbox", checked: true });
	const used = state.monitors.length;
	const form = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); act(form.querySelector("button[type=submit]"), async () => {
		const body = { kind: addKind, name: name.value, every: Number(every.value) };
		if (addKind === "website") Object.assign(body, { url: url.value, rules: rulesOf(rf), extras: extras.checked });
		if (addKind === "mail" || addKind === "port") Object.assign(body, { host: host.value, port: Number(port.value) });
		const r = await api("/api/monitors", body);
		open.add(r.added); tab = "overview"; location.hash = "overview";
		return r;
	}, "Added. It's been checked once already."); } },
		addKind === "website" ? [field("Web address", url, "The home page, or any page such as a login or shop page."), field("Name", name), field("How often to check", every), rulesBlock(rf), h("label", { class: "check" }, extras, "Watch the certificate and the domain's renewal date")] : null,
		addKind === "mail" || addKind === "port" ? [field("Server name", host), field("Port", port, addKind === "mail" ? "Port 25 can't be checked from Cloudflare, which doesn't allow it." : "Any port except 25."), field("Name", name), field("How often to check", every)] : null,
		addKind === "heartbeat" ? [field("Name", name, "So you know which job it is."), field("How often the job runs", every), h("p", { class: "hint" }, "Once it's added you'll get an address for the job to visit each time it runs.")] : null,
		h("div", { class: "btns" }, h("button", { class: "btn main", type: "submit" }, icon("plus"), "Start watching")));
	return h("div", null, h("h1", null, "Add something to watch"),
		h("p", { class: "lead" }, lim.monitors !== null ? "You're using " + used + " of the " + lim.monitors + " on your plan." : "Choose what to watch."),
		h("div", { class: "tiles" }, tiles.map(([id, label, ic, text]) => h("button", { type: "button", class: "tile" + (addKind === id ? " on" : ""), onclick: () => { addKind = id; draw(); } }, h("b", null, icon(ic), label), h("span", null, text)))),
		form);
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
	return h("div", null, h("h1", null, "Alerts"), h("p", { class: "lead" }, "Where we tell you when something goes down, comes back, or has a certificate or renewal coming up."),
		h("div", { class: "card" }, h("h2", null, "By email"),
			!s.emailReady ? msg("note", state.me.role === "owner" ? "Email isn't set up yet: choose the address alerts come from on the Admin tab. You can use the channels below meanwhile." : "Email alerts aren't available here yet. You can use the channels below.") : null,
			field("Send alerts to", to), h("div", { class: "two" }, field("Your time zone", zone, "For the times in alerts."), field("Most alerts a day", per, "A safety net if something keeps going up and down.")),
			h("datalist", { id: "zones" }, (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).map((z) => h("option", { value: z }))),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/settings", { alertTo: to.value, tz: zone.value, alertsPerDay: Number(per.value) }), "Saved"), "main"),
				btn("Send a test alert", "send", (e) => act(e.currentTarget, async () => { const r = await api("/api/alerts/test", {}); return r; }, "Test sent. Check your email and channels.")))),
		h("div", { class: "card" }, h("h2", null, "Chat and webhooks"),
			state.channels.length ? h("table", null, h("tr", null, h("th", null, "Channel"), h("th", null, "Where"), h("th", null, "")),
				state.channels.map((c) => h("tr", null, h("td", null, h("b", null, c.name), h("div", { class: "hint" }, c.kindName + (c.on ? "" : " · switched off" + (c.fails ? " after " + c.fails + " failed posts" : "")))),
					h("td", null, c.where, c.secret ? h("div", { class: "hint" }, "Signing secret: ", h("code", null, c.secret)) : null),
					h("td", null, h("div", { class: "btns", style: "margin:0" }, btn("Test", "send", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id + "/test", {}), "Sent to " + c.name), "small"),
						btn(c.on ? "Switch off" : "Switch on", c.on ? "pause" : "play", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id, { on: !c.on })), "small"),
						btn("Remove", "trash", (e) => act(e.currentTarget, () => api("/api/channels/" + c.id, undefined, "DELETE")), "small danger")))))) : h("p", { class: "hint" }, "No channels yet."),
			h("h3", { style: "margin-top:16px" }, "Add a channel"), h("div", { class: "two" }, field("Service", ck), field("Name", cn)), field("Webhook address", cu, "Paste the incoming webhook address the service gives you."),
			h("div", { class: "btns" }, btn("Add channel", "plus", (e) => act(e.currentTarget, () => api("/api/channels", { kind: ck.value, name: cn.value, url: cu.value }), "Channel added. Send it a test.")))),
		h("div", { class: "card" }, h("h2", null, "Recent alerts"), state.alerts.length ? state.alerts.map((a) => h("details", { class: "alert-item" }, h("summary", { style: "cursor:pointer" }, h("b", { class: a.urgent ? "t-down" : "" }, a.subject), h("span", { class: "hint" }, " · " + when(a.at) + " · " + (a.sent === "held" ? "held (daily limit)" : a.sent || "nowhere to send it"))), h("pre", null, a.text))) : h("p", { class: "hint" }, "None yet.")));
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
			const nimpact = h("select", null, h("option", { value: "minor" }, "Minor problem"), h("option", { value: "major" }, "Major problem"), h("option", { value: "maintenance" }, "Maintenance"));
			const notes = state.notices.filter((n) => n.page_id === pg.id);
			return h("div", { class: "card" }, h("h2", null, pg.title), copyBox(pg.host ? "https://" + pg.host + "/" : pg.address),
				h("div", { class: "btns" }, h("a", { class: "btn", href: pg.address, target: "_blank", rel: "noopener" }, icon("open"), "Open"), btn("Edit", "edit", () => { editing = { page: pg.id }; draw(); window.scrollTo(0, 0); }), btn("Delete", "trash", (e) => { if (confirm("Delete this status page?")) act(e.currentTarget, () => api("/api/pages/" + pg.id, undefined, "DELETE")); }, "danger")),
				h("h3", { style: "margin-top:16px" }, "Notices"),
				notes.length ? notes.map((n) => h("div", { class: "note" }, h("b", null, n.title), " · " + n.impact + " · " + when(n.created_at) + (n.resolved_at ? " · resolved " + when(n.resolved_at) : ""), n.body ? h("div", null, n.body) : null,
					h("div", { class: "btns" }, !n.resolved_at ? btn("Mark resolved", "check", (e) => act(e.currentTarget, () => api("/api/notices/" + n.id + "/resolve", {})), "small") : null, btn("Delete", "trash", (e) => act(e.currentTarget, () => api("/api/notices/" + n.id, undefined, "DELETE")), "small danger")))) : h("p", { class: "hint" }, "None in the last 14 days."),
				h("details", null, h("summary", { style: "cursor:pointer;font-weight:700" }, "Post a notice"), field("Title", ntitle), field("Details", nbody), field("Type", nimpact),
					h("div", { class: "btns" }, btn("Post notice", "send", (e) => act(e.currentTarget, () => api("/api/pages/" + pg.id + "/notices", { title: ntitle.value, body: nbody.value, impact: nimpact.value }), "Posted")))));
		}));
}

function account() {
	const me = state.me;
	const name = h("input", { value: me.name || "" });
	const cur = h("input", { type: "password", autocomplete: "current-password" });
	const next = h("input", { type: "password", autocomplete: "new-password" });
	return h("div", null, h("h1", null, "Account"), h("p", { class: "lead" }, "Signed in as " + me.email + "."),
		me.role === "client" ? h("div", { class: "card" }, h("h2", null, "Your plan"),
			h("p", null, h("b", null, me.live ? "Active" : "Not active"), me.periodEnd && me.live ? " · renews or ends on " + new Date(me.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""),
			h("div", { class: "btns" }, me.hasBilling ? btn("Manage billing", "card", (e) => act(e.currentTarget, async () => { const r = await api("/api/billing/portal", {}); location.href = r.portal; }), "main") : null,
				!me.live ? btn("Choose a plan and pay", "card", (e) => act(e.currentTarget, async () => { const r = await api("/api/billing/checkout", {}); location.href = r.checkout; }), "main") : null),
			h("p", { class: "hint" }, "Cards, receipts, changing plan and cancelling are handled securely by Stripe.")) : null,
		h("div", { class: "card" }, h("h2", null, "Your details"), field("Name", name), h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/settings", { name: name.value }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Change your password"), field("Current password", cur), field("New password", next, "At least 10 characters."),
			h("div", { class: "btns" }, btn("Change password", "key", (e) => act(e.currentTarget, async () => { await api("/api/password", { current: cur.value, next: next.value }); return api("/api/state"); }, "Password changed. Other devices are signed out.")))),
		h("div", { class: "card" }, h("h2", null, "Your data"), h("p", null, "Download everything as a JSON file: what you watch, its history, your channels and status pages."),
			h("div", { class: "btns" }, h("a", { class: "btn", href: "/api/export" }, icon("down"), "Download my data"))),
		h("div", { class: "btns" }, btn("Sign out", "out", async () => { await api("/api/signout", {}); location.href = "/signin"; }), btn("Sign out everywhere", "out", async () => { await api("/api/signout-all", {}); location.href = "/signin"; })));
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
		pages: h("input", { inputmode: "numeric", value: pl ? pl.pages : 1 }), blurb: h("input", { value: pl ? pl.blurb || "" : "" }), on: h("input", { type: "checkbox", checked: pl ? pl.on : true }), position: h("input", { inputmode: "numeric", value: pl ? pl.position : 0 }) };
	return h("div", null, h("h1", null, "Admin"), h("p", { class: "lead" }, "Settings for this whole install."),
		h("div", { class: "card" }, h("h2", null, "Sending email"),
			!a.emailBinding ? msg("err", "The EMAIL binding is missing from the Worker, so no email can be sent. See the README.") : null,
			field("Alerts come from", from, "An address on a domain that has Cloudflare Email Routing switched on, such as alerts@yourdomain.com. Each address alerts go to must be verified in Email Routing as a destination."),
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/admin/install", { alertFrom: from.value }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Branding"), h("p", { class: "hint" }, "Your name, logo and colours on the app, status pages, emails and chat alerts."),
			h("div", { class: "two" }, field("App name", bn), field("Main colour", bc)), field("Logo address", bl, "An https:// address for a square or wide logo (SVG or PNG)."), field("Support email or web address", bs, "Shown on status pages and to clients."),
			h("label", { class: "check" }, hide, "Hide \"Runs on Site Watch\" on status pages"),
			h("div", { class: "btns" }, btn("Save branding", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/admin/brand", { name: bn.value, logo: bl.value || (b.logo && b.logo.startsWith("data:") ? b.logo : ""), colour: bc.value, support: bs.value, hideCredit: hide.checked }); setTimeout(() => location.reload(), 300); return r; }, "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Sell to clients"),
			h("p", null, "Let clients sign up, choose one of your plans and pay you by Stripe. Payments go straight to your own Stripe account. Each client gets their own sign-in and only sees their own things."),
			msg("note", "The free licence covers your own use. Offering this to clients, or under your own brand to others, needs a commercial licence: talk to us at paulobrien.dev/contact/."),
			!a.stripeKey || !a.stripeWebhook ? msg("err", "Add the STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET secrets to this Worker in Cloudflare first (Settings, Variables and Secrets). The README has the steps.") : msg("ok", "Stripe keys found."),
			h("label", null, "Stripe webhook address"), copyBox(a.webhookUrl), h("p", { class: "hint" }, "In Stripe, add this as a webhook endpoint for: checkout.session.completed, customer.subscription.created, customer.subscription.updated and customer.subscription.deleted."),
			h("label", { class: "check" }, sell, "Open sign-up to clients"), a.sell ? [h("label", null, "Sign-up page"), copyBox(a.signupUrl)] : null,
			h("div", { class: "btns" }, btn("Save", "save", (e) => act(e.currentTarget, () => api("/api/admin/install", { sell: sell.checked }), "Saved"), "main"))),
		h("div", { class: "card" }, h("h2", null, "Plans"), h("p", { class: "hint" }, "Make a product with a monthly or yearly price in Stripe, then paste its price ID here. The price text is what the sign-up page shows."),
			a.plans.length ? h("table", null, h("tr", null, h("th", null, "Plan"), h("th", null, "Includes"), h("th", null, "")), a.plans.map((x) => h("tr", null,
				h("td", null, h("b", null, x.name), h("div", { class: "hint" }, (x.price || "No price text") + (x.on ? "" : " · switched off") + (x.stripePrice ? "" : " · no Stripe price yet"))),
				h("td", null, x.monitors + " things, every " + everyWords(x.minEvery) + ", " + x.pages + " status page" + (x.pages === 1 ? "" : "s")),
				h("td", null, h("div", { class: "btns", style: "margin:0" }, btn("Edit", "edit", () => { editing = { plan: x.id }; draw(); }, "small"), btn("Delete", "trash", (e) => act(e.currentTarget, () => api("/api/admin/plans/" + x.id, undefined, "DELETE")), "small danger")))))) : h("p", { class: "hint" }, "No plans yet."),
			pe ? h("div", { class: "note" }, h("h3", null, pl ? "Edit " + pl.name : "New plan"), h("div", { class: "two" }, field("Name", pf.name), field("Price text", pf.priceLabel), field("Stripe price ID", pf.stripePrice), field("Things to watch", pf.monitors), field("Fastest checks", pf.minEvery), field("Status pages", pf.pages), field("Order on the page", pf.position), field("Short description", pf.blurb)),
				h("label", { class: "check" }, pf.on, "Offer this plan on the sign-up page"),
				h("div", { class: "btns" }, btn("Save plan", "save", (e) => act(e.currentTarget, async () => { const r = await api("/api/admin/plans", { id: pl ? pl.id : undefined, name: pf.name.value, priceLabel: pf.priceLabel.value, stripePrice: pf.stripePrice.value, monitors: Number(pf.monitors.value), minEvery: Number(pf.minEvery.value), pages: Number(pf.pages.value), position: Number(pf.position.value), blurb: pf.blurb.value, on: pf.on.checked }); editing = null; return r; }, "Plan saved"), "main"), btn("Cancel", "x", () => { editing = null; draw(); })))
				: h("div", { class: "btns" }, btn("New plan", "plus", () => { editing = { plan: null }; draw(); }))),
		h("div", { class: "card" }, h("h2", null, "Clients"), a.clients.length ? h("table", null, h("tr", null, h("th", null, "Client"), h("th", null, "Plan"), h("th", null, "")), a.clients.map((c) => h("tr", null,
			h("td", null, h("b", null, c.name || c.email), h("div", { class: "hint" }, c.email + " · joined " + when(c.created_at) + " · watching " + c.monitors)),
			h("td", null, ((a.plans.find((p) => p.id === c.plan) || {}).name || "None"), h("div", { class: c.status === "active" || c.status === "trialing" ? "t-up" : "t-unsure" }, c.status === "none" ? "not paid" : c.status.replace("_", " "))),
			h("td", null, h("div", { class: "btns", style: "margin:0" }, c.status === "active" || c.status === "trialing" ? btn("Hold", "pause", (e) => act(e.currentTarget, () => api("/api/admin/clients/" + c.id, { status: "none" })), "small") : btn("Make active free", "play", (e) => act(e.currentTarget, () => api("/api/admin/clients/" + c.id, { status: "active" })), "small"),
				btn("Delete", "trash", (e) => { if (confirm("Delete " + c.email + " and everything they watch? Cancel their subscription in Stripe too.")) act(e.currentTarget, () => api("/api/admin/clients/" + c.id, undefined, "DELETE")); }, "small danger")))))) : h("p", { class: "hint" }, "No clients yet.")),
		h("div", { class: "card" }, h("h2", null, "Licence"), h("p", null, "Site Watch is free for one person or organisation's own websites, up to " + a.licence.limit + ". You're watching " + a.licence.websites + ". Going over that, running it for clients or offering it as a service needs a commercial licence."),
			h("div", { class: "btns" }, h("a", { class: "btn", href: "https://paulobrien.dev/contact/", target: "_blank", rel: "noopener" }, icon("open"), "Ask about a commercial licence"))));
}

async function start() {
	try { who = await api("/api/whoami"); } catch (e) { app.replaceChildren(msg("err", e.message)); return; }
	document.documentElement.style.setProperty("--brand", who.brand.colour);
	const path = location.pathname;
	if (path === "/setup") return setupView();
	if (path === "/reset") return resetView();
	if (path === "/signup" && !who.signedIn) return signupView();
	if (!who.hasOwner) return centre(h("div", { class: "card" }, h("h1", null, "Almost there"), h("p", null, "Open your set-up link to make the owner's account: this address followed by /setup?code= and the SETUP_TOKEN secret you chose when you installed.")));
	if (!who.signedIn) return signinView();
	if (path !== "/") history.replaceState(null, "", "/" + location.hash);
	state = await api("/api/state");
	const paid = new URLSearchParams(location.search).get("paid");
	if (paid === "1") flashText = "Thanks! Your payment is going through. Your plan switches on in a few seconds.";
	draw();
	if (paid === "1") setTimeout(async () => { state = await api("/api/state"); flashText = ""; draw(); }, 5000);
}
setInterval(async () => { if (state && !document.hidden && !editing && !document.activeElement.matches("input,textarea,select")) { try { state = await api("/api/state"); draw(); } catch {} } }, 60000);
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t && t !== tab && state) { tab = t; draw(); } });
start();
})();
`;
