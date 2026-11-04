// The database: one Cloudflare D1 database that Site Watch sets up itself on first use, so there are no
// migrations to run. Later versions add tables and columns here with IF NOT EXISTS and ALTER TABLE.
//
// Everything belongs to an account. The owner (who installed it) has the first account. When "Sell to clients"
// is switched on, clients sign up for one of the owner's plans and get accounts of their own.

export interface Env {
	DB: D1Database;
	/** Cloudflare's send_email binding. Alerts by email need a domain with Email Routing on (see the README). */
	EMAIL?: SendEmail;
	/** The secret code that lets the owner make (or reset) their account at /setup. */
	SETUP_TOKEN?: string;
	/** Sell to clients: your own Stripe keys, as secrets on the Worker. Payments go straight to your Stripe account. */
	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
}

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
];
const SCHEMA_VERSION = "1";

let ready: Promise<void> | null = null;

/** Makes the tables once per Worker instance (cheap: one read when they're already there). */
export function ensureSchema(db: D1Database): Promise<void> {
	ready ??= (async () => {
		const have = await db.prepare("SELECT value FROM meta WHERE key = 'schema'").first<{ value: string }>().catch(() => null);
		if (have?.value === SCHEMA_VERSION) return;
		await db.batch(SCHEMA.map((s) => db.prepare(s)));
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
export const isLive = (a: Pick<AccountRow, "role" | "status">) => a.role === "owner" || a.status === "active" || a.status === "trialing";
