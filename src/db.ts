// The database: one Cloudflare D1 database that Site Watch sets up itself on first use, so there are no
// migrations to run. Later versions add tables and columns here with IF NOT EXISTS and ALTER TABLE.
//
// Everything belongs to an account. The owner (who installed it) has the first account. When "Sell to clients"
// is switched on, clients sign up for one of the owner's plans and get accounts of their own.

import type { ApnsEnv } from "./apns.ts";
import type { PhoneEnv } from "./phones.ts";
import type { WhiteLabelEnv } from "./whitelabel.ts";
import type { Kind } from "./core.ts";

export interface Env extends WhiteLabelEnv, ApnsEnv, PhoneEnv {
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
	/** Optional helpers in other regions that confirm a failure before a "down" alert goes (probe.ts). */
	PROBES?: DurableObjectNamespace;
	/** Optional Amazon SES keys for emails to status page subscribers (cheaper for big lists than the EMAIL binding).
	 *  The sending address (Admin, "alerts come from") must be verified in SES. */
	SES_ACCESS_KEY_ID?: string;
	SES_SECRET_ACCESS_KEY?: string;
	SES_REGION?: string;
	/** Optional: the domain whose email Cloudflare Email Routing sends to this Worker, for posting notices by email
	 *  (update-<token>@UPDATE_DOMAIN, extras.ts). */
	UPDATE_DOMAIN?: string;
}

/** One queue message: monitors to check now, or websites due their daily certificate and renewal look. */
/** `at`: when the checks are meant to run (half a minute ahead for the second look at 30 second checks). */
export interface CheckBatch { ids: string[]; daily?: boolean; late?: boolean; at: number; /** 1.11.0: a batch of subscriber messages instead (subscribers.ts). */ sends?: SubSend[] }
export interface SubSend { kind: string; target: string; token: string; subject: string; text: string; from: string; fromName: string; unsub: string; look?: { colour: string | null; logo: string | null; name: string } }

