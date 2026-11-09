// The schedule: every minute Cloudflare runs this, and it checks whatever is due, a few at a time. Things on 30 second
// checks are looked at every run, and again half a minute later through a delayed queue message (without a queue, every
// minute). Once a day each
// website's certificate and domain renewal date are looked up too, with reminders before either runs out.

import { deliver } from "./alerts.ts";
import { checkJob, lookupCert, lookupRegistration, type Result } from "./checks.ts";
import {
	alertFor, askAgain, certAlert, certStale, certSteps, heartbeatOutcome, iso, markSent, reminderDue, remindersPassed, renewalAlert, RENEWAL_DAYS, rulesOf, stateOf, step, weighOpinions,
	type Cert, type Registration,
} from "./core.ts";
import { secondOpinions } from "./probe.ts";
import { runSends, tellAboutMonitor } from "./subscribers.ts";
import { publicName } from "./status.ts";
import { accountById, ensureSchema, install, LIVE_SQL, type AccountRow, type CheckBatch, type Env, type MonitorRow } from "./db.ts";

/** Checks per run, and how many at once (Workers allow six open connections; the free plan 50 requests a run). */
const PER_RUN = 40;
const AT_ONCE = 6;
/** Websites whose certificate and renewal are looked up per run (each is up to three requests). */
const DAILY_PER_RUN = 3;
/** With a queue (env.CHECKS): checks handed out per run, and how many go in one message. */
const QUEUED_PER_RUN = 5000;
const PER_MESSAGE = 20;
const DAILY_QUEUED_PER_RUN = 200;
/** A run that starts this late has its failures ignored: Cloudflare sometimes starts runs minutes late, and a late
 *  start can make a healthy site look slow. */
const LATE_MS = 60_000;
/** Heartbeats are looked at every 5 minutes, whatever their interval. */
const HEARTBEAT_LOOK = 5;
/** 30 second checks: the second look each minute is a queue message held back this long. */
const HALF_MINUTE = 30;
/** Alerts kept in the list. */
const KEEP_ALERTS = 500;

const minutesAgo = (now: Date, mins: number) => iso(new Date(now.getTime() - mins * 60_000 + 20_000));

async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
	for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map((x) => fn(x).catch((e) => console.error("check failed", e))));
}

export async function look(row: MonitorRow, now: Date, helloName: string): Promise<Result> {
	if (row.kind === "heartbeat") return { outcome: heartbeatOutcome(row.every, row.last_ping, row.created_at, now), ms: null };
	return checkJob({ kind: row.kind, url: row.url, rules: row.rules, host: row.host, port: row.port, helloName });
}

/** Checks one monitor, saves what it found and sends any alerts. `late`: a failure isn't counted. */
export interface Ctx { helloName: string; link: string; app: string }

export async function checkOne(env: Env, row: MonitorRow, account: AccountRow, now: Date, ctx: Ctx, opts: { late?: boolean; quiet?: boolean } = {}): Promise<void> {
	const { outcome, ms } = await look(row, now, ctx.helloName);
	if (opts.late && outcome.state !== "up") {
		await env.DB.prepare("UPDATE monitors SET checked_at = ? WHERE id = ?").bind(iso(now), row.id).run();
		return;
	}
	const before = stateOf(row.state);
	let { next, events } = step(before, outcome, now, ms);
	// About to say it's down: other regions try it first (probe.ts). While only we can't reach it, they're asked
	// again every 10 minutes and the alert waits.
	if (events.some((e) => e.kind === "down") && env.PROBES && row.kind !== "heartbeat") {
		if (askAgain(before, now)) ({ next, events } = weighOpinions(next, events, await secondOpinions(env, row, ctx.helloName).catch(() => null), now));
		else ({ next, events } = { next: { ...next, alerted: false, regional: before.regional }, events: events.filter((e) => e.kind !== "down") });
	}
	await env.DB.prepare("UPDATE monitors SET state = ?, checked_at = ? WHERE id = ?").bind(JSON.stringify(next), iso(now), row.id).run();
	if (opts.quiet) return;
	for (const e of events) {
		await deliver(env, account, alertFor({ ...row }, e, account.tz, ctx.link, ctx.app), row.id, now);
		// Status pages that tell their subscribers automatically (subscribers.ts).
		if (e.kind === "down" || e.kind === "up") await tellAboutMonitor(env, row.account_id, row.id, publicName(row), e.kind === "down", e.kind === "down" ? e.since : null).catch((x) => console.error("subscribers", x));
	}
}

