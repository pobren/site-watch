// The database: one Cloudflare D1 database that Site Watch sets up itself on first use, so there are no
// migrations to run. Later versions add tables and columns here with IF NOT EXISTS and ALTER TABLE.
//
// Everything belongs to an account. The owner (who installed it) has the first account. When "Sell to clients"
// is switched on, clients sign up for one of the owner's plans and get accounts of their own.

import type { ApnsEnv } from "./apns.ts";
import type { WhiteLabelEnv } from "./whitelabel.ts";

export interface Env extends WhiteLabelEnv, ApnsEnv {
	DB: D1Database;
	/** Cloudflare's send_email binding. Alerts by email need a domain with Email Routing on (see the README). */
	EMAIL?: SendEmail;
	/** The secret code that lets the owner make (or reset) their account at /setup. */
	SETUP_TOKEN?: string;
	/** Sell to clients: your own Stripe keys, as secrets on the Worker. Payments go straight to your Stripe account. */
	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	/** Optional: "on" makes Stripe the seller through Stripe Managed Payments (its merchant of record service), so
	 *  Stripe works out, collects and pays sales tax and VAT and handles fraud and disputes. Switch it on in Stripe too. */
	STRIPE_MANAGED_PAYMENTS?: string;
	/** Optional Cloudflare Turnstile on sign in, set-up, forgotten password and sign-up (turnstile.ts): both are needed. */
	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET?: string;
	/** Optional Cloudflare Queue for big installs: the cron hands due checks to it in batches, so thousands of
	 *  websites can be checked every minute instead of about 40 (see the README, "Lots of websites"). */
	CHECKS?: Queue<CheckBatch>;
	/** Optional static files (Workers assets): a home page and other pages shown to people who aren't signed in. */
	ASSETS?: Fetcher;
	/** Gives status pages their own name on this domain (name.example.com) instead of /status/name. Needs a
	 * wildcard DNS record and a *.domain/* Worker route; /status/name keeps working too. */
	PAGE_DOMAIN?: string;
	/** Cloudflare for SaaS, for status pages on customers' own domains (domains.ts). */
	CF_ZONE_ID?: string;
	CF_API_TOKEN?: string;
	/** What customers point their CNAME at, such as domains.example.com (the zone's fallback origin). */
	DOMAIN_TARGET?: string;
}

/** One queue message: monitors to check now, or websites due their daily certificate and renewal look. */
export interface CheckBatch { ids: string[]; daily?: boolean; late?: boolean; at: number }

export interface MonitorRow {
	id: string;
	account_id: string;
	kind: "website" | "mail" | "port" | "heartbeat";
	name: string | null;
	url: string | null;
	host: string | null;
	port: number | null;
	rules: string | null;
	/** Minutes between checks; for a heartbeat, how often it should check in. */
	every: number;
	token: string | null;
	state: string | null;
	/** Websites only: the certificate and the domain's registration, looked up once a day, and the reminders sent. */
	extras: number;
	cert: string | null;
	reg: string | null;
	cert_sent: string;
	reg_sent: string;
	daily_at: string | null;
	paused_until: string | null;
	last_ping: string | null;
	checked_at: string | null;
	created_at: string;
}

export interface AccountRow {
	id: string;
	email: string;
	name: string | null;
	password: string | null;
	role: "owner" | "client";
	plan: string | null;
	/** Clients: active or trialing while Stripe says the subscription is paid; anything else holds their checks. */
	status: string;
	stripe_customer: string | null;
	stripe_sub: string | null;
	period_end: string | null;
	alert_to: string | null;
	tz: string;
	alerts_per_day: number;
	session_ver: number;
	reset_token: string | null;
	reset_until: string | null;
	/** Free sign-ups confirm their email address with this before their checks run. */
	verify_token: string | null;
	/** The private Live view link (/live/<token>), when the account has made one. */
	live_token?: string | null;
	/** 1 when the Live view link shows the latest alerts too. */
	live_alerts?: number;
	/** When the Live view link stops working (ISO time), or null for never. */
	live_expires?: string | null;
	created_at: string;
}

