// Text message and WhatsApp alerts, sent through Twilio (1.7.0).
//
// Only the urgent ones go to phones: something going down, and coming back up. Each phone is confirmed with a
// six digit code before it gets anything. Alerts made in the same run (several sites failing in the same minute)
// go out as one message per phone. Every message is paid for, so there are limits everywhere:
//   - each plan includes so many phone alerts a month (plans.phone_alerts), and clients can buy top ups;
//   - an account sends 30 at most a day, and the whole install PHONE_DAILY_MAX (250 unless set);
//   - phones can only be in the countries in PHONE_COUNTRIES (calling codes, "44,1" unless set).
// The owner's own account has no monthly allowance, but the daily limits still apply.

import { iso } from "./core.ts";
import { getMeta, newId, type AccountRow, type PlanRow } from "./db.ts";

export interface PhoneEnv {
	/** Twilio's Account SID and Auth Token, from the Twilio console. Both are needed for any phone alerts. */
	TWILIO_ACCOUNT_SID?: string;
	TWILIO_AUTH_TOKEN?: string;
	/** Text messages come from this: a sender name of up to 11 letters (such as SitePatrol, for the UK and most
	 *  of Europe) or a Twilio number in +44 form. Without it, there are no text alerts. */
	TWILIO_SMS_FROM?: string;
	/** Texts to US and Canadian numbers (+1) need a verified toll free or 10DLC number of your own. */
	TWILIO_SMS_FROM_US?: string;
	/** Your WhatsApp sender, such as +447700900123. With the three approved templates below, WhatsApp alerts are on. */
	TWILIO_WHATSAPP_FROM?: string;
	/** Content SIDs (HX...) of your approved WhatsApp templates: down {{1}} {{2}} {{3}}, back up {{1}} {{2}}, code {{1}}. */
	TWILIO_WA_DOWN?: string;
	TWILIO_WA_UP?: string;
	TWILIO_WA_CODE?: string;
	/** Calling codes phones may be in, comma separated. "44,1" (UK, US and Canada) unless set. */
	PHONE_COUNTRIES?: string;
	/** Most phone messages a day for the whole install, codes included. 250 unless set. */
	PHONE_DAILY_MAX?: string;
}

export type PhoneKind = "sms" | "whatsapp";
export const PHONE_KINDS: PhoneKind[] = ["sms", "whatsapp"];
export const PHONE_NAMES: Record<PhoneKind, string> = { sms: "Text messages", whatsapp: "WhatsApp" };
export const isPhone = (kind: string): kind is PhoneKind => kind === "sms" || kind === "whatsapp";

/** Most phone messages one account sends in a day, and most phones it can add. */
export const PER_ACCOUNT_DAY = 30;
export const MAX_PHONES = 3;
/** Codes an account can ask for in a day, and wrong tries per code. A code works for 10 minutes. */
export const CODES_A_DAY = 3;
export const CODE_TRIES = 5;
const CODE_MINUTES = 10;
/** Top ups last a year from the latest one bought. */
export const TOPUP_DAYS = 365;

export const countriesOf = (env: PhoneEnv) => (env.PHONE_COUNTRIES ?? "44,1").split(",").map((s) => s.trim()).filter((s) => /^\d{1,3}$/.test(s));
export const dailyMaxOf = (env: PhoneEnv) => {
	const n = Number(env.PHONE_DAILY_MAX);
	return Number.isInteger(n) && n > 0 ? n : 250;
};

/** What this install can send. */
export function phoneReady(env: PhoneEnv): { sms: boolean; whatsapp: boolean } {
	const twilio = !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN;
	return {
		sms: twilio && !!env.TWILIO_SMS_FROM,
		whatsapp: twilio && !!env.TWILIO_WHATSAPP_FROM && !!env.TWILIO_WA_DOWN && !!env.TWILIO_WA_UP && !!env.TWILIO_WA_CODE,
	};
}

/** A mobile number in +44... form, or why it won't do. A number starting 0 is taken as a UK one. */
export function cleanPhone(raw: unknown, countries: string[]): { number: string } | { error: string } {
	let s = String(raw ?? "").replace(/[\s().-]/g, "");
	if (s.startsWith("00")) s = "+" + s.slice(2);
	if (/^0\d{9,10}$/.test(s)) s = "+44" + s.slice(1);
	if (!/^\+\d{8,15}$/.test(s)) return { error: "Please enter a mobile number with its country code, such as +44 7700 900123." };
	const cc = countries.find((c) => s.startsWith("+" + c));
	if (!cc) return { error: "We can't send alerts to phones in that country yet." };
	if (cc === "44" && !/^\+447\d{9}$/.test(s)) return { error: "That doesn't look like a UK mobile number. UK mobiles start 07 or +44 7." };
	if (cc === "1" && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(s)) return { error: "That doesn't look like a US or Canadian number. It needs the area code: +1 and 10 digits." };
	return { number: s };
}

