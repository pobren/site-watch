// The parts of Site Watch that need no network and no database, so the tests can load them straight into Node:
// cleaning what you type, what one check means, how a monitor's state moves on, uptime, certificates, domain
// renewals and the mail server conversation. checks.ts does the network side and cron.ts the scheduling.

export type Kind = "website" | "api" | "dns" | "mail" | "port" | "heartbeat";
export type Proto = "smtp" | "imap" | "pop3";

/** Failed checks in a row before we call something down, so one slow answer doesn't send an alert. */
export const DOWN_AFTER = 2;
/** How often a website, mail server or port can be checked, in minutes. 0.5 is every 30 seconds (1.8.0): the minute's
 *  run checks it and a delayed queue message checks it again half a minute later. Plans say how many may use it. */
export const FAST_EVERY = 0.5;
export const CHECK_EVERY = [FAST_EVERY, 1, 5, 10, 15, 30, 60];
export const DEFAULT_EVERY = 5;
/** How often a heartbeat is expected, in minutes. */
export const HEARTBEAT_EVERY = [5, 15, 30, 60, 360, 1440, 10080];
/** A heartbeat is late once this long has passed: its interval plus a tenth of it, at least 5 minutes. */
export const heartbeatLate = (every: number) => (every + Math.max(5, Math.round(every / 10))) * 60_000;
/** Outages in an hour that make something "going up and down": one alert says so, then it goes quiet. */
export const FLAP_OUTAGES = 3;
const FLAP_QUIET_MS = 30 * 60_000;
/** While it's going up and down, a fresh outage only alerts once it has lasted this long. */
const FLAP_DOWN_MS = 15 * 60_000;
/** Past outages kept for each monitor, days of daily totals, and hours of response times. */
const KEEP_OUTAGES = 30;
export const KEEP_DAYS = 90;
export const KEEP_HOURS = 24;
/** The free licence covers this many websites for one person or organisation (see LICENSE). Nothing enforces it. */
export const LICENCE_SITES = 10;

/** The mail ports Cloudflare can reach. Port 25 isn't here: Workers can't connect out on it. */
export const MAIL_PORTS: { port: number; name: string; proto: Proto; tls: "on" | "starttls" }[] = [
	{ port: 587, name: "Sending mail (SMTP submission)", proto: "smtp", tls: "starttls" },
	{ port: 465, name: "Sending mail (SMTP over TLS)", proto: "smtp", tls: "on" },
	{ port: 993, name: "Reading mail (IMAP over TLS)", proto: "imap", tls: "on" },
	{ port: 143, name: "Reading mail (IMAP)", proto: "imap", tls: "starttls" },
	{ port: 995, name: "Reading mail (POP3 over TLS)", proto: "pop3", tls: "on" },
	{ port: 110, name: "Reading mail (POP3)", proto: "pop3", tls: "starttls" },
];
export const mailPort = (port: number) => MAIL_PORTS.find((p) => p.port === port) ?? null;

// -- Cleaning what people type ------------------------------------------------------------------

/** A web address to watch: https:// added when it's missing, no user name, password or #part. */
export function cleanUrl(input: unknown): string | null {
	if (typeof input !== "string" || !input.trim() || input.length > 500) return null;
	const text = input.trim();
	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
	} catch {
		return null;
	}
	if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
	if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i.test(url.hostname)) return null;
	url.hash = "";
	return url.toString();
}

/** A server's name: lower case, at least two parts, no addresses or ports. */
export function cleanHost(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "");
	if (host.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host)) return null;
	return host;
}

/** Ports we won't try: 25 (Cloudflare blocks it) and the ones Workers can't open. */
export function cleanPort(input: unknown): number | null {
	const n = Number(input);
	if (!Number.isInteger(n) || n < 1 || n > 65535 || n === 25) return null;
	return n;
}

