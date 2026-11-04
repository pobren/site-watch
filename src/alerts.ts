// Sending an alert: by email (Cloudflare's send_email binding) and to every alert channel the account has switched
// on (Slack, Teams, Google Chat, Discord or your own webhook). Every alert is kept in the account's Alerts list,
// and a daily cap stops a server that keeps going up and down from flooding anyone.

import { EmailMessage } from "cloudflare:email";
import { CHANNEL_KINDS, hookMonitor, webhookHeaders, MAX_FAILS, payloadFor, rawEmail, iso, type Alert, type ChannelKind, type HookEvent } from "./core.ts";
import { install, newId, type AccountRow, type Env, type MonitorRow } from "./db.ts";

interface ChannelRow { id: number; kind: string; name: string; url: string; secret: string | null; on_off: number; fails: number }

export const newSecret = () => `whsec_${newId(24)}`;

/** Posts to one channel. True when the service took it. Your own webhook's posts are signed with its secret. */
export async function postTo(c: Pick<ChannelRow, "kind" | "url" | "secret">, e: HookEvent): Promise<boolean> {
	const kind = (CHANNEL_KINDS.includes(c.kind as ChannelKind) ? c.kind : "webhook") as ChannelKind;
	const full: HookEvent = { ...e, id: e.id ?? `evt_${newId(12)}`, type: e.type ?? (e.event === "test" ? "test" : "alert.test"), created: e.sentAt, monitor: e.monitor ?? null };
	const body = JSON.stringify(payloadFor(kind, full));
	const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "SiteWatch/1.0" };
	if (kind === "webhook" && c.secret) Object.assign(headers, await webhookHeaders(c.secret, full.type!, full.id!, body));
	try {
		const res = await fetch(c.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
		await res.body?.cancel();
		return res.ok;
	} catch {
		return false;
	}
}

/** Sends a plain text email. Null when Cloudflare took it, or what went wrong. */
export async function sendEmail(env: Env, from: string, to: string, subject: string, text: string, fromName = "Site Watch"): Promise<string | null> {
	if (!env.EMAIL) return "email isn't set up on this install: the EMAIL binding is missing (see the README)";
	try {
		await env.EMAIL.send(new EmailMessage(from, to, rawEmail(from, to, subject, text, new Date(), newId(12), fromName)));
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
	const sent: string[] = [];
	if ((today?.n ?? 0) >= account.alerts_per_day) {
		sent.push("held");
	} else {
		const link = inst.origin ? `${inst.origin}/` : null;
		if (account.alert_to && inst.alertFrom) {
			const problem = await sendEmail(env, inst.alertFrom, account.alert_to, alert.subject, alert.text, inst.brand.name);
			sent.push(problem ? "email failed" : "email");
		}
		const { results } = await db.prepare("SELECT * FROM channels WHERE account_id = ? AND on_off = 1").bind(account.id).all<ChannelRow>();
		const row = monitorId ? await db.prepare("SELECT * FROM monitors WHERE id = ?").bind(monitorId).first<MonitorRow>() : null;
		const e: HookEvent = {
			event: "alert", subject: alert.subject, text: alert.text, urgent: alert.urgent, url: link, sentAt: iso(now), app: inst.brand.name,
			id: `evt_${newId(12)}`, type: alert.type ?? "alert.test", monitor: row ? hookMonitor(row) : null,
		};
		for (const c of results) {
			const ok = await postTo(c, e);
			sent.push(ok ? c.name : `${c.name} failed`);
			const fails = ok ? 0 : c.fails + 1;
			if (fails !== c.fails) await db.prepare("UPDATE channels SET fails = ?, on_off = ? WHERE id = ?").bind(fails, fails >= MAX_FAILS ? 0 : 1, c.id).run();
		}
	}
	await db.prepare("INSERT INTO alerts (account_id, at, monitor_id, subject, text, urgent, sent) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(account.id, iso(now), monitorId, alert.subject, alert.text, alert.urgent ? 1 : 0, sent.join(", ")).run();
}
