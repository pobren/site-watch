// The JSON the app page uses. Everything here needs someone signed in, apart from set-up, sign-in and sign-up.
// Each account sees only its own things; the owner also gets the Admin routes (branding, plans, clients).

import { REGIONS } from "./probe.ts";
import { canLock, updateAddress } from "./extras.ts";
import { handleTeam, memberMay, memberView, teamLimits, teamOf } from "./team.ts";
import { emailsThisMonth, HOOK_NAMES, subLimits, tellSubscribers } from "./subscribers.ts";
import { appTo, deliver, newSecret, planAllows, postTo, pushTo, sendEmail } from "./alerts.ts";
import { apnsReady } from "./apns.ts";
import { deleteAccount, handleApps, listApps } from "./apps.ts";
import { handleAuth, json } from "./api-auth.ts";
import { currentAccount, hashPassword } from "./auth.ts";
import { handleBilling, livePlans, publicPlan, signupCap } from "./billing.ts";
import { checkOne, contextOf, dailyOne } from "./cron.ts";
import {
	CHANNEL_NAMES, cleanApiRules, cleanDnsRules, DNS_TYPES, API_METHODS, type ApiRules, CHECK_EVERY, FAST_EVERY, cleanChannel, cleanEmail, cleanHost, cleanName, cleanPort, cleanRules, cleanSlug, cleanUrl, dailyBars, DEFAULT_EVERY, HEARTBEAT_EVERY, iso,
	HELPER_REGIONS, isDown, labelOf, LICENCE_SITES, mailPort, MAIL_PORTS, maskUrl, responseTimes, rulesOf, speedLogOf, speedSummary, stateOf, statusOf, uptime, daysLeft, type Kind,
} from "./core.ts";
import { DEFAULT_BRAND, hasPro, install, isLive, newId, planById, setMeta, type AccountRow, type Env, type MonitorRow, type PlanRow } from "./db.ts";
import { cleanSub, vapidKeys } from "./push.ts";
import { deleteKey, listKeys, makeKey } from "./keys.ts";
import { connectorLinked, revokeAll } from "./oauth.ts";
import { nameProblem, tidyName } from "./names.ts";
import { addHostname, domainState, removeHostname, saasReady } from "./domains.ts";
import { allowanceOf, canSend, cleanPhone, confirmCode, countriesOf, isPhone, MAX_PHONES, maskPhone, PHONE_NAMES, phonePacks, phoneReady, phoneSecretOf, sendCode, testPhone, type PhoneKind, type PhonePack } from "./phones.ts";

/** Where a status page lives: name.PAGE_DOMAIN when the install has one, otherwise /status/name. */
export function pageAddress(env: Env, origin: string, slug: string): string {
	return env.PAGE_DOMAIN ? `https://${slug}.${env.PAGE_DOMAIN.toLowerCase()}` : `${origin}/status/${slug}`;
}

const bad = (error: string, status = 400) => json({ error }, status);

/** A monitor's rules as shown: API header values work like passwords, so only their start is shown. */
function shownRules(r: MonitorRow) {
	const rules = rulesOf(r.rules) as ApiRules;
	if (r.kind !== "api" || !rules.headers) return rules;
	return { ...rules, headers: Object.fromEntries(Object.entries(rules.headers).map(([k, v]) => [k, v.length > 8 ? `${v.slice(0, 4)}…` : "…"])) };
}

export function shape(r: MonitorRow, origin: string, now = new Date()) {
	const s = stateOf(r.state);
	const paused = !!r.paused_until && r.paused_until > iso(now);
	const cert = r.cert ? JSON.parse(r.cert) : null;
	const reg = r.reg ? JSON.parse(r.reg) : null;
	return {
		id: r.id, kind: r.kind, label: labelOf(r), name: r.name, url: r.url, host: r.host, port: r.port, rules: shownRules(r),
		// 30 second checks are stored as every 0.5 but shown as every 1 with fast set, so apps that expect whole minutes carry on.
		every: r.every < 1 ? 1 : r.every, fast: r.every < 1, extras: r.extras === 1,
		status: statusOf(s, !!r.checked_at, paused), why: s.blocked ?? s.why ?? s.certProblem, since: isDown(s) ? s.since : null, ms: s.ms,
		uptime30: uptime(s, now, 30), uptime90: uptime(s, now, 90), bars: dailyBars(s, now).map((b) => b.up), responses: responseTimes(s),
		// Failing only from our own check: the regions that could still reach it (probe.ts).
		regional: s.regional && isDown(s) ? s.regional.ok : null,
		// Speed from each region over the last 24 hours, for plans that include it.
		speeds: r.speeds ? speedSummary(speedLogOf(r.speeds), HELPER_REGIONS, now) : [],
		outages: s.outages.slice(-10).reverse(), checkedAt: r.checked_at, pausedUntil: paused ? r.paused_until : null,
		pingUrl: r.kind === "heartbeat" && r.token ? `${origin}/hb/${r.token}` : null, lastPing: r.last_ping,
		cert: cert ? { ...cert, daysLeft: daysLeft(cert.expires, now) } : null,
		reg: reg ? { ...reg, daysLeft: reg.expires ? daysLeft(reg.expires, now) : null } : null,
	};
}


interface Limits { monitors: number | null; minEvery: number; pages: number | null; channels: "email" | "push" | "all"; alertsPerDay: number | null; ownDomain: boolean; branding: boolean; phoneAlerts: number | null; fast: number | null }

/** What an account may have. The owner has no limits here (the licence covers that, on trust); clients have their plan's. */
async function limitsOf(db: D1Database, a: AccountRow): Promise<Limits> {
	if (a.role === "owner") return { monitors: null, minEvery: 1, pages: null, channels: "all", alertsPerDay: null, ownDomain: true, branding: true, phoneAlerts: null, fast: null };
	const plan = await planById(db, a.plan);
	return { monitors: plan?.monitors ?? 0, minEvery: plan?.min_every ?? 5, pages: plan?.pages ?? 0, channels: plan?.channels ?? "all", alertsPerDay: plan?.alerts_per_day ?? null, ownDomain: !!plan && plan.free !== 1, branding: !!plan && plan.free !== 1, phoneAlerts: plan && plan.free !== 1 && (plan.channels ?? "all") === "all" ? plan.phone_alerts ?? 0 : 0, fast: plan && plan.free !== 1 ? plan.fast ?? 0 : 0 };
}

/** How often this account's things can be checked: the plan's fastest and slower, plus 30 seconds if the plan has any. */
const everyChoices = (l: Limits) => CHECK_EVERY.filter((n) => n >= l.minEvery || (n === FAST_EVERY && l.fast !== 0));

/** Whether one more thing can go to 30 second checks (`except`: the one being edited, already counted). */
async function fastRoom(db: D1Database, accountId: string, l: Limits, except = ""): Promise<string | null> {
	if (l.fast === null) return null;
	const n = await db.prepare("SELECT COUNT(*) AS n FROM monitors WHERE account_id = ? AND kind != 'heartbeat' AND every < 1 AND id != ?").bind(accountId, except).first<{ n: number }>();
	if ((n?.n ?? 0) < l.fast) return null;
	return l.fast ? `Your plan checks up to ${l.fast === 1 ? "1 thing" : `${l.fast} things`} every 30 seconds. Move one to every minute first, or upgrade on the Account tab.` : "30 second checks aren't on your plan. Upgrade on the Account tab to add them.";
}

const KIND_NAMES: Record<string, string> = { ...CHANNEL_NAMES, ...PHONE_NAMES, push: "Browser alerts", apns: "App alerts" };
/** Where a channel sends, as the Alerts tab shows it. Push and app alerts don't show their secret addresses. */
const whereOf = (c: { kind: string; url: string; name: string }) => (c.kind === "push" ? new URL(c.url).hostname : c.kind === "apns" ? "Apple" : isPhone(c.kind) ? maskPhone(c.url) : maskUrl(c.url));