/** "+44 7••• ••0123": enough to tell phones apart without showing the whole number. */
export const maskPhone = (n: string) => `${n.slice(0, n.startsWith("+1") ? 2 : 3)} ${n.slice(n.startsWith("+1") ? 2 : 3, n.startsWith("+1") ? 3 : 4)}••• ••${n.slice(-4)}`;

/** Where texts to this number come from, or null when this install can't text it. */
export const smsFrom = (env: PhoneEnv, number: string) => (number.startsWith("+1") ? env.TWILIO_SMS_FROM_US ?? null : env.TWILIO_SMS_FROM ?? null);

/** Can this install send this kind of message to this number? */
export function canSend(env: PhoneEnv, kind: PhoneKind, number: string): boolean {
	const r = phoneReady(env);
	return kind === "whatsapp" ? r.whatsapp : r.sms && !!smsFrom(env, number);
}

/** One phone alert waiting to go: something going down or coming back. */
export interface PhoneItem { event: "down" | "up"; label: string; at: string }

/** "a", "a and b", "a, b and 2 more". */
export function nameList(labels: string[], show = 2): string {
	const u = [...new Set(labels)];
	if (u.length === 1) return u[0];
	if (u.length <= show + 1) return `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
	return `${u.slice(0, show).join(", ")} and ${u.length - show} more`;
}

const clock = (at: string, tz: string) => {
	try {
		return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
	} catch {
		return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
	}
};

/** A text message for a group of alerts of one kind, kept short so it fits one or two texts. */
export function phoneText(items: PhoneItem[], tz: string, link: string, app: string): string {
	const event = items[0].event;
	const what = nameList(items.map((i) => i.label));
	const many = new Set(items.map((i) => i.label)).size > 1;
	if (event === "down") {
		// One text is 160 letters: the "we'll text again" line goes when the names need the room.
		const full = `${app}: ${what} ${many ? "are" : "is"} down, since about ${clock(items[0].at, tz)}. We'll text again when ${many ? "they're" : "it's"} back. ${link}`;
		return full.length <= 160 ? full : `${app}: ${what} ${many ? "are" : "is"} down, since about ${clock(items[0].at, tz)}. ${link}`;
	}
	return `${app}: good news, ${what} ${many ? "are" : "is"} working again. ${link}`;
}

/** The values for the approved WhatsApp template (down: what, when, link; up: what, link). */
export function waVars(items: PhoneItem[], tz: string, link: string): Record<string, string> {
	const what = nameList(items.map((i) => i.label));
	return items[0].event === "down" ? { 1: what, 2: clock(items[0].at, tz), 3: link } : { 1: what, 2: link };
}

/** Twilio's error codes that mean this number will never take our messages (unsubscribed, not a mobile, not on WhatsApp). */
const GONE = [21211, 21610, 21614, 63003, 63024];

export type SendResult = { ok: true } | { ok: false; gone: boolean; why: string };

/** Sends one message through Twilio. */
export async function twilioSend(env: PhoneEnv, kind: PhoneKind, to: string, msg: { body: string } | { template: string; vars: Record<string, string> }): Promise<SendResult> {
	const from = kind === "whatsapp" ? `whatsapp:${env.TWILIO_WHATSAPP_FROM}` : smsFrom(env, to);
	if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !from) return { ok: false, gone: false, why: "phone alerts aren't set up on this install" };
	const form = new URLSearchParams({ To: kind === "whatsapp" ? `whatsapp:${to}` : to, From: from });
	if ("body" in msg) form.set("Body", msg.body);
	else {
		form.set("ContentSid", msg.template);
		form.set("ContentVariables", JSON.stringify(msg.vars));
	}
	try {
		const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
			method: "POST",
			headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, "content-type": "application/x-www-form-urlencoded" },
			body: form,
			signal: AbortSignal.timeout(10_000),
		});
		if (res.ok) {
			await res.body?.cancel();
			return { ok: true };
		}
		const err = await res.json<{ code?: number; message?: string }>().catch(() => ({}) as { code?: number; message?: string });
		return { ok: false, gone: GONE.includes(err.code ?? 0), why: err.message ?? `Twilio answered ${res.status}` };
	} catch (e) {
		return { ok: false, gone: false, why: e instanceof Error ? e.message : String(e) };
	}
}

