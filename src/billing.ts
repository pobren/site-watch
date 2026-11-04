// Sell to clients (off until the owner switches it on): clients sign up on /signup, pick one of the owner's plans
// and pay by Stripe Checkout with the owner's own Stripe account. Stripe tells us by webhook when a subscription
// starts, changes or ends, and a client's checks only run while it's paid. Cards, receipts, invoices, refunds and
// cancelling are all Stripe's: clients manage theirs in Stripe's billing portal from their Account tab.
//
// Secrets on the Worker: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The webhook address is /stripe/webhook.

import { json } from "./api-auth.ts";
import { hashPassword, passwordProblem, sessionCookie } from "./auth.ts";
import { cleanEmail, cleanName, iso, verifyStripe } from "./core.ts";
import { install, newId, type AccountRow, type Env, type PlanRow } from "./db.ts";

const API = "https://api.stripe.com/v1";

export const sellingOn = async (env: Env) => !!env.STRIPE_SECRET_KEY && (await install(env.DB)).sell;

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

export async function stripe<T = Record<string, unknown>>(env: Env, path: string, params?: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method: params ? "POST" : "GET",
		headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2024-06-20" },
		body: params ? form(params).join("&") : undefined,
	});
	const data = (await res.json()) as T & { error?: { message?: string } };
	if (!res.ok) throw new Error(data.error?.message ?? `Stripe answered ${res.status}`);
	return data;
}

export async function livePlans(db: D1Database): Promise<PlanRow[]> {
	return (await db.prepare("SELECT * FROM plans WHERE on_off = 1 AND stripe_price IS NOT NULL ORDER BY position, name").all<PlanRow>()).results;
}

export const publicPlan = (p: PlanRow) => ({ id: p.id, name: p.name, blurb: p.blurb, price: p.price_label, monitors: p.monitors, minEvery: p.min_every, pages: p.pages });

async function checkout(env: Env, a: AccountRow, plan: PlanRow, origin: string): Promise<string> {
	const session = await stripe<{ url: string }>(env, "/checkout/sessions", {
		mode: "subscription",
		line_items: { 0: { price: plan.stripe_price, quantity: 1 } },
		client_reference_id: a.id,
		...(a.stripe_customer ? { customer: a.stripe_customer } : { customer_email: a.email }),
		subscription_data: { metadata: { account: a.id, plan: plan.id } },
		metadata: { account: a.id, plan: plan.id },
		allow_promotion_codes: "true",
		success_url: `${origin}/?paid=1`,
		cancel_url: `${origin}/?paid=0`,
	});
	return session.url;
}

/** Routes for clients and Stripe. Null for the rest. `me` is the signed-in account, if any. */
export async function handleBilling(request: Request, env: Env, path: string, url: URL, me: AccountRow | null): Promise<Response | null> {
	const db = env.DB;
	if (path === "/api/plans" && request.method === "GET") {
		if (!(await sellingOn(env))) return json({ plans: [] });
		return json({ plans: (await livePlans(db)).map(publicPlan) });
	}
	if (path === "/stripe/webhook" && request.method === "POST") return webhook(request, env);
	if (request.method !== "POST") return null;

	if (path === "/api/signup") {
		if (!(await sellingOn(env))) return json({ error: "Sign-up isn't open." }, 403);
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const email = cleanEmail(b.email);
		if (!email) return json({ error: "Please enter your email address." }, 400);
		const problem = passwordProblem(b.password);
		if (problem) return json({ error: problem }, 400);
		const plan = (await livePlans(db)).find((p) => p.id === b.plan);
		if (!plan) return json({ error: "Please choose a plan." }, 400);
		if (await db.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first()) return json({ error: "There's already an account for that email address. Please sign in instead." }, 409);
		// A cap on new accounts a day, so a script can't fill the database.
		const today = await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?").bind(iso(new Date(Date.now() - 86_400_000))).first<{ n: number }>();
		if ((today?.n ?? 0) >= 50) return json({ error: "Lots of people signed up today. Please try again tomorrow." }, 429);
		const tz = typeof b.tz === "string" && b.tz.length < 60 ? b.tz : "UTC";
		const a: AccountRow = {
			id: newId(8), email, name: cleanName(b.name, 80), password: await hashPassword(b.password as string), role: "client", plan: plan.id, status: "none",
			stripe_customer: null, stripe_sub: null, period_end: null, alert_to: email, tz, alerts_per_day: 50, session_ver: 0, reset_token: null, reset_until: null, created_at: iso(new Date()),
		};
		await db.prepare("INSERT INTO accounts (id, email, name, password, role, plan, status, alert_to, tz, created_at) VALUES (?, ?, ?, ?, 'client', ?, 'none', ?, ?, ?)")
			.bind(a.id, a.email, a.name, a.password, a.plan, a.alert_to, a.tz, a.created_at).run();
		try {
			return json({ checkout: await checkout(env, a, plan, url.origin) }, 200, { "set-cookie": await sessionCookie(db, a, url.protocol === "https:") });
		} catch (e) {
			return json({ error: `We couldn't start the payment: ${e instanceof Error ? e.message : e}` }, 502, { "set-cookie": await sessionCookie(db, a, url.protocol === "https:") });
		}
	}

	if (!me || me.role !== "client") return null;
	if (path === "/api/billing/checkout") {
		if (!(await sellingOn(env))) return json({ error: "Payments aren't switched on." }, 403);
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const plan = (await livePlans(db)).find((p) => p.id === (b.plan ?? me.plan));
		if (!plan) return json({ error: "Please choose a plan." }, 400);
		if (me.status === "active" || me.status === "trialing") return json({ error: "Your plan is already paid. Use Manage billing to change it." }, 409);
		try {
			return json({ checkout: await checkout(env, me, plan, url.origin) });
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

interface Sub { id: string; customer: string; status: string; current_period_end?: number; metadata?: Record<string, string>; items?: { data?: { price?: { id?: string } }[] } }

async function webhook(request: Request, env: Env): Promise<Response> {
	const body = await request.text();
	if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripe(env.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature") ?? "", body))) return json({ error: "Bad signature" }, 400);
	const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };
	const db = env.DB;
	const o = event.data.object;
	if (event.type === "checkout.session.completed") {
		const account = (o.client_reference_id as string) ?? (o.metadata as Record<string, string> | undefined)?.account;
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

async function saveSub(db: D1Database, account: string, sub: Sub): Promise<void> {
	const price = sub.items?.data?.[0]?.price?.id;
	const plan = price ? await db.prepare("SELECT id FROM plans WHERE stripe_price = ?").bind(price).first<{ id: string }>() : null;
	await db.prepare("UPDATE accounts SET stripe_customer = ?, stripe_sub = ?, status = ?, plan = COALESCE(?, plan), period_end = ? WHERE id = ? AND role = 'client'")
		.bind(sub.customer, sub.id, sub.status, plan?.id ?? sub.metadata?.plan ?? null, sub.current_period_end ? iso(new Date(sub.current_period_end * 1000)) : null, account).run();
}
