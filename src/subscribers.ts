// Status page subscribers (1.11.0). Visitors follow a status page by email, or point a Slack, Discord, Teams or Google
// Chat room (or any webhook) at it, and hear when a notice is posted or resolved, and, when the page owner leaves it on,
// when something on the page goes down and comes back.
//
//   POST <page>/subscribe                    the form on the status page (an email address, or a chat room's address)
//   GET  /subscriptions/confirm/<token>      the link in the confirmation email
//   GET  /subscriptions/unsubscribe/<token>  asks; POST unsubscribes (also the one-click List-Unsubscribe header)
//   GET  <page>/feed.atom                    the page's notices as an Atom feed, for feed readers
//
// Plans set how many email subscribers an account may have across its pages, how many emails to them go out a month
// (a fair use limit: when it's reached, emails pause until the 1st and the page carries on), and how many chat rooms
// or webhooks. Emails go through Amazon SES when its keys are set (much cheaper for big lists), otherwise the EMAIL
// binding. Big sends go through the queue in batches so they don't hold up the checks.

import { brandedHtml } from "./email.ts";
import { cleanEmail, iso, rawEmail } from "./core.ts";
import { accountById, install, isLive, newId, planById, type AccountRow, type Env, type SubSend } from "./db.ts";
import { sesSend, type AwsKeys } from "./ses.ts";
import { esc } from "./status.ts";

export const HOOK_KINDS = ["slack", "discord", "teams", "google", "webhook"] as const;
export const HOOK_NAMES: Record<string, string> = { slack: "Slack", discord: "Discord", teams: "Microsoft Teams", google: "Google Chat", webhook: "Webhook" };
/** New subscriptions a page takes in an hour, and from one visitor, so the form can't be used to send lots of emails. */
const PAGE_HOURLY = 30;
const VISITOR_HOURLY = 5;
/** Messages in one queue message, and the most sent straight away when there's no queue. */
const PER_MESSAGE = 25;
const INLINE_MAX = 200;

/** Chat rooms only take their own service's webhook addresses. */
export function hookHostOk(kind: string, url: string): boolean {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return false;
	}
	if (kind === "slack") return host === "hooks.slack.com";
	if (kind === "discord") return /^(discord|discordapp)\.com$/.test(host) && url.includes("/api/webhooks/");
	if (kind === "teams") return /\.(webhook\.office\.com|logic\.azure\.com|powerplatform\.com)$/.test(host);
	if (kind === "google") return host === "chat.googleapis.com";
	return kind === "webhook";
}

export interface SubLimits { subscribers: number | null; emails: number | null; hooks: number | null }
interface PageRow { id: string; account_id: string; slug: string; title: string; host: string | null; monitors: string; logo?: string | null; colour?: string | null; auto_notify?: number; subscribe?: number }

export async function subLimits(db: D1Database, a: Pick<AccountRow, "role" | "plan">): Promise<SubLimits> {
	if (a.role === "owner") return { subscribers: null, emails: null, hooks: null };
	const p = await planById(db, a.plan);
	if (!p || p.free === 1) return { subscribers: 0, emails: 0, hooks: 0 };
	return { subscribers: p.subscribers ?? 0, emails: p.sub_emails ?? 0, hooks: p.sub_hooks ?? 0 };
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Emails sent to subscribers this month. */
export async function emailsThisMonth(db: D1Database, accountId: string): Promise<number> {
	return (await db.prepare("SELECT emails FROM sub_sends WHERE account_id = ? AND month = ?").bind(accountId, month()).first<{ emails: number }>())?.emails ?? 0;
}

export function pageLink(env: Env, origin: string | null, p: Pick<PageRow, "slug" | "host">): string {
	if (p.host) return `https://${p.host}/`;
	if (env.PAGE_DOMAIN) return `https://${p.slug}.${env.PAGE_DOMAIN.toLowerCase()}/`;
	return `${origin ?? ""}/status/${p.slug}`;
}

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);