/** Top up packs of phone alerts the owner sells (Admin tab): how many alerts, the Stripe price and its text. */
export interface PhonePack { alerts: number; price: string; label: string }
export async function phonePacks(db: D1Database): Promise<PhonePack[]> {
	try {
		return JSON.parse((await getMeta(db, "phone_packs")) ?? "[]");
	} catch {
		return [];
	}
}

// -- Allowance --

export const monthStart = (now: Date) => iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
const dayStart = (now: Date) => iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));

export interface Allowance {
	/** Phone alerts included each month, or null for no limit (the owner). */
	included: number | null;
	used: number;
	/** Top up alerts left, and until when. */
	credits: number;
	creditsUntil: string | null;
	/** Alerts this account can still send this month. */
	left: number;
}

/** Works out what's left from the plan's monthly alerts and any top ups. Pure, so it can be tested. */
export function allowanceFrom(included: number | null, used: number, credits: number, creditsUntil: string | null, now: Date): Allowance {
	const live = creditsUntil && creditsUntil > iso(now) ? credits : 0;
	return { included, used, credits: live, creditsUntil: live ? creditsUntil : null, left: included === null ? Infinity : Math.max(0, included - used) + live };
}

export async function allowanceOf(db: D1Database, account: AccountRow, plan: PlanRow | null, now = new Date()): Promise<Allowance> {
	const used = await db.prepare("SELECT COUNT(*) AS n FROM phone_sends WHERE account_id = ? AND counted = 1 AND at >= ?").bind(account.id, monthStart(now)).first<{ n: number }>();
	const included = account.role === "owner" ? null : plan?.phone_alerts ?? 0;
	return allowanceFrom(included, used?.n ?? 0, account.phone_credits ?? 0, account.phone_credits_until ?? null, now);
}

/** Uses one alert: from the month's allowance first, then from top ups. False when there's none left. */
async function spend(db: D1Database, account: AccountRow, plan: PlanRow | null, now: Date): Promise<boolean> {
	const a = await allowanceOf(db, account, plan, now);
	if (a.included === null || a.used < a.included) return true;
	if (a.credits <= 0) return false;
	const r = await db.prepare("UPDATE accounts SET phone_credits = phone_credits - 1 WHERE id = ? AND phone_credits > 0").bind(account.id).run();
	return (r.meta.changes ?? 0) > 0;
}

/** Room in today's limits, for this account and for the whole install. */
async function roomToday(db: D1Database, env: PhoneEnv, accountId: string, now: Date): Promise<"ok" | "account" | "install"> {
	const since = dayStart(now);
	const [mine, all] = await Promise.all([
		db.prepare("SELECT COUNT(*) AS n FROM phone_sends WHERE account_id = ? AND at >= ?").bind(accountId, since).first<{ n: number }>(),
		db.prepare("SELECT COUNT(*) AS n FROM phone_sends WHERE at >= ?").bind(since).first<{ n: number }>(),
	]);
	if ((all?.n ?? 0) >= dailyMaxOf(env)) return "install";
	if ((mine?.n ?? 0) >= PER_ACCOUNT_DAY) return "account";
	return "ok";
}

const noteSend = (db: D1Database, accountId: string, channelId: number, kind: string, counted: boolean, now: Date) =>
	db.prepare("INSERT INTO phone_sends (account_id, channel_id, kind, counted, at) VALUES (?, ?, ?, ?, ?)").bind(accountId, channelId, kind, counted ? 1 : 0, iso(now)).run();

/** A message Twilio turned away isn't charged. From the monthly allowance nothing was taken (only sent messages are
 *  noted), but a top up alert taken for it goes back. */
async function giveBack(db: D1Database, account: AccountRow, plan: PlanRow | null, now: Date): Promise<void> {
	const a = await allowanceOf(db, account, plan, now);
	if (a.included !== null && a.used >= a.included && (account.phone_credits ?? 0) > 0) await db.prepare("UPDATE accounts SET phone_credits = phone_credits + 1 WHERE id = ?").bind(account.id).run();
}

// -- Phones on an account --

/** A phone channel keeps its number in `url`, and in `secret` whether it's confirmed, or the code waiting to be typed. */
export interface PhoneSecret { verified: boolean; hash?: string; until?: string; tries?: number }
export const phoneSecretOf = (s: string | null): PhoneSecret => {
	try {
		return { verified: false, ...JSON.parse(s ?? "{}") };
	} catch {
		return { verified: false };
	}
};

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