export interface MonitorRow {
	id: string;
	/** 1.13.0: response times from each region (core.ts SpeedLog), for plans with speeds. */
	speeds?: string | null;
	account_id: string;
	kind: Kind;
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
	/** 1.14.0: set when a team member (team.ts) is signed in rather than the account's own login. */
	member?: { id: string; email: string; name: string | null; role: "admin" | "viewer"; password: string | null; session_ver: number; alerts: boolean };
	/** 1.12.0: 1 for the monthly uptime report (paid plans), and the last month sent. */
	reports?: number;
	report_month?: string | null;
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
	/** 1.7.0: phone alerts bought as top ups, and when they run out. */
	phone_credits?: number;
	phone_credits_until?: string | null;
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
	/** 1.7.0: text message and WhatsApp alerts included each month (0: none). */
	phone_alerts?: number;
	/** 1.8.0: how many things may be checked every 30 seconds (0: none). */
	fast?: number;
	/** 1.11.0: email subscribers across the account's status pages, emails to them a month, and chat or webhook subscribers. */
	subscribers?: number;
	sub_emails?: number;
	sub_hooks?: number;
	/** 1.12.0: 1 when status pages may have a password. */
	locked?: number;
	/** 1.13.0: how many websites and APIs are also timed from each region every 5 minutes (0: none). */
	speeds?: number;
	/** 1.14.0: logins included, counting the account's own (0: just theirs); Stripe prices for each extra login,
	 *  monthly and yearly; and how many people may get alerts without a login. */
	seats?: number;
	seat_price?: string | null;
	seat_price_year?: string | null;
	alert_people?: number;
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
	// 1.11.0: people and chat rooms following a status page. kind: email, slack, discord, teams, google or webhook.
	// target is the email address or the incoming webhook address; monitors a JSON list (null: everything on the page).
	`CREATE TABLE IF NOT EXISTS subscribers (
		id TEXT PRIMARY KEY, page_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, monitors TEXT,
		token TEXT NOT NULL UNIQUE, confirmed_at TEXT, created_at TEXT NOT NULL, ip TEXT, UNIQUE (page_id, kind, target))`,
	"CREATE INDEX IF NOT EXISTS subscribers_page ON subscribers (page_id, confirmed_at)",
	// Emails sent to subscribers each month, for the plan's fair use limit.
	"CREATE TABLE IF NOT EXISTS sub_sends (account_id TEXT NOT NULL, month TEXT NOT NULL, emails INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, month))",
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
	// 1.7.0: text message and WhatsApp alerts (phones.ts). Alerts wait in the outbox until the run ends, so several go
	// as one message; every message sent is noted, for the monthly allowance and the daily limits; top ups count once.
	`CREATE TABLE IF NOT EXISTS phone_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, alert_id INTEGER, event TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, claim TEXT)`,
	`CREATE TABLE IF NOT EXISTS phone_sends (
		id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, channel_id INTEGER, kind TEXT NOT NULL, counted INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS phone_sends_account_at ON phone_sends (account_id, at)`,
	`CREATE INDEX IF NOT EXISTS phone_sends_at ON phone_sends (at)`,
	`CREATE TABLE IF NOT EXISTS phone_topups (session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, alerts INTEGER NOT NULL, at TEXT NOT NULL)`,
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
	"ALTER TABLE plans ADD COLUMN phone_alerts INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE accounts ADD COLUMN phone_credits INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE accounts ADD COLUMN phone_credits_until TEXT",
	"ALTER TABLE pages ADD COLUMN logo TEXT",
	"ALTER TABLE pages ADD COLUMN support TEXT",
	"ALTER TABLE pages ADD COLUMN colour TEXT",
	"ALTER TABLE plans ADD COLUMN fast INTEGER NOT NULL DEFAULT 0",
	// 1.11.0: status page subscribers (subscribers.ts).
	"ALTER TABLE plans ADD COLUMN subscribers INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE plans ADD COLUMN sub_emails INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE plans ADD COLUMN sub_hooks INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE pages ADD COLUMN auto_notify INTEGER NOT NULL DEFAULT 1",
	"ALTER TABLE pages ADD COLUMN subscribe INTEGER NOT NULL DEFAULT 1",
	// 1.12.0: password protected pages, posting notices by email and the monthly report (extras.ts).
	"ALTER TABLE plans ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE pages ADD COLUMN password TEXT",
	"ALTER TABLE pages ADD COLUMN mail_token TEXT",
	"ALTER TABLE accounts ADD COLUMN reports INTEGER NOT NULL DEFAULT 1",
	"ALTER TABLE accounts ADD COLUMN report_month TEXT",
	"CREATE UNIQUE INDEX IF NOT EXISTS pages_mail_token ON pages (mail_token)",
	// 1.13.0: speed from each region (cron.ts regionSpeeds).
	"ALTER TABLE plans ADD COLUMN speeds INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE monitors ADD COLUMN speeds TEXT",
	// 1.14.0: team logins and people who only get alerts (team.ts).
	`CREATE TABLE IF NOT EXISTS members (
		id TEXT PRIMARY KEY, account_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL, password TEXT,
		session_ver INTEGER NOT NULL DEFAULT 0, alerts INTEGER NOT NULL DEFAULT 0, token TEXT UNIQUE, token_until TEXT, accepted_at TEXT, created_at TEXT NOT NULL)`,
	"CREATE INDEX IF NOT EXISTS members_account ON members (account_id)",
	"ALTER TABLE plans ADD COLUMN seats INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE plans ADD COLUMN seat_price TEXT",
	"ALTER TABLE plans ADD COLUMN seat_price_year TEXT",
	"ALTER TABLE plans ADD COLUMN alert_people INTEGER NOT NULL DEFAULT 0",
	// 1.15.0: planned maintenance windows on notices (maintenance.ts).
	"ALTER TABLE notices ADD COLUMN starts_at TEXT",
	"ALTER TABLE notices ADD COLUMN ends_at TEXT",
	// 1.15.1: a team member's own app sign in (apps.ts). Null for the account's own login.
	"ALTER TABLE app_devices ADD COLUMN member_id TEXT",
];
const SCHEMA_VERSION = "15";

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

/** Pro features (own domain, and a status page's logo, colour and contact): the owner, and any plan that isn't free. */
export async function hasPro(db: D1Database, a: Pick<AccountRow, "role" | "plan">): Promise<boolean> {
	if (a.role === "owner") return true;
	const plan = await planById(db, a.plan);
	return !!plan && plan.free !== 1;
}