export const cleanName = (input: unknown, max = 60) => (typeof input === "string" ? input.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

export interface Rules {
	/** The exact status code the page must answer with. Without it, anything under 500 counts as working. */
	status?: number;
	/** Words the page must contain, and must not contain (not case sensitive). */
	contains?: string;
	missing?: string;
	/** Slowest acceptable answer, in milliseconds. */
	maxMs?: number;
}

export function cleanRules(input: unknown): Rules | { error: string } {
	const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const out: Rules = {};
	if (r.status !== undefined && r.status !== null && r.status !== "") {
		const s = Number(r.status);
		if (!Number.isInteger(s) || s < 100 || s > 599) return { error: "The status code should be a number from 100 to 599, such as 200." };
		out.status = s;
	}
	for (const k of ["contains", "missing"] as const) {
		if (typeof r[k] === "string" && r[k].trim()) out[k] = (r[k] as string).replace(/\s+/g, " ").trim().slice(0, 100);
	}
	if (r.maxMs !== undefined && r.maxMs !== null && r.maxMs !== "") {
		const ms = Number(r.maxMs);
		if (!Number.isFinite(ms) || ms < 500 || ms > 15_000) return { error: "The time limit should be between 0.5 and 15 seconds." };
		out.maxMs = Math.round(ms);
	}
	return out;
}

export function rulesOf(saved: string | null): Rules {
	try {
		const r = saved ? JSON.parse(saved) : {};
		return r && typeof r === "object" ? r : {};
	} catch {
		return {};
	}
}

// -- API and DNS checks (1.10.0) -----------------------------------------------------------------

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export interface ApiRules extends Rules {
	method?: (typeof API_METHODS)[number];
	headers?: Record<string, string>;
	body?: string;
	/** A value in the JSON answer, by its path ("status" or "data.items.0.ok"), and what it must equal. */
	json?: { path: string; equals: string };
}

/** What an API check sends and expects. Header values work like passwords, so they're never shown back in full. */
export function cleanApiRules(input: unknown): ApiRules | { error: string } {
	const base = cleanRules(input);
	if ("error" in base) return base;
	const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const out: ApiRules = { ...base };
	const method = typeof r.method === "string" ? r.method.toUpperCase() : "GET";
	if (!(API_METHODS as readonly string[]).includes(method)) return { error: "Please choose GET, POST, PUT, PATCH, DELETE or HEAD." };
	if (method !== "GET") out.method = method as ApiRules["method"];
	if (r.headers && typeof r.headers === "object") {
		const list = Object.entries(r.headers as Record<string, unknown>).filter(([k, v]) => k.trim() && typeof v === "string");
		if (list.length > 10) return { error: "Please use 10 headers or fewer." };
		const headers: Record<string, string> = {};
		for (const [k, v] of list) {
			const name = k.trim();
			if (!/^[A-Za-z0-9-]{1,60}$/.test(name)) return { error: `"${name}" isn't a header name we can send. Use letters, numbers and dashes.` };
			if (/^(host|content-length|connection|transfer-encoding)$/i.test(name)) return { error: `The ${name} header is set for you.` };
			if ((v as string).length > 2000 || /[\r\n]/.test(v as string)) return { error: `The ${name} header is too long or has a line break.` };
			headers[name] = v as string;
		}
		if (Object.keys(headers).length) out.headers = headers;
	}
	if (typeof r.body === "string" && r.body.trim()) {
		if (method === "GET" || method === "HEAD") return { error: "GET and HEAD requests can't send a body. Choose POST or PUT instead." };
		if (r.body.length > 4000) return { error: "Please keep the body under 4,000 characters." };
		out.body = r.body;
	}
	const j = r.json as Record<string, unknown> | undefined;
	if (j && typeof j.path === "string" && j.path.trim()) {
		const path = j.path.trim().replace(/^\$\.?/, "");
		if (!/^[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+){0,9}$/.test(path)) return { error: "Please give the JSON value as a path like status or data.items.0.ok." };
		out.json = { path, equals: String(j.equals ?? "").slice(0, 200) };
	}
	return out;
}

/** The value at a dotted path in parsed JSON, or undefined. */
export function jsonAt(data: unknown, path: string): unknown {
	let at: unknown = data;
	for (const part of path.split(".")) {
		if (at === null || typeof at !== "object") return undefined;
		at = (at as Record<string, unknown>)[part];
	}
	return at;
}

/** One API call with its rules: under 400 counts as working unless a status is set, then the words, time and JSON value. */
export function apiOutcome(result: { status?: number; error?: string; ms: number; body?: string }, rules: ApiRules): Outcome {
	if (result.error !== undefined) return classify(result);
	const status = result.status ?? 0;
	if (rules.status === undefined && status >= 400) return status >= 500 ? classify(result) : { state: "down", why: `it answered with status ${status}` };
	const page = pageOutcome(result, rules);
	if (page.state !== "up" || !rules.json) return page;
	let data: unknown;
	try {
		data = JSON.parse(result.body ?? "");
	} catch {
		return { state: "down", why: "its answer wasn't JSON" };
	}
	const got = jsonAt(data, rules.json.path);
	if (got === undefined) return { state: "down", why: `its answer has no ${rules.json.path}` };
	const text = typeof got === "string" ? got : JSON.stringify(got);
	if (text !== rules.json.equals) return { state: "down", why: `${rules.json.path} was ${text.slice(0, 60)}, not ${rules.json.equals}` };
	return page;
}

export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA"] as const;
export interface DnsRules { type: (typeof DNS_TYPES)[number]; /** Words one of the answers must contain, such as an address or mail server. */ expect?: string }

export function cleanDnsRules(input: unknown): DnsRules | { error: string } {
	const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const type = typeof r.type === "string" ? r.type.toUpperCase() : "A";
	if (!(DNS_TYPES as readonly string[]).includes(type)) return { error: "Please choose a record type: A, AAAA, CNAME, MX, TXT, NS or CAA." };
	const out: DnsRules = { type: type as DnsRules["type"] };
	if (typeof r.expect === "string" && r.expect.trim()) out.expect = r.expect.trim().slice(0, 200);
	return out;
}

/** A DNS over HTTPS answer (application/dns-json): Status 0 is fine, 3 is "no such name". */
export interface DohAnswer { Status: number; Answer?: { type: number; data: string }[] }
const DNS_CODES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

export function dnsOutcome(result: { answer?: DohAnswer; error?: string }, host: string, rules: DnsRules): Outcome {
	if (result.error !== undefined || !result.answer) return { state: "down", why: "the DNS lookup didn't answer" };
	if (result.answer.Status === 3) return { state: "down", why: `${host} doesn't exist in DNS any more` };
	if (result.answer.Status !== 0) return { state: "down", why: `the DNS lookup failed (code ${result.answer.Status})` };
	const records = (result.answer.Answer ?? []).filter((a) => a.type === DNS_CODES[rules.type]).map((a) => a.data.replace(/^"|"$/g, ""));
	if (!records.length) return { state: "down", why: `${host} has no ${rules.type} records` };
	if (rules.expect && !records.some((d) => d.toLowerCase().includes(rules.expect!.toLowerCase()))) return { state: "down", why: `its ${rules.type} records no longer include ${rules.expect} (found ${records.slice(0, 3).join(", ").slice(0, 120)})` };
	return { state: "up" };
}

// -- What one check means -----------------------------------------------------------------------

export type Outcome = { state: "up" } | { state: "down" | "cert" | "blocked"; why: string };

/** One visit to a web page. Any answer under 500 means the web server is there (even "forbidden"). */
export function classify(result: { status?: number; error?: string }): Outcome {
	if (result.error !== undefined) {
		if (/certificate|ssl|tls|x509|handshake/i.test(result.error)) return { state: "cert", why: "browsers can't make a secure connection to it: its certificate has expired, doesn't match the address, or isn't trusted" };
		if (/time ?out|timed out|abort/i.test(result.error)) return { state: "down", why: "it didn't answer within 15 seconds" };
		return { state: "down", why: "we couldn't connect to it" };
	}
	const status = result.status ?? 0;
	if (status === 526) return { state: "cert", why: "Cloudflare can't check the certificate on the web server behind it, so visitors see an \"Invalid SSL certificate\" error (526)" };
	if (status >= 500) return { state: "down", why: `it answered with an error (${status})` };
	return { state: "up" };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;

/** One visit with your rules on top: the status code, words it must or mustn't contain, and a time limit. */
export function pageOutcome(result: { status?: number; error?: string; ms: number; body?: string }, rules: Rules): Outcome {
	if (result.error !== undefined) return classify(result);
	const status = result.status ?? 0;
	if (status === 526) return classify(result);
	if (rules.status !== undefined && status !== rules.status) return { state: "down", why: `it answered with status ${status}, not ${rules.status}` };
	if (rules.status === undefined && status >= 500) return classify(result);
	const body = (result.body ?? "").toLowerCase();
	if (rules.contains && !body.includes(rules.contains.toLowerCase())) return { state: "down", why: `the page no longer contains "${rules.contains}"` };
	if (rules.missing && body.includes(rules.missing.toLowerCase())) return { state: "down", why: `the page contains "${rules.missing}"` };
	if (rules.maxMs && result.ms > rules.maxMs) return { state: "down", why: `it took ${secs(result.ms)} to answer, over your limit of ${secs(rules.maxMs)}` };
	return { state: "up" };
}

const everyWords = (mins: number) => (mins % 1440 === 0 ? `${mins / 1440 === 1 ? "day" : `${mins / 1440} days`}` : mins % 60 === 0 ? `${mins / 60 === 1 ? "hour" : `${mins / 60} hours`}` : `${mins} minutes`);

export function heartbeatOutcome(every: number, lastPing: string | null, created: string, now: Date): Outcome {
	if (now.getTime() - Date.parse(lastPing ?? created) <= heartbeatLate(every)) return { state: "up" };
	return { state: "down", why: lastPing ? `it should check in every ${everyWords(every)}` : `it should check in every ${everyWords(every)}, and hasn't checked in since you set it up` };
}

// -- State --------------------------------------------------------------------------------------

export interface Outage { from: string; to: string; why: string }
export interface State {
	/** Failed checks in a row, when the first of them was, and why the latest failed. */
	fails: number;
	since: string | null;
	why: string | null;
	/** True once the "down" alert went for this outage, so the "back up" one follows it. */
	alerted: boolean;
	certFails: number;
	certProblem: string | null;
	blockedFails: number;
	blocked: string | null;
	outages: Outage[];
	/** Checks that found it up and down on each day (UTC), the last KEEP_DAYS days. */
	days: Record<string, [up: number, down: number]>;
	/** Response times per hour (UTC, "2026-10-27T17"): total milliseconds and answered checks. */
	hours: Record<string, [ms: number, checks: number]>;
	ms: number | null;
	/** Set while it keeps going up and down: when the one alert about it went. */
	flapping: string | null;
	/** Set while it only fails from our own check: when other regions last said they could reach it, and which. */
	regional?: { at: string; ok: string[] } | null;
}
export const NEW_STATE: State = { fails: 0, since: null, why: null, alerted: false, certFails: 0, certProblem: null, blockedFails: 0, blocked: null, outages: [], days: {}, hours: {}, ms: null, flapping: null, regional: null };

export function stateOf(saved: string | null): State {
	try {
		return saved ? { ...NEW_STATE, ...JSON.parse(saved) } : { ...NEW_STATE, outages: [], days: {}, hours: {} };
	} catch {
		return { ...NEW_STATE, outages: [], days: {}, hours: {} };
	}
}

export type Event =
	| { kind: "down"; why: string; since: string; confirmed?: string[] }
	| { kind: "up"; outage: Outage }
	| { kind: "cert"; why: string }
	| { kind: "flapping"; outages: number }
	| { kind: "blocked"; why: string };

export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function countDay(days: State["days"], day: string, down: boolean): State["days"] {
	const next = { ...days };
	const [up, dn] = next[day] ?? [0, 0];
	next[day] = down ? [up, dn + 1] : [up + 1, dn];
	const keys = Object.keys(next).sort();
	for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete next[k];
	return next;
}

function addResponse(hours: State["hours"], at: string, ms: number): State["hours"] {
	const next = { ...hours };
	const hour = at.slice(0, 13);
	const [sum, n] = next[hour] ?? [0, 0];
	next[hour] = [sum + Math.max(0, Math.round(ms)), n + 1];
	const keys = Object.keys(next).sort();
	for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_HOURS))) delete next[k];
	return next;
}

