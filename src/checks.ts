// The network side of each check: visiting a web page, talking to a mail server, opening a port, and the daily
// look-ups of a website's certificate (Certificate Transparency logs) and its domain's renewal date (RDAP).
// What the answers mean is decided in core.ts.

import { connect } from "cloudflare:sockets";
import { apiOutcome, certFromCt, connectWhy, dnsOutcome, domainOf, iso, mailDialog, mailPort, pageOutcome, rdapExpiry, rulesOf, type ApiRules, type Cert, type CtEntry, type DnsRules, type DohAnswer, type Kind, type MailIo, type Outcome, type Registration, type Rules } from "./core.ts";

import { WL } from "./whitelabel.ts";

/** What websites see in their logs (whitelabel.ts). */
export const agent = () => WL.agent;
const PAGE_TIMEOUT = 15;
const SOCKET_TIMEOUT = 10;
/** The most of a page we read when looking for words. */
const PAGE_BYTES = 1_000_000;

export interface Result { outcome: Outcome; ms: number | null; detail?: FailDetail }
/** What a website or API answered when it failed, for the dashboard: the status, a few headers and the start of the page. */
export interface FailDetail { status: number | null; headers: Record<string, string>; body: string }
const SHOWN_HEADERS = ["server", "content-type", "content-length", "location", "retry-after", "cache-control", "cf-ray", "cf-cache-status", "x-cache", "via", "date", "x-powered-by"];
const FAIL_BODY = 1500;

async function failDetail(res: Response, body: string | null): Promise<FailDetail> {
	const headers: Record<string, string> = {};
	for (const h of SHOWN_HEADERS) { const v = res.headers.get(h); if (v) headers[h] = v.slice(0, 200); }
	const text = body ?? (await readSome(res, FAIL_BODY).catch(() => ""));
	return { status: res.status, headers, body: text.slice(0, FAIL_BODY) };
}

async function readSome(res: Response, most = PAGE_BYTES): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	while (bytes < most) {
		const { value, done } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		text += decoder.decode(value, { stream: true });
	}
	await reader.cancel().catch(() => undefined);
	return text;
}

export async function checkWebsite(url: string, rules: Rules): Promise<Result> {
	const started = Date.now();
	try {
		const res = await fetch(url, { headers: { "user-agent": agent(), accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(PAGE_TIMEOUT * 1000) });
		const ms = Date.now() - started;
		const read = !!(rules.contains || rules.missing);
		const body = read ? await readSome(res) : "";
		const outcome = pageOutcome({ status: res.status, ms, body }, rules);
		const detail = outcome.state === "up" ? undefined : await failDetail(res, read ? body : null);
		if (!read || outcome.state === "up") await res.body?.cancel().catch(() => undefined);
		return { outcome, ms, detail };
	} catch (e) {
		const why = e instanceof Error ? `${e.name} ${e.message}` : String(e);
		return { outcome: pageOutcome({ error: why, ms: Date.now() - started }, rules), ms: null, detail: { status: null, headers: {}, body: why } };
	}
}

/** An API call: your method, headers and body, then the status, words, time and JSON value. */
export async function checkApi(url: string, rules: ApiRules): Promise<Result> {
	const started = Date.now();
	try {
		const headers: Record<string, string> = { "user-agent": agent(), accept: "application/json, */*", ...(rules.headers ?? {}) };
		if (rules.body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = /^\s*[[{]/.test(rules.body) ? "application/json" : "text/plain";
		const res = await fetch(url, { method: rules.method ?? "GET", headers, body: rules.body, redirect: "follow", signal: AbortSignal.timeout(PAGE_TIMEOUT * 1000) });
		const ms = Date.now() - started;
		const read = !!(rules.contains || rules.missing || rules.json);
		const body = read ? await readSome(res) : "";
		const outcome = apiOutcome({ status: res.status, ms, body }, rules);
		const detail = outcome.state === "up" ? undefined : await failDetail(res, read ? body : null);
		if (!read || outcome.state === "up") await res.body?.cancel().catch(() => undefined);
		return { outcome, ms, detail };
	} catch (e) {
		const why = e instanceof Error ? `${e.name} ${e.message}` : String(e);
		return { outcome: apiOutcome({ error: why, ms: Date.now() - started }, rules), ms: null, detail: { status: null, headers: {}, body: why } };
	}
}

/** A DNS lookup through Cloudflare's 1.1.1.1 (DNS over HTTPS), so it sees what the world sees. */
export async function checkDns(host: string, rules: DnsRules): Promise<Result> {
	const started = Date.now();
	try {
		const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${rules.type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(SOCKET_TIMEOUT * 1000) });
		if (!res.ok) return { outcome: dnsOutcome({ error: String(res.status) }, host, rules), ms: null };
		const answer = await res.json<DohAnswer>();
		return { outcome: dnsOutcome({ answer }, host, rules), ms: Date.now() - started };
	} catch (e) {
		return { outcome: dnsOutcome({ error: String(e) }, host, rules), ms: null };
	}
}

/** One check of anything but a heartbeat, from wherever this runs (the cron, the queue or a helper in another region). */
export interface CheckJob { kind: Kind; url: string | null; rules: string | null; host: string | null; port: number | null; helloName: string }
export function checkJob(j: CheckJob): Promise<Result> {
	if (j.kind === "website") return checkWebsite(j.url!, rulesOf(j.rules));
	if (j.kind === "api") return checkApi(j.url!, rulesOf(j.rules) as ApiRules);
	if (j.kind === "dns") return checkDns(j.host!, rulesOf(j.rules) as unknown as DnsRules);
	if (j.kind === "mail") return checkMail(j.host!, j.port!, j.helloName);
	return checkPort(j.host!, j.port!);
}

function timeout<T>(secs: number): { promise: Promise<T>; clear: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error("timed out")), secs * 1000);
	});
	return { promise, clear: () => timer !== undefined && clearTimeout(timer) };
}

