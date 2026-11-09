// Small extras around status pages and reports (1.12.0):
//
// - A status badge (badge.svg) and a small widget (widget) for people's own websites, on every plan.
// - Password protected status pages, for staff or clients only, on plans that allow them.
// - Posting a notice by email: each page gets a private address, and whatever is sent there becomes a notice.
// - A monthly uptime report by email for paid plans, sent in the first days of each month.

import { checkPassword } from "./auth.ts";
import { iso, stateOf } from "./core.ts";
import { accountById, install, isLive, planById, type AccountRow, type Env, type MonitorRow } from "./db.ts";
import { esc, publicName, statusData } from "./status.ts";
import { tellSubscribers } from "./subscribers.ts";

interface PageLike { id: string; account_id: string; slug: string; title: string; monitors: string; password?: string | null; mail_token?: string | null; colour?: string | null; intro: string | null; host: string | null }

const COLOUR = { up: "#15803d", down: "#b91c1c", degraded: "#b45309", maintenance: "#1d4ed8", unknown: "#64748b" } as const;

// -- Badge and widget -----------------------------------------------------------------------------------

/** Rough text width for the badge, as Verdana 11px draws it. */
const width = (t: string) => Math.round([...t].reduce((n, c) => n + (/[ilj.,:'|!]/.test(c) ? 3.5 : /[mwMW]/.test(c) ? 9.5 : /[A-Z]/.test(c) ? 7.5 : 6.5), 0)) + 12;

export function badgeSvg(label: string, text: string, colour: string): string {
	const a = width(label), b = width(text);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="20" role="img" aria-label="${esc(label)}: ${esc(text)}"><title>${esc(label)}: ${esc(text)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${a + b}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${a}" height="20" fill="#555"/><rect x="${a}" width="${b}" height="20" fill="${colour}"/><rect width="${a + b}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${a / 2}" y="14">${esc(label)}</text><text x="${a + b / 2}" y="14">${esc(text)}</text></g></svg>`;
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

async function liveOwner(db: D1Database, page: PageLike): Promise<AccountRow | null> {
	const a = await accountById(db, page.account_id);
	return a && isLive(a) ? a : null;
}

/** "status | All working" in the page's state colour. Not for password protected pages. */
export async function badge(db: D1Database, page: PageLike): Promise<Response> {
	if (page.password || !(await liveOwner(db, page))) return notFound();
	const d = await statusData(db, page as never);
	return new Response(badgeSvg("status", d.overall.text, COLOUR[d.overall.state]), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60" } });
}

/** A small box for an iframe on the customer's own website: the overall state, linking to the full page. */
export async function widget(db: D1Database, page: PageLike, link: string): Promise<Response> {
	if (page.password || !(await liveOwner(db, page))) return notFound();
	const d = await statusData(db, page as never);
	const c = COLOUR[d.overall.state];
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><meta http-equiv="refresh" content="120">
<style>*{box-sizing:border-box}html,body{margin:0;background:transparent}a{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;color:#0f172a;text-decoration:none;font:15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}a:hover{border-color:${c}}i{flex:none;width:12px;height:12px;border-radius:50%;background:${c}}b{display:block}small{color:#475569}</style></head>
<body><a href="${esc(link)}" target="_blank" rel="noopener"><i></i><span><b>${esc(d.overall.text)}</b><small>${esc(d.title)}</small></span></a></body></html>`;
	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
}

// -- Password protected pages ---------------------------------------------------------------------------

/** Whether the plan lets status pages have a password. The owner always can. */
export async function canLock(db: D1Database, a: Pick<AccountRow, "role" | "plan">): Promise<boolean> {
	if (a.role === "owner") return true;
	const p = await planById(db, a.plan);
	return !!p && p.free !== 1 && (p.locked ?? 0) === 1;
}

const cookieName = (page: PageLike) => `sp_${page.id}`;
/** The cookie's value: a hash of the page and its password hash, so it stops working when the password changes. */
async function pass(page: PageLike): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${page.id}:${page.password}`));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

export async function unlocked(request: Request, page: PageLike): Promise<boolean> {
	if (!page.password) return true;
	const want = `${cookieName(page)}=${await pass(page)}`;
	return (request.headers.get("cookie") ?? "").split(/;\s*/).includes(want);
}

/** The "this page needs a password" form. */
export function lockedPage(page: PageLike, base: string, brandColour: string, wrong = false): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(page.title)}</title>
<style>*{box-sizing:border-box}body{margin:0;border-top:6px solid ${esc(page.colour || brandColour)};font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f8fafc}main{max-width:420px;margin:0 auto;padding:48px 16px}form{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px}h1{font-size:24px;margin:0 0 8px}p{color:#475569;margin:0 0 16px}input{width:100%;font:inherit;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px}button{display:inline-flex;align-items:center;gap:8px;font:inherit;font-weight:700;padding:10px 16px;border:0;border-radius:10px;background:${esc(page.colour || brandColour)};color:#fff;cursor:pointer}.err{color:#b91c1c;font-weight:700}</style></head>
<body><main><form method="post" action="${base}/unlock"><h1>${esc(page.title)}</h1><p>This status page is private. Please enter its password.</p>${wrong ? '<p class="err" role="alert">That password isn\'t right. Please try again.</p>' : ""}
<input type="password" name="password" required autocomplete="current-password" aria-label="Password" autofocus>
<button type="submit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Open the page</button></form></main></body></html>`;
	return new Response(html, { status: wrong ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** The password form's answer: a cookie for 30 days and back to the page, or the form again. */
export async function handleUnlock(request: Request, env: Env, page: PageLike, base: string): Promise<Response> {
	if (!page.password) return Response.redirect(new URL(base || "/", request.url).toString(), 303);
	const form = await request.formData().catch(() => null);
	const given = String(form?.get("password") ?? "");
	const { brand } = await install(env.DB);
	if (!given || given.length > 200 || !(await checkPassword(given, page.password))) return lockedPage(page, base, brand.colour, true);
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return new Response(null, { status: 303, headers: { location: base || "/", "set-cookie": `${cookieName(page)}=${await pass(page)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure}`, "cache-control": "no-store" } });
}

// -- Posting a notice by email --------------------------------------------------------------------------

/** The page's private address, when posting by email is set up (UPDATE_DOMAIN). */
export const updateAddress = (env: Env, page: Pick<PageLike, "mail_token">) => (env.UPDATE_DOMAIN && page.mail_token ? `update-${page.mail_token}@${env.UPDATE_DOMAIN}` : null);

/** Decodes =?utf-8?B?...?= and =?utf-8?Q?...?= words in a header. */
export function decodeWords(s: string): string {
	return s.replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs: string, how: string, text: string) => {
		try {
			const bytes = how.toUpperCase() === "B" ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) : qpBytes(text.replace(/_/g, " "));
			return new TextDecoder(cs.toLowerCase()).decode(bytes);
		} catch {
			return text;
		}
	});
}

function qpBytes(s: string): Uint8Array {
	const out: number[] = [];
	const raw = s.replace(/=\r?\n/g, "");
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) { out.push(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
		else out.push(...new TextEncoder().encode(raw[i]));
	}
	return new Uint8Array(out);
}

function splitPart(part: string): { headers: Record<string, string>; body: string } {
	const at = part.search(/\r?\n\r?\n/);
	const head = at < 0 ? part : part.slice(0, at);
	const body = at < 0 ? "" : part.slice(at).replace(/^\r?\n\r?\n/, "");
	const headers: Record<string, string> = {};
	for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
		const m = /^([\w-]+):\s*(.*)$/.exec(line);
		if (m) headers[m[1].toLowerCase()] = m[2];
	}
	return { headers, body };
}

function decodeBody(headers: Record<string, string>, body: string): string {
	const cte = (headers["content-transfer-encoding"] ?? "").toLowerCase();
	const cs = /charset="?([\w-]+)"?/i.exec(headers["content-type"] ?? "")?.[1]?.toLowerCase() ?? "utf-8";
	let bytes: Uint8Array;
	if (cte === "base64") bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
	else if (cte === "quoted-printable") bytes = qpBytes(body);
	else return body;
	try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

const htmlToText = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The subject and the plain text of an email, without the quoted reply or signature. */
export function readEmail(raw: string): { subject: string; text: string } {
	const top = splitPart(raw);
	const subject = decodeWords(top.headers["subject"] ?? "").trim();
	const find = (h: Record<string, string>, body: string, depth = 0): { text?: string; html?: string } => {
		const type = (h["content-type"] ?? "text/plain").toLowerCase();
		const boundary = /boundary="?([^";]+)"?/i.exec(h["content-type"] ?? "")?.[1];
		if (type.startsWith("multipart/") && boundary && depth < 5) {
			const found: { text?: string; html?: string } = {};
			for (const p of body.split(`--${boundary}`).slice(1)) {
				if (p.startsWith("--")) break;
				const part = splitPart(p.replace(/^\r?\n/, ""));
				const f = find(part.headers, part.body, depth + 1);
				found.text ??= f.text;
				found.html ??= f.html;
			}
			return found;
		}
		if (/attachment/i.test(h["content-disposition"] ?? "")) return {};
		if (type.startsWith("text/html")) return { html: decodeBody(h, body) };
		if (type.startsWith("text/plain")) return { text: decodeBody(h, body) };
		return {};
	};
	const f = find(top.headers, top.body);
	let text = f.text ?? (f.html ? htmlToText(f.html) : "");
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const cut = lines.findIndex((l) => /^-- ?$/.test(l) || /^On .+ wrote:$/.test(l.trim()) || /^>/.test(l) || /^-+ ?Original Message ?-+$/i.test(l.trim()) || /^Sent from my /i.test(l.trim()));
	text = (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
	return { subject, text };
}

/** What an emailed subject means: "Resolved" closes the newest open notice; "Maintenance:" or "Major:" sets the kind. */
export function noticeFromSubject(subject: string): { resolve: boolean; impact: "minor" | "major" | "maintenance"; title: string } {
	const s = subject.replace(/^((re|fwd?|fw):\s*)+/i, "").trim();
	if (/^(resolved|fixed|all clear)\b/i.test(s)) return { resolve: true, impact: "minor", title: s };
	const m = /^(maintenance|major|minor)\s*[:\-]\s*/i.exec(s);
	const impact = (m ? m[1].toLowerCase() : "minor") as "minor" | "major" | "maintenance";
	return { resolve: false, impact, title: (m ? s.slice(m[0].length) : s).slice(0, 140) || "Update" };
}

/** Cloudflare Email Routing hands us mail sent to update-<token>@UPDATE_DOMAIN. Only the account's own address may post. */
export async function handleUpdateEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
	const m = /^update-([0-9a-f]{24})@/i.exec(message.to);
	if (!m || !env.DB) return message.setReject("Unknown address");
	const page = await env.DB.prepare("SELECT * FROM pages WHERE mail_token = ?").bind(m[1].toLowerCase()).first<PageLike>();
	const account = page ? await liveOwner(env.DB, page) : null;
	if (!page || !account) return message.setReject("Unknown address");
	const from = message.from.toLowerCase();
	if (from !== account.email.toLowerCase()) return message.setReject("Only the account's own email address can post to this status page");
	if (message.rawSize > 2_000_000) return message.setReject("That email is too big");
	const raw = await new Response(message.raw).text();
	// Cloudflare checks the sender; a message that fails SPF or DKIM for the From address is refused.
	if (/^Authentication-Results:[^\n]*(dmarc=fail|spf=fail)/im.test(raw.slice(0, 20_000))) return message.setReject("We couldn't confirm that email came from you");
	const { subject, text } = readEmail(raw);
	const n = noticeFromSubject(subject);
	const now = iso(new Date());
	if (n.resolve) {
		const open = await env.DB.prepare("SELECT id, title FROM notices WHERE page_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(page.id).first<{ id: number; title: string }>();
		if (!open) return;
		await env.DB.prepare("UPDATE notices SET resolved_at = ? WHERE id = ?").bind(now, open.id).run();
		await tellSubscribers(env, page.id, `Resolved: ${open.title}`, text || `This is now resolved: ${open.title}.`).catch((e) => console.error("subscribers", e));
		return;
	}
	await env.DB.prepare("INSERT INTO notices (page_id, title, body, impact, created_at) VALUES (?, ?, ?, ?, ?)").bind(page.id, n.title, text.slice(0, 4000), n.impact, now).run();
	await tellSubscribers(env, page.id, `${n.impact === "maintenance" ? "Planned maintenance" : n.impact === "major" ? "Major problem" : "Update"}: ${n.title}`, text || n.title).catch((e) => console.error("subscribers", e));
}

// -- Monthly uptime report ------------------------------------------------------------------------------

/** "2026-10" for the month before `now`. */
export const lastMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

/** One monitor's month: its uptime (from the daily counts) and the outages that started in it. */
export function monthOf(row: Pick<MonitorRow, "state">, month: string): { uptime: number | null; outages: number; downMinutes: number } {
	const s = stateOf(row.state);
	let up = 0, down = 0;
	for (const [day, [u, d]] of Object.entries(s.days ?? {})) if (day.startsWith(month)) { up += u; down += d; }
	const outs = (s.outages ?? []).filter((o) => o.from.startsWith(month));
	const downMinutes = outs.reduce((n, o) => n + Math.max(0, Math.round((Date.parse(o.to) - Date.parse(o.from)) / 60000)), 0);
	return { uptime: up + down ? Math.floor((up / (up + down)) * 10000) / 100 : null, outages: outs.length, downMinutes };
}

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const minutesWords = (m: number) => (m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? "" : "s"}${m % 60 ? ` ${m % 60} min` : ""}`);

export function reportText(month: string, rows: { name: string; uptime: number | null; outages: number; downMinutes: number }[], link: string | null): string {
	const checked = rows.filter((r) => r.uptime !== null);
	const all = checked.length ? Math.floor((checked.reduce((n, r) => n + r.uptime!, 0) / checked.length) * 100) / 100 : null;
	const lines = rows.map((r) => `${r.name}: ${r.uptime === null ? "not checked" : `${r.uptime}% up`}${r.outages ? `, ${r.outages} outage${r.outages === 1 ? "" : "s"} (${minutesWords(r.downMinutes)} in all)` : ", no outages"}`);
	return `Here's how everything did in ${monthName(month)}.\n\n${all === null ? "" : `Average uptime: ${all}%\n\n`}${lines.join("\n")}${link ? `\n\nSee the details: ${link}` : ""}\n\nYou get this report on the first of each month. You can turn it off on the Account tab.`;
}

/** In the first three days of each month, sends last month's report to paid accounts that want it, a few at a time. */
export async function monthlyReports(env: Env, now: Date, perRun = 20): Promise<number> {
	if (now.getUTCDate() > 3) return 0;
	const db = env.DB;
	const month = lastMonth(now);
	const inst = await install(db);
	if (!inst.alertFrom || !env.EMAIL) return 0;
	const { results } = await db.prepare(
		"SELECT * FROM accounts WHERE reports = 1 AND (report_month IS NULL OR report_month < ?) AND (role = 'owner' OR (status IN ('active', 'trialing') AND plan IN (SELECT id FROM plans WHERE free = 0))) LIMIT ?",
	).bind(month, perRun).all<AccountRow>();
	// Loaded here so the rest of this file (and its tests) don't need the email module.
	const { sendEmail } = await import("./alerts.ts");
	let sent = 0;
	for (const a of results) {
		await db.prepare("UPDATE accounts SET report_month = ? WHERE id = ?").bind(month, a.id).run();
		const { results: mons } = await db.prepare("SELECT * FROM monitors WHERE account_id = ? ORDER BY created_at, id").bind(a.id).all<MonitorRow>();
		if (!mons.length) continue;
		const rows = mons.map((r) => ({ name: r.name ?? publicName(r), ...monthOf(r, month) }));
		const problem = await sendEmail(env, inst.alertFrom, a.email, `Your uptime report for ${monthName(month)}`, reportText(month, rows, inst.origin ? `${inst.origin}/` : null), inst.brand.name);
		if (problem) console.error("monthly report", a.id, problem);
		else sent++;
	}
	return sent;
}