/**
 * Moves a monitor on after one check, and says which alerts to send. At most one "down" alert per outage, and a
 * "back up" one only after a "down" one. A single failed check is forgotten if the next one works. Being turned
 * away (a mail server refusing cloud addresses) isn't counted as up or down: we say so once and wait.
 */
export function step(s: State, o: Outcome, now: Date, ms: number | null = null): { next: State; events: Event[] } {
	const at = iso(now);
	const events: Event[] = [];
	if (o.state === "blocked") {
		const next = { ...s, blockedFails: s.blockedFails + 1, ms: ms ?? s.ms };
		if (next.blockedFails >= DOWN_AFTER && !s.blocked) {
			next.blocked = o.why;
			events.push({ kind: "blocked", why: o.why });
		}
		return { next, events };
	}
	const next: State = { ...s, blockedFails: 0, blocked: null, outages: [...s.outages], days: countDay(s.days, at.slice(0, 10), o.state === "down"), ms };
	if (ms !== null && o.state !== "down") next.hours = addResponse(s.hours, at, ms);
	if (o.state === "down") {
		next.fails = s.fails + 1;
		next.since = s.since ?? at;
		next.why = o.why;
		const settled = !s.flapping || now.getTime() - Date.parse(next.since) >= FLAP_DOWN_MS;
		if (next.fails >= DOWN_AFTER && !s.alerted && settled) {
			next.alerted = true;
			events.push({ kind: "down", why: o.why, since: next.since });
		}
		return { next, events };
	}
	if (s.fails >= DOWN_AFTER && s.since) {
		const outage = { from: s.since, to: at, why: s.why ?? "" };
		next.outages = [...s.outages, outage].slice(-KEEP_OUTAGES);
		const lastHour = next.outages.filter((x) => Date.parse(x.to) > now.getTime() - 3_600_000).length;
		if (!s.flapping && lastHour >= FLAP_OUTAGES) {
			next.flapping = at;
			events.push({ kind: "flapping", outages: lastHour });
		} else if (s.alerted) events.push({ kind: "up", outage });
	} else if (s.flapping) {
		const last = s.outages[s.outages.length - 1];
		if (!last || Date.parse(last.to) <= now.getTime() - FLAP_QUIET_MS) next.flapping = null;
	}
	next.fails = 0;
	next.regional = null;
	next.since = null;
	next.why = null;
	next.alerted = false;
	if (o.state === "cert") {
		next.certFails = s.certFails + 1;
		if (next.certFails >= DOWN_AFTER && !s.certProblem) {
			next.certProblem = o.why;
			events.push({ kind: "cert", why: o.why });
		}
	} else {
		next.certFails = 0;
		next.certProblem = null;
	}
	return { next, events };
}

export const isDown = (s: State) => s.fails >= DOWN_AFTER;

export type Status = "checking" | "up" | "down" | "cert" | "blocked" | "unsure" | "paused";
export function statusOf(s: State, checked: boolean, paused: boolean): Status {
	if (paused) return "paused";
	if (!checked) return "checking";
	return s.blocked ? "blocked" : isDown(s) ? "down" : s.certProblem ? "cert" : s.fails ? "unsure" : "up";
}

/** The share of checks that found it up over the last `days` days, from the daily totals. Null before any check. */
export function uptime(s: State, now: Date, days = 30): number | null {
	const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
	let up = 0;
	let down = 0;
	for (const [day, [u, d]] of Object.entries(s.days ?? {})) if (day >= from) { up += u; down += d; }
	if (!up && !down) return null;
	return Math.floor((up / (up + down)) * 10000) / 100;
}

