// Sell to clients (off until the owner switches it on): clients sign up on /signup, pick one of the owner's plans
// and pay by Stripe Checkout with the owner's own Stripe account. Stripe tells us by webhook when a subscription
// starts, changes or ends, and a client's checks only run while it's paid. Cards, receipts, invoices, refunds and
// cancelling are all Stripe's: clients manage theirs in Stripe's billing portal from their Account tab.
//
// Secrets on the Worker: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The webhook address is /stripe/webhook.
// Optional variable STRIPE_MANAGED_PAYMENTS = "on": Stripe sells as merchant of record (Stripe Managed Payments).

import { sendEmail } from "./alerts.ts";
import { json } from "./api-auth.ts";
import { hashPassword, passwordProblem, sessionCookie } from "./auth.ts";
import { cleanEmail, cleanName, iso, verifyStripe } from "./core.ts";
import { getMeta, install, newId, type AccountRow, type Env, type PlanRow } from "./db.ts";
import { phonePacks, TOPUP_DAYS } from "./phones.ts";
import { ROBOT_ERROR, turnstileOk } from "./turnstile.ts";

const API = "https://api.stripe.com/v1";

/** Sign-up is open. Free plans work without Stripe; paid plans also need the Stripe keys. */
export const sellingOn = async (env: Env) => (await install(env.DB)).sell;
/** Payments can be taken: sign-up is open and the Stripe key is there. */
export const paymentsOn = async (env: Env) => !!env.STRIPE_SECRET_KEY && (await install(env.DB)).sell;

/** Stripe's API takes form fields, with nested ones as a[b][c]. */
function form(params: Record<string, unknown>, prefix = ""): string[] {
	const out: string[] = [];
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null) continue;
		const key = prefix ? `${prefix}[${k}]` : k;
		if (typeof v === "object") out.push(...form(v as Record<string, unknown>, key));
		else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
	}
	return out;
}

/** The Stripe API version we read and write. Managed Payments checkouts need a newer one (MANAGED_VERSION). */
const VERSION = "2024-06-20";
const MANAGED_VERSION = "2025-03-31.basil";

export async function stripe<T = Record<string, unknown>>(env: Env, path: string, params?: Record<string, unknown>, version = VERSION): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method: params ? "POST" : "GET",
		headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": version },
		body: params ? form(params).join("&") : undefined,
	});
	const data = (await res.json()) as T & { error?: { message?: string } };
	if (!res.ok) throw new Error(data.error?.message ?? `Stripe answered ${res.status}`);
	return data;
}

/** Plans people can choose. Without the Stripe key, only the free ones. */
export async function livePlans(db: D1Database, paid = true): Promise<PlanRow[]> {
	const sql = paid ? "(stripe_price IS NOT NULL OR free = 1)" : "free = 1";
	return (await db.prepare(`SELECT * FROM plans WHERE on_off = 1 AND ${sql} ORDER BY position, name`).all<PlanRow>()).results;
}

export const publicPlan = (p: PlanRow) => ({
	id: p.id, name: p.name, blurb: p.blurb, price: p.price_label, priceYear: p.stripe_price_year ? p.price_label_year : null, free: p.free === 1,
	monitors: p.monitors, minEvery: p.min_every, pages: p.pages, alertsPerDay: p.alerts_per_day, channels: p.channels ?? "all", phoneAlerts: p.phone_alerts ?? 0, fast: p.fast ?? 0, subscribers: p.subscribers ?? 0, subEmails: p.sub_emails ?? 0, subHooks: p.sub_hooks ?? 0, locked: p.locked === 1,
});

/** The free plan clients drop back to when a paid subscription ends, if there is one. */
export const freePlan = async (db: D1Database) => (await db.prepare("SELECT * FROM plans WHERE free = 1 AND on_off = 1 ORDER BY position LIMIT 1").first<PlanRow>()) ?? null;

