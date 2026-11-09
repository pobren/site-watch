// Team logins and people who only get alerts (1.14.0).
//
// - Admins can do everything in the account except billing, the team, API keys and deleting the account.
// - Viewers can look at everything but not change anything.
// - Alert-only people have no login: they confirm their email address once and then get the account's alert emails.
//
// Plans set how many logins are included, counting the account's own (seats), the Stripe prices for each extra
// login (added as a second item on the same subscription, monthly or yearly to match), and how many alert-only
// people there may be. The owner of the install has no limits.

import type { MemberRow } from "./auth.ts";
import { cleanEmail, cleanName, iso } from "./core.ts";
import { install, newId, planById, type AccountRow, type Env, type PlanRow } from "./db.ts";

export const ROLES = ["admin", "viewer", "alerts"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_WORDS: Record<Role, string> = { admin: "Admin", viewer: "Viewer", alerts: "Alerts only" };
const INVITE_DAYS = 7;

export interface TeamLimits { seats: number | null; alertPeople: number | null; extraPrice: string | null }

/** Logins included (counting the account's own), alert-only people, and the price of an extra login. Null: no limit. */
export async function teamLimits(db: D1Database, a: Pick<AccountRow, "role" | "plan" | "stripe_sub">, yearly = false): Promise<TeamLimits> {
	if (a.role === "owner") return { seats: null, alertPeople: null, extraPrice: null };
	const p = await planById(db, a.plan);
	if (!p || p.free === 1) return { seats: 1, alertPeople: 0, extraPrice: null };
	return { seats: Math.max(1, p.seats ?? 0), alertPeople: p.alert_people ?? 0, extraPrice: (yearly ? p.seat_price_year : p.seat_price) || null };
}

/** What a team member may do. Null when they may; otherwise the reason. The account's own login may do anything. */
export function memberMay(a: Pick<AccountRow, "member">, method: string, path: string): string | null {
	const m = a.member;
	if (!m) return null;
	if (method === "GET") return null;
	// Their own name, alerts and password are theirs to change (the password is handled before this).
	if (path === "/api/settings") return null;
	// Their own app: alerts on it, and signing it out.
	if (path === "/api/app/push" || path === "/api/app/signout") return null;
	if (m.role === "viewer") return "Your login can look at everything but not change it. Ask the account's owner if you need to.";
	if (/^\/api\/(team|keys|billing|account|admin|app\/(devices|qr)|live-link|connector)(\/|$)/.test(path)) return "Only the account's owner can change this.";
	return null;
}

export const memberView = (m: MemberRow) => ({ id: m.id, email: m.email, name: m.name, role: m.role, alerts: m.alerts === 1 || m.role === "alerts", accepted: !!m.accepted_at, invitedAt: m.created_at });

export async function teamOf(db: D1Database, accountId: string): Promise<MemberRow[]> {
	return (await db.prepare("SELECT * FROM members WHERE account_id = ? ORDER BY created_at").bind(accountId).all<MemberRow>()).results;
}

/** Email addresses that get the account's alert emails as well as its own: alert-only people and members who asked. */
export async function alertPeople(db: D1Database, accountId: string): Promise<string[]> {
	const { results } = await db.prepare("SELECT email FROM members WHERE account_id = ? AND accepted_at IS NOT NULL AND (role = 'alerts' OR alerts = 1)").bind(accountId).all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }));
	return results.map((r) => r.email);
}

const logins = (team: MemberRow[]) => 1 + team.filter((m) => m.role !== "alerts").length;

/** Whether the account's Stripe subscription is yearly (its plan item is the plan's yearly price). */
// Billing (and the email module behind it) is loaded when needed, so this file's checks can be tested on their own.
const stripe = async <T = Record<string, unknown>>(env: Env, path: string, params?: Record<string, unknown>): Promise<T> => (await import("./billing.ts")).stripe<T>(env, path, params);

