// Sending an alert: by email (Cloudflare's send_email binding) and to every alert channel the account has switched
// on (Slack, Teams, Google Chat, Discord or your own webhook). Every alert is kept in the account's Alerts list,
// and a daily cap stops a server that keeps going up and down from flooding anyone.

import { EmailMessage } from "cloudflare:email";
import { alertPeople } from "./team.ts";
import { CHANNEL_KINDS, hookMonitor, labelOf, webhookHeaders, MAX_FAILS, payloadFor, rawEmail, iso, type Alert, type ChannelKind, type HookEvent } from "./core.ts";
import { accountById, getMeta, install, newId, planById, setMeta, type AccountRow, type Env, type MonitorRow, type PlanRow } from "./db.ts";
import { brandedHtml, toneOf, type EmailLook } from "./email.ts";
import { sendApns } from "./apns.ts";
import { sendPush, type PushSub } from "./push.ts";
import { flushPhones, isPhone, monthStart, queuePhone, type Allowance } from "./phones.ts";
import { WL } from "./whitelabel.ts";

interface ChannelRow { id: number; kind: string; name: string; url: string; secret: string | null; on_off: number; fails: number }

export const newSecret = () => `whsec_${newId(24)}`;

/** A browser push channel keeps the browser's keys in `secret`. */
const pushSubOf = (c: Pick<ChannelRow, "url" | "secret">): PushSub => ({ endpoint: c.url, keys: JSON.parse(c.secret ?? "{}") });

/** Sends an alert to one browser. "gone" when the browser has turned push off. */
export async function pushTo(db: D1Database, c: Pick<ChannelRow, "url" | "secret">, e: HookEvent, contact: string, tag?: string): Promise<"sent" | "gone" | "failed"> {
	return sendPush(db, pushSubOf(c), { title: e.subject, body: e.text.split("\n").find((l) => l.trim()) ?? "", url: e.url, urgent: e.urgent, tag }, contact);
}

import { planAllows } from "./core.ts";
export { planAllows };

/** An app's alerts (kind "apns") keep the device's Apple token in `url` and { device, sandbox } in `secret`. */
const appOf = (c: Pick<ChannelRow, "secret">) => {
	try {
		const s = JSON.parse(c.secret ?? "{}") as { device?: string; sandbox?: boolean };
		return { device: s.device ?? "", sandbox: s.sandbox === true };
	} catch {
		return { device: "", sandbox: false };
	}
};

/** Sends an alert to one app on a phone or computer. "gone" when the app is signed out or removed. */
export async function appTo(env: Env, account: Pick<AccountRow, "session_ver">, c: Pick<ChannelRow, "url" | "secret">, e: HookEvent, monitorId: string | null, tag?: string): Promise<"sent" | "gone" | "failed"> {
	const { device, sandbox } = appOf(c);
	// An app signed out by "Sign out everywhere" or a new password gets no more alerts.
	const d = await env.DB.prepare("SELECT session_ver FROM app_devices WHERE id = ?").bind(device).first<{ session_ver: number }>();
	if (!d || d.session_ver !== account.session_ver) return "gone";
	return sendApns(env.DB, env, c.url, sandbox, { title: e.subject, body: e.text.split("\n").find((l) => l.trim()) ?? "", urgent: e.urgent, monitorId, tag });
}