/** The once-a-day look at a website's certificate and domain registration, with reminders. */
export async function dailyOne(env: Env, row: MonitorRow, account: AccountRow, now: Date, ctx: Ctx, quiet = false): Promise<void> {
	const host = new URL(row.url!).hostname;
	const was: Cert | null = row.cert ? JSON.parse(row.cert) : null;
	const cert = url(row).protocol === "https:" && certStale(was, host, now) ? await lookupCert(host, now) : was;
	const reg: Registration | null | undefined = await lookupRegistration(host, now) ?? (row.reg ? JSON.parse(row.reg) : null);
	const keepCert = cert === undefined ? was : cert;
	// A new expiry date starts its reminders again, with the ones already passed marked as sent.
	let certSent = keepCert?.expires === was?.expires ? row.cert_sent : remindersPassed(keepCert?.expires ?? null, now, certSteps(keepCert));
	const oldReg: Registration | null = row.reg ? JSON.parse(row.reg) : null;
	let regSent = reg?.expires === oldReg?.expires ? row.reg_sent : remindersPassed(reg?.expires ?? null, now, RENEWAL_DAYS);
	if (!quiet && keepCert && reminderDue(keepCert.expires, now, certSent, certSteps(keepCert)) !== null) {
		await deliver(env, account, certAlert(keepCert, now, ctx.link, ctx.app), row.id, now);
		certSent = markSent(certSent, keepCert.expires, now, certSteps(keepCert));
	}
	if (!quiet && reg?.expires && reminderDue(reg.expires, now, regSent, RENEWAL_DAYS) !== null) {
		// Two websites on one domain share a registration: only the first one reminds.
		const twin = await env.DB.prepare("SELECT id FROM monitors WHERE account_id = ? AND kind = 'website' AND extras = 1 AND json_extract(reg, '$.domain') = ? AND id < ? LIMIT 1").bind(row.account_id, reg.domain, row.id).first();
		if (!twin) await deliver(env, account, renewalAlert(reg, now, ctx.link, ctx.app), row.id, now);
		regSent = markSent(regSent, reg.expires, now, RENEWAL_DAYS);
	}
	await env.DB.prepare("UPDATE monitors SET cert = ?, reg = ?, cert_sent = ?, reg_sent = ?, daily_at = ? WHERE id = ?")
		.bind(keepCert ? JSON.stringify(keepCert) : null, reg ? JSON.stringify(reg) : null, certSent, regSent, iso(now), row.id).run();
}

const url = (row: MonitorRow) => new URL(row.url!);

export async function contextOf(env: Env): Promise<Ctx> {
	const inst = await install(env.DB);
	return { link: inst.origin ? `${inst.origin}/` : "your Site Watch address", helloName: inst.origin ? new URL(inst.origin).hostname : "sitewatch.invalid", app: inst.brand.name };
}

/** Only accounts that are live (the owner, clients whose subscription is paid, and confirmed free clients) are checked. */
const LIVE = LIVE_SQL;

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Hands due checks to the queue. Each is marked as looked at first, so the next run doesn't send it again. */
async function enqueue(env: Env, ids: string[], batch: Omit<CheckBatch, "ids">, mark: string | null, delaySeconds = 0): Promise<void> {
	const db = env.DB;
	if (mark) for (const part of chunk(ids, 90)) {
		await db.prepare(`UPDATE monitors SET ${mark} = ? WHERE id IN (${part.map(() => "?").join(",")})`).bind(iso(new Date(batch.at)), ...part).run();
	}
	for (const group of chunk(chunk(ids, PER_MESSAGE), 100)) await env.CHECKS!.sendBatch(group.map((g) => ({ body: { ...batch, ids: g }, ...(delaySeconds ? { delaySeconds } : {}) })));
}

/** The queue's side: checks one message's monitors. Called by Cloudflare with a few messages at a time. */
export async function runQueue(env: Env, messages: readonly Message<CheckBatch>[]): Promise<void> {
	const db = env.DB;
	await ensureSchema(db);
	const ctx = await contextOf(env);
	const accounts = new Map<string, AccountRow | null>();
	const accountOf = async (id: string) => {
		if (!accounts.has(id)) accounts.set(id, await accountById(db, id));
		return accounts.get(id)!;
	};
	for (const m of messages) {
		// A batch of messages to status page subscribers: tried again shortly if Amazon asks us to slow down.
		if (m.body.sends) {
			if ((await runSends(env, m.body.sends)) === "slow") m.retry({ delaySeconds: 30 });
			else m.ack();
			continue;
		}
		const { ids, daily, late, at } = m.body;
		const now = new Date();
		// A message that waited too long counts as late: failures from it aren't trusted.
		const stale = late || now.getTime() - at > LATE_MS;
		const { results } = await db.prepare(`SELECT * FROM monitors WHERE id IN (${ids.map(() => "?").join(",")}) AND ${LIVE}`).bind(...ids).all<MonitorRow>();
		await inBatches(results, AT_ONCE, async (row) => {
			const a = await accountOf(row.account_id);
			if (!a) return;
			if (daily) await dailyOne(env, row, a, now, ctx);
			else await checkOne(env, row, a, now, ctx, { late: stale });
		});
		m.ack();
	}
}