async function subscription(env: Env, a: AccountRow): Promise<{ yearly: boolean; items: { id: string; price: string; quantity: number }[] } | null> {
	if (!a.stripe_sub || !env.STRIPE_SECRET_KEY) return null;
	const sub = await stripe<{ items: { data: { id: string; quantity: number; price: { id: string } }[] } }>(env, `/subscriptions/${a.stripe_sub}`);
	const plan = await planById(env.DB, a.plan);
	const items = sub.items.data.map((i) => ({ id: i.id, price: i.price.id, quantity: i.quantity }));
	return { yearly: !!plan?.stripe_price_year && items.some((i) => i.price === plan.stripe_price_year), items };
}

/** Sets the extra logins item on the subscription to however many logins are over what the plan includes. */
export async function syncSeats(env: Env, a: AccountRow): Promise<void> {
	if (a.role === "owner") return;
	const sub = await subscription(env, a);
	if (!sub) return;
	const plan = await planById(env.DB, a.plan);
	if (!plan) return;
	const price = (sub.yearly ? plan.seat_price_year : plan.seat_price) || null;
	const extra = Math.max(0, logins(await teamOf(env.DB, a.id)) - Math.max(1, plan.seats ?? 0));
	const item = sub.items.find((i) => i.price === plan.seat_price || i.price === plan.seat_price_year);
	if (item && !extra) {
		await fetch(`https://api.stripe.com/v1/subscription_items/${item.id}?proration_behavior=create_prorations`, { method: "DELETE", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
	} else if (item && item.quantity !== extra) {
		await stripe(env, `/subscription_items/${item.id}`, { quantity: extra, proration_behavior: "create_prorations" });
	} else if (!item && extra && price) {
		await stripe(env, "/subscription_items", { subscription: a.stripe_sub, price, quantity: extra, proration_behavior: "create_prorations" });
	}
}

/** Everything under /api/team, for the account's own login only (memberMay stops members first). */
export async function handleTeam(request: Request, env: Env, me: AccountRow, path: string, method: string, b: Record<string, unknown>, origin: string): Promise<{ error: string; status: number } | null> {
	const db = env.DB;
	const team = await teamOf(db, me.id);
	if (path === "/api/team" && method === "POST") {
		const email = cleanEmail(b.email);
		if (!email) return { error: "Please enter their whole email address, such as sam@example.com.", status: 400 };
		const role = ROLES.includes(b.role as Role) ? (b.role as Role) : "viewer";
		if (email === me.email.toLowerCase()) return { error: "That's your own address.", status: 400 };
		if (team.some((m) => m.email === email)) return { error: "They're already on your team.", status: 409 };
		if (await db.prepare("SELECT 1 FROM members WHERE email = ? UNION SELECT 1 FROM accounts WHERE email = ?").bind(email, email).first())
			return { error: "That address already has its own login here, so it can't join another team. Please use a different address.", status: 409 };
		const sub = role === "alerts" ? null : await subscription(env, me).catch(() => null);
		const lim = await teamLimits(db, me, sub?.yearly ?? false);
		if (role === "alerts") {
			if (lim.alertPeople !== null && team.filter((m) => m.role === "alerts").length >= lim.alertPeople)
				return { error: lim.alertPeople ? `Your plan includes ${lim.alertPeople} people who only get alerts.` : "Your plan doesn't include people who only get alerts. Upgrade on the Account tab to add them.", status: 403 };
		} else if (lim.seats !== null && logins(team) >= lim.seats && !(lim.extraPrice && me.stripe_sub)) {
			return { error: lim.seats > 1 ? `Your plan includes ${lim.seats} logins, counting yours.` : "Your plan doesn't include team logins. Upgrade on the Account tab to add them.", status: 403 };
		}
		const inst = await install(db);
		if (!inst.alertFrom) return { error: "Email isn't set up yet, so we can't send the invitation.", status: 503 };
		const token = newId(24);
		const name = cleanName(b.name, 80);
		await db.prepare("INSERT INTO members (id, account_id, email, name, role, alerts, token, token_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(newId(8), me.id, email, name, role, role === "alerts" ? 1 : 0, token, iso(new Date(Date.now() + INVITE_DAYS * 86_400_000)), iso(new Date())).run();
		const who = me.name || me.email;
		const { sendEmail } = await import("./alerts.ts");
		const link = role === "alerts" ? `${origin}/team/alerts/${token}` : `${origin}/reset?token=${token}&join=1`;
		const problem = role === "alerts"
			? await sendEmail(env, inst.alertFrom, email, `${who} would like to send you ${inst.brand.name} alerts`, `${who} would like you to get an email when one of their websites or services goes down, and when it's back.\n\nYes, send me alerts: ${link}\n\nIf you'd rather not, ignore this email and you won't hear from us. The link works for ${INVITE_DAYS} days.`, inst.brand.name, { brand: inst.brand, button: "Yes, send me alerts", footer: `If the button doesn't work, copy this link into your browser: ${link}` })
			: await sendEmail(env, inst.alertFrom, email, `${who} has invited you to ${inst.brand.name}`, `${who} has invited you to their ${inst.brand.name} account as ${role === "admin" ? "an admin, so you can add and change things" : "a viewer, so you can see how everything's doing"}.\n\nChoose a password to join: ${link}\n\nThe link works for ${INVITE_DAYS} days.`, inst.brand.name, { brand: inst.brand, button: "Join", footer: `If the button doesn't work, copy this link into your browser: ${link}` });
		if (problem) console.error("team invite", problem);
		if (role !== "alerts") await syncSeats(env, me).catch((e) => console.error("team seats", e));
		return null;
	}
	const one = /^\/api\/team\/([0-9a-f]{16})$/.exec(path);
	const m = one ? team.find((x) => x.id === one[1]) : null;
	if (one && !m) return { error: "We couldn't find them on your team.", status: 404 };
	if (m && method === "DELETE") {
		await db.prepare("DELETE FROM members WHERE id = ?").bind(m.id).run();
		// Their sessions end with them: the cookie names a member that no longer exists.
		if (m.role !== "alerts") await syncSeats(env, me).catch((e) => console.error("team seats", e));
		return null;
	}
	if (m && method === "POST") {
		// Admin and viewer can swap; alert-only people stay alert only (they have no login to change).
		if (m.role !== "alerts" && (b.role === "admin" || b.role === "viewer")) await db.prepare("UPDATE members SET role = ? WHERE id = ?").bind(b.role, m.id).run();
		if (m.role !== "alerts" && typeof b.alerts === "boolean") await db.prepare("UPDATE members SET alerts = ? WHERE id = ?").bind(b.alerts ? 1 : 0, m.id).run();
		return null;
	}
	return { error: "Not found", status: 404 };
}

/** The link in an alert-only person's email: they agree to get alerts. */
export async function confirmAlerts(env: Env, token: string): Promise<Response> {
	const db = env.DB;
	const m = await db.prepare("SELECT * FROM members WHERE token = ? AND role = 'alerts'").bind(token).first<MemberRow>();
	const { brand } = await install(db);
	const page = (title: string, text: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;border-top:6px solid ${brand.colour};font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f8fafc}main{max-width:480px;margin:0 auto;padding:48px 16px}div{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:#475569}</style></head><body><main><div><h1>${title}</h1><p>${text}</p></div></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
	if (!m || !m.token_until || m.token_until < iso(new Date())) return page("That link has expired", "Please ask whoever invited you to send it again.");
	await db.prepare("UPDATE members SET accepted_at = COALESCE(accepted_at, ?), token = NULL, token_until = NULL WHERE id = ?").bind(iso(new Date()), m.id).run();
	return page("You're all set", `We'll email ${m.email} when something goes down and when it's back. To stop, ask whoever invited you to remove you.`);
}

export type { PlanRow };