/** A small page for the answers to the form and the links in emails, in the status page's colours. */
function answer(title: string, text: string, back: string | null, colour = "#15803d", status = 200, extra = ""): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;border-top:6px solid ${esc(colour)};font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f8fafc}main{max-width:560px;margin:0 auto;padding:48px 16px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px}h1{font-size:24px;margin:0 0 10px}a{color:${esc(colour)}}button{font:inherit;font-weight:700;padding:10px 18px;border-radius:10px;border:0;background:${esc(colour)};color:#fff;cursor:pointer}</style></head>
<body><main><div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}${back ? `<p><a href="${esc(back)}">Back to the status page</a></p>` : ""}</div></main></body></html>`;
	return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/** The subscribe form on a status page posts here. */
export async function handleSubscribe(request: Request, env: Env, page: PageRow): Promise<Response> {
	const db = env.DB;
	const inst = await install(db);
	const back = pageLink(env, inst.origin, page);
	const colour = page.colour ?? inst.brand.colour;
	const no = (text: string, status = 400) => answer("We couldn't add you", text, back, colour, status);
	const account = await accountById(db, page.account_id);
	if (!account || !isLive(account) || page.subscribe === 0) return no("This status page doesn't take subscribers.", 404);
	const limits = await subLimits(db, account);
	const form = await request.formData().catch(() => null);
	if (!form) return no("Please fill in the form on the status page.");
	if (form.get("website")) return answer("Thank you", "You're subscribed.", back, colour); // the hidden field robots fill in
	const ip = await sha(`${request.headers.get("cf-connecting-ip") ?? ""}:${page.id}`);
	const hourAgo = iso(new Date(Date.now() - 3_600_000));
	const recent = await db.prepare("SELECT COUNT(*) AS n, SUM(ip = ?) AS mine FROM subscribers WHERE page_id = ? AND created_at > ?").bind(ip, page.id, hourAgo).first<{ n: number; mine: number | null }>();
	if ((recent?.n ?? 0) >= PAGE_HOURLY || (recent?.mine ?? 0) >= VISITOR_HOURLY) return no("Lots of people have subscribed in the last hour. Please try again a little later.", 429);
	const ids: string[] = JSON.parse(page.monitors);
	const chosen = form.getAll("m").map(String).filter((id) => ids.includes(id));
	const monitors = chosen.length && chosen.length < ids.length ? JSON.stringify(chosen) : null;
	const kind = String(form.get("kind") ?? "email");
	const now = iso(new Date());
	const token = newId(16);

	if (kind === "email") {
		const email = cleanEmail(form.get("email"));
		if (!email) return no("Please enter your email address.");
		if (limits.subscribers !== null) {
			const n = await db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE account_id = ? AND kind = 'email'").bind(account.id).first<{ n: number }>();
			if ((n?.n ?? 0) >= limits.subscribers) return no("This status page has as many email subscribers as it can take. Please check the page itself for news.", 403);
		}
		const had = await db.prepare("SELECT token, confirmed_at FROM subscribers WHERE page_id = ? AND kind = 'email' AND target = ?").bind(page.id, email).first<{ token: string; confirmed_at: string | null }>();
		if (had?.confirmed_at) return answer("You're already subscribed", `We already send updates about ${page.title} to ${email}.`, back, colour);
		if (!had) await db.prepare("INSERT INTO subscribers (id, page_id, account_id, kind, target, monitors, token, created_at, ip) VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?)").bind(newId(8), page.id, account.id, email, monitors, token, now, ip).run();
		const link = `${inst.origin ?? ""}/subscriptions/confirm/${had?.token ?? token}`;
		const problem = await sendNow(env, {
			kind: "email", target: email, token: had?.token ?? token, from: inst.alertFrom ?? "", fromName: page.title, unsub: `${inst.origin ?? ""}/subscriptions/unsubscribe/${had?.token ?? token}`,
			subject: `Please confirm: updates about ${page.title}`,
			text: `Someone, hopefully you, asked for email updates when ${page.title} has a problem or planned maintenance.\n\nConfirm my subscription: ${link}\n\nIf it wasn't you, ignore this email and you won't hear from us again.`,
			look: { colour: page.colour ?? null, logo: page.logo ?? null, name: page.title },
		});
		if (problem && problem !== "slow") return no("We couldn't send the confirmation email just now. Please try again later.", 503);
		return answer("Check your email", `We've sent a link to ${email}. Click it to start getting updates about ${page.title}.`, back, colour);
	}

	if (!(HOOK_KINDS as readonly string[]).includes(kind)) return no("Please choose where updates should go.");
	const url = String(form.get("url") ?? "").trim();
	if (!/^https:\/\/[^\s]{8,500}$/.test(url)) return no("Please paste the room's incoming webhook address, starting with https://.");
	if (!hookHostOk(kind, url)) return no(`That doesn't look like a ${HOOK_NAMES[kind]} incoming webhook address. Please copy it again from ${HOOK_NAMES[kind]}.`);
	if (limits.hooks !== null) {
		const n = await db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE account_id = ? AND kind != 'email'").bind(account.id).first<{ n: number }>();
		if ((n?.n ?? 0) >= limits.hooks) return no("This status page can't take more chat rooms or webhooks.", 403);
	}
	const hello = await sendNow(env, {
		kind, target: url, token, from: "", fromName: page.title, unsub: `${inst.origin ?? ""}/subscriptions/unsubscribe/${token}`,
		subject: `Following ${page.title}`, text: `This room will now hear when ${page.title} has a problem or planned maintenance. Status page: ${back}`,
	});
	if (hello && hello !== "slow") return no("That address didn't accept our test message. Please check it's an incoming webhook address.");
	await db.prepare("INSERT INTO subscribers (id, page_id, account_id, kind, target, monitors, token, confirmed_at, created_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (page_id, kind, target) DO NOTHING")
		.bind(newId(8), page.id, account.id, kind, url, monitors, token, now, now, ip).run();
	return answer("Done", `We've posted a test message, and updates about ${page.title} will go there too.`, back, colour);
}