/** Each of the last `days` days (oldest first) as the share of checks that found it up, or null for no checks. */
export function dailyBars(s: State, now: Date, days = KEEP_DAYS): { day: string; up: number | null }[] {
	const out: { day: string; up: number | null }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
		const [u, d] = s.days?.[day] ?? [0, 0];
		out.push({ day, up: u + d ? Math.floor((u / (u + d)) * 10000) / 100 : null });
	}
	return out;
}

export function responseTimes(s: State): { hour: string; ms: number }[] {
	return Object.entries(s.hours ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([hour, [sum, n]]) => ({ hour, ms: n ? Math.round(sum / n) : 0 }));
}

// -- Certificates and domain renewals --------------------------------------------------------------

export interface Cert { expires: string; issuer: string | null; host: string; checkedAt: string; issued: string; auto: boolean }
export interface Registration { domain: string; expires: string | null; registrar: string | null; checkedAt: string }

/** A certificate that lasts this many days or fewer renews itself (Let's Encrypt, Google Trust Services and others). */
export const AUTO_CERT_MAX_DAYS = 100;
/** Reminders before a certificate runs out: hand-renewed ones, and self-renewing ones (only once the renewal is late). */
export const CERT_DAYS = [14, 7, 1];
export const AUTO_CERT_DAYS = [7, 1];
export const certSteps = (cert: Cert | null | undefined) => (cert?.auto ? AUTO_CERT_DAYS : CERT_DAYS);
/** Reminders before a domain registration runs out. */
export const RENEWAL_DAYS = [30, 7, 1];

/** One entry from crt.sh's JSON (Certificate Transparency logs). */
export interface CtEntry { not_before: string; not_after: string; name_value: string; issuer_name?: string }

/** The newest certificate for the host that has already started, from Certificate Transparency log entries. */
export function certFromCt(entries: CtEntry[], host: string, now: Date): Omit<Cert, "checkedAt" | "host"> | null {
	const wild = `*.${host.split(".").slice(1).join(".")}`;
	const utc = (t: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
	let best: CtEntry | null = null;
	for (const e of entries) {
		const names = e.name_value.toLowerCase().split(/\s+/);
		if (!names.includes(host) && !names.includes(wild)) continue;
		if (utc(e.not_before) > now.getTime()) continue;
		if (!best || utc(e.not_after) > utc(best.not_after)) best = e;
	}
	if (!best) return null;
	const issuer = /(?:^|,\s*)O=("?)([^,"]+)\1/.exec(best.issuer_name ?? "")?.[2] ?? null;
	const from = utc(best.not_before), to = utc(best.not_after);
	return { expires: new Date(to).toISOString(), issuer, issued: new Date(from).toISOString(), auto: to - from <= AUTO_CERT_MAX_DAYS * 86_400_000 };
}

/** Worth looking up again: not known, running out within three weeks, or not looked at for a day. */
export function certStale(cert: Cert | null | undefined, host: string, now: Date): boolean {
	if (!cert || cert.host !== host) return true;
	return daysLeft(cert.expires, now) <= 21 || now.getTime() - Date.parse(cert.checkedAt) > 86_400_000;
}

/** The registrable domain for a host: the last two labels, or three for the common two-part endings (co.uk, com.au...). */
export function domainOf(host: string): string {
	const parts = host.toLowerCase().replace(/\.$/, "").split(".");
	if (parts.length <= 2) return parts.join(".");
	const two = parts.slice(-2).join(".");
	const SECOND = /^(co|com|org|net|ac|gov|ltd|plc|me|sch|nhs|police|edu|nom|gen|firm|ind|ne|or|go|gob|mil)\.[a-z]{2}$/;
	return SECOND.test(two) ? parts.slice(-3).join(".") : two;
}

/** When a domain's registration ends, from an RDAP answer (the "expiration" event). */
export function rdapExpiry(data: unknown): { expires: string | null; registrar: string | null } {
	const d = (data && typeof data === "object" ? data : {}) as { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: unknown[] }[] };
	const ev = (d.events ?? []).find((e) => e.eventAction === "expiration" && e.eventDate);
	const expires = ev?.eventDate && !Number.isNaN(Date.parse(ev.eventDate)) ? new Date(ev.eventDate).toISOString() : null;
	let registrar: string | null = null;
	for (const e of d.entities ?? []) {
		if (!e.roles?.includes("registrar")) continue;
		const card = Array.isArray(e.vcardArray?.[1]) ? (e.vcardArray![1] as unknown[][]) : [];
		const fn = card.find((x) => Array.isArray(x) && x[0] === "fn");
		if (fn && typeof fn[3] === "string") registrar = fn[3];
	}
	return { expires, registrar };
}

export function daysLeft(expires: string, now: Date): number {
	return Math.floor((Date.parse(expires) - now.getTime()) / 86_400_000);
}

/** The reminders already "used up" by something this close to running out, so adding a site whose certificate
 *  ends in 5 days doesn't send the 14 and 7 day reminders for something already on screen. */
export function remindersPassed(expires: string | null, now: Date, steps: number[]): string {
	if (!expires) return "";
	const days = daysLeft(expires, now);
	return steps.filter((d) => d > days).join(",");
}

/** Which reminder is due now, if any: the closest threshold not yet sent. */
export function reminderDue(expires: string | null, now: Date, sent: string, steps: number[]): number | null {
	if (!expires) return null;
	const days = daysLeft(expires, now);
	const done = sent.split(",").filter(Boolean).map(Number);
	const due = steps.filter((d) => days <= d && !done.includes(d));
	return due.length ? Math.min(...due) : null;
}

/** Every threshold at or above today's days left, added to `sent`, so one reminder covers them all. */
export function markSent(sent: string, expires: string, now: Date, steps: number[]): string {
	const days = daysLeft(expires, now);
	const all = new Set([...sent.split(",").filter(Boolean).map(Number), ...steps.filter((d) => days <= d)]);
	return [...all].sort((a, b) => b - a).join(",");
}

// -- The mail server conversation -----------------------------------------------------------------

/** One line at a time from the server, sending a line, and switching the connection to encryption. */
export interface MailIo {
	line(): Promise<string>;
	send(text: string): Promise<void>;
	upgrade(): Promise<void>;
}

export type MailResult = { ok: true; greeting: string } | { ok: false; kind: "refused" | "broken"; why: string; greeting?: string };

const cut = (s: string) => s.replace(/[^\x20-\x7e]/g, "").slice(0, 120);

async function smtpReply(io: MailIo): Promise<{ code: number; lines: string[] }> {
	const lines: string[] = [];
	for (let i = 0; i < 50; i++) {
		const l = await io.line();
		lines.push(l);
		if (!/^\d{3}-/.test(l)) break;
	}
	return { code: Number(lines.at(-1)?.slice(0, 3)) || 0, lines };
}