async function everything(env: Env, me: AccountRow, origin: string) {
	const db = env.DB;
	const [mons, chans, pages, notices, alerts, inst, limits] = await Promise.all([
		db.prepare("SELECT * FROM monitors WHERE account_id = ? ORDER BY created_at, id").bind(me.id).all<MonitorRow>(),
		db.prepare("SELECT id, kind, name, url, secret, on_off, fails FROM channels WHERE account_id = ? ORDER BY id").bind(me.id).all<{ id: number; kind: string; name: string; url: string; secret: string | null; on_off: number; fails: number }>(),
		db.prepare("SELECT * FROM pages WHERE account_id = ? ORDER BY created_at").bind(me.id).all<{ id: string; slug: string; title: string; intro: string | null; host: string | null; monitors: string; password?: string | null; mail_token?: string | null }>(),
		db.prepare("SELECT n.* FROM notices n JOIN pages p ON p.id = n.page_id WHERE p.account_id = ? AND (n.resolved_at IS NULL OR n.resolved_at > ?) ORDER BY n.created_at DESC").bind(me.id, iso(new Date(Date.now() - 14 * 86_400_000))).all(),
		db.prepare("SELECT id, at, monitor_id, subject, text, urgent, sent FROM alerts WHERE account_id = ? ORDER BY id DESC LIMIT 50").bind(me.id).all(),
		install(db),
		limitsOf(db, me),
	]);
	const subCounts = new Map((await db.prepare("SELECT page_id, COUNT(*) AS n FROM subscribers WHERE account_id = ? AND confirmed_at IS NOT NULL GROUP BY page_id").bind(me.id).all<{ page_id: string; n: number }>()).results.map((r) => [r.page_id, r.n]));
	const out: Record<string, unknown> = {
		me: { role: me.role, email: me.email, name: me.name, plan: me.plan, status: me.status, live: isLive(me), periodEnd: me.period_end, hasBilling: !!me.stripe_customer, unverified: me.status === "unverified", liveUrl: me.live_token ? `${origin}/live/${me.live_token}` : null, liveAlerts: me.live_alerts === 1, liveExpires: me.live_token ? me.live_expires ?? null : null, reports: me.reports !== 0,
			// Signed in as a team member: who they are and what they may do (team.ts).
			member: me.member ? { email: me.member.email, name: me.member.name, role: me.member.role, alerts: me.member.alerts } : null },
		// The team, for the account's own login: logins and alert-only people, and what the plan includes.
		team: me.member ? null : { members: (await teamOf(db, me.id)).map(memberView), ...(await teamLimits(db, me)) },
		plans: me.role === "client" ? (await livePlans(db, !!env.STRIPE_SECRET_KEY)).map(publicPlan) : [],
		monitors: mons.results.map((r) => shape(r, origin)),
		// Phones waiting for their code are listed under phones.pending, not here. Only webhooks show their secret.
		channels: chans.results.filter((c) => !isPhone(c.kind) || phoneSecretOf(c.secret).verified).map((c) => ({ id: c.id, kind: c.kind, kindName: KIND_NAMES[c.kind] ?? c.kind, name: c.name, where: whereOf(c), secret: c.kind === "webhook" ? c.secret : null, endpoint: c.kind === "push" ? c.url : undefined, on: c.on_off === 1, fails: c.fails })),
		phones: await phonesState(env, me, chans.results, limits),
		// Never the password's hash: only whether there is one, and the address for posting notices by email.
		pages: pages.results.map(({ password, mail_token, ...p }) => ({ ...p, monitors: JSON.parse(p.monitors), address: pageAddress(env, origin, p.slug), subscribers: subCounts.get(p.id as string) ?? 0, locked: !!password, updateEmail: updateAddress(env, { mail_token }), badge: `${pageAddress(env, origin, p.slug).replace(/\/$/, "")}/badge.svg`, widget: `${pageAddress(env, origin, p.slug).replace(/\/$/, "")}/widget` })),
		// Extras on this plan: password protected pages, and whether this install takes notices by email.
		extras: { lock: await canLock(db, me), emailUpdates: !!env.UPDATE_DOMAIN, reports: await hasPro(db, me) },
		// Status page subscribers: the plan's limits and this month's emails (subscribers.ts).
		subs: { ...(await subLimits(db, me)), used: await emailsThisMonth(db, me.id), viaSes: !!env.SES_ACCESS_KEY_ID },
		pageDomain: env.PAGE_DOMAIN?.toLowerCase() ?? null,
		domainTarget: env.DOMAIN_TARGET?.toLowerCase() ?? null,
		notices: notices.results,
		alerts: alerts.results,
		settings: { alertTo: me.alert_to, tz: me.tz, alertsPerDay: me.alerts_per_day, emailReady: !!env.EMAIL && !!inst.alertFrom },
		// Regions that confirm a failure before a "down" alert, when this install has them (probe.ts).
		regions: env.PROBES ? REGIONS.map((r) => r.name) : [],
		choices: { every: everyChoices(limits).filter((n) => n >= 1), fast: limits.fast, heartbeatEvery: HEARTBEAT_EVERY, mailPorts: MAIL_PORTS, dnsTypes: DNS_TYPES, apiMethods: API_METHODS },
		limits,
		brand: inst.brand,
		apiKeys: await listKeys(db, me.id),
		connector: { address: `${origin}/mcp`, api: `${origin}/api/v1`, linked: await connectorLinked(db, me.id, Date.now()) },
		apps: { list: await listApps(db, me.id, me.session_ver), alerts: apnsReady(env), canDelete: me.role === "client" },
	};
	if (me.role === "owner") {
		const [clients, plans] = await Promise.all([
			db.prepare(`SELECT a.id, a.email, a.name, a.plan, a.status, a.period_end, a.created_at, (SELECT COUNT(*) FROM monitors m WHERE m.account_id = a.id) AS monitors
				FROM accounts a WHERE a.role = 'client' ORDER BY a.created_at DESC LIMIT 500`).all(),
			db.prepare("SELECT * FROM plans ORDER BY position, name").all<PlanRow>(),
		]);
		out.admin = {
			alertFrom: inst.alertFrom, emailBinding: !!env.EMAIL, sell: inst.sell, stripeKey: !!env.STRIPE_SECRET_KEY, stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
			webhookUrl: `${origin}/stripe/webhook`, signupUrl: `${origin}/signup`, clients: clients.results, signupCap: await signupCap(db), queue: !!env.CHECKS,
			plans: plans.results.map((p) => ({ ...publicPlan(p), stripePrice: p.stripe_price, stripePriceYear: p.stripe_price_year, priceYear: p.price_label_year, on: p.on_off === 1, position: p.position })),
			licence: { websites: mons.results.filter((m) => m.kind === "website").length, limit: LICENCE_SITES },
			phones: { ready: phoneReady(env), usFrom: !!env.TWILIO_SMS_FROM_US, countries: countriesOf(env), dailyMax: Number(env.PHONE_DAILY_MAX) || 250, packs: await phonePacks(db) },
		};
	}
	return out;
}

/** The Alerts tab's text and WhatsApp card: what this install can send, what's left this month, phones waiting for a code. */
async function phonesState(env: Env, me: AccountRow, chans: { id: number; kind: string; url: string; secret: string | null }[], limits: Limits) {
	const ready = phoneReady(env);
	const plan = me.role === "client" ? await planById(env.DB, me.plan) : null;
	const a = await allowanceOf(env.DB, me, plan);
	const packs = me.role === "client" && env.STRIPE_SECRET_KEY && limits.phoneAlerts ? (await phonePacks(env.DB)).map((p, i) => ({ i, alerts: p.alerts, label: p.label })) : [];
	return {
		ready, countries: countriesOf(env), usFrom: !!env.TWILIO_SMS_FROM_US,
		included: a.included, used: a.used, credits: a.credits, creditsUntil: a.creditsUntil,
		allowed: me.role === "owner" || (limits.phoneAlerts ?? 0) > 0 || a.credits > 0,
		pending: chans.filter((c) => isPhone(c.kind) && !phoneSecretOf(c.secret).verified).map((c) => ({ id: c.id, kind: c.kind, kindName: KIND_NAMES[c.kind], where: maskPhone(c.url) })),
		packs, max: MAX_PHONES,
	};
}