/** The links in subscriber emails: confirming, and unsubscribing (a page with a button, so mail scanners can't do it). */
export async function handleSubscriptionLink(request: Request, env: Env, what: string, token: string): Promise<Response> {
	const db = env.DB;
	const inst = await install(db);
	const sub = await db.prepare("SELECT s.*, p.title, p.slug, p.host, p.colour FROM subscribers s JOIN pages p ON p.id = s.page_id WHERE s.token = ?").bind(token).first<{ id: string; kind: string; target: string; confirmed_at: string | null; title: string; slug: string; host: string | null; colour: string | null }>();
	const colour = sub?.colour ?? inst.brand.colour;
	if (!sub) return answer(what === "confirm" ? "That link has expired" : "You're not subscribed", what === "confirm" ? "Please subscribe again from the status page." : "There's nothing to unsubscribe from: you won't get any more updates.", null, colour, 404);
	const back = pageLink(env, inst.origin, sub);
	if (what === "confirm") {
		if (!sub.confirmed_at) await db.prepare("UPDATE subscribers SET confirmed_at = ? WHERE id = ?").bind(iso(new Date()), sub.id).run();
		return answer("You're subscribed", `We'll email ${sub.target} when ${sub.title} has a problem or planned maintenance. Every email has a link to stop them.`, back, colour);
	}
	if (request.method === "POST") {
		await db.prepare("DELETE FROM subscribers WHERE id = ?").bind(sub.id).run();
		return answer("Unsubscribed", `We won't send any more updates about ${sub.title}${sub.kind === "email" ? ` to ${sub.target}` : ""}.`, back, colour);
	}
	return answer("Stop these updates?", `Stop updates about ${sub.title}${sub.kind === "email" ? ` to ${sub.target}` : ""}.`, back, colour, 200, `<form method="post"><button type="submit">Unsubscribe</button></form>`);
}

/** The page's notices as an Atom feed. */
export async function feed(env: Env, page: PageRow): Promise<Response> {
	const inst = await install(env.DB);
	const link = pageLink(env, inst.origin, page);
	const { results } = await env.DB.prepare("SELECT * FROM notices WHERE page_id = ? ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT 50").bind(page.id).all<{ id: number; title: string; body: string; impact: string; created_at: string; resolved_at: string | null }>();
	const kind = (i: string) => (i === "maintenance" ? "Maintenance" : i === "major" ? "Major problem" : "Minor problem");
	const entries = results.map((n) => `<entry><id>${esc(link)}#notice-${n.id}</id><title>${esc(`${n.resolved_at ? "Resolved: " : ""}${n.title}`)}</title><updated>${n.resolved_at ?? n.created_at}</updated><published>${n.created_at}</published><link href="${esc(link)}"/><content type="text">${esc(`${kind(n.impact)}. ${n.body}`.trim())}</content></entry>`).join("");
	const xml = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${esc(link)}</id><title>${esc(page.title)}</title><link href="${esc(link)}"/><updated>${results[0]?.resolved_at ?? results[0]?.created_at ?? iso(new Date())}</updated>${entries}</feed>`;
	return new Response(xml, { headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=120" } });
}

/** Tells a page's confirmed subscribers something: a notice, or (monitorId set) one of its things going down or back up.
 *  Emails beyond the plan's monthly limit are skipped. */
export async function tellSubscribers(env: Env, pageId: string, subject: string, text: string, monitorId: string | null = null): Promise<number> {
	const db = env.DB;
	const page = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(pageId).first<PageRow>();
	if (!page) return 0;
	const account = await accountById(db, page.account_id);
	if (!account || !isLive(account)) return 0;
	const limits = await subLimits(db, account);
	const { results } = await db.prepare("SELECT kind, target, token, monitors FROM subscribers WHERE page_id = ? AND confirmed_at IS NOT NULL ORDER BY confirmed_at").bind(page.id).all<{ kind: string; target: string; token: string; monitors: string | null }>();
	let list = results.filter((s) => !monitorId || !s.monitors || (JSON.parse(s.monitors) as string[]).includes(monitorId));
	const emails = list.filter((s) => s.kind === "email");
	if (limits.emails !== null) {
		const left = Math.max(0, limits.emails - (await emailsThisMonth(db, account.id)));
		if (emails.length > left) list = [...list.filter((s) => s.kind !== "email"), ...emails.slice(0, left)];
	}
	if (!limits.hooks && limits.hooks !== null) list = list.filter((s) => s.kind === "email");
	if (!list.length) return 0;
	const inst = await install(db);
	const link = pageLink(env, inst.origin, page);
	const sends: SubSend[] = list.map((s) => ({
		kind: s.kind, target: s.target, token: s.token, from: inst.alertFrom ?? "", fromName: page.title, unsub: `${inst.origin ?? ""}/subscriptions/unsubscribe/${s.token}`,
		subject, text: `${text}\n\nSee the status page: ${link}`, look: { colour: page.colour ?? null, logo: page.logo ?? null, name: page.title },
	}));
	const n = sends.filter((s) => s.kind === "email").length;
	if (n) await db.prepare("INSERT INTO sub_sends (account_id, month, emails) VALUES (?, ?, ?) ON CONFLICT (account_id, month) DO UPDATE SET emails = emails + excluded.emails").bind(account.id, month(), n).run();
	if (env.CHECKS) {
		for (let i = 0; i < sends.length; i += PER_MESSAGE * 100) {
			const group = [];
			for (let j = i; j < Math.min(sends.length, i + PER_MESSAGE * 100); j += PER_MESSAGE) group.push({ body: { ids: [], at: Date.now(), sends: sends.slice(j, j + PER_MESSAGE) } });
			await env.CHECKS.sendBatch(group);
		}
	} else {
		await runSends(env, sends.slice(0, INLINE_MAX));
	}
	return sends.length;
}

/** When something on a page goes down or comes back, and the page tells subscribers automatically. */
export async function tellAboutMonitor(env: Env, accountId: string, monitorId: string, name: string, down: boolean, since: string | null): Promise<void> {
	const { results } = await env.DB.prepare("SELECT id, title FROM pages WHERE account_id = ? AND auto_notify = 1 AND monitors LIKE ?").bind(accountId, `%"${monitorId}"%`).all<{ id: string; title: string }>();
	for (const p of results) {
		const subject = down ? `${p.title}: ${name} is having problems` : `${p.title}: ${name} is working again`;
		const text = down ? `${name} stopped working${since ? ` at about ${new Date(since).toUTCString().slice(17, 22)} UTC` : ""}. It's being looked into, and we'll email again once it's working.`
			: `${name} is working again. Thank you for bearing with us.`;
		await tellSubscribers(env, p.id, subject, text, monitorId).catch((e) => console.error("subscribers", e));
	}
}