async function imapReply(io: MailIo, tag: string): Promise<{ ok: boolean; lines: string[] }> {
	const lines: string[] = [];
	for (let i = 0; i < 50; i++) {
		const l = await io.line();
		lines.push(l);
		if (l.startsWith(`${tag} `)) return { ok: /^\S+ OK/i.test(l), lines };
	}
	return { ok: false, lines };
}

async function popList(io: MailIo): Promise<{ ok: boolean; lines: string[] }> {
	const first = await io.line();
	if (!first.startsWith("+OK")) return { ok: false, lines: [first] };
	const lines: string[] = [];
	for (let i = 0; i < 100; i++) {
		const l = await io.line();
		if (l === ".") break;
		lines.push(l);
	}
	return { ok: true, lines };
}

const refused = (greeting: string): MailResult => ({ ok: false, kind: "refused", why: `the server answered but turned our check away ("${cut(greeting)}")`, greeting: cut(greeting) });
const broken = (why: string, greeting?: string): MailResult => ({ ok: false, kind: "broken", why, greeting: greeting && cut(greeting) });

/** A failed switch to encryption is a certificate problem, not an outage. */
export class TlsFailed extends Error {}
async function upgrade(io: MailIo): Promise<void> {
	try {
		await io.upgrade();
	} catch (e) {
		throw new TlsFailed(e instanceof Error ? e.message : String(e));
	}
}

/**
 * Reads the greeting and, on a plain port, asks for encryption (STARTTLS), switches to it and says hello again.
 * Then goodbye. We never sign in, so we never hold anyone's password. Throws when the connection fails.
 */
export async function mailDialog(proto: Proto, tls: "on" | "starttls", io: MailIo, helloName: string): Promise<MailResult> {
	if (proto === "smtp") {
		const hi = await smtpReply(io);
		const greeting = hi.lines.join(" ");
		if (hi.code === 554 || hi.code === 421 || hi.code === 550) return refused(greeting);
		if (hi.code !== 220) return broken(`it didn't greet us properly ("${cut(greeting)}")`, greeting);
		if (tls === "starttls") {
			await io.send(`EHLO ${helloName}`);
			const ehlo = await smtpReply(io);
			if (ehlo.code !== 250) return broken(`it didn't accept our hello ("${cut(ehlo.lines.join(" "))}")`, greeting);
			if (!ehlo.lines.some((l) => /^250[ -]STARTTLS\b/i.test(l))) return broken("it doesn't offer encryption (STARTTLS), so mail apps would send passwords unprotected", greeting);
			await io.send("STARTTLS");
			const go = await smtpReply(io);
			if (go.code !== 220) return broken(`it offered encryption but refused to start it ("${cut(go.lines.join(" "))}")`, greeting);
			await upgrade(io);
			await io.send(`EHLO ${helloName}`);
			const again = await smtpReply(io);
			if (again.code !== 250) return broken("it stopped answering after switching to encryption", greeting);
		}
		await io.send("QUIT").catch(() => undefined);
		return { ok: true, greeting: cut(greeting) };
	}
	if (proto === "imap") {
		const greeting = await io.line();
		if (/^\* BYE/i.test(greeting)) return refused(greeting);
		if (!/^\* (OK|PREAUTH)/i.test(greeting)) return broken(`it didn't greet us properly ("${cut(greeting)}")`, greeting);
		if (tls === "starttls") {
			await io.send("a1 CAPABILITY");
			const caps = await imapReply(io, "a1");
			if (!caps.lines.some((l) => /\bSTARTTLS\b/i.test(l))) return broken("it doesn't offer encryption (STARTTLS), so mail apps would send passwords unprotected", greeting);
			await io.send("a2 STARTTLS");
			if (!(await imapReply(io, "a2")).ok) return broken("it offered encryption but refused to start it", greeting);
			await upgrade(io);
			await io.send("a3 CAPABILITY");
			if (!(await imapReply(io, "a3")).ok) return broken("it stopped answering after switching to encryption", greeting);
		}
		await io.send("a9 LOGOUT").catch(() => undefined);
		return { ok: true, greeting: cut(greeting) };
	}
	const greeting = await io.line();
	if (/^-ERR/i.test(greeting)) return refused(greeting);
	if (!greeting.startsWith("+OK")) return broken(`it didn't greet us properly ("${cut(greeting)}")`, greeting);
	if (tls === "starttls") {
		await io.send("CAPA");
		const caps = await popList(io);
		if (!caps.lines.some((l) => /^STLS\b/i.test(l))) return broken("it doesn't offer encryption (STLS), so mail apps would send passwords unprotected", greeting);
		await io.send("STLS");
		if (!(await io.line()).startsWith("+OK")) return broken("it offered encryption but refused to start it", greeting);
		await upgrade(io);
		await io.send("CAPA");
		if (!(await popList(io)).ok) return broken("it stopped answering after switching to encryption", greeting);
	}
	await io.send("QUIT").catch(() => undefined);
	return { ok: true, greeting: cut(greeting) };
}

export const isTlsFailure = (e: unknown) => e instanceof TlsFailed || (e instanceof Error && /certificate|ssl|tls|x509|handshake/i.test(e.message));

/** What a thrown connection error means, in words for the alert. */
export function connectWhy(e: unknown, timeoutSecs: number): Outcome {
	const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
	if (/cannot connect to the specified address|proxy request failed/i.test(msg)) return { state: "down", why: "the name points at Cloudflare's proxy, which only passes web traffic on, so nothing else can reach the server either" };
	if (isTlsFailure(e)) return { state: "cert", why: "we can't make a secure connection to it: its certificate has expired, doesn't match the server's name, or isn't trusted" };
	if (/time ?out|timed out|abort/i.test(msg)) return { state: "down", why: `it didn't answer within ${timeoutSecs} seconds` };
	if (/refused|reset/i.test(msg)) return { state: "down", why: "nothing is answering on that port (the connection was refused)" };
	return { state: "down", why: "we couldn't connect to it" };
}

// -- Words ----------------------------------------------------------------------------------------

export interface MonitorLike { kind: Kind; name: string | null; url: string | null; host: string | null; port: number | null }

/** How we name a monitor in alerts and on the page. */
export function labelOf(m: MonitorLike): string {
	if (m.name) return m.name;
	if (m.kind === "website") {
		try {
			const u = new URL(m.url ?? "");
			return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
		} catch {
			return m.url ?? "Website";
		}
	}
	if (m.kind === "heartbeat") return "Heartbeat";
	if (m.kind === "api") {
		try {
			const u = new URL(m.url ?? "");
			return `${u.hostname}${u.pathname}`;
		} catch {
			return m.url ?? "API";
		}
	}
	if (m.kind === "dns") return `${m.host} DNS`;
	return `${m.host}:${m.port}`;
}