async function body(request: Request): Promise<Record<string, unknown>> {
	return request.json<Record<string, unknown>>().catch(() => ({}));
}

/** A new monitor from the Add form. */
function newMonitor(b: Record<string, unknown>, accountId: string, choices: number[]): MonitorRow | { error: string } {
	const kind = b.kind as Kind;
	const now = iso(new Date());
	const row: MonitorRow = {
		id: newId(8), account_id: accountId, kind, name: cleanName(b.name), url: null, host: null, port: null, rules: null, every: DEFAULT_EVERY, token: null, state: null,
		extras: b.extras === false ? 0 : 1, cert: null, reg: null, cert_sent: "", reg_sent: "", daily_at: null, paused_until: null, last_ping: null, checked_at: null, created_at: now,
	};
	const every = b.fast === true ? FAST_EVERY : Number(b.every);
	const pick = (n: number) => (choices.includes(n) ? n : Math.max(DEFAULT_EVERY, choices.find((x) => x >= 1) ?? DEFAULT_EVERY));
	if (kind === "api") {
		const url = cleanUrl(b.url);
		if (!url) return { error: "Please enter the API address to call, such as https://api.example.com/health." };
		const rules = cleanApiRules(b.rules);
		if ("error" in rules) return rules;
		Object.assign(row, { url, rules: JSON.stringify(rules), every: pick(every), extras: 0 });
	} else if (kind === "dns") {
		const host = cleanHost(b.host);
		if (!host) return { error: "Please enter the domain or name to look up, such as example.com." };
		const rules = cleanDnsRules(b.rules);
		if ("error" in rules) return rules;
		Object.assign(row, { host, rules: JSON.stringify(rules), every: pick(Math.max(every, 5)), extras: 0 });
	} else if (kind === "website") {
		const url = cleanUrl(b.url);
		if (!url) return { error: "Please enter the web address to watch, such as https://example.com/." };
		const rules = cleanRules(b.rules);
		if ("error" in rules) return rules;
		Object.assign(row, { url, rules: JSON.stringify(rules), every: pick(every) });
	} else if (kind === "mail" || kind === "port") {
		const host = cleanHost(b.host);
		if (!host) return { error: "Please enter the server's name, such as mail.example.com." };
		const port = cleanPort(b.port);
		if (!port) return { error: Number(b.port) === 25 ? "Port 25 can't be checked from Cloudflare: Workers aren't allowed to connect out on it. Check 587 or 465 instead." : "Please enter a port number from 1 to 65535." };
		if (kind === "mail" && !mailPort(port)) return { error: "Please choose one of the mail ports listed, or add it as a port check instead." };
		Object.assign(row, { host, port, every: pick(every), extras: 0 });
	} else if (kind === "heartbeat") {
		if (!HEARTBEAT_EVERY.includes(every)) return { error: "Please choose how often the job runs." };
		if (!row.name) return { error: "Please give the heartbeat a name, such as Nightly backup, so you know which job it is." };
		Object.assign(row, { every, token: newId(16), extras: 0, checked_at: now });
	} else {
		return { error: "Please choose what to watch." };
	}
	return row;
}