/** Sends one batch. "slow" when Amazon asked us to slow down, so the queue tries the batch again shortly. */
export async function runSends(env: Env, sends: SubSend[]): Promise<"slow" | null> {
	for (const s of sends) {
		const r = await sendNow(env, s);
		if (r === "slow") return "slow";
		if (r) console.error("subscriber send failed", s.kind, r);
	}
	return null;
}

async function sendNow(env: Env, s: SubSend): Promise<string | null> {
	if (s.kind === "email") {
		if (!s.from) return "no sending address";
		const inst = await install(env.DB);
		const brand = { ...inst.brand, name: s.look?.name ?? inst.brand.name, colour: s.look?.colour ?? inst.brand.colour, logo: s.look?.logo ?? inst.brand.logo };
		const html = brandedHtml(s.subject, s.text, { brand, button: "Open the status page", footer: `You're getting this because you subscribed to updates about ${s.fromName}. Unsubscribe: ${s.unsub}` });
		const text = `${s.text}\n\nUnsubscribe: ${s.unsub}`;
		const raw = rawEmail(s.from, s.target, s.subject, text, new Date(), newId(12), s.fromName, html, [`List-Unsubscribe: <${s.unsub}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]);
		const keys: AwsKeys | null = env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY ? { accessKeyId: env.SES_ACCESS_KEY_ID, secretAccessKey: env.SES_SECRET_ACCESS_KEY, region: env.SES_REGION || "eu-west-1" } : null;
		if (keys) return sesSend(keys, s.from, s.target, raw).catch((e) => String(e));
		if (!env.EMAIL) return "email isn't set up";
		try {
			// Loaded here so pages that only show the subscribe form (and the tests) don't need the email module.
			const { EmailMessage } = await import("cloudflare:email");
			await env.EMAIL.send(new EmailMessage(s.from, s.target, raw));
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	}
	const text = `*${s.subject}*\n${s.text}`;
	const body = s.kind === "slack" || s.kind === "google" ? { text } : s.kind === "discord" ? { content: text.slice(0, 1900) } : s.kind === "teams" ? { text: text.replace(/\n/g, "\n\n") } : { type: "status.update", page: s.fromName, subject: s.subject, text: s.text, unsubscribe: s.unsub };
	try {
		const res = await fetch(s.target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
		if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM subscribers WHERE token = ?").bind(s.token).run();
		return res.ok ? null : `answered ${res.status}`;
	} catch (e) {
		return String(e);
	}
}
