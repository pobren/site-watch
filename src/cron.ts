// The schedule: every minute Cloudflare runs this, and it checks whatever is due, a few at a time. Once a day each
// website's certificate and domain renewal date are looked up too, with reminders before either runs out.

import { deliver } from "./alerts.ts";
import { checkMail, checkPort, checkWebsite, lookupCert, lookupRegistration, type Result } from "./checks.ts";
import {
	alertFor, certAlert, certStale, certSteps, heartbeatOutcome, iso, markSent, reminderDue, remindersPassed, renewalAlert, RENEWAL_DAYS, rulesOf, stateOf, step,
	type Cert, type Registration,
} from "./core.ts";
import { accountById, ensureSchema, install, type AccountRow, type Env, type MonitorRow } from "./db.ts";

/** Checks per run, and how many at once (Workers allow six open connections; the free plan 50 requests a run). */
const PER_RUN = 40;
const AT_ONCE = 6;
/** Websites whose certificate and renewal are looked up per run (each is up to three requests). */
const DAILY_PER_RUN = 3;
/** A run that starts this late has its failures ignored: Cloudflare sometimes starts runs minutes late, and a late
 *  start can make a healthy site look slow. */
const LATE_MS = 60_000;
/** Heartbeats are looked at every 5 minutes, whatever their interval. */
const HEARTBEAT_LOOK = 5;
/** Alerts kept in the list. */
const KEEP_ALERTS = 500;

const minutesAgo = (now: Date, mins: number) => iso(new Date(now.getTime() - mins * 60_000 + 20_000));

async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
	for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map((x) => fn(x).catch((e) => console.error("check failed", e))));
}

export async function look(row: MonitorRow, now: Date, helloName: string): Promise<Result> {
	if (row.kind === "website") return checkWebsite(row.url!, rulesOf(row.rules));
	if (row.kind === "mail") return checkMail(row.host!, row.port!, helloName);
	if (row.kind === "port") return checkPort(row.host!, row.port!);
	return { outcome: heartbeatOutcome(row.every, row.last_ping, row.created_at, now), ms: null };
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
	const { next, events } = step(before, outcome, now, ms);
	await env.DB.prepare("UPDATE monitors SET state = ?, checked_at = ? WHERE id = ?").bind(JSON.stringify(next), iso(now), row.id).run();
	if (opts.quiet) return;
	for (const e of events) await deliver(env, account, alertFor({ ...row }, e, account.tz, ctx.link, ctx.app), row.id, now);
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

/** Only accounts that are live (the owner, and clients whose subscription is paid) have their checks run. */
const LIVE = `account_id IN (SELECT id FROM accounts WHERE role = 'owner' OR status IN ('active', 'trialing'))`;

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

	const { results: due } = await db.prepare(
		`SELECT * FROM monitors
		 WHERE ${LIVE} AND (paused_until IS NULL OR paused_until <= ?1)
		   AND (checked_at IS NULL OR checked_at <= strftime('%Y-%m-%dT%H:%M:%SZ', ?1, '-' || (CASE kind WHEN 'heartbeat' THEN ${HEARTBEAT_LOOK} ELSE every END) || ' minutes', '+20 seconds'))
		 ORDER BY checked_at IS NOT NULL, checked_at LIMIT ${PER_RUN}`,
	).bind(at).all<MonitorRow>();
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

	if (now.getUTCMinutes() === 7) await db.prepare(`DELETE FROM alerts WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY id DESC) AS n FROM alerts) WHERE n > ${KEEP_ALERTS})`).run();
}