export async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
	const db = env.DB;
	await ensureSchema(db);
	const now = new Date();
	const late = now.getTime() - scheduledTime > LATE_MS;
	const ctx = await contextOf(env);
	const at = iso(now);
	const accounts = new Map<string, AccountRow | null>();
	const accountOf = async (id: string) => {
		if (!accounts.has(id)) accounts.set(id, await accountById(db, id));
		return accounts.get(id)!;
	};

	const queued = !!env.CHECKS;
	// 30 second checks (every below 1) are due every run; with a queue they get a second look half a minute later.
	const { results: due } = await db.prepare(
		`SELECT ${queued ? "id, every, kind" : "*"} FROM monitors
		 WHERE ${LIVE} AND (paused_until IS NULL OR paused_until <= ?1)
		   AND (checked_at IS NULL OR (kind != 'heartbeat' AND every < 1) OR checked_at <= strftime('%Y-%m-%dT%H:%M:%SZ', ?1, '-' || (CASE kind WHEN 'heartbeat' THEN ${HEARTBEAT_LOOK} ELSE every END) || ' minutes', '+20 seconds'))
		 ORDER BY checked_at IS NOT NULL, checked_at LIMIT ${queued ? QUEUED_PER_RUN : PER_RUN}`,
	).bind(at).all<MonitorRow>();
	if (queued) {
		// Everything due goes to the queue, a batch to a message; Cloudflare runs as many at once as it needs.
		await enqueue(env, due.map((r) => r.id), { late, at: now.getTime() }, "checked_at");
		const fast = due.filter((r) => r.kind !== "heartbeat" && r.every < 1).map((r) => r.id);
		if (fast.length) await enqueue(env, fast, { late, at: now.getTime() + HALF_MINUTE * 1000 }, null, HALF_MINUTE);
		const { results: daily } = await db.prepare(
			`SELECT id FROM monitors WHERE ${LIVE} AND kind = 'website' AND extras = 1 AND (daily_at IS NULL OR daily_at <= ?) ORDER BY daily_at IS NOT NULL, daily_at LIMIT ${DAILY_QUEUED_PER_RUN}`,
		).bind(minutesAgo(now, 24 * 60)).all<{ id: string }>();
		if (daily.length) await enqueue(env, daily.map((r) => r.id), { daily: true, at: now.getTime() }, "daily_at");
		await tidy(db, now);
		return;
	}
	await inBatches(due, AT_ONCE, async (row) => {
		const a = await accountOf(row.account_id);
		if (a) await checkOne(env, row, a, now, ctx, { late });
	});

	const { results: daily } = await db.prepare(
		`SELECT * FROM monitors WHERE ${LIVE} AND kind = 'website' AND extras = 1 AND (daily_at IS NULL OR daily_at <= ?) ORDER BY daily_at IS NOT NULL, daily_at LIMIT ${DAILY_PER_RUN}`,
	).bind(minutesAgo(now, 24 * 60)).all<MonitorRow>();
	for (const row of daily) {
		const a = await accountOf(row.account_id);
		if (a) await dailyOne(env, row, a, now, ctx).catch((e) => console.error("daily look failed", e));
	}

	await tidy(db, now);
}

/** Once an hour: old alerts beyond the last 500 an account, and sign-up records older than a day. */
async function tidy(db: D1Database, now: Date): Promise<void> {
	if (now.getUTCMinutes() !== 7) return;
	await db.prepare(`DELETE FROM alerts WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY id DESC) AS n FROM alerts) WHERE n > ${KEEP_ALERTS})`).run();
	await db.prepare("DELETE FROM signups WHERE at < ?").bind(minutesAgo(now, 24 * 60)).run();
	await db.prepare("DELETE FROM phone_sends WHERE at < ?").bind(minutesAgo(now, 45 * 24 * 60)).run();
}