/** Opens the port and closes it again: up when something answers. */
export async function checkPort(host: string, port: number): Promise<Result> {
	const started = Date.now();
	const t = timeout<never>(SOCKET_TIMEOUT);
	const socket = connect({ hostname: host, port }, { secureTransport: "off", allowHalfOpen: false });
	try {
		await Promise.race([socket.opened, t.promise]);
		return { outcome: { state: "up" }, ms: Date.now() - started };
	} catch (e) {
		return { outcome: connectWhy(e, SOCKET_TIMEOUT), ms: null };
	} finally {
		t.clear();
		socket.close().catch(() => undefined);
	}
}

/** Reads a mail server's greeting and checks it offers encryption. Never signs in. */
export async function checkMail(host: string, port: number, helloName: string): Promise<Result> {
	const p = mailPort(port);
	if (!p) return checkPort(host, port);
	const started = Date.now();
	let ms: number | null = null;
	let socket = connect({ hostname: host, port }, { secureTransport: p.tls === "on" ? "on" : "starttls", allowHalfOpen: false });
	let reader = socket.readable.getReader();
	let writer = socket.writable.getWriter();
	let buffer = "";
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const io: MailIo = {
		async line() {
			for (;;) {
				const at = buffer.indexOf("\n");
				if (at >= 0) {
					const l = buffer.slice(0, at).replace(/\r$/, "");
					buffer = buffer.slice(at + 1);
					ms ??= Date.now() - started;
					return l;
				}
				const { value, done } = await reader.read();
				if (done) throw new Error("The server closed the connection");
				buffer += decoder.decode(value, { stream: true });
				if (buffer.length > 65_536) throw new Error("The server sent too much");
			}
		},
		async send(text) {
			await writer.write(encoder.encode(`${text}\r\n`));
		},
		async upgrade() {
			reader.releaseLock();
			writer.releaseLock();
			socket = socket.startTls();
			reader = socket.readable.getReader();
			writer = socket.writable.getWriter();
			buffer = "";
		},
	};
	const t = timeout<never>(SOCKET_TIMEOUT);
	try {
		const result = await Promise.race([mailDialog(p.proto, p.tls, io, helloName), t.promise]);
		if (result.ok) return { outcome: { state: "up" }, ms };
		return { outcome: { state: result.kind === "refused" ? "blocked" : "down", why: result.why }, ms };
	} catch (e) {
		return { outcome: connectWhy(e, SOCKET_TIMEOUT), ms };
	} finally {
		t.clear();
		socket.close().catch(() => undefined);
	}
}

/** The newest certificate for a web address, from the public Certificate Transparency logs: crt.sh first, then
 *  Cert Spotter (a few lookups a day without a key) when crt.sh is slow or refuses. Undefined when neither answered. */
export async function lookupCert(host: string, now: Date): Promise<Cert | null | undefined> {
	const found = (await fromCrtSh(host)) ?? (await fromCertSpotter(host));
	if (found === undefined) return undefined;
	const best = certFromCt(found, host, now);
	return best ? { ...best, host, checkedAt: iso(now) } : null;
}

async function fromCrtSh(host: string): Promise<CtEntry[] | undefined> {
	try {
		const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`, { headers: { "user-agent": agent() }, signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return undefined;
		const data = await res.json<CtEntry[]>();
		return Array.isArray(data) ? data : undefined;
	} catch {
		return undefined;
	}
}

async function fromCertSpotter(host: string): Promise<CtEntry[] | undefined> {
	try {
		const res = await fetch(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&expand=dns_names&expand=issuer`, { headers: { "user-agent": agent() }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return undefined;
		const data = await res.json<{ dns_names: string[]; not_before: string; not_after: string; issuer?: { name?: string } }[]>();
		if (!Array.isArray(data)) return undefined;
		return data.map((d) => ({ name_value: d.dns_names.join("\n"), not_before: d.not_before, not_after: d.not_after, issuer_name: d.issuer?.name }));
	} catch {
		return undefined;
	}
}

/** When the domain's registration ends, from RDAP (rdap.org sends us to the right registry). */
export async function lookupRegistration(host: string, now: Date): Promise<Registration | undefined> {
	const domain = domainOf(host);
	try {
		const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json, application/json", "user-agent": agent() }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
		if (res.status === 404) return { domain, expires: null, registrar: null, checkedAt: iso(now) };
		if (!res.ok) return undefined;
		return { domain, ...rdapExpiry(await res.json()), checkedAt: iso(now) };
	} catch {
		return undefined;
	}
}