/** Fits an account's things to a smaller plan: the oldest ones carry on, the rest are paused (kept, not checked). */
export async function fitToPlan(db: D1Database, accountId: string, plan: PlanRow): Promise<void> {
	await db.batch([
		// 30 second checks: the oldest ones the plan allows carry on, the rest go to the plan's fastest.
		db.prepare("UPDATE monitors SET every = ? WHERE account_id = ? AND kind != 'heartbeat' AND every < 1 AND id NOT IN (SELECT id FROM monitors WHERE account_id = ? AND kind != 'heartbeat' AND every < 1 ORDER BY created_at, id LIMIT ?)")
			.bind(plan.min_every, accountId, accountId, plan.fast ?? 0),
		db.prepare("UPDATE monitors SET every = ? WHERE account_id = ? AND kind != 'heartbeat' AND every >= 1 AND every < ?").bind(plan.min_every, accountId, plan.min_every),
		db.prepare("UPDATE monitors SET paused_until = '9999-12-31T00:00:00Z' WHERE account_id = ? AND id NOT IN (SELECT id FROM monitors WHERE account_id = ? ORDER BY created_at, id LIMIT ?)").bind(accountId, accountId, plan.monitors),
	]);
}

/** Free sign-ups and abuse: how many accounts one address may make in a day, and all addresses together. */
const PER_ADDRESS_A_DAY = 3;
export const signupCap = async (db: D1Database) => Number(await getMeta(db, "signup_cap")) || 50;

async function addressHash(request: Request): Promise<string> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`site-watch:${ip}`)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Emails the link that confirms a free sign-up's address. Null when sent, or what went wrong. */
export async function sendVerify(env: Env, a: Pick<AccountRow, "email" | "verify_token">, origin: string): Promise<string | null> {
	const inst = await install(env.DB);
	if (!inst.alertFrom || !a.verify_token) return "email isn't set up";
	const app = inst.brand.name;
	return sendEmail(env, inst.alertFrom, a.email, `Confirm your email for ${app}`,
		`Hello,\n\nPlease confirm this is your email address, so ${app} can start checking your website and send you alerts.\n\n${origin}/verify?token=${a.verify_token}\n\nIf you didn't sign up for ${app}, you can ignore this email and nothing more will be sent.`, app,
		{ button: "Confirm my email", footer: `If the button doesn't work, copy this link into your browser: ${origin}/verify?token=${a.verify_token}` });
}

async function checkout(env: Env, a: AccountRow, plan: PlanRow, origin: string, yearly = false): Promise<string> {
	const price = yearly && plan.stripe_price_year ? plan.stripe_price_year : plan.stripe_price;
	if (!price) throw new Error("this plan has no Stripe price");
	// With Managed Payments, Stripe sells the plan as merchant of record and works out the tax itself.
	const managed = env.STRIPE_MANAGED_PAYMENTS === "on";
	const session = await stripe<{ url: string }>(env, "/checkout/sessions", {
		mode: "subscription",
		...(managed ? { managed_payments: { enabled: "true" } } : {}),
		line_items: { 0: { price, quantity: 1 } },
		client_reference_id: a.id,
		...(a.stripe_customer ? { customer: a.stripe_customer } : { customer_email: a.email }),
		subscription_data: { metadata: { account: a.id, plan: plan.id } },
		metadata: { account: a.id, plan: plan.id },
		allow_promotion_codes: "true",
		success_url: `${origin}/?paid=1`,
		cancel_url: `${origin}/?paid=0`,
	}, managed ? MANAGED_VERSION : VERSION);
	return session.url;
}