/** Sends a new code to a phone channel. Null when sent, or what went wrong, in words for the person. */
export async function sendCode(db: D1Database, env: PhoneEnv, accountId: string, channel: { id: number; kind: string; url: string }, app: string, now = new Date()): Promise<string | null> {
	const kind = channel.kind as PhoneKind;
	const codes = await db.prepare("SELECT COUNT(*) AS n FROM phone_sends WHERE account_id = ? AND kind = 'code' AND at >= ?").bind(accountId, iso(new Date(now.getTime() - 86_400_000))).first<{ n: number }>();
	if ((codes?.n ?? 0) >= CODES_A_DAY) return "That's 3 codes today. Please try again tomorrow.";
	if ((await roomToday(db, env, accountId, now)) !== "ok") return "We can't send any more messages today. Please try again tomorrow.";
	const code = sixDigits();
	const r = kind === "whatsapp"
		? await twilioSend(env, kind, channel.url, { template: env.TWILIO_WA_CODE!, vars: { 1: code } })
		: await twilioSend(env, kind, channel.url, { body: `${code} is your ${app} code. It works for ${CODE_MINUTES} minutes.` });
	if (!r.ok) return r.gone ? (kind === "whatsapp" ? "That number doesn't seem to be on WhatsApp. Try text messages instead." : "That number can't take text messages.") : "We couldn't send the code just now. Please try again in a minute.";
	const secret: PhoneSecret = { verified: false, hash: await sha256(`${channel.id}:${code}`), until: iso(new Date(now.getTime() + CODE_MINUTES * 60_000)), tries: 0 };
	await db.batch([
		db.prepare("UPDATE channels SET secret = ?, on_off = 0 WHERE id = ?").bind(JSON.stringify(secret), channel.id),
		db.prepare("INSERT INTO phone_sends (account_id, channel_id, kind, counted, at) VALUES (?, ?, 'code', 0, ?)").bind(accountId, channel.id, iso(now)),
	]);
	return null;
}

/** Checks a typed code. Null when the phone is now confirmed, or what's wrong. */
export async function confirmCode(db: D1Database, channel: { id: number; secret: string | null }, typed: unknown, now = new Date()): Promise<string | null> {
	const s = phoneSecretOf(channel.secret);
	if (s.verified) return null;
	if (!s.hash || !s.until || s.until < iso(now)) return "That code has run out. Send a new one.";
	if ((s.tries ?? 0) >= CODE_TRIES) return "Too many wrong codes. Send a new one.";
	const code = String(typed ?? "").replace(/\D/g, "");
	if (code.length !== 6 || (await sha256(`${channel.id}:${code}`)) !== s.hash) {
		await db.prepare("UPDATE channels SET secret = ? WHERE id = ?").bind(JSON.stringify({ ...s, tries: (s.tries ?? 0) + 1 }), channel.id).run();
		return "That code isn't right. Check the message and try again.";
	}
	await db.prepare("UPDATE channels SET secret = ?, on_off = 1, fails = 0 WHERE id = ?").bind(JSON.stringify({ verified: true, at: iso(now) }), channel.id).run();
	return null;
}

// -- Sending alerts --

/** deliver() calls this for down and back up alerts; they go out when the run ends, grouped, through flushPhones(). */
export async function queuePhone(db: D1Database, accountId: string, alertId: number | null, item: PhoneItem): Promise<void> {
	await db.prepare("INSERT INTO phone_outbox (account_id, alert_id, event, label, at) VALUES (?, ?, ?, ?, ?)").bind(accountId, alertId, item.event, item.label, item.at).run();
}

interface OutRow { id: number; account_id: string; alert_id: number | null; event: "down" | "up"; label: string; at: string }
interface PhoneRow { id: number; kind: string; name: string; url: string; secret: string | null; fails: number }

export interface FlushDeps {
	account: (id: string) => Promise<AccountRow | null>;
	plan: (id: string | null) => Promise<PlanRow | null>;
	/** Tells the account their phone alerts have run out this month (once a month). */
	ranOut: (account: AccountRow, a: Allowance) => Promise<void>;
	link: string;
	app: string;
}

/** Sends the phone alerts waiting in the outbox: one message per phone for each kind of alert. Safe to run at once in
 *  several places, as each run claims its own rows first. */