export function lasted(fromIso: string, toIso: string): string {
	return minutesIn(Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

export function minutesIn(mins: number): string {
	if (mins < 1) return "under a minute";
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : "");
	return [part(d, "day"), part(h, "hour"), d ? "" : part(m, "minute")].filter(Boolean).join(" ");
}

export const timeIn = (isoDate: string, tz: string) => {
	try {
		return new Date(isoDate).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz });
	} catch {
		return new Date(isoDate).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
	}
};
export const dateOf = (isoDate: string) => new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** type names the event for webhooks and the API, such as monitor.down (see WEBHOOK_TYPES). */
export interface Alert { subject: string; text: string; urgent: boolean; type?: WebhookType }

/** What each webhook event means. Your own webhook gets one of these as `type`. */
export const WEBHOOK_TYPES = {
	"monitor.down": "Something stopped working, after two checks in a row (or a heartbeat is late).",
	"monitor.up": "It's working again after a down alert.",
	"monitor.flapping": "It went down and came back 3 times in an hour.",
	"monitor.blocked": "The server turned our checks away, so we can't tell whether it's working.",
	"monitor.cert": "A website or server's certificate is broken or has run out.",
	"cert.expiring": "A website's certificate runs out soon.",
	"domain.expiring": "A domain's registration runs out soon.",
	"alert.test": "The Send a test alert button.",
	"test": "A channel's Test button.",
} as const;
export type WebhookType = keyof typeof WEBHOOK_TYPES;
const EVENT_TYPE: Record<Event["kind"], WebhookType> = { down: "monitor.down", up: "monitor.up", flapping: "monitor.flapping", blocked: "monitor.blocked", cert: "monitor.cert" };

const ADVICE: Record<Kind, string> = {
	website: "Worth checking: your hosting company's status page, whether a payment for the hosting has failed, and any recent change to the website or its DNS records. If it works for you, a firewall or security plugin may be blocking Cloudflare's addresses.",
	api: "Worth checking: your API's logs and recent deploys, whether a key or token it needs has run out, and your hosting company's status page.",
	dns: "Worth checking: your DNS provider's dashboard for recent changes, whether the domain's registration has lapsed, and whether its name servers changed.",
	mail: "Worth checking: your mail provider's status page, whether a payment has failed, and any recent change to the server, its firewall or its DNS records.",
	port: "Worth checking: whether the service on that port is running, the server's firewall, and any recent change to its DNS records.",
	heartbeat: "This usually means the job didn't run, or ran but failed before it could check in. Worth checking: the job's own log, the server it runs on, and whether its schedule changed.",
};

/** The alert for one event, in plain words. `tz` is the time zone from Settings. */
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Where a failure was confirmed, or why it wasn't: after the "down" step, with what other regions saw. Only us failing
 *  holds the alert back and notes which regions can reach it; any region agreeing lets the alert go, naming them. */
export function weighOpinions(next: State, events: Event[], views: { region: string; state: string }[] | null, now: Date): { next: State; events: Event[] } {
	const down = events.find((e) => e.kind === "down") as Extract<Event, { kind: "down" }> | undefined;
	if (!down || !views?.length) return { next: { ...next, regional: null }, events };
	const agree = views.filter((v) => v.state === "down").map((v) => v.region);
	if (agree.length) return { next: { ...next, regional: null }, events: events.map((e) => (e === down ? { ...down, confirmed: agree } : e)) };
	return { next: { ...next, alerted: false, regional: { at: iso(now), ok: views.map((v) => v.region) } }, events: events.filter((e) => e !== down) };
}

/** While only we see it failing, other regions are asked again at most this often. */
export const REGIONAL_RECHECK_MS = 10 * 60_000;
export const askAgain = (s: State, now: Date) => !s.regional || now.getTime() - Date.parse(s.regional.at) >= REGIONAL_RECHECK_MS;

export function alertFor(m: MonitorLike & { every: number }, e: Event, tz: string, link: string, app = "Site Watch"): Alert {
	return { ...alertText(m, e, tz, link, app), type: EVENT_TYPE[e.kind] };
}

function alertText(m: MonitorLike & { every: number }, e: Event, tz: string, link: string, app: string): Alert {
	const label = labelOf(m);
	const what = m.kind === "website" ? m.url : m.kind === "api" ? `the API at ${m.url}` : m.kind === "dns" ? `the DNS for ${m.host}` : m.kind === "heartbeat" ? `the "${label}" heartbeat` : `${m.host} port ${m.port}`;
	const end = `Open ${app}: ${link}`;
	const apart = m.every < 1 ? `${Math.round(m.every * 60)} seconds apart` : m.every === 1 ? "a minute apart" : `${m.every} minutes apart`;
	switch (e.kind) {
		case "down":
			return {
				subject: m.kind === "heartbeat" ? `Missed heartbeat: ${label}` : `Down: ${label}`,
				urgent: true,
				text: [
					m.kind === "heartbeat" ? `We haven't heard from ${what} since about ${timeIn(e.since, tz)}: ${e.why}.`
						: `${what} stopped working at about ${timeIn(e.since, tz)}: ${e.why}. We tried twice, ${apart}${e.confirmed?.length ? `, and our checks from ${listOf(e.confirmed)} found the same,` : ""} before telling you.`,
					"We'll keep checking and tell you once more when it's back. There won't be more alerts about this outage until then.",
					ADVICE[m.kind], end,
				].join("\n\n"),
			};
		case "up":
			return {
				subject: m.kind === "heartbeat" ? `Heartbeat back: ${label}` : `Back up: ${label}`,
				urgent: false,
				text: [`Good news: ${what} ${m.kind === "heartbeat" ? "has checked in again" : "is working again"}. It was down for about ${lasted(e.outage.from, e.outage.to)}, from ${timeIn(e.outage.from, tz)} to ${timeIn(e.outage.to, tz)}.`, end].join("\n\n"),
			};
		case "flapping":
			return {
				subject: `Going up and down: ${label}`,
				urgent: true,
				text: [`${what} has gone down and come back ${e.outages} times in the last hour. It's answering again right now.`,
					"So we don't flood you, we'll only alert about a new outage if it lasts more than 15 minutes, until it has been steady for half an hour.",
					"Worth checking: whether the server is running out of memory or busy, a plugin or update that changed recently, and your hosting company's status page.", end].join("\n\n"),
			};
		case "blocked":
			return {
				subject: `Turning our checks away: ${label}`,
				urgent: false,
				text: [`When we checked ${what}, ${e.why}. That happened twice in a row, so we can't tell whether it's working. We haven't counted it as down.`,
					"Some servers turn away connections from cloud services, including the shared Cloudflare addresses these checks come from. If it works for you, remove this monitor or ask whoever runs the server to accept connections on this port.", end].join("\n\n"),
			};
		case "cert":
			return {
				subject: `Certificate problem: ${label}`,
				urgent: true,
				text: [`When we checked ${what} just now, ${e.why}.`,
					m.kind === "website" ? "Visitors will see a security warning instead of the page. Most hosts and Cloudflare renew certificates automatically, so this usually means the renewal failed. Ask your web host to renew or reinstall it."
						: "Apps will show a security warning or refuse to connect. Ask whoever runs the server to renew or reinstall its certificate, and make sure it covers this server name.", end].join("\n\n"),
			};
	}
}