/** Routes for clients and Stripe. Null for the rest. `me` is the signed-in account, if any. */
export async function handleBilling(request: Request, env: Env, path: string, url: URL, me: AccountRow | null): Promise<Response | null> {
	const db = env.DB;
	if (path === "/api/plans" && request.method === "GET") {
		if (!(await sellingOn(env))) return json({ plans: [] });
		return json({ plans: (await livePlans(db, !!env.STRIPE_SECRET_KEY)).map(publicPlan) });
	}
	if (path === "/stripe/webhook" && request.method === "POST") return webhook(request, env);
	if (request.method !== "POST") return null;

	if (path === "/api/signup") {
		if (!(await sellingOn(env))) return json({ error: "Sign-up isn't open." }, 403);
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (!(await turnstileOk(env, request, b.ts))) return json({ error: ROBOT_ERROR }, 403);
		const email = cleanEmail(b.email);
		if (!email) return json({ error: "Please enter your email address." }, 400);
		const problem = passwordProblem(b.password);
		if (problem) return json({ error: problem }, 400);
		const plan = (await livePlans(db, !!env.STRIPE_SECRET_KEY)).find((p) => p.id === b.plan);
		if (!plan) return json({ error: "Please choose a plan." }, 400);
		if (await db.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first()) return json({ error: "There's already an account for that email address. Please sign in instead." }, 409);
		// A cap on new accounts a day, so a script can't fill the database, and a smaller one for each address.
		const dayAgo = iso(new Date(Date.now() - 86_400_000));
		const today = await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?").bind(dayAgo).first<{ n: number }>();
		if ((today?.n ?? 0) >= (await signupCap(db))) return json({ error: "Lots of people signed up today. Please try again tomorrow." }, 429);
		const ipHash = await addressHash(request);
		const mine = await db.prepare("SELECT COUNT(*) AS n FROM signups WHERE ip_hash = ? AND at > ?").bind(ipHash, dayAgo).first<{ n: number }>();
		if ((mine?.n ?? 0) >= PER_ADDRESS_A_DAY) return json({ error: "That's a few new accounts from here today. Please try again tomorrow, or sign in to the one you made." }, 429);
		const tz = typeof b.tz === "string" && b.tz.length < 60 ? b.tz : "UTC";
		const a: AccountRow = {
			id: newId(8), email, name: cleanName(b.name, 80), password: await hashPassword(b.password as string), role: "client", plan: plan.id, status: "none",
			stripe_customer: null, stripe_sub: null, period_end: null, alert_to: email, tz, alerts_per_day: 50, session_ver: 0, reset_token: null, reset_until: null,
			verify_token: null, created_at: iso(new Date()),
		};
		// Free plans: the person confirms their email address, then their checks start. Without email set up on this
		// install there's no way to confirm, so a free account starts straight away.
		if (plan.free === 1) {
			const canEmail = !!env.EMAIL && !!(await install(db)).alertFrom;
			a.status = canEmail ? "unverified" : "free";
			a.verify_token = canEmail ? newId(16) : null;
		}
		await db.batch([
			db.prepare("INSERT INTO accounts (id, email, name, password, role, plan, status, alert_to, tz, verify_token, created_at) VALUES (?, ?, ?, ?, 'client', ?, ?, ?, ?, ?, ?)")
				.bind(a.id, a.email, a.name, a.password, a.plan, a.status, a.alert_to, a.tz, a.verify_token, a.created_at),
			db.prepare("INSERT INTO signups (ip_hash, at) VALUES (?, ?)").bind(ipHash, a.created_at),
		]);
		const cookie = { "set-cookie": await sessionCookie(db, a, url.protocol === "https:") };
		if (plan.free === 1) {
			if (a.verify_token) await sendVerify(env, a, url.origin);
			return json({ next: "/", verify: !!a.verify_token }, 200, cookie);
		}
		try {
			return json({ checkout: await checkout(env, a, plan, url.origin, b.yearly === true) }, 200, cookie);
		} catch (e) {
			return json({ error: `We couldn't start the payment: ${e instanceof Error ? e.message : e}` }, 502, cookie);
		}
	}

	if (path === "/api/verify") {
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const token = typeof b.token === "string" && /^[0-9a-f]{32}$/.test(b.token) ? b.token : null;
		const a = token ? await db.prepare("SELECT * FROM accounts WHERE verify_token = ?").bind(token).first<AccountRow>() : null;
		if (!a) return json({ error: "That link has already been used or isn't right. Sign in to see your account." }, 404);
		await db.prepare("UPDATE accounts SET status = CASE status WHEN 'unverified' THEN 'free' ELSE status END, verify_token = NULL WHERE id = ?").bind(a.id).run();
		return json({ ok: true, next: "/" }, 200, me?.id === a.id ? {} : { "set-cookie": await sessionCookie(db, a, url.protocol === "https:") });
	}

	if (!me || me.role !== "client") return null;
	if (path === "/api/verify/again") {
		if (me.status !== "unverified" || !me.verify_token) return json({ error: "Your email address is already confirmed." }, 409);
		const problem = await sendVerify(env, me, url.origin);
		return problem ? json({ error: `We couldn't send the email: ${problem}` }, 502) : json({ ok: true });
	}
	if (path === "/api/billing/topup") {
		// A one off payment for more text and WhatsApp alerts (phones.ts), for paying clients whose plan includes them.
		if (!(await paymentsOn(env))) return json({ error: "Payments aren't switched on." }, 403);
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const pack = (await phonePacks(db))[Number(b.pack)];
		const plan = await db.prepare("SELECT * FROM plans WHERE id = ?").bind(me.plan).first<PlanRow>();
		if (!pack) return json({ error: "Please choose a top up." }, 400);
		if (!(me.status === "active" || me.status === "trialing") || !plan?.phone_alerts) return json({ error: "Top ups are for plans that include text and WhatsApp alerts." }, 403);
		const managed = env.STRIPE_MANAGED_PAYMENTS === "on";
		try {
			const session = await stripe<{ url: string }>(env, "/checkout/sessions", {
				mode: "payment",
				...(managed ? { managed_payments: { enabled: "true" } } : {}),
				line_items: { 0: { price: pack.price, quantity: 1 } },
				client_reference_id: me.id,
				...(me.stripe_customer ? { customer: me.stripe_customer } : { customer_email: me.email }),
				metadata: { account: me.id, phone_alerts: String(pack.alerts) },
				success_url: `${url.origin}/?topup=1#alerts`,
				cancel_url: `${url.origin}/#alerts`,
			}, managed ? MANAGED_VERSION : VERSION);
			return json({ checkout: session.url });
		} catch (e) {
			return json({ error: `We couldn't start the payment: ${e instanceof Error ? e.message : e}` }, 502);
		}
	}
	if (path === "/api/billing/checkout") {
		if (!(await paymentsOn(env))) return json({ error: "Payments aren't switched on." }, 403);
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const plan = (await livePlans(db)).find((p) => p.id === (b.plan ?? me.plan));
		if (!plan) return json({ error: "Please choose a plan." }, 400);
		if (me.status === "active" || me.status === "trialing") return json({ error: "Your plan is already paid. Use Manage billing to change it." }, 409);
		if (plan.free === 1) return json({ error: "That plan is free: there's nothing to pay." }, 400);
		try {
			return json({ checkout: await checkout(env, me, plan, url.origin, b.yearly === true) });
		} catch (e) {
			return json({ error: `We couldn't start the payment: ${e instanceof Error ? e.message : e}` }, 502);
		}
	}
	if (path === "/api/billing/portal") {
		if (!me.stripe_customer) return json({ error: "There's nothing to manage yet: choose a plan first." }, 409);
		try {
			const s = await stripe<{ url: string }>(env, "/billing_portal/sessions", { customer: me.stripe_customer, return_url: `${url.origin}/#account` });
			return json({ portal: s.url });
		} catch (e) {
			return json({ error: `Stripe didn't open the billing page: ${e instanceof Error ? e.message : e}` }, 502);
		}
	}
	return null;
}

