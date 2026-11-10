// Billing inside the app (1.16.0). Clients see their plan, receipts and card on the Account tab, change or cancel
// their plan, and update their card on Stripe's own secure page. The owner sees each client's history and payments
// on the Admin tab, and refunds a payment in full or in part. Card numbers never reach this Worker: everything
// about money is read from Stripe when a page asks for it, so nothing extra runs in the background.

import type { Sub } from "./billing.ts";
import { logEvent, type AccountRow, type Env, type PlanRow } from "./db.ts";
import { syncSeats, teamOf } from "./team.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (error: string, status = 400) => json({ error }, status);

// Billing (and the email module behind it) is loaded when needed, so this file's sums can be tested on their own.
const B = () => import("./billing.ts");
const stripe = async <T = Record<string, unknown>>(env: Env, path: string, params?: Record<string, unknown>): Promise<T> => (await B()).stripe<T>(env, path, params);

/** A Stripe GET with query parameters (nested ones as a[b]). */
const get = async <T>(env: Env, path: string, params: Record<string, unknown>) => stripe<T>(env, `${path}?${(await B()).form(params).join("&")}`);

interface Price { id: string; unit_amount: number | null; currency: string; recurring?: { interval: string } | null }
interface Item { id: string; quantity: number; price: Price }
interface FullSub extends Sub { cancel_at_period_end?: boolean; default_payment_method?: Card | null; items: { data: Item[] } & Sub["items"] }
interface Card { card?: { brand: string; last4: string; exp_month: number; exp_year: number } }
interface Charge { id: string; amount: number; amount_refunded: number; currency: string; created: number; status: string; refunded: boolean; description: string | null; receipt_url: string | null; customer: string | null; invoice: string | null; failure_message: string | null; refunds?: { data: Refund[] } }
interface Refund { id: string; amount: number; created: number; status: string; reason: string | null; metadata?: Record<string, string> }
interface Invoice { id: string; number: string | null; created: number; total: number; amount_paid: number; currency: string; status: string; invoice_pdf: string | null; hosted_invoice_url: string | null; charge: Charge | string | null; lines?: { data: { description: string | null; proration?: boolean; amount: number; price?: { recurring?: { interval: string } | null } | null }[] } }

/** Turns "2.50", "£2.50" or "2" into pence (or cents). Null if it isn't a sensible amount. */
export function toMinor(v: unknown): number | null {
	const s = String(v ?? "").replace(/[£$€,\s]/g, "");
	if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
	const n = Math.round(Number(s) * 100);
	return n > 0 ? n : null;
}

/** How much a refund can be: all that's left of the payment, or the part asked for if that's no more. */
export function refundable(c: Pick<Charge, "amount" | "amount_refunded" | "status" | "currency">, asked: number | null): { amount: number } | { error: string } {
	const left = c.amount - c.amount_refunded;
	if (c.status !== "succeeded") return { error: "Only a payment that went through can be refunded." };
	if (left <= 0) return { error: "That payment has already been refunded in full." };
	if (asked === null) return { amount: left };
	if (asked > left) return { error: `That's more than is left to refund (${money(left, c.currency)} at most).` };
	return { amount: asked };
}

export const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);

/** What changing plan costs today, from Stripe's preview: the part of this period on the new plan less what's unused
 *  on the old one. Moving between monthly and yearly starts a new period, so the new plan's own price is due too. */
export function dueToday(lines: { proration?: boolean; amount: number }[], newPeriod: boolean): number {
	return lines.reduce((sum, l) => sum + (l.proration || newPeriod ? l.amount : 0), 0);
}

/** Whether the team fits the plan being moved to, counting the account's own login. */
export function teamFits(logins: number, plan: Pick<PlanRow, "seats" | "seat_price" | "seat_price_year">): boolean {
	return logins <= Math.max(1, plan.seats ?? 0) || !!(plan.seat_price || plan.seat_price_year);
}

