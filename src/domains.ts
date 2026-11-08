// Status pages on a customer's own domain (status.theirshop.com), on installs that use Cloudflare for SaaS:
// the customer points a CNAME at DOMAIN_TARGET, we ask Cloudflare for a custom hostname, and Cloudflare issues
// the certificate and sends the traffic to this Worker (a */* route), where findPage matches the host.
//
// Needs CF_ZONE_ID, CF_API_TOKEN (SSL and Certificates: Edit on that zone) and DOMAIN_TARGET. Without them a
// page's own domain is just saved, for installs that add the domain to their Worker themselves.

import type { Env } from "./db.ts";

export const saasReady = (env: Env) => !!(env.CF_ZONE_ID && env.CF_API_TOKEN && env.DOMAIN_TARGET);

type CfHostname = { id: string; hostname: string; status: string; ssl?: { status?: string; validation_errors?: { message: string }[] }; verification_errors?: string[] };

async function cf<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames${path}`, {
		...init,
		headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
	});
	const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
	if (!res.ok || !body.success) throw new Error(body.errors?.[0]?.message ?? `Cloudflare said ${res.status}`);
	return body.result as T;
}

/** Asks Cloudflare to serve (and get a certificate for) this host. Returns Cloudflare's id for it. */
export async function addHostname(env: Env, host: string): Promise<string> {
	try {
		const r = await cf<CfHostname>(env, "", { method: "POST", body: JSON.stringify({ hostname: host, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }) });
		return r.id;
	} catch (e) {
		// Already there (a second try, or added by hand): use it.
		const found = await cf<CfHostname[]>(env, `?hostname=${encodeURIComponent(host)}`);
		if (found[0]) return found[0].id;
		throw e;
	}
}

export async function removeHostname(env: Env, id: string | null): Promise<void> {
	if (!id || !saasReady(env)) return;
	await cf(env, `/${id}`, { method: "DELETE" }).catch(() => undefined);
}

/** Where the customer's DNS points now, from Cloudflare's public resolver. */
export async function cnameOf(host: string): Promise<string | null> {
	try {
		const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=CNAME`, { headers: { accept: "application/dns-json" } });
		const j = (await res.json()) as { Answer?: { type: number; data: string }[] };
		const a = j.Answer?.find((x) => x.type === 5);
		return a ? a.data.replace(/\.$/, "").toLowerCase() : null;
	} catch {
		return null;
	}
}

export type DomainState = {
	host: string;
	target: string | null;
	/** The name to type in the DNS form: the part before their domain (status), or @ for a whole domain. */
	recordName: string;
	cname: string | null;
	pointed: boolean;
	certificate: "waiting" | "pending" | "active" | "problem" | "unknown";
	ready: boolean;
	problem: string | null;
};

/** Everything the set-up wizard shows: is the record there, and has Cloudflare issued the certificate. */
export async function domainState(env: Env, host: string, id: string | null): Promise<DomainState> {
	const target = env.DOMAIN_TARGET?.toLowerCase() ?? null;
	const cname = await cnameOf(host);
	const pointed = !!target && cname === target;
	const parts = host.split(".");
	const recordName = parts.length > 2 ? parts.slice(0, -2).join(".") : "@";
	let certificate: DomainState["certificate"] = "unknown";
	let problem: string | null = null;
	let active = false;
	if (saasReady(env) && id) {
		try {
			const r = await cf<CfHostname>(env, `/${id}`);
			active = r.status === "active";
			const ssl = r.ssl?.status ?? "";
			certificate = ssl === "active" ? "active" : /^(pending|initializing)/.test(ssl) ? (pointed ? "pending" : "waiting") : ssl ? "problem" : "unknown";
			if (certificate === "problem") problem = r.ssl?.validation_errors?.[0]?.message ?? r.verification_errors?.[0] ?? null;
		} catch (e) {
			problem = (e as Error).message;
		}
	}
	return { host, target, recordName, cname, pointed, certificate, ready: pointed && active && certificate === "active", problem };
}