interface Sub { id: string; customer: string; status: string; current_period_end?: number; metadata?: Record<string, string>; items?: { data?: { price?: { id?: string }; current_period_end?: number }[] } }

async function webhook(request: Request, env: Env): Promise<Response> {
	const body = await request.text();
	if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripe(env.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature") ?? "", body))) return json({ error: "Bad signature" }, 400);
	const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };
	const db = env.DB;
	const o = event.data.object;
	if (event.type === "checkout.session.completed") {
		const account = (o.client_reference_id as string) ?? (o.metadata as Record<string, string> | undefined)?.account;
		const topup = Number((o.metadata as Record<string, string> | undefined)?.phone_alerts);
		if (account && o.mode === "payment" && o.payment_status === "paid" && Number.isInteger(topup) && topup > 0) {
			// Text and WhatsApp top up: counted once per payment, even if Stripe sends the event again. Lasts a year.
			const r = await db.prepare("INSERT OR IGNORE INTO phone_topups (session_id, account_id, alerts, at) VALUES (?, ?, ?, ?)").bind(String(o.id), account, topup, iso(new Date())).run();
			if ((r.meta.changes ?? 0) > 0) {
				await db.prepare("UPDATE accounts SET phone_credits = CASE WHEN phone_credits_until IS NULL OR phone_credits_until < ? THEN 0 ELSE phone_credits END + ?, phone_credits_until = ? WHERE id = ?")
					.bind(iso(new Date()), topup, iso(new Date(Date.now() + TOPUP_DAYS * 86_400_000)), account).run();
			}
		}
		if (account && typeof o.subscription === "string") {
			const sub = await stripe<Sub>(env, `/subscriptions/${o.subscription}`);
			await saveSub(db, account, sub);
		}
	} else if (event.type.startsWith("customer.subscription.")) {
		const sub = o as unknown as Sub;
		const account = sub.metadata?.account ?? (await db.prepare("SELECT id FROM accounts WHERE stripe_sub = ? OR stripe_customer = ?").bind(sub.id, sub.customer).first<{ id: string }>())?.id;
		if (account) await saveSub(db, account, event.type === "customer.subscription.deleted" ? { ...sub, status: "canceled" } : sub);
	}
	return json({ received: true });
}