export interface PlanRow {
	id: string;
	name: string;
	blurb: string | null;
	/** What the sign-up page shows for the price, in the owner's words ("£9 a month"). Stripe charges stripe_price. */
	price_label: string | null;
	stripe_price: string | null;
	monitors: number;
	min_every: number;
	pages: number;
	position: number;
	on_off: number;
	/** 1.3.0: a free plan needs no Stripe price; sign-up asks the person to confirm their email address instead. */
	free: number;
	/** Alerts a day at most on this plan (null: the account's own setting). */
	alerts_per_day: number | null;
	/** Where this plan's alerts can go: "email", "push" (email and browser push) or "all" (every channel). */
	channels: "email" | "push" | "all";
	/** Optional yearly price, shown beside the monthly one. */
	stripe_price_year: string | null;
	price_label_year: string | null;
}

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS accounts (
		id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, password TEXT, role TEXT NOT NULL DEFAULT 'client',
		plan TEXT, status TEXT NOT NULL DEFAULT 'none', stripe_customer TEXT, stripe_sub TEXT, period_end TEXT,
		alert_to TEXT, tz TEXT NOT NULL DEFAULT 'UTC', alerts_per_day INTEGER NOT NULL DEFAULT 50, session_ver INTEGER NOT NULL DEFAULT 0,
		reset_token TEXT, reset_until TEXT, created_at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS plans (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT, price_label TEXT, stripe_price TEXT, monitors INTEGER NOT NULL DEFAULT 5,
		min_every INTEGER NOT NULL DEFAULT 5, pages INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, on_off INTEGER NOT NULL DEFAULT 1)`,
	`CREATE TABLE IF NOT EXISTS monitors (
		id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, url TEXT, host TEXT, port INTEGER, rules TEXT,
		every INTEGER NOT NULL DEFAULT 5, token TEXT UNIQUE, state TEXT, extras INTEGER NOT NULL DEFAULT 1,
		cert TEXT, reg TEXT, cert_sent TEXT NOT NULL DEFAULT '', reg_sent TEXT NOT NULL DEFAULT '', daily_at TEXT,
		paused_until TEXT, last_ping TEXT, checked_at TEXT, created_at TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS monitors_account ON monitors (account_id)`,
	`CREATE TABLE IF NOT EXISTS channels (
		id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT,
		on_off INTEGER NOT NULL DEFAULT 1, fails INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, at TEXT NOT NULL, monitor_id TEXT, subject TEXT NOT NULL, text TEXT NOT NULL,
		urgent INTEGER NOT NULL DEFAULT 0, sent TEXT NOT NULL DEFAULT '')`,
	`CREATE INDEX IF NOT EXISTS alerts_account_at ON alerts (account_id, at)`,
	`CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY, account_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, intro TEXT, host TEXT,
		monitors TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS notices (
		id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
		impact TEXT NOT NULL DEFAULT 'minor', created_at TEXT NOT NULL, resolved_at TEXT)`,
	// 1.2.0: API keys (keys.ts) and the AI connector's sign-in (oauth.ts). Keys, codes and tokens are kept as SHA-256 hashes.
	`CREATE TABLE IF NOT EXISTS api_keys (
		id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL,
		can_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_used TEXT, window_start INTEGER NOT NULL DEFAULT 0, window_count INTEGER NOT NULL DEFAULT 0)`,
	`CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys (account_id)`,
	`CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS oauth_codes (
		code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, account_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS oauth_tokens (
		token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, account_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS oauth_tokens_account ON oauth_tokens (account_id)`,
	// 1.3.0: sign-ups per address (kept as a hash, for a day), for the free plan's limits.
	`CREATE TABLE IF NOT EXISTS signups (ip_hash TEXT NOT NULL, at TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS signups_ip ON signups (ip_hash, at)`,
	`CREATE INDEX IF NOT EXISTS monitors_due ON monitors (checked_at)`,
	// 1.5.0: apps on phones and computers (apps.ts). Each signed-in app has its own key, kept as a SHA-256 hash, and
	// stops working when its account signs out everywhere. Sign-in codes (the QR code on the Account tab) work once.
	`CREATE TABLE IF NOT EXISTS app_devices (
		id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
		session_ver INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_used TEXT)`,
	`CREATE INDEX IF NOT EXISTS app_devices_account ON app_devices (account_id)`,
	`CREATE TABLE IF NOT EXISTS app_codes (code_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
];
/** Columns added after 1.0.0. Each is tried on its own, as it may already be there. */
const COLUMNS = [
	"ALTER TABLE plans ADD COLUMN free INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE plans ADD COLUMN alerts_per_day INTEGER",
	"ALTER TABLE plans ADD COLUMN channels TEXT NOT NULL DEFAULT 'all'",
	"ALTER TABLE plans ADD COLUMN stripe_price_year TEXT",
	"ALTER TABLE plans ADD COLUMN price_label_year TEXT",
	"ALTER TABLE accounts ADD COLUMN verify_token TEXT",
	"ALTER TABLE accounts ADD COLUMN live_token TEXT",
	"ALTER TABLE accounts ADD COLUMN live_alerts INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE accounts ADD COLUMN live_expires TEXT",
	"ALTER TABLE pages ADD COLUMN cf_host_id TEXT",
];
const SCHEMA_VERSION = "6";

let ready: Promise<void> | null = null;

/** Makes the tables once per Worker instance (cheap: one read when they're already there). */
export function ensureSchema(db: D1Database): Promise<void> {
	ready ??= (async () => {
		const have = await db.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>().catch(() => null);
		if (have?.value === SCHEMA_VERSION) return;
		await db.batch(SCHEMA.map((s) => db.prepare(s)));
		for (const c of COLUMNS) await db.prepare(c).run().catch(() => {});
		await db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(SCHEMA_VERSION).run();
	})().catch((e) => {
		ready = null;
		throw e;
	});
	return ready;
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
	return (await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string | null): Promise<void> {
	if (value === null) await db.prepare("DELETE FROM meta WHERE key = ?").bind(key).run();
	else await db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

/** Install-wide settings: where alerts come from, the address people use, branding and selling. */
export interface Install {
	alertFrom: string | null;
	origin: string | null;
	brand: Brand;
	sell: boolean;
}

export interface Brand {
	/** The app's name everywhere: the page, emails, status pages and alert channels. */
	name: string;
	/** A logo address (https://...) or a small picture saved as a data: address. */
	logo: string | null;
	/** The main colour, as #rrggbb. */
	colour: string;
	/** Where clients and status page visitors are told to ask for help. */
	support: string | null;
	/** Hide "Runs on Site Watch" at the foot of status pages and emails. */
	hideCredit: boolean;
}

export const DEFAULT_BRAND: Brand = { name: "Site Watch", logo: null, colour: "#0f766e", support: null, hideCredit: false };

export async function install(db: D1Database): Promise<Install> {
	const { results } = await db.prepare("SELECT key, value FROM meta WHERE key IN ('alert_from', 'origin', 'brand', 'sell')").all<{ key: string; value: string }>();
	const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
	let brand = DEFAULT_BRAND;
	try {
		if (m.brand) brand = { ...DEFAULT_BRAND, ...JSON.parse(m.brand) };
	} catch {}
	return { alertFrom: m.alert_from ?? null, origin: m.origin ?? null, brand, sell: m.sell === "1" };
}

export const newId = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const accountById = (db: D1Database, id: string) => db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();

/** Clients whose subscription isn't paid have their checks held (kept, not run). The owner is never held. */
export const isLive = (a: Pick<AccountRow, "role" | "status">) => a.role === "owner" || LIVE_STATUSES.includes(a.status);
/** Paid (Stripe's active or trialing) or on a free plan with the email address confirmed. */
export const LIVE_STATUSES = ["active", "trialing", "free"];
export const LIVE_SQL = `account_id IN (SELECT id FROM accounts WHERE role = 'owner' OR status IN ('active', 'trialing', 'free'))`;

export const planById = (db: D1Database, id: string | null) => (id ? db.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first<PlanRow>() : Promise.resolve(null));