export function certAlert(cert: Cert, now: Date, link: string, app = "Site Watch"): Alert {
	const days = daysLeft(cert.expires, now);
	const when = dateOf(cert.expires);
	const how = cert.auto && days >= 0
		? `This is a short-lived certificate that renews itself${cert.issuer ? ` (${cert.issuer} certificates normally renew about a month before they run out)` : ""}. It hasn't renewed yet, so the automatic renewal may have failed. If the website is on Cloudflare, check SSL/TLS › Edge Certificates in the dashboard. Otherwise ask your web host.`
		: "Ask your web host to renew it. If the website is on Cloudflare, check SSL/TLS › Edge Certificates in the dashboard.";
	return {
		type: "cert.expiring",
		subject: days < 0 ? `Certificate expired: ${cert.host}` : `Certificate expires in ${days} day${days === 1 ? "" : "s"}: ${cert.host}`,
		urgent: days <= 7,
		text: [
			days < 0 ? `The security certificate for https://${cert.host}/ expired on ${when}. Visitors will see a security warning instead of the website.`
				: `The security certificate for https://${cert.host}/ expires on ${when}${cert.issuer ? ` (it's from ${cert.issuer})` : ""}. After that, visitors will see a security warning.`,
			how, "If it has already been renewed, there's nothing to do: we'll see the new certificate on the next check.", `Open ${app}: ${link}`,
		].join("\n\n"),
	};
}

export function renewalAlert(reg: Registration, now: Date, link: string, app = "Site Watch"): Alert {
	const days = daysLeft(reg.expires!, now);
	const when = dateOf(reg.expires!);
	return {
		type: "domain.expiring",
		subject: days < 0 ? `Domain expired: ${reg.domain}` : days === 0 ? `Domain expires today: ${reg.domain}` : `Domain expires in ${days} day${days === 1 ? "" : "s"}: ${reg.domain}`,
		urgent: days <= 7,
		text: [
			days < 0 ? `The registration for ${reg.domain} expired on ${when}. Its website and email may already have stopped working.`
				: `The registration for ${reg.domain} expires on ${when}. If it isn't renewed, its website and email will stop working.`,
			`${reg.registrar ? `Sign in to ${reg.registrar}, where it's registered, and renew it.` : "Sign in to the company you registered it with and renew it."} Switching on automatic renewal saves this happening again.`,
			"If you've already renewed it, there's nothing to do: the registry can take a day or two to show the new date.", `Open ${app}: ${link}`,
		].join("\n\n"),
	};
}

// -- Alert channels -------------------------------------------------------------------------------

export const CHANNEL_KINDS = ["slack", "teams", "google", "discord", "webhook"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const CHANNEL_NAMES: Record<ChannelKind, string> = { slack: "Slack", teams: "Microsoft Teams", google: "Google Chat", discord: "Discord", webhook: "Your own webhook" };
/** A channel whose service refuses this many posts in a row is switched off. */
export const MAX_FAILS = 10;

const SHAPES: Record<Exclude<ChannelKind, "webhook">, { test: (u: URL) => boolean; hint: string }> = {
	slack: { test: (u) => u.hostname === "hooks.slack.com" && /^\/(services|workflows|triggers)\//.test(u.pathname), hint: "A Slack webhook address starts with https://hooks.slack.com/services/." },
	teams: { test: (u) => /(\.logic\.azure\.com|\.api\.powerplatform\.com|\.webhook\.office\.com)$/.test(u.hostname), hint: "A Teams address comes from the Workflows app: choose \"Send webhook alerts to a channel\" and copy the address it gives you." },
	google: { test: (u) => u.hostname === "chat.googleapis.com" && /^\/v1\/spaces\/[^/]+\/messages$/.test(u.pathname), hint: "A Google Chat webhook address starts with https://chat.googleapis.com/v1/spaces/." },
	discord: { test: (u) => /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(u.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname), hint: "A Discord webhook address starts with https://discord.com/api/webhooks/." },
};

const PRIVATE = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$|^(\d{1,3}\.){3}\d{1,3}$|^\[|:/i;

export function cleanChannel(raw: unknown): { kind: ChannelKind; name: string; url: string } | { error: string } {
	const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const kind = String(b.kind ?? "") as ChannelKind;
	if (!CHANNEL_KINDS.includes(kind)) return { error: "Please choose where the alerts should go." };
	let url: URL;
	try {
		url = new URL(typeof b.url === "string" ? b.url.trim() : "");
	} catch {
		return { error: "Please paste the full webhook address, starting with https://." };
	}
	if (url.protocol !== "https:") return { error: "The webhook address needs to start with https://, so alerts are encrypted on the way." };
	if (url.username || url.password) return { error: "Please paste the address without a user name or password in it." };
	if (kind === "webhook") {
		if (PRIVATE.test(url.hostname)) return { error: "Please use a public web address with a domain name, not an IP address or a local name." };
	} else if (!SHAPES[kind].test(url)) return { error: SHAPES[kind].hint };
	return { kind, name: cleanName(b.name) ?? CHANNEL_NAMES[kind], url: url.toString().slice(0, 1000) };
}

/** What a webhook knows about the thing an alert is about. */
export interface HookMonitor { id: string; kind: Kind; label: string; url: string | null; host: string | null; port: number | null }

/**
 * One alert, as your own webhook gets it. event, subject, text, urgent, url, sentAt and app were there from 1.0.0;
 * id, type, created and monitor came in 1.2.0, so webhooks look the same as Mail App's and DMARC Reports'.
 */
export interface HookEvent {
	event: "alert" | "test"; subject: string; text: string; urgent: boolean; url: string | null; sentAt: string; app?: string;
	id?: string; type?: WebhookType; created?: string; monitor?: HookMonitor | null;
}

/** HMAC-SHA256 of "<timestamp>.<body>" with the webhook's secret, as hex. The same as Mail App and DMARC Reports. */
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function signBody(secret: string, timestamp: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return hexOf(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/**
 * The headers your own webhook gets. Site-Watch-Signature (t=...,v1=...) matches Mail App and DMARC Reports, so one
 * check works for all three. X-SiteWatch-Timestamp and X-SiteWatch-Signature (sha256=...) are kept from 1.0.0.
 */
export async function webhookHeaders(secret: string, type: string, delivery: string, body: string, now = Date.now()): Promise<Record<string, string>> {
	const ts = String(Math.floor(now / 1000));
	const sig = await signBody(secret, ts, body);
	return {
		"site-watch-event": type,
		"site-watch-delivery": delivery,
		"site-watch-signature": `t=${ts},v1=${sig}`,
		"x-sitewatch-timestamp": ts,
		"x-sitewatch-signature": `sha256=${sig}`,
	};
}

export const hookMonitor = (m: MonitorLike & { id: string }): HookMonitor => ({ id: m.id, kind: m.kind, label: labelOf(m), url: m.url, host: m.host, port: m.port });

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The request body for one channel. Your own webhook gets HookEvent as it is. */
export function payloadFor(kind: ChannelKind, e: HookEvent): unknown {
	const app = e.app ?? "Site Watch";
	const title = `${e.urgent ? "🔴 " : ""}${e.subject}`;
	const text = short(e.text, 1500);
	switch (kind) {
		case "slack":
			return {
				text: title,
				blocks: [
					{ type: "section", text: { type: "mrkdwn", text: `*${title.replace(/[*_~]/g, "")}*\n${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}` } },
					...(e.url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: `Open ${app}` }, url: e.url }] }] : []),
				],
			};
		case "teams":
			return {
				type: "message",
				attachments: [{
					contentType: "application/vnd.microsoft.card.adaptive",
					content: {
						$schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
						body: [
							{ type: "TextBlock", text: e.subject, weight: "Bolder", size: "Medium", wrap: true, color: e.urgent ? "Attention" : "Default" },
							{ type: "TextBlock", text, wrap: true },
						],
						...(e.url ? { actions: [{ type: "Action.OpenUrl", title: `Open ${app}`, url: e.url }] } : {}),
					},
				}],
			};
		case "google":
			return { text: `*${title}*\n${text}${e.url ? `\n<${e.url}|Open ${app}>` : ""}` };
		case "discord":
			return { username: app, embeds: [{ title: short(e.subject, 250), description: short(e.text, 4000), url: e.url ?? undefined, color: e.urgent ? 0xc8102e : 0x0f766e, timestamp: e.sentAt }], allowed_mentions: { parse: [] } };
		default:
			return e;
	}
}

/** The address with its secret part hidden, for showing on the page (webhook addresses work like passwords). */
export function maskUrl(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname.length > 16 ? `${u.pathname.slice(0, 12)}…${u.pathname.slice(-4)}` : u.pathname;
		return `${u.host}${path}`;
	} catch {
		return "";
	}
}

