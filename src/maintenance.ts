// Planned maintenance windows (1.15.0). A maintenance notice on a status page can have a start and an end:
// - before it starts, the page shows it as planned;
// - while it runs, alerts for the monitors on that page wait (nobody is woken for work they planned);
// - at the end it resolves itself, and subscribers hear that it's finished.

import { iso } from "./core.ts";
import type { Env } from "./db.ts";

const MAX_DAYS = 14;

/** Checks the start and end the dashboard sent (ISO times). Both or neither; at most two weeks long. */
export function maintenanceWindow(startsAt: unknown, endsAt: unknown, now: Date): { startsAt: string | null; endsAt: string | null } | { error: string } {
	if ((startsAt === undefined || startsAt === null || startsAt === "") && (endsAt === undefined || endsAt === null || endsAt === "")) return { startsAt: null, endsAt: null };
	const s = typeof startsAt === "string" ? Date.parse(startsAt) : NaN;
	const e = typeof endsAt === "string" ? Date.parse(endsAt) : NaN;
	if (Number.isNaN(s) || Number.isNaN(e)) return { error: "Please give both a start and an end for the maintenance." };
	if (e <= s) return { error: "The maintenance needs to end after it starts." };
	if (e <= now.getTime()) return { error: "That maintenance has already finished. Please choose a time in the future." };
	if (e - s > MAX_DAYS * 86_400_000) return { error: `Maintenance windows can be up to ${MAX_DAYS} days long.` };
	if (s - now.getTime() > 365 * 86_400_000) return { error: "Please choose a time within the next year." };
	return { startsAt: iso(new Date(s)), endsAt: iso(new Date(e)) };
}

/** "Tue 10 Nov, 22:00 to 23:30" in the account's time zone. */
export function windowWords(startsAt: string, endsAt: string, tz: string): string {
	const opt = { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;
	const a = new Date(startsAt), b = new Date(endsAt);
	let zone = tz;
	try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { zone = "UTC"; }
	const sameDay = a.toLocaleDateString("en-GB", { timeZone: zone }) === b.toLocaleDateString("en-GB", { timeZone: zone });
	return `${a.toLocaleString("en-GB", { ...opt, timeZone: zone })} to ${sameDay ? b.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }) : b.toLocaleString("en-GB", { ...opt, timeZone: zone })} (${zone})`;
}

/** Whether a monitor is in a maintenance window now, on any status page that shows it. */
export async function inMaintenance(db: D1Database, accountId: string, monitorId: string, now: Date): Promise<boolean> {
	const at = iso(now);
	const { results } = await db.prepare(
		"SELECT p.monitors FROM notices n JOIN pages p ON p.id = n.page_id WHERE p.account_id = ? AND n.impact = 'maintenance' AND n.resolved_at IS NULL AND n.starts_at <= ? AND n.ends_at > ?",
	).bind(accountId, at, at).all<{ monitors: string }>();
	return results.some((r) => (JSON.parse(r.monitors) as string[]).includes(monitorId));
}

/** Resolves maintenance whose window has ended, and tells subscribers. Runs every few minutes from the cron. */
export async function endMaintenance(env: Env, now: Date): Promise<number> {
	const { results } = await env.DB.prepare("UPDATE notices SET resolved_at = ends_at WHERE impact = 'maintenance' AND resolved_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ? RETURNING page_id, title").bind(iso(now)).all<{ page_id: string; title: string }>();
	if (results.length) {
		const { tellSubscribers } = await import("./subscribers.ts");
		for (const n of results) await tellSubscribers(env, n.page_id, `Finished: ${n.title}`, `The planned maintenance is finished: ${n.title}.`).catch((e) => console.error("subscribers", e));
	}
	return results.length;
}