const plainCard = (pm: Card | null | undefined) => (pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, expires: `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}` } : null);
const isoOf = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function loadSub(env: Env, me: AccountRow): Promise<FullSub | null> {
	if (!me.stripe_sub) return null;
	return get<FullSub>(env, `/subscriptions/${me.stripe_sub}`, { expand: ["default_payment_method"] }).catch(() => null);
}

/** The plan and seat items on a subscription, and whether it's yearly. */
async function partsOf(db: D1Database, sub: FullSub) {
	let plan: PlanRow | null = null, planItem: Item | null = null;
	for (const it of sub.items.data) {
		plan = await db.prepare("SELECT * FROM plans WHERE stripe_price = ? OR stripe_price_year = ?").bind(it.price.id, it.price.id).first<PlanRow>();
		if (plan) { planItem = it; break; }
	}
	const seatItem = plan ? sub.items.data.find((i) => i.price.id === plan!.seat_price || i.price.id === plan!.seat_price_year) ?? null : null;
	return { plan, planItem, seatItem, yearly: planItem?.price.recurring?.interval === "year" };
}

/** The subscription items for moving to another plan: the plan's price swapped, and extra logins moved to the new
 *  plan's matching price, or dropped when it has none. */
function newItems(to: PlanRow, yearly: boolean, planItem: Item, seatItem: Item | null): Record<string, unknown> {
	const items: Record<string, unknown> = { 0: { id: planItem.id, price: yearly ? to.stripe_price_year : to.stripe_price } };
	if (seatItem) {
		const seat = (yearly ? to.seat_price_year : to.seat_price) || null;
		items[1] = seat ? { id: seatItem.id, price: seat } : { id: seatItem.id, deleted: "true" };
	}
	return items;
}