const cleanColour = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x.trim()) ? x.trim().toLowerCase() : null);
function cleanLogo(x: unknown): string | null | { error: string } {
	if (x === null || x === "") return null;
	if (typeof x !== "string") return { error: "Please give the logo as a web address." };
	if (/^data:image\/(png|svg\+xml|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(x)) return x.length <= 150_000 ? x : { error: "Please use a logo under 100 KB." };
	try {
		const u = new URL(x);
		return u.protocol === "https:" ? u.toString() : { error: "The logo address needs to start with https://." };
	} catch {
		return { error: "Please give the logo as a web address starting with https://." };
	}
}

export async function handleApi(request: Request, env: Env, path: string, url: URL): Promise<Response> {
	const db = env.DB;
	const auth = await handleAuth(request, env, path, url);
	if (auth) return auth;
	// Team members (team.ts): viewers only look, and admins can't touch billing, the team or keys.
	const signedIn = await currentAccount(request, db);
	const refused = signedIn ? memberMay(signedIn, request.method, path) : null;
	if (refused) return bad(refused, 403);
	const apps = await handleApps(request, env, path, url);
	if (apps) return apps;
	const me = signedIn;
	const billing = await handleBilling(request, env, path, url, me);
	if (billing) return billing;
	if (!me) return bad("Please sign in.", 401);

	const inst = await install(db);
	if (me.role === "owner" && inst.origin !== url.origin) await setMeta(db, "origin", url.origin);
	const method = request.method;

	if (path === "/api/state" && method === "GET") return json(await everything(env, me, url.origin));
	if (path === "/api/export" && method === "GET") {
		const data = await everything(env, me, url.origin);
		return json({ exportedAt: iso(new Date()), ...data }, 200, { "content-disposition": `attachment; filename="site-watch-${iso(new Date()).slice(0, 10)}.json"` });
	}
	// Two reads live with the status page actions: the name checker and the own domain wizard's progress.
	const readable = method === "GET" && (path === "/api/pages/name" || /^\/api\/pages\/[0-9a-f]{12}\/domain$/.test(path));
	if (method !== "POST" && method !== "DELETE" && !readable) return bad("Not found", 404);
	const b = method === "POST" ? await body(request) : {};

	// -- The team (team.ts): only the account's own login gets here. --
	if (path === "/api/team" || path.startsWith("/api/team/")) {
		const problem = await handleTeam(request, env, me, path, method, b, url.origin);
		if (problem) return bad(problem.error, problem.status);
		return json(await everything(env, me, url.origin));
	}

	// -- API keys and the AI connector (Account tab). Only from the signed-in page, never with a key. --
	if (path === "/api/keys" && method === "POST") {
		const made = await makeKey(db, me.id, b.name, b.change === true);
		if ("error" in made) return bad(made.error);
		return json({ ...(await everything(env, me, url.origin)), newKey: made.key });
	}
	const key = /^\/api\/keys\/([0-9a-f]{16})$/.exec(path);
	if (key && method === "DELETE") {
		await deleteKey(db, me.id, key[1]);
		return json(await everything(env, me, url.origin));
	}
	if (path === "/api/connector/disconnect" && method === "POST") {
		await revokeAll(db, me.id);
		return json(await everything(env, me, url.origin));
	}
	return act(env, me, path, method, b, url, request);
}

/**
 * Everything that changes something: the app page's buttons, and the public API's writes (v1.ts), which call this
 * with the key's account. Answers with the whole state, or { error } and a status.
 */
export async function act(env: Env, me: AccountRow, path: string, method: string, b: Record<string, unknown>, url: URL, request: Request): Promise<Response> {
	const db = env.DB;
	const owner = me.role === "owner";
	const inst = await install(db);
	const ctx = { ...(await contextOf(env)), link: `${url.origin}/`, helloName: url.hostname };
	const reply = async (extra: Record<string, unknown> = {}) => json({ ...(await everything(env, me, url.origin)), ...extra });
	const limits = await limitsOf(db, me);

	// -- Monitors --
	if (path === "/api/monitors" && method === "POST") {
		if (!isLive(me) && me.status !== "unverified") return bad("Your plan isn't active, so checks are paused. Choose a plan on the Account tab first.", 402);
		const row = newMonitor(b, me.id, everyChoices(limits));
		if ("error" in row) return bad(row.error);
		if (row.kind !== "heartbeat" && row.every < 1) {
			const full = await fastRoom(db, me.id, limits);
			if (full) return bad(full, 403);
		}
		if (limits.monitors !== null) {
			const n = await db.prepare("SELECT COUNT(*) AS n FROM monitors WHERE account_id = ?").bind(me.id).first<{ n: number }>();
			if ((n?.n ?? 0) >= limits.monitors) return bad(`Your plan includes ${limits.monitors === 1 ? "1 monitor" : `${limits.monitors} monitors`}. Remove one first, or upgrade on the Account tab.`, 403);
		}
		const dup = await db.prepare("SELECT 1 FROM monitors WHERE account_id = ? AND kind = ? AND kind != 'heartbeat' AND COALESCE(url, '') = COALESCE(?, '') AND COALESCE(host, '') = COALESCE(?, '') AND COALESCE(port, 0) = COALESCE(?, 0)")
			.bind(me.id, row.kind, row.url, row.host, row.port).first();
		if (dup) return bad("You're already watching that.", 409);
		await db.prepare(`INSERT INTO monitors (id, account_id, kind, name, url, host, port, rules, every, token, extras, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(row.id, me.id, row.kind, row.name, row.url, row.host, row.port, row.rules, row.every, row.token, row.extras, row.checked_at, row.created_at).run();
		// Checked once straight away, without alerts, so you see at once whether it can be reached.
		if (row.kind !== "heartbeat") {
			await checkOne(env, row, me, new Date(), ctx, { quiet: true });
			if (row.kind === "website" && row.extras) await dailyOne(env, row, me, new Date(), ctx, true).catch(() => undefined);
		}
		return reply({ added: row.id });
	}
	const mon = /^\/api\/monitors\/([0-9a-f]{16})(\/(check|pause|resume))?$/.exec(path);
	if (mon) {
		const row = await db.prepare("SELECT * FROM monitors WHERE id = ? AND account_id = ?").bind(mon[1], me.id).first<MonitorRow>();
		if (!row) return bad("We couldn't find that. It may have been removed already.", 404);
		if (method === "DELETE") {
			await db.prepare("DELETE FROM monitors WHERE id = ?").bind(row.id).run();
			return reply();
		}
		if (mon[3] === "check") {
			if (!isLive(me)) return bad("Your plan isn't active, so checks are paused.", 402);
			if (row.kind !== "heartbeat") await checkOne(env, row, me, new Date(), ctx);
			if (row.kind === "website" && row.extras) await dailyOne(env, row, me, new Date(), ctx).catch(() => undefined);
			return reply();
		}
		if (mon[3] === "pause") {
			const mins = Number(b.minutes);
			if (!Number.isInteger(mins) || mins < 5 || mins > 60 * 24 * 365) return bad("Please choose how long to pause for.");
			await db.prepare("UPDATE monitors SET paused_until = ? WHERE id = ?").bind(iso(new Date(Date.now() + mins * 60_000)), row.id).run();
			return reply();
		}
		if (mon[3] === "resume") {
			await db.prepare("UPDATE monitors SET paused_until = NULL, checked_at = CASE kind WHEN 'heartbeat' THEN checked_at ELSE NULL END WHERE id = ?").bind(row.id).run();
			return reply();
		}
		// Edit: name, how often, rules and the daily certificate and renewal look.
		const name = "name" in b ? cleanName(b.name) : row.name;
		if (row.kind === "heartbeat" && !name) return bad("Please give the heartbeat a name.");
		let every = row.every;
		if ("every" in b || b.fast === true) {
			const n = b.fast === true ? FAST_EVERY : Number(b.every);
			if (!(row.kind === "heartbeat" ? HEARTBEAT_EVERY : everyChoices(limits)).includes(n)) return bad("Please choose how often.");
			if (row.kind !== "heartbeat" && n < 1 && row.every >= 1) {
				const full = await fastRoom(db, me.id, limits, row.id);
				if (full) return bad(full, 403);
			}
			every = n;
		}
		let rules = row.rules;
		if ((row.kind === "website" || row.kind === "api" || row.kind === "dns") && "rules" in b) {
			// API headers come back masked, so leaving them out keeps the ones already saved.
			const given = b.rules && typeof b.rules === "object" ? { ...(b.rules as Record<string, unknown>) } : {};
			if (row.kind === "api" && !("headers" in given)) given.headers = (rulesOf(row.rules) as ApiRules).headers;
			const r = row.kind === "api" ? cleanApiRules(given) : row.kind === "dns" ? cleanDnsRules(given) : cleanRules(given);
			if ("error" in r) return bad(r.error);
			rules = JSON.stringify(r);
		}
		const extras = row.kind === "website" && "extras" in b ? (b.extras ? 1 : 0) : row.extras;
		await db.prepare("UPDATE monitors SET name = ?, every = ?, rules = ?, extras = ? WHERE id = ?").bind(name, every, rules, extras, row.id).run();
		return reply();
	}

	// -- Browser alerts (push): the page asks for this install's public key, then hands over the browser's subscription. --
	if (path === "/api/push/key" && method === "POST") return json({ key: (await vapidKeys(db)).publicKey });
	if (path === "/api/push" && method === "POST") {
		if (!owner && !planAllows({ channels: limits.channels }, "push")) return bad("Browser alerts aren't on your plan. Upgrade on the Account tab to turn them on.", 403);
		const sub = cleanSub(b.subscription);
		if (!sub) return bad("This browser didn't give us what it needs for alerts. Please try again, or try another browser.");
		const name = cleanName(b.name, 60) ?? "This browser";
		const count = await db.prepare("SELECT COUNT(*) AS n FROM channels WHERE account_id = ?").bind(me.id).first<{ n: number }>();
		if ((count?.n ?? 0) >= 20) return bad("That's 20 channels already. Remove one first.");
		await db.batch([
			db.prepare("DELETE FROM channels WHERE account_id = ? AND kind = 'push' AND url = ?").bind(me.id, sub.endpoint),
			db.prepare("INSERT INTO channels (account_id, kind, name, url, secret, created_at) VALUES (?, 'push', ?, ?, ?, ?)").bind(me.id, name, sub.endpoint, JSON.stringify(sub.keys), iso(new Date())),
		]);
		return reply({ ok: true });
	}

	// -- Text message and WhatsApp alerts (phones.ts) --
	if (path === "/api/phones" && method === "POST") {
		const via = (b.via === "sms" ? "sms" : "whatsapp") as PhoneKind;
		const plan = owner ? null : await planById(db, me.plan);
		const left = await allowanceOf(db, me, plan);
		if (!owner && !((limits.phoneAlerts ?? 0) > 0 || left.credits > 0)) return bad("Text and WhatsApp alerts aren't on your plan. Upgrade on the Account tab to add them.", 403);
		const n = cleanPhone(b.number, countriesOf(env));
		if ("error" in n) return bad(n.error);
		if (!canSend(env, via, n.number)) return bad(via === "sms" ? "We can't send text messages to that number yet. Try WhatsApp instead." : "WhatsApp alerts aren't set up here yet.");
		const mine = await db.prepare("SELECT id, kind, url FROM channels WHERE account_id = ? AND kind IN ('sms', 'whatsapp')").bind(me.id).all<{ id: number; kind: string; url: string }>();
		const same = mine.results.find((c) => c.url === n.number && c.kind === via);
		if (!same && mine.results.length >= MAX_PHONES) return bad(`That's ${MAX_PHONES} phones already. Remove one first.`);
		const name = cleanName(b.name, 60) ?? `${PHONE_NAMES[via]} ending ${n.number.slice(-3)}`;
		let id = same?.id;
		if (!id) {
			const r = await db.prepare("INSERT INTO channels (account_id, kind, name, url, secret, on_off, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)").bind(me.id, via, name, n.number, JSON.stringify({ verified: false }), iso(new Date())).run();
			id = r.meta.last_row_id;
		}
		const problem = await sendCode(db, env, me.id, { id: id!, kind: via, url: n.number }, inst.brand.name);
		if (problem && !same) await db.prepare("DELETE FROM channels WHERE id = ?").bind(id).run();
		return problem ? bad(problem, 429) : reply({ ok: true, id });
	}
	const ph = /^\/api\/phones\/(\d+)\/(code|confirm)$/.exec(path);
	if (ph && method === "POST") {
		const c = await db.prepare("SELECT id, kind, url, secret FROM channels WHERE id = ? AND account_id = ? AND kind IN ('sms', 'whatsapp')").bind(Number(ph[1]), me.id).first<{ id: number; kind: string; url: string; secret: string | null }>();
		if (!c) return bad("We couldn't find that phone.", 404);
		const problem = ph[2] === "code" ? await sendCode(db, env, me.id, c, inst.brand.name) : await confirmCode(db, c, b.code);
		return problem ? bad(problem) : reply({ ok: true });
	}

	// -- Alert channels --
	if (path === "/api/channels" && method === "POST") {
		const c = cleanChannel(b);
		if ("error" in c) return bad(c.error);
		if (!owner && !planAllows({ channels: limits.channels }, c.kind)) return bad(`${CHANNEL_NAMES[c.kind]} alerts aren't on your plan. Upgrade on the Account tab to add them.`, 403);
		const count = await db.prepare("SELECT COUNT(*) AS n FROM channels WHERE account_id = ?").bind(me.id).first<{ n: number }>();
		if ((count?.n ?? 0) >= 20) return bad("That's 20 channels already. Remove one first.");
		await db.prepare("INSERT INTO channels (account_id, kind, name, url, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(me.id, c.kind, c.name, c.url, c.kind === "webhook" ? newSecret() : null, iso(new Date())).run();
		return reply();
	}
	const ch = /^\/api\/channels\/(\d+)(\/test)?$/.exec(path);
	if (ch) {
		const c = await db.prepare("SELECT * FROM channels WHERE id = ? AND account_id = ?").bind(Number(ch[1]), me.id).first<{ id: number; kind: string; url: string; secret: string | null; name: string }>();
		if (!c) return bad("We couldn't find that channel.", 404);
		if (method === "DELETE") {
			await db.prepare("DELETE FROM channels WHERE id = ?").bind(c.id).run();
			return reply();
		}
		if (ch[2] && isPhone(c.kind)) {
			const row = await db.prepare("SELECT id, kind, name, url, secret, fails FROM channels WHERE id = ?").bind(c.id).first<{ id: number; kind: string; name: string; url: string; secret: string | null; fails: number }>();
			const problem = await testPhone(db, env, me, owner ? null : await planById(db, me.plan), row!, ctx.link, inst.brand.name);
			return problem ? bad(problem, 429) : reply({ ok: true });
		}
		if (ch[2]) {
			const test = { event: "test" as const, subject: `Test alert from ${inst.brand.name}`, text: `If you can read this, ${inst.brand.name} alerts will arrive here.`, urgent: false, url: ctx.link, sentAt: iso(new Date()), app: inst.brand.name };
			if (c.kind === "apns") {
				const r = await appTo(env, me, c, test, null, "test");
				if (r === "gone") await db.prepare("DELETE FROM channels WHERE id = ?").bind(c.id).run();
				return r === "sent" ? reply({ ok: true }) : bad(r === "gone" ? "That app is signed out, so we've removed it. Sign in on the app again to turn alerts back on." : "Apple didn't take the test. Please try again in a minute.", 502);
			}
			if (c.kind === "push") {
				const r = await pushTo(db, c, test, inst.alertFrom ? `mailto:${inst.alertFrom}` : url.origin, "test");
				if (r === "gone") await db.prepare("DELETE FROM channels WHERE id = ?").bind(c.id).run();
				return r === "sent" ? reply({ ok: true }) : bad(r === "gone" ? "That browser has turned alerts off, so we've removed it. Turn them on again from that browser." : "The browser's push service didn't take the test. Please try again in a minute.", 502);
			}
			const ok = await postTo(c, test);
			if (ok) await db.prepare("UPDATE channels SET fails = 0, on_off = 1 WHERE id = ?").bind(c.id).run();
			return ok ? reply({ ok: true }) : bad(`${c.name} didn't accept the test. Check the address is right and still switched on in ${CHANNEL_NAMES[c.kind as keyof typeof CHANNEL_NAMES] ?? "the service"}.`, 502);
		}
		if ("on" in b && b.on && isPhone(c.kind) && !phoneSecretOf(c.secret).verified) return bad("Confirm this phone with its code first.");
		if ("on" in b) await db.prepare("UPDATE channels SET on_off = ?, fails = 0 WHERE id = ?").bind(b.on ? 1 : 0, c.id).run();
		return reply();
	}

	// -- Your settings --
	if (path === "/api/settings" && method === "POST") {
		// A team member's own name, and whether they get the alert emails too. Everything else is the account's.
		if (me.member) {
			if ("name" in b) await db.prepare("UPDATE members SET name = ? WHERE id = ?").bind(cleanName(b.name, 80), me.member.id).run();
			if (typeof b.alerts === "boolean") await db.prepare("UPDATE members SET alerts = ? WHERE id = ?").bind(b.alerts ? 1 : 0, me.member.id).run();
			return reply({ ok: true });
		}
		let alertTo = me.alert_to;
		if ("alertTo" in b) {
			if (b.alertTo === "" || b.alertTo === null) alertTo = null;
			else {
				alertTo = cleanEmail(b.alertTo);
				if (!alertTo) return bad("Please enter a whole email address, such as you@example.com.");
			}
		}
		let tz = me.tz;
		if (typeof b.tz === "string") {
			try {
				new Intl.DateTimeFormat("en-GB", { timeZone: b.tz });
				tz = b.tz;
			} catch {
				return bad("We don't know that time zone.");
			}
		}
		let perDay = me.alerts_per_day;
		if ("alertsPerDay" in b) {
			perDay = Number(b.alertsPerDay);
			if (!Number.isInteger(perDay) || perDay < 5 || perDay > 1000) return bad("Please choose between 5 and 1,000 alerts a day.");
		}
		const name = "name" in b ? cleanName(b.name, 80) : me.name;
		await db.prepare("UPDATE accounts SET alert_to = ?, tz = ?, alerts_per_day = ?, name = ? WHERE id = ?").bind(alertTo, tz, perDay, name, me.id).run();
		if (typeof b.reports === "boolean") { await db.prepare("UPDATE accounts SET reports = ? WHERE id = ?").bind(b.reports ? 1 : 0, me.id).run(); me.reports = b.reports ? 1 : 0; }
		Object.assign(me, { alert_to: alertTo, tz, alerts_per_day: perDay, name });
		return reply({ ok: true });
	}
	if (path === "/api/alerts/test" && method === "POST") {
		await deliver(env, me, { subject: `Test alert from ${inst.brand.name}`, text: `This is a test. Every alert goes to the places that got this one.\n\nOpen ${inst.brand.name}: ${ctx.link}`, urgent: false }, null);
		const last = await db.prepare("SELECT sent FROM alerts WHERE account_id = ? ORDER BY id DESC LIMIT 1").bind(me.id).first<{ sent: string }>();
		return reply({ ok: true, sent: last?.sent ?? "" });
	}

	// -- The Live view link: POST makes one (or a new one with reset; alerts: true shows the latest alerts on it; expires: hours it works for, or null), DELETE turns it off. --
	if (path === "/api/live-link" && (method === "POST" || method === "DELETE")) {
		const token = method === "DELETE" ? null : me.live_token && !b.reset ? me.live_token : newId(16);
		const alerts = method === "DELETE" ? 0 : typeof b.alerts === "boolean" ? (b.alerts ? 1 : 0) : (me.live_alerts ?? 0);
		// expires: how many hours the link works for (1 hour to a year), or null for until it's turned off.
		const hours = typeof b.expires === "number" && b.expires >= 1 ? Math.min(Math.round(b.expires), 24 * 366) : null;
		const expires = method === "DELETE" ? null : "expires" in b ? (hours ? iso(new Date(Date.now() + hours * 3_600_000)) : null) : (me.live_expires ?? null);
		await db.prepare("UPDATE accounts SET live_token = ?, live_alerts = ?, live_expires = ? WHERE id = ?").bind(token, alerts, expires, me.id).run();
		me.live_token = token;
		me.live_alerts = alerts;
		me.live_expires = expires;
		return reply({ ok: true });
	}

	// -- Status pages --
	// Checked as people type a name: allowed, and free (their own page's current name counts as free).
	if (path === "/api/pages/name" && method === "GET") {
		const name = tidyName(url.searchParams.get("name"));
		const id = url.searchParams.get("id") ?? "";
		const problem = nameProblem(name);
		if (problem) return Response.json({ ok: false, name, reason: problem, address: pageAddress(env, url.origin, name || "name") });
		const taken = await db.prepare("SELECT 1 FROM pages WHERE slug = ? AND id != ?").bind(name, id).first();
		return Response.json(taken ? { ok: false, name, reason: "Someone already has that name. Please try another.", address: pageAddress(env, url.origin, name) } : { ok: true, name, address: pageAddress(env, url.origin, name) });
	}
	if (path === "/api/pages" && method === "POST") {
		const title = cleanName(b.title, 80);
		if (!title) return bad("Please give the status page a title, such as Example Ltd status.");
		const slug = tidyName(b.slug || title);
		const problem = nameProblem(slug);
		if (problem) return bad(problem);
		const intro = typeof b.intro === "string" ? b.intro.trim().slice(0, 500) || null : null;
		// The page's own logo: left out keeps what's there, empty removes it.
		// Logo, colour and contact come with Pro: on other plans they're left as they are.
		if (!limits.branding) { delete b.logo; delete b.support; delete b.colour; }
		const logo = b.logo === undefined ? undefined : cleanLogo(b.logo);
		if (logo && typeof logo === "object") return bad(logo.error);
		// Who visitors contact (the customer, never us) and the page's colour: left out keeps what's there.
		let support: string | null | undefined = undefined;
		if (typeof b.support === "string") {
			const t = b.support.trim();
			if (!t) support = null;
			else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 200) support = t;
			else if (/^https:\/\/[^\s]+$/.test(t) && t.length <= 300) support = t;
			else return bad("Please give an email address, or a web address starting with https://, for visitors to contact.");
		}
		const colour = b.colour === undefined ? undefined : b.colour === "" || b.colour === null ? null : cleanColour(b.colour);
		if (colour === null && b.colour) return bad("Please pick a colour.");
		// With Cloudflare for SaaS, own domains go through the wizard (/domain below), so this keeps what's there.
		const managed = saasReady(env);
		let host = typeof b.host === "string" && b.host.trim() ? cleanHost(b.host) : null;
		if (!managed && typeof b.host === "string" && b.host.trim() && !host) return bad("Please enter just the address, such as status.example.com.");
		const mine = new Set((await db.prepare("SELECT id FROM monitors WHERE account_id = ?").bind(me.id).all<{ id: string }>()).results.map((r) => r.id));
		const ids = Array.isArray(b.monitors) ? b.monitors.filter((x): x is string => typeof x === "string" && mine.has(x)).slice(0, 60) : [];
		const id = typeof b.id === "string" && /^[0-9a-f]{12}$/.test(b.id) ? b.id : null;
		if (id && !(await db.prepare("SELECT 1 FROM pages WHERE id = ? AND account_id = ?").bind(id, me.id).first())) return bad("We couldn't find that page.", 404);
		if (!id && limits.pages !== null) {
			const n = await db.prepare("SELECT COUNT(*) AS n FROM pages WHERE account_id = ?").bind(me.id).first<{ n: number }>();
			if ((n?.n ?? 0) >= limits.pages) return bad(limits.pages ? `Your plan includes ${limits.pages} status page${limits.pages === 1 ? "" : "s"}.` : "Your plan doesn't include status pages.", 403);
		}
		if (managed) host = id ? ((await db.prepare("SELECT host FROM pages WHERE id = ?").bind(id).first<string>("host")) ?? null) : null;
		const taken = await db.prepare("SELECT id FROM pages WHERE slug = ? AND id != ?").bind(slug, id ?? "").first();
		if (taken) return bad("Someone already has that name. Please try another.", 409);
		if (host && (await db.prepare("SELECT id FROM pages WHERE host = ? AND id != ?").bind(host, id ?? "").first())) return bad("Another status page uses that address.", 409);
		if (id) {
			await db.prepare("UPDATE pages SET slug = ?, title = ?, intro = ?, host = ?, monitors = ? WHERE id = ?").bind(slug, title, intro, host, JSON.stringify(ids), id).run();
			if (logo !== undefined) await db.prepare("UPDATE pages SET logo = ? WHERE id = ?").bind(logo, id).run();
			if (support !== undefined) await db.prepare("UPDATE pages SET support = ? WHERE id = ?").bind(support, id).run();
			if (colour !== undefined) await db.prepare("UPDATE pages SET colour = ? WHERE id = ?").bind(colour, id).run();
			// Subscribers: whether the page takes them, and whether things going down and back up are sent automatically.
			if (typeof b.subscribe === "boolean") await db.prepare("UPDATE pages SET subscribe = ? WHERE id = ?").bind(b.subscribe ? 1 : 0, id).run();
			if (typeof b.autoNotify === "boolean") await db.prepare("UPDATE pages SET auto_notify = ? WHERE id = ?").bind(b.autoNotify ? 1 : 0, id).run();
			// A password (plans that allow it), and the private address for posting notices by email.
			if (typeof b.password === "string" && b.password) {
				if (!(await canLock(db, me))) return bad("Password protected status pages aren't on your plan. Upgrade on the Account tab to add them.", 403);
				if (b.password.length < 8 || b.password.length > 200) return bad("Please choose a page password of at least 8 characters.");
				await db.prepare("UPDATE pages SET password = ? WHERE id = ?").bind(await hashPassword(b.password), id).run();
			}
			if (b.removePassword === true) await db.prepare("UPDATE pages SET password = NULL WHERE id = ?").bind(id).run();
			if (b.mailUpdates === true) await db.prepare("UPDATE pages SET mail_token = ? WHERE id = ?").bind(newId(12), id).run();
			if (b.mailUpdates === false) await db.prepare("UPDATE pages SET mail_token = NULL WHERE id = ?").bind(id).run();
		} else await db.prepare("INSERT INTO pages (id, account_id, slug, title, intro, host, monitors, logo, support, colour, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(newId(6), me.id, slug, title, intro, host, JSON.stringify(ids), logo ?? null, support ?? null, colour ?? null, iso(new Date())).run();
		return reply({ ok: true });
	}
	// A status page on the customer's own domain: the set-up wizard adds it, checks it, and removes it.
	const dm = /^\/api\/pages\/([0-9a-f]{12})\/domain$/.exec(path);
	if (dm) {
		const page = await db.prepare("SELECT id, host, cf_host_id FROM pages WHERE id = ? AND account_id = ?").bind(dm[1], me.id).first<{ id: string; host: string | null; cf_host_id: string | null }>();
		if (!page) return bad("We couldn't find that page.", 404);
		if (method === "GET") return json(page.host ? await domainState(env, page.host, page.cf_host_id) : { host: null });
		if (method === "DELETE") {
			await removeHostname(env, page.cf_host_id);
			await db.prepare("UPDATE pages SET host = NULL, cf_host_id = NULL WHERE id = ?").bind(page.id).run();
			return reply();
		}
		if (method === "POST") {
			if (!limits.ownDomain) return bad("Your own domain comes with Pro. You can upgrade on the website.", 403);
			const host = cleanHost(b.host);
			if (!host) return bad("Please enter just the address, such as status.yourcompany.com.");
			if (env.PAGE_DOMAIN && (host === env.PAGE_DOMAIN.toLowerCase() || host.endsWith(`.${env.PAGE_DOMAIN.toLowerCase()}`))) return bad("Please use a domain of your own.");
			if (await db.prepare("SELECT 1 FROM pages WHERE host = ? AND id != ?").bind(host, page.id).first()) return bad("Another status page uses that address.", 409);
			let id: string | null = null;
			if (saasReady(env)) {
				if (page.cf_host_id && page.host !== host) await removeHostname(env, page.cf_host_id);
				try {
					id = page.host === host && page.cf_host_id ? page.cf_host_id : await addHostname(env, host);
				} catch (e) {
					return bad(`We couldn't add that domain: ${(e as Error).message}`, 502);
				}
			}
			await db.prepare("UPDATE pages SET host = ?, cf_host_id = ? WHERE id = ?").bind(host, id, page.id).run();
			return reply({ domain: await domainState(env, host, id) });
		}
		return bad("Not found", 404);
	}
	// Subscribers: the list for one page, adding addresses by hand or from a spreadsheet, and removing one.
	const sp = /^\/api\/pages\/([0-9a-f]{12})\/subscribers$/.exec(path);
	if (sp) {
		if (!(await db.prepare("SELECT 1 FROM pages WHERE id = ? AND account_id = ?").bind(sp[1], me.id).first())) return bad("We couldn't find that page.", 404);
		if (method === "POST") {
			const sl = await subLimits(db, me);
			const list = [...new Set(String(b.emails ?? "").split(/[\s,;]+/).map((x) => cleanEmail(x)).filter((x): x is string => !!x))].slice(0, 5000);
			if (!list.length) return bad("Please paste one or more email addresses.");
			if (sl.subscribers !== null) {
				const n = (await db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE account_id = ? AND kind = 'email'").bind(me.id).first<{ n: number }>())?.n ?? 0;
				if (n + list.length > sl.subscribers) return bad(sl.subscribers ? `Your plan includes ${sl.subscribers.toLocaleString("en-GB")} email subscribers and you have ${n.toLocaleString("en-GB")}.` : "Your plan doesn't include subscribers.", 403);
			}
			const now = iso(new Date());
			const rows = list.map((e) => db.prepare("INSERT INTO subscribers (id, page_id, account_id, kind, target, token, confirmed_at, created_at) VALUES (?, ?, ?, 'email', ?, ?, ?, ?) ON CONFLICT (page_id, kind, target) DO UPDATE SET confirmed_at = COALESCE(confirmed_at, excluded.confirmed_at)").bind(newId(8), sp[1], me.id, e, newId(16), now, now));
			for (let i = 0; i < rows.length; i += 100) await db.batch(rows.slice(i, i + 100));
			return reply({ added: list.length });
		}
		const { results } = await db.prepare("SELECT id, kind, target, monitors, confirmed_at, created_at FROM subscribers WHERE page_id = ? ORDER BY created_at DESC LIMIT 1000").bind(sp[1]).all<{ id: string; kind: string; target: string; monitors: string | null; confirmed_at: string | null; created_at: string }>();
		// Chat and webhook addresses work like passwords: only where they go is shown.
		return json({ subscribers: results.map((r) => ({ ...r, target: r.kind === "email" ? r.target : `${HOOK_NAMES[r.kind] ?? r.kind}: ${maskUrl(r.target)}`, monitors: r.monitors ? JSON.parse(r.monitors) : null })) });
	}
	const sd = /^\/api\/subscribers\/([0-9a-f]{16})$/.exec(path);
	if (sd && method === "DELETE") {
		await db.prepare("DELETE FROM subscribers WHERE id = ? AND account_id = ?").bind(sd[1], me.id).run();
		return reply();
	}
	const pg = /^\/api\/pages\/([0-9a-f]{12})(\/notices)?$/.exec(path);
	if (pg) {
		if (!(await db.prepare("SELECT 1 FROM pages WHERE id = ? AND account_id = ?").bind(pg[1], me.id).first())) return bad("We couldn't find that page.", 404);
		if (method === "DELETE") {
			const cfId = await db.prepare("SELECT cf_host_id FROM pages WHERE id = ?").bind(pg[1]).first<string>("cf_host_id");
			await removeHostname(env, cfId);
			await db.batch([db.prepare("DELETE FROM notices WHERE page_id = ?").bind(pg[1]), db.prepare("DELETE FROM subscribers WHERE page_id = ?").bind(pg[1]), db.prepare("DELETE FROM pages WHERE id = ?").bind(pg[1])]);
			return reply();
		}
		if (pg[2]) {
			const title = cleanName(b.title, 120);
			if (!title) return bad("Please give the notice a short title, such as Email is slow this morning.");
			const impact = ["minor", "major", "maintenance"].includes(String(b.impact)) ? String(b.impact) : "minor";
			const text = typeof b.body === "string" ? b.body.trim().slice(0, 2000) : "";
			await db.prepare("INSERT INTO notices (page_id, title, body, impact, created_at) VALUES (?, ?, ?, ?, ?)").bind(pg[1], title, text, impact, iso(new Date())).run();
			if (b.tell !== false) await tellSubscribers(env, pg[1], `${impact === "maintenance" ? "Planned maintenance" : impact === "major" ? "Major problem" : "Update"}: ${title}`, text || title).catch((e) => console.error("subscribers", e));
			return reply();
		}
	}
	const nt = /^\/api\/notices\/(\d+)(\/resolve)?$/.exec(path);
	if (nt) {
		const n = await db.prepare("SELECT n.id FROM notices n JOIN pages p ON p.id = n.page_id WHERE n.id = ? AND p.account_id = ?").bind(Number(nt[1]), me.id).first();
		if (!n) return bad("We couldn't find that notice.", 404);
		if (method === "DELETE") await db.prepare("DELETE FROM notices WHERE id = ?").bind(Number(nt[1])).run();
		else if (nt[2]) {
			const done = await db.prepare("UPDATE notices SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL RETURNING page_id, title").bind(iso(new Date()), Number(nt[1])).first<{ page_id: string; title: string }>();
			if (done && b.tell !== false) await tellSubscribers(env, done.page_id, `Resolved: ${done.title}`, `This is now resolved: ${done.title}.`).catch((e) => console.error("subscribers", e));
		}
		return reply();
	}

	if (!owner) return bad("Not found", 404);
	return admin(request, env, path, b, reply);
}

/** The owner's Admin tab: sending address, branding, selling, plans and clients. */
async function admin(request: Request, env: Env, path: string, b: Record<string, unknown>, reply: (extra?: Record<string, unknown>) => Promise<Response>): Promise<Response> {
	const db = env.DB;
	const method = request.method;
	if (path === "/api/admin/install" && method === "POST") {
		if ("alertFrom" in b) {
			if (b.alertFrom === "" || b.alertFrom === null) await setMeta(db, "alert_from", null);
			else {
				const e = cleanEmail(b.alertFrom);
				if (!e) return bad("Please enter the whole address alerts come from, such as alerts@example.com.");
				await setMeta(db, "alert_from", e);
			}
		}
		if ("signupCap" in b) {
			const n = Number(b.signupCap);
			if (!Number.isInteger(n) || n < 1 || n > 100_000) return bad("Please choose between 1 and 100,000 new accounts a day.");
			await setMeta(db, "signup_cap", String(n));
		}
		if ("sell" in b) {
			await setMeta(db, "sell", b.sell ? "1" : null);
		}
		return reply({ ok: true });
	}
	if (path === "/api/admin/brand" && method === "POST") {
		const inst = await install(db);
		const brand = { ...inst.brand };
		if ("name" in b) brand.name = cleanName(b.name, 40) ?? DEFAULT_BRAND.name;
		if ("colour" in b) brand.colour = cleanColour(b.colour) ?? DEFAULT_BRAND.colour;
		if ("support" in b) {
			const s = typeof b.support === "string" ? b.support.trim() : "";
			brand.support = s ? (cleanEmail(s) ?? (/^https:\/\/\S+$/.test(s) ? s : null)) : null;
			if (s && !brand.support) return bad("Please give a support email address, or a web address starting with https://.");
		}
		if ("logo" in b) {
			const l = cleanLogo(b.logo);
			if (l && typeof l === "object") return bad(l.error);
			brand.logo = l;
		}
		if ("hideCredit" in b) brand.hideCredit = b.hideCredit === true;
		await setMeta(db, "brand", JSON.stringify(brand));
		return reply({ ok: true });
	}
	if (path === "/api/admin/phones" && method === "POST") {
		const raw = Array.isArray(b.packs) ? b.packs.slice(0, 4) : [];
		const packs: PhonePack[] = [];
		for (const x of raw as Record<string, unknown>[]) {
			const alerts = Number(x.alerts), price = String(x.price ?? "").trim(), label = cleanName(x.label, 40);
			if (!alerts && !price) continue;
			if (!Number.isInteger(alerts) || alerts < 1 || alerts > 10_000) return bad("Each top up needs a number of alerts, between 1 and 10,000.");
			if (!/^price_[A-Za-z0-9]+$/.test(price)) return bad("A Stripe price ID starts with price_. Make a one off price in Stripe and paste its ID.");
			if (!label) return bad("Give each top up its price text, such as £5, so people see what it costs.");
			packs.push({ alerts, price, label });
		}
		await setMeta(db, "phone_packs", JSON.stringify(packs));
		return reply({ ok: true });
	}
	if (path === "/api/admin/plans" && method === "POST") {
		const name = cleanName(b.name, 40);
		if (!name) return bad("Please give the plan a name, such as Small business.");
		const num = (x: unknown, lo: number, hi: number) => (Number.isInteger(Number(x)) && Number(x) >= lo && Number(x) <= hi ? Number(x) : null);
		const monitors = num(b.monitors, 1, 10_000);
		const pages = num(b.pages, 0, 100);
		const minEvery = CHECK_EVERY.includes(Number(b.minEvery)) && Number(b.minEvery) >= 1 ? Number(b.minEvery) : null;
		if (monitors === null || pages === null || minEvery === null) return bad("Please fill in what the plan includes: monitors, how often and status pages.");
		const priceId = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
		const free = b.free === true;
		const price = free ? null : priceId(b.stripePrice);
		const priceYear = free ? null : priceId(b.stripePriceYear);
		for (const p of [price, priceYear]) if (p && !/^price_[A-Za-z0-9]+$/.test(p)) return bad("A Stripe price ID starts with price_. Find it on the product's page in Stripe.");
		const perDay = b.alertsPerDay === "" || b.alertsPerDay === null || b.alertsPerDay === undefined ? null : num(b.alertsPerDay, 1, 1000);
		if (perDay === null && b.alertsPerDay !== "" && b.alertsPerDay !== null && b.alertsPerDay !== undefined) return bad("Please choose between 1 and 1,000 alerts a day, or leave it empty for no limit.");
		const channels = ["email", "push", "all"].includes(String(b.channels)) ? String(b.channels) : "all";
		const phoneAlerts = b.phoneAlerts === "" || b.phoneAlerts === undefined || b.phoneAlerts === null ? 0 : num(b.phoneAlerts, 0, 10_000);
		if (phoneAlerts === null) return bad("Please choose between 0 and 10,000 text and WhatsApp alerts a month.");
		const fast = b.fast === "" || b.fast === undefined || b.fast === null ? 0 : num(b.fast, 0, 10_000);
		if (fast === null) return bad("Please choose how many things can be checked every 30 seconds, from 0 up.");
		const opt = (x: unknown, max: number) => (x === "" || x === undefined || x === null ? 0 : num(x, 0, max));
		const subscribers = opt(b.subscribers, 1_000_000), subEmails = opt(b.subEmails, 10_000_000), subHooks = opt(b.subHooks, 10_000);
		if (subscribers === null || subEmails === null || subHooks === null) return bad("Please give the subscriber limits as whole numbers, from 0 up.");
		const fields = [name, cleanName(b.blurb, 200), cleanName(b.priceLabel, 40), price, monitors, minEvery, pages, num(b.position, 0, 100) ?? 0, b.on === false ? 0 : 1,
			free ? 1 : 0, perDay, channels, priceYear, priceYear ? cleanName(b.priceLabelYear, 40) : null, free ? 0 : phoneAlerts, free ? 0 : Math.min(fast, monitors), free ? 0 : subscribers, free ? 0 : subEmails, free ? 0 : subHooks, !free && b.locked === true ? 1 : 0, free ? 0 : Math.min(opt(b.speeds, 10_000) ?? 0, monitors),
			free ? 0 : opt(b.seats, 1000) ?? 0, free ? null : priceId(b.seatPrice), free ? null : priceId(b.seatPriceYear), free ? 0 : opt(b.alertPeople, 1000) ?? 0];
		const id = typeof b.id === "string" && /^[0-9a-f]{8}$/.test(b.id) ? b.id : null;
		if (id) await db.prepare("UPDATE plans SET name = ?, blurb = ?, price_label = ?, stripe_price = ?, monitors = ?, min_every = ?, pages = ?, position = ?, on_off = ?, free = ?, alerts_per_day = ?, channels = ?, stripe_price_year = ?, price_label_year = ?, phone_alerts = ?, fast = ?, subscribers = ?, sub_emails = ?, sub_hooks = ?, locked = ?, speeds = ?, seats = ?, seat_price = ?, seat_price_year = ?, alert_people = ? WHERE id = ?").bind(...fields, id).run();
		else await db.prepare("INSERT INTO plans (name, blurb, price_label, stripe_price, monitors, min_every, pages, position, on_off, free, alerts_per_day, channels, stripe_price_year, price_label_year, phone_alerts, fast, subscribers, sub_emails, sub_hooks, locked, speeds, seats, seat_price, seat_price_year, alert_people, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...fields, newId(4)).run();
		return reply({ ok: true });
	}
	const pl = /^\/api\/admin\/plans\/([0-9a-f]{8})$/.exec(path);
	if (pl && method === "DELETE") {
		const used = await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE plan = ?").bind(pl[1]).first<{ n: number }>();
		if (used?.n) return bad(`${used.n} client${used.n === 1 ? " is" : "s are"} on this plan. Switch it off instead, so nobody new can choose it.`, 409);
		await db.prepare("DELETE FROM plans WHERE id = ?").bind(pl[1]).run();
		return reply();
	}
	const cl = /^\/api\/admin\/clients\/([0-9a-f]{16})$/.exec(path);
	if (cl) {
		const c = await db.prepare("SELECT id FROM accounts WHERE id = ? AND role = 'client'").bind(cl[1]).first();
		if (!c) return bad("We couldn't find that client.", 404);
		if (method === "DELETE") {
			await deleteAccount(db, cl[1]);
			return reply();
		}
		// Free of charge (no Stripe), or held. Stripe's next webhook for them wins again.
		if ("status" in b) await db.prepare("UPDATE accounts SET status = ? WHERE id = ?").bind(b.status === "active" ? "active" : b.status === "free" ? "free" : "none", cl[1]).run();
		if ("plan" in b && typeof b.plan === "string") await db.prepare("UPDATE accounts SET plan = (SELECT id FROM plans WHERE id = ?) WHERE id = ?").bind(b.plan, cl[1]).run();
		return reply();
	}
	return bad("Not found", 404);
}
