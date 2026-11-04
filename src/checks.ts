// The network side of each check: visiting a web page, talking to a mail server, opening a port, and the daily
// look-ups of a website's certificate (Certificate Transparency logs) and its domain's renewal date (RDAP).
// What the answers mean is decided in core.ts.

import { connect } from "cloudflare:sockets";
import { certFromCt, connectWhy, domainOf, iso, mailDialog, mailPort, pageOutcome, rdapExpiry, type Cert, type CtEntry, type MailIo, type Outcome, type Registration, type Rules } from "./core.ts";

export const AGENT = "Mozilla/5.0 (compatible; SiteWatch/1.0; +https://paulobrien.dev/watch/)";
const PAGE_TIMEOUT = 15;
const SOCKET_TIMEOUT = 10;
/** The most of a page we read when looking for words. */
const PAGE_BYTES = 1_000_000;

export interface Result { outcome: Outcome; ms: number | null }

async function readSome(res: Response): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	while (bytes < PAGE_BYTES) {
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
		const res = await fetch(url, { headers: { "user-agent": AGENT, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(PAGE_TIMEOUT * 1000) });
		const ms = Date.now() - started;
		const body = rules.contains || rules.missing ? await readSome(res) : (await res.body?.cancel(), "");
		return { outcome: pageOutcome({ status: res.status, ms, body }, rules), ms };
	} catch (e) {
		return { outcome: pageOutcome({ error: e instanceof Error ? `${e.name} ${e.message}` : String(e), ms: Date.now() - started }, rules), ms: null };
	}
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
		const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return undefined;
		const data = await res.json<CtEntry[]>();
		return Array.isArray(data) ? data : undefined;
	} catch {
		return undefined;
	}
}

async function fromCertSpotter(host: string): Promise<CtEntry[] | undefined> {
	try {
		const res = await fetch(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&expand=dns_names&expand=issuer`, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(15_000) });
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
		const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json, application/json", "user-agent": AGENT }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
		if (res.status === 404) return { domain, expires: null, registrar: null, checkedAt: iso(now) };
		if (!res.ok) return undefined;
		return { domain, ...rdapExpiry(await res.json()), checkedAt: iso(now) };
	} catch {
		return undefined;
	}
}