/** Stripe's statuses that mean the subscription has ended for good. */
const ENDED = ["canceled", "incomplete_expired", "unpaid"];

async function saveSub(db: D1Database, account: string, sub: Sub): Promise<void> {
	const price = sub.items?.data?.[0]?.price?.id;
	const plan = price ? await db.prepare("SELECT id FROM plans WHERE stripe_price = ? OR stripe_price_year = ?").bind(price, price).first<{ id: string }>() : null;
	// With a free plan on offer, a client whose subscription ends drops back to it rather than being held.
	const free = ENDED.includes(sub.status) ? await freePlan(db) : null;
	if (free) {
		await db.prepare("UPDATE accounts SET stripe_customer = ?, stripe_sub = NULL, status = 'free', plan = ?, period_end = NULL WHERE id = ? AND role = 'client'").bind(sub.customer, free.id, account).run();
		await fitToPlan(db, account, free);
		return;
	}
	// Newer Stripe versions (such as a new webhook endpoint's) keep the period end on the subscription item.
	const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
	await db.prepare("UPDATE accounts SET stripe_customer = ?, stripe_sub = ?, status = ?, plan = COALESCE(?, plan), period_end = ? WHERE id = ? AND role = 'client'")
		.bind(sub.customer, sub.id, sub.status, plan?.id ?? sub.metadata?.plan ?? null, periodEnd ? iso(new Date(periodEnd * 1000)) : null, account).run();
	// Moving up from a smaller plan: things paused to fit it carry on.
	if (sub.status === "active" || sub.status === "trialing") await db.prepare("UPDATE monitors SET paused_until = NULL WHERE account_id = ? AND paused_until = '9999-12-31T00:00:00Z'").bind(account).run();
}