// -- Email ------------------------------------------------------------------------------------------

export const cleanEmail = (input: unknown): string | null => {
	if (typeof input !== "string") return null;
	const e = input.trim().toLowerCase();
	return e.length <= 254 && /^[^\s@<>()",;:]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(e) ? e : null;
};

/** An email as raw MIME, for Cloudflare's send_email binding: plain text, or text and HTML side by side. */
export function rawEmail(from: string, to: string, subject: string, text: string, now: Date, id: string, fromName = "Site Watch", html?: string, extra: string[] = []): string {
	const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
	const wrap = (s: string) => b64(s).replace(/.{76}/g, "$&\r\n");
	const head = [
		`From: ${enc(fromName.replace(/["<>\r\n]/g, ""))} <${from}>`, `To: ${to}`, `Subject: ${enc(subject)}`, `Date: ${now.toUTCString()}`,
		`Message-ID: <${id}@${from.split("@")[1]}>`, "MIME-Version: 1.0", "Auto-Submitted: auto-generated", ...extra.filter((l) => !/[\r\n]/.test(l)),
	];
	if (!html) return [...head, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(text), ""].join("\r\n");
	const edge = `sw-${id}`;
	return [
		...head, `Content-Type: multipart/alternative; boundary="${edge}"`, "",
		`--${edge}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(text),
		`--${edge}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(html),
		`--${edge}--`, "",
	].join("\r\n");
}

function b64(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

// -- Status pages ---------------------------------------------------------------------------------

export function cleanSlug(x: unknown): string | null {
	if (typeof x !== "string") return null;
	const s = x.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	return s.length >= 2 ? s : null;
}

export type Shown = "up" | "down" | "degraded" | "maintenance" | "unknown";
export function shownOf(status: Status): Shown {
	return status === "up" ? "up" : status === "down" ? "down" : status === "cert" || status === "unsure" ? "degraded" : status === "paused" ? "maintenance" : "unknown";
}

export function overall(states: Shown[]): { state: Shown; text: string } {
	if (!states.length) return { state: "unknown", text: "Nothing to show yet" };
	if (states.includes("down")) return { state: "down", text: states.every((s) => s === "down") ? "Major outage" : "Partial outage" };
	if (states.includes("degraded")) return { state: "degraded", text: "Some problems" };
	if (states.includes("maintenance")) return { state: "maintenance", text: "Maintenance under way" };
	if (states.every((s) => s === "up")) return { state: "up", text: "All systems working" };
	return { state: "unknown", text: "Checking" };
}

// -- Stripe ---------------------------------------------------------------------------------------

const stripeEnc = new TextEncoder();
const stripeHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Checks Stripe's signature: HMAC-SHA256 of "timestamp.body" with the webhook secret, within five minutes. */
export async function verifyStripe(secret: string, header: string, body: string, now = Date.now()): Promise<boolean> {
	const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
	const t = Number(parts.t);
	if (!t || Math.abs(now / 1000 - t) > 300) return false;
	const key = await crypto.subtle.importKey("raw", stripeEnc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const want = stripeHex(await crypto.subtle.sign("HMAC", key, stripeEnc.encode(`${t}.${body}`)));
	return header.split(",").some((p) => p === `v1=${want}`);
}


/** Which channels a plan allows: email always; browser and app alerts unless "email"; the rest only on "all". */
export const planAllows = (plan: { channels: "email" | "push" | "all" } | null, kind: string) => {
	const c = plan?.channels ?? "all";
	if (kind === "email" || c === "all") return true;
	return (kind === "push" || kind === "apns") && c === "push";
};