/** Posts to one channel. True when the service took it. Your own webhook's posts are signed with its secret. */
export async function postTo(c: Pick<ChannelRow, "kind" | "url" | "secret">, e: HookEvent): Promise<boolean> {
	const kind = (CHANNEL_KINDS.includes(c.kind as ChannelKind) ? c.kind : "webhook") as ChannelKind;
	const full: HookEvent = { ...e, id: e.id ?? `evt_${newId(12)}`, type: e.type ?? (e.event === "test" ? "test" : "alert.test"), created: e.sentAt, monitor: e.monitor ?? null };
	const body = JSON.stringify(payloadFor(kind, full));
	const headers: Record<string, string> = { "content-type": "application/json", "user-agent": `${WL.name.replace(/\s+/g, "")}/1.0` };
	if (kind === "webhook" && c.secret) Object.assign(headers, await webhookHeaders(c.secret, full.type!, full.id!, body));
	try {
		const res = await fetch(c.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
		await res.body?.cancel();
		return res.ok;
	} catch {
		return false;
	}
}

/** Sends an email in the install's brand (HTML with the plain text beside it). Null when Cloudflare took it, or what went wrong. */
export async function sendEmail(env: Env, from: string, to: string, subject: string, text: string, fromName = "Site Watch", look: Partial<EmailLook> = {}): Promise<string | null> {
	if (!env.EMAIL) return "email isn't set up on this install: the EMAIL binding is missing (see the README)";
	try {
		const inst = await install(env.DB);
		const html = brandedHtml(subject, text, { home: inst.origin ? `${inst.origin}/` : null, ...look, brand: look.brand ?? inst.brand });
		await env.EMAIL.send(new EmailMessage(from, to, rawEmail(from, to, subject, text, new Date(), newId(12), fromName, html)));
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

/** Sends one alert everywhere this account wants it, and notes it in their Alerts list. */
export async function deliver(env: Env, account: AccountRow, alert: Alert, monitorId: string | null, now = new Date()): Promise<void> {
	const db = env.DB;
	const inst = await install(db);
	const since = iso(new Date(now.getTime() - 86_400_000));
	const today = await db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE account_id = ? AND at > ? AND sent != 'held'").bind(account.id, since).first<{ n: number }>();
	const plan = account.role === "client" ? await planById(db, account.plan) : null;
	const cap = Math.min(account.alerts_per_day, plan?.alerts_per_day ?? Infinity);
	const sent: string[] = [];
	if ((today?.n ?? 0) >= cap) {
		sent.push("held");
	} else {
		const link = inst.origin ? `${inst.origin}/` : null;
		if (account.alert_to && inst.alertFrom) {
			const problem = await sendEmail(env, inst.alertFrom, account.alert_to, alert.subject, alert.text, inst.brand.name,
				{ brand: inst.brand, tone: toneOf(alert), footer: `You get these alerts because of your ${inst.brand.name} account. Choose where they go on the Alerts page.` });
			sent.push(problem ? "email failed" : "email");
		}
		// Team members who asked for alerts, and people who only get alerts (team.ts).
		if (inst.alertFrom) {
			for (const to of await alertPeople(db, account.id)) {
				if (to === account.alert_to) continue;
				const problem = await sendEmail(env, inst.alertFrom, to, alert.subject, alert.text, inst.brand.name,
					{ brand: inst.brand, tone: toneOf(alert), footer: `You get these alerts because you're on a ${inst.brand.name} team. Ask whoever added you to remove you.` });
				if (problem) sent.push("team email failed");
			}
		}
		const { results } = await db.prepare("SELECT * FROM channels WHERE account_id = ? AND on_off = 1").bind(account.id).all<ChannelRow>();
		const row = monitorId ? await db.prepare("SELECT * FROM monitors WHERE id = ?").bind(monitorId).first<MonitorRow>() : null;
		const e: HookEvent = {
			event: "alert", subject: alert.subject, text: alert.text, urgent: alert.urgent, url: link, sentAt: iso(now), app: inst.brand.name,
			id: `evt_${newId(12)}`, type: alert.type ?? "alert.test", monitor: row ? hookMonitor(row) : null,
		};
		const contact = inst.alertFrom ? `mailto:${inst.alertFrom}` : (inst.origin ?? "mailto:alerts@example.com");
		for (const c of results) {
			if (account.role === "client" && !planAllows(plan, c.kind)) continue;
			// Phones get down and back up alerts only, sent grouped when the run ends (flushPhones).
			if (isPhone(c.kind)) continue;
			if (c.kind === "push" || c.kind === "apns") {
				const r = c.kind === "apns" ? await appTo(env, account, c, e, monitorId, monitorId ?? undefined) : await pushTo(db, c, e, contact, monitorId ?? undefined);
				sent.push(r === "sent" ? c.name : `${c.name} failed`);
				if (r === "gone") await db.prepare("DELETE FROM channels WHERE id = ?").bind(c.id).run();
				continue;
			}
			const ok = await postTo(c, e);
			sent.push(ok ? c.name : `${c.name} failed`);
			const fails = ok ? 0 : c.fails + 1;
			if (fails !== c.fails) await db.prepare("UPDATE channels SET fails = ?, on_off = ? WHERE id = ?").bind(fails, fails >= MAX_FAILS ? 0 : 1, c.id).run();
		}
	}
	const saved = await db.prepare("INSERT INTO alerts (account_id, at, monitor_id, subject, text, urgent, sent) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(account.id, iso(now), monitorId, alert.subject, alert.text, alert.urgent ? 1 : 0, sent.join(", ")).run();
	const event = alert.type === "monitor.down" ? "down" : alert.type === "monitor.up" ? "up" : null;
	if (event && monitorId && !sent.includes("held") && (account.role === "owner" || planAllows(plan, "sms"))) {
		const row = await db.prepare("SELECT * FROM monitors WHERE id = ?").bind(monitorId).first<MonitorRow>();
		const phones = await db.prepare("SELECT COUNT(*) AS n FROM channels WHERE account_id = ? AND on_off = 1 AND kind IN ('sms', 'whatsapp')").bind(account.id).first<{ n: number }>();
		if (row && (phones?.n ?? 0) > 0) await queuePhone(db, account.id, saved.meta.last_row_id ?? null, { event, label: labelOf(row), at: iso(now) });
	}
}

/** Sends the text message and WhatsApp alerts made in this run (see phones.ts). Call it when a run's checks are done. */
export async function sendPhones(env: Env, now = new Date()): Promise<void> {
	const db = env.DB;
	const waiting = await db.prepare("SELECT 1 FROM phone_outbox WHERE claim IS NULL LIMIT 1").first().catch(() => null);
	if (!waiting) return;
	const inst = await install(db);
	await flushPhones(db, env, {
		account: (id) => accountById(db, id),
		plan: (id) => planById(db, id),
		link: inst.origin ? `${inst.origin}/` : "",
		app: inst.brand.name,
		ranOut: async (a: AccountRow, left: Allowance) => {
			// Once a month: the phone alerts have run out, so email and app alerts carry on alone.
			const key = `phones_out:${a.id}:${monthStart(now).slice(0, 7)}`;
			if (!a.alert_to || !inst.alertFrom || (await getMeta(db, key))) return;
			await setMeta(db, key, "1");
			await sendEmail(env, inst.alertFrom, a.alert_to, `Your text and WhatsApp alerts have run out this month`,
				`You've used all ${left.included ?? ""} text and WhatsApp alerts included with your plan this month, so we've held the latest one. Alerts carry on by email and on your devices as usual, and phone alerts start again on the 1st.\n\nNeed them sooner? Buy a top up on the Alerts page: ${inst.origin ?? ""}/#alerts`,
				inst.brand.name, { brand: inst.brand, tone: "warn" });
		},
	}, now);
}