/** Client routes under /api/billing/ (the account's own login only: team.ts stops members first). */
async function client(request: Request, env: Env, path: string, url: URL, me: AccountRow): Promise<Response | null> {
	const db = env.DB;
	const method = request.method;
	if (path === "/api/billing/summary" && method === "GET") {
		if (!me.stripe_customer) return json({ billing: false });
		const [sub, invoices, customer] = await Promise.all([
			loadSub(env, me),
			get<{ data: Invoice[] }>(env, "/invoices", { customer: me.stripe_customer, limit: 24, expand: ["data.charge"] }).catch(() => ({ data: [] as Invoice[] })),
			get<{ invoice_settings?: { default_payment_method?: Card | null } }>(env, `/customers/${me.stripe_customer}`, { expand: ["invoice_settings.default_payment_method"] }).catch(() => null),
		]);
		const parts = sub ? await partsOf(db, sub) : null;
		const team = await teamOf(db, me.id);
		return json({
			billing: true,
			plan: parts?.plan ? { id: parts.plan.id, name: parts.plan.name } : null,
			yearly: !!parts?.yearly,
			price: parts?.planItem?.price.unit_amount != null ? money(parts.planItem.price.unit_amount, parts.planItem.price.currency) : null,
			status: sub?.status ?? null,
			renews: sub && (sub.current_period_end ?? sub.items.data[0]?.current_period_end) ? isoOf((sub.current_period_end ?? sub.items.data[0]?.current_period_end)!) : null,
			ending: !!sub?.cancel_at_period_end,
			extraLogins: parts?.seatItem ? { count: parts.seatItem.quantity, each: parts.seatItem.price.unit_amount != null ? money(parts.seatItem.price.unit_amount, parts.seatItem.price.currency) : null } : null,
			logins: 1 + team.filter((m) => m.role !== "alerts").length,
			card: plainCard(sub?.default_payment_method) ?? plainCard(customer?.invoice_settings?.default_payment_method),
			receipts: invoices.data.filter((i) => i.status !== "draft").map((i) => {
				const ch = i.charge && typeof i.charge === "object" ? i.charge : null;
				return {
					id: i.id, number: i.number, date: isoOf(i.created), amount: money(i.total, i.currency), status: i.status,
					refunded: ch && ch.amount_refunded ? (ch.refunded ? "Refunded" : `${money(ch.amount_refunded, ch.currency)} refunded`) : null,
					pdf: i.invoice_pdf, link: i.hosted_invoice_url, what: i.lines?.data?.find((l) => !l.proration)?.description ?? i.lines?.data?.[0]?.description ?? null,
				};
			}),
		});
	}
	if (method !== "POST") return null;
	const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

	if (path === "/api/billing/card") {
		if (!me.stripe_customer) return bad("There's no card to change yet: choose a plan first.", 409);
		try {
			const s = await stripe<{ url: string }>(env, "/billing_portal/sessions", { customer: me.stripe_customer, return_url: `${url.origin}/#account`, flow_data: { type: "payment_method_update", after_completion: { type: "redirect", redirect: { return_url: `${url.origin}/?card=1#account` } } } });
			return json({ go: s.url });
		} catch (e) {
			return bad(`Stripe didn't open the card page: ${e instanceof Error ? e.message : e}`, 502);
		}
	}

	if (path === "/api/billing/preview" || path === "/api/billing/change") {
		const sub = await loadSub(env, me);
		if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) return bad("There's no paid plan to change. Choose one below instead.", 409);
		const parts = await partsOf(db, sub);
		const to = (await (await B()).livePlans(db)).find((p) => p.id === b.plan && p.free !== 1);
		const yearly = b.yearly === true;
		if (!to || !parts.planItem) return bad("Please choose a plan.");
		if (!(yearly ? to.stripe_price_year : to.stripe_price)) return bad(`${to.name} isn't sold ${yearly ? "yearly" : "monthly"}.`);
		if (to.id === parts.plan?.id && yearly === parts.yearly) return bad("You're already on that plan.");
		const team = await teamOf(db, me.id);
		const logins = 1 + team.filter((m) => m.role !== "alerts").length;
		if (!teamFits(logins, to)) return bad(`${to.name} includes ${Math.max(1, to.seats ?? 0) === 1 ? "just your own login" : Math.max(1, to.seats ?? 0) + " logins"}. Please remove team logins on the Team card first.`, 409);
		const items = newItems(to, yearly, parts.planItem, parts.seatItem);
		const newPeriod = yearly !== parts.yearly;
		if (path === "/api/billing/preview") {
			try {
				const now = Math.floor(Date.now() / 1000);
				const inv = await get<Invoice & { amount_due: number }>(env, "/invoices/upcoming", { customer: me.stripe_customer, subscription: sub.id, subscription_items: items, subscription_proration_behavior: "always_invoice", subscription_proration_date: now });
				const today = Math.max(0, dueToday(inv.lines?.data ?? [], newPeriod));
				const price = await stripe<Price>(env, `/prices/${yearly ? to.stripe_price_year : to.stripe_price}`);
				return json({ today: money(today, inv.currency), credit: dueToday(inv.lines?.data ?? [], newPeriod) < 0, then: price.unit_amount != null ? `${money(price.unit_amount, price.currency)} a ${yearly ? "year" : "month"}` : null, plan: to.name });
			} catch (e) {
				return bad(`Stripe couldn't work out the cost: ${e instanceof Error ? e.message : e}`, 502);
			}
		}
		try {
			// The difference is charged now. If the card is declined, nothing changes (pending_if_incomplete).
			const updated = await stripe<FullSub>(env, `/subscriptions/${sub.id}`, { items, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
			await (await B()).saveSub(env, me.id, updated);
			await (await B()).fitToPlan(db, me.id, to);
			const fresh = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(me.id).first<AccountRow>();
			if (fresh) await syncSeats(env, fresh).catch((e) => console.error("team seats", e));
			return json({ ok: true, plan: to.name });
		} catch (e) {
			return bad(`The change didn't go through: ${e instanceof Error ? e.message : e}`, 402);
		}
	}

	if (path === "/api/billing/cancel" || path === "/api/billing/resume") {
		if (!me.stripe_sub) return bad("There's no plan to cancel.", 409);
		const ending = path === "/api/billing/cancel";
		try {
			const sub = await stripe<FullSub>(env, `/subscriptions/${me.stripe_sub}`, { cancel_at_period_end: ending ? "true" : "false" });
			await logEvent(db, me.id, ending ? "cancel" : "resume", ending ? "Cancelled the plan, to end when the paid period does" : "Kept the plan after cancelling");
			return json({ ok: true, ending: !!sub.cancel_at_period_end });
		} catch (e) {
			return bad(`Stripe didn't make the change: ${e instanceof Error ? e.message : e}`, 502);
		}
	}
	return null;
}

/** Admin routes for one client: their history and payments, and refunds. */
async function owner(request: Request, env: Env, path: string): Promise<Response | null> {
	const m = /^\/api\/admin\/clients\/([0-9a-f]{16})\/(billing|refund)$/.exec(path);
	if (!m) return null;
	const db = env.DB;
	const c = await db.prepare("SELECT * FROM accounts WHERE id = ? AND role = 'client'").bind(m[1]).first<AccountRow>();
	if (!c) return bad("We couldn't find that client.", 404);

	if (m[2] === "billing" && request.method === "GET") {
		const [events, charges, sub] = await Promise.all([
			db.prepare("SELECT at, kind, text FROM billing_events WHERE account_id = ? ORDER BY at DESC, id DESC LIMIT 200").bind(c.id).all<{ at: string; kind: string; text: string }>(),
			c.stripe_customer && env.STRIPE_SECRET_KEY ? get<{ data: Charge[] }>(env, "/charges", { customer: c.stripe_customer, limit: 50, expand: ["data.refunds"] }).then((r) => r.data).catch(() => null) : Promise.resolve([] as Charge[]),
			loadSub(env, c),
		]);
		const payments = (charges ?? []).map((ch) => ({
			id: ch.id, at: isoOf(ch.created), amount: money(ch.amount, ch.currency), status: ch.status, what: ch.description, receipt: ch.receipt_url, failed: ch.failure_message,
			refunded: ch.amount_refunded ? money(ch.amount_refunded, ch.currency) : null, left: ch.status === "succeeded" ? (ch.amount - ch.amount_refunded) / 100 : 0,
			refunds: (ch.refunds?.data ?? []).map((r) => ({ at: isoOf(r.created), amount: money(r.amount, ch.currency), status: r.status, note: r.metadata?.note ?? null })),
		}));
		// Totals in each currency the client paid in.
		const totals: Record<string, { paid: number; refunded: number }> = {};
		for (const ch of charges ?? []) if (ch.status === "succeeded") { const t = (totals[ch.currency] ??= { paid: 0, refunded: 0 }); t.paid += ch.amount; t.refunded += ch.amount_refunded; }
		// Payments and refunds from Stripe go into the history beside what happened here.
		const history = [
			// Refunds made here are in Stripe's list too, so they're only shown from ours when Stripe didn't answer.
			...events.results.filter((e) => e.kind !== "refund" || charges === null).map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
			...(charges ?? []).map((ch) => ({ at: isoOf(ch.created), kind: ch.status === "succeeded" ? "paid" : "failed", text: ch.status === "succeeded" ? `Paid ${money(ch.amount, ch.currency)}${ch.description ? ` (${ch.description})` : ""}` : `Payment of ${money(ch.amount, ch.currency)} failed${ch.failure_message ? `: ${ch.failure_message}` : ""}` })),
			...(charges ?? []).flatMap((ch) => (ch.refunds?.data ?? []).map((r) => ({ at: isoOf(r.created), kind: "refund", text: `Refunded ${money(r.amount, ch.currency)}${r.metadata?.note ? ` (${r.metadata.note})` : ""}` }))),
		].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
		const parts = sub ? await partsOf(db, sub) : null;
		return json({
			client: { id: c.id, email: c.email, name: c.name, status: c.status, joined: c.created_at, stripe: c.stripe_customer, stripeLink: c.stripe_customer ? `https://dashboard.stripe.com/customers/${c.stripe_customer}` : null },
			plan: parts?.plan?.name ?? null, yearly: !!parts?.yearly, ending: !!sub?.cancel_at_period_end, subStatus: sub?.status ?? null,
			stripeError: charges === null ? "Stripe didn't answer, so payments aren't shown. Please try again." : null,
			totals: Object.entries(totals).map(([cur, t]) => ({ paid: money(t.paid, cur), refunded: money(t.refunded, cur), kept: money(t.paid - t.refunded, cur) })),
			payments, history,
		});
	}

	if (m[2] === "refund" && request.method === "POST") {
		const b = await request.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (!c.stripe_customer || !env.STRIPE_SECRET_KEY) return bad("This client has no payments in Stripe.", 409);
		const id = typeof b.payment === "string" && /^(ch|py)_[A-Za-z0-9]{6,64}$/.test(b.payment) ? b.payment : null;
		if (!id) return bad("Please choose a payment.");
		let ch: Charge;
		try {
			ch = await stripe<Charge>(env, `/charges/${id}`);
		} catch {
			return bad("We couldn't find that payment in Stripe.", 404);
		}
		// Only this client's own payments.
		if (ch.customer !== c.stripe_customer) return bad("That payment isn't this client's.", 403);
		const asked = b.amount === undefined || b.amount === null || b.amount === "" ? null : toMinor(b.amount);
		if (b.amount !== undefined && b.amount !== null && b.amount !== "" && asked === null) return bad("Please enter an amount such as 2.50, or leave it empty to refund it all.");
		const r = refundable(ch, asked);
		if ("error" in r) return bad(r.error, 409);
		const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
		const end = b.end === "now" || b.end === "period" ? b.end : null;
		try {
			await stripe(env, "/refunds", { charge: ch.id, amount: r.amount, reason: "requested_by_customer", metadata: note ? { note } : undefined });
		} catch (e) {
			return bad(`Stripe didn't make the refund: ${e instanceof Error ? e.message : e}`, 502);
		}
		const full = r.amount === ch.amount - ch.amount_refunded;
		await logEvent(db, c.id, "refund", `${full ? "Refunded in full" : "Part refund"}: ${money(r.amount, ch.currency)}${note ? ` (${note})` : ""}`);
		// Optionally end the plan: straight away (back to the free plan, or held), or when the paid period ends.
		if (end && c.stripe_sub) {
			try {
				if (end === "now") {
					const res = await fetch(`https://api.stripe.com/v1/subscriptions/${c.stripe_sub}`, { method: "DELETE", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
					const sub = (await res.json()) as Sub & { error?: { message?: string } };
					if (!res.ok) throw new Error(sub.error?.message ?? `Stripe answered ${res.status}`);
					await (await B()).saveSub(env, c.id, { ...sub, status: "canceled" });
					await logEvent(db, c.id, "cancel", "Plan ended straight away by you");
				} else {
					await stripe(env, `/subscriptions/${c.stripe_sub}`, { cancel_at_period_end: "true" });
					await logEvent(db, c.id, "cancel", "Plan set to end when the paid period does, by you");
				}
			} catch (e) {
				return json({ ok: true, refunded: money(r.amount, ch.currency), warning: `The refund went through, but the plan wasn't ended: ${e instanceof Error ? e.message : e}` });
			}
		}
		return json({ ok: true, refunded: money(r.amount, ch.currency) });
	}
	return null;
}

/** Routes for billing in the app. Null for the rest. */
export async function handleMoney(request: Request, env: Env, path: string, url: URL, me: AccountRow): Promise<Response | null> {
	if (!env.STRIPE_SECRET_KEY) return null;
	if (me.role === "client" && path.startsWith("/api/billing/")) return client(request, env, path, url, me);
	if (me.role === "owner" && !me.member && path.startsWith("/api/admin/clients/")) return owner(request, env, path);
	return null;
}