export async function flushPhones(db: D1Database, env: PhoneEnv, deps: FlushDeps, now = new Date()): Promise<void> {
	const claim = newId(8);
	await db.prepare("UPDATE phone_outbox SET claim = ? WHERE claim IS NULL").bind(claim).run();
	const { results } = await db.prepare("SELECT id, account_id, alert_id, event, label, at FROM phone_outbox WHERE claim = ? ORDER BY id").bind(claim).all<OutRow>();
	if (!results.length) return;
	await db.prepare("DELETE FROM phone_outbox WHERE claim = ? OR at < ?").bind(claim, iso(new Date(now.getTime() - 86_400_000))).run();
	const byAccount = new Map<string, OutRow[]>();
	for (const r of results) byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), r]);
	for (const [accountId, rows] of byAccount) {
		const account = await deps.account(accountId);
		if (!account) continue;
		const plan = account.role === "client" ? await deps.plan(account.plan) : null;
		const { results: phones } = await db.prepare("SELECT id, kind, name, url, secret, fails FROM channels WHERE account_id = ? AND on_off = 1 AND kind IN ('sms', 'whatsapp') ORDER BY id").bind(accountId).all<PhoneRow>();
		const live = phones.filter((p) => phoneSecretOf(p.secret).verified);
		if (!live.length) continue;
		// Older alerts first, so a quick down and up goes out in that order.
		for (const event of ["down", "up"] as const) {
			const items = rows.filter((r) => r.event === event);
			if (!items.length) continue;
			const notes: string[] = [];
			for (const p of live) {
				const kind = p.kind as PhoneKind;
				if (!canSend(env, kind, p.url)) continue;
				const room = await roomToday(db, env, accountId, now);
				if (room !== "ok") {
					notes.push(`${p.name} held (${room === "account" ? "daily limit" : "limit for today"})`);
					continue;
				}
				if (!(await spend(db, account, plan, now))) {
					notes.push(`${p.name} held (no phone alerts left)`);
					await deps.ranOut(account, await allowanceOf(db, account, plan, now)).catch(() => {});
					continue;
				}
				const r = kind === "whatsapp"
					? await twilioSend(env, kind, p.url, { template: event === "down" ? env.TWILIO_WA_DOWN! : env.TWILIO_WA_UP!, vars: waVars(items, account.tz, deps.link) })
					: await twilioSend(env, kind, p.url, { body: phoneText(items, account.tz, deps.link, deps.app) });
				if (r.ok) {
					await noteSend(db, accountId, p.id, kind, true, now);
					notes.push(p.name);
				} else {
					await giveBack(db, account, plan, now);
					const fails = r.gone ? 99 : p.fails + 1;
					await db.prepare("UPDATE channels SET fails = ?, on_off = ? WHERE id = ?").bind(fails, fails >= 5 ? 0 : 1, p.id).run();
					notes.push(`${p.name} failed`);
				}
			}
			const ids = items.map((i) => i.alert_id).filter((x): x is number => x !== null);
			if (notes.length && ids.length) {
				await db.prepare(`UPDATE alerts SET sent = CASE WHEN sent = '' THEN ? ELSE sent || ', ' || ? END WHERE id IN (${ids.map(() => "?").join(",")})`).bind(notes.join(", "), notes.join(", "), ...ids).run();
			}
		}
	}
}

/** Sends a test message to one phone. It uses one alert from the allowance, like any other. */
export async function testPhone(db: D1Database, env: PhoneEnv, account: AccountRow, plan: PlanRow | null, p: PhoneRow, link: string, app: string, now = new Date()): Promise<string | null> {
	if (!phoneSecretOf(p.secret).verified) return "Confirm this phone with its code first.";
	if ((await roomToday(db, env, account.id, now)) !== "ok") return "We can't send any more messages today. Please try again tomorrow.";
	if (!(await spend(db, account, plan, now))) return "You've no phone alerts left this month.";
	const kind = p.kind as PhoneKind;
	const item: PhoneItem = { event: "up", label: "this phone", at: iso(now) };
	const r = kind === "whatsapp"
		? await twilioSend(env, kind, p.url, { template: env.TWILIO_WA_UP!, vars: waVars([item], account.tz, link) })
		: await twilioSend(env, kind, p.url, { body: `${app}: test message. Alerts will arrive here when something goes down and comes back. ${link}` });
	if (!r.ok) {
		await giveBack(db, account, plan, now);
		if (r.gone) await db.prepare("UPDATE channels SET on_off = 0 WHERE id = ?").bind(p.id).run();
		return r.gone ? "That number won't take our messages, so it's been switched off." : "Twilio didn't send it. Please try again in a minute.";
	}
	await noteSend(db, account.id, p.id, kind, true, now);
	return null;
}

