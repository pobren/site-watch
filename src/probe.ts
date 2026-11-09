// Second opinions from other parts of the world. When a check fails twice in a row and we're about to send a "down"
// alert, small helpers in other Cloudflare regions try the same website, mail server or port straight away. The alert
// only goes if at least one of them agrees it's down; if they can all reach it, the problem is only where our own
// check runs (a blocked route, a firewall that turns away one region) and nobody is woken up.
//
// Each helper is a Durable Object pinned to a region with a location hint, so it stays there. They only work when a
// check is failing, so they cost next to nothing. Without the PROBES binding everything works as before.

import { DurableObject } from "cloudflare:workers";
import { checkJob, type CheckJob } from "./checks.ts";
import type { Outcome } from "./core.ts";
import { configure } from "./whitelabel.ts";
import type { Env, MonitorRow } from "./db.ts";

/** The regions asked, in order: the first two, and the third when one of them can't answer. */
export const REGIONS: { hint: DurableObjectLocationHint; name: string }[] = [
	{ hint: "weur", name: "west Europe" },
	{ hint: "enam", name: "east US" },
	{ hint: "apac", name: "Asia Pacific" },
];
/** How long we wait for a helper. Its own checks give up after 15 seconds. */
const WAIT_MS = 25_000;

export type ProbeJob = CheckJob;
export interface View { region: string; state: Outcome["state"]; why: string | null; ms: number | null }

export class Probe extends DurableObject<Env> {
	/** One check, from wherever this helper lives. */
	async check(job: ProbeJob): Promise<{ state: Outcome["state"]; why: string | null; ms: number | null }> {
		configure(this.env);
		const r = await checkJob(job);
		return { state: r.outcome.state, why: "why" in r.outcome ? r.outcome.why : null, ms: r.ms };
	}
}

async function ask(env: Env, region: (typeof REGIONS)[number], job: ProbeJob): Promise<View> {
	const ns = env.PROBES!;
	const stub = ns.get(ns.idFromName(`probe-${region.hint}`), { locationHint: region.hint }) as unknown as { check(j: ProbeJob): Promise<Omit<View, "region">> };
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const v = await Promise.race([stub.check(job), new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("no answer")), WAIT_MS); })]);
		return { region: region.name, ...v };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** What two other regions see, or null when there are no helpers (or none answered). Heartbeats have nothing to check. */
export async function secondOpinions(env: Env, row: MonitorRow, helloName: string): Promise<View[] | null> {
	if (!env.PROBES || row.kind === "heartbeat") return null;
	const job: ProbeJob = { kind: row.kind, url: row.url, rules: row.rules, host: row.host, port: row.port, helloName };
	const first = await Promise.allSettled(REGIONS.slice(0, 2).map((r) => ask(env, r, job)));
	const views = first.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
	if (views.length < 2) {
		const spare = await ask(env, REGIONS[2], job).catch(() => null);
		if (spare) views.push(spare);
	}
	return views.length ? views : null;
}

/** Joins region names the way people say them: "west Europe and east US". */
export const regionList = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
