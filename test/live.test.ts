import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLive } from "../src/live.ts";

// A tiny stand-in for D1 that answers the few queries the Live view makes.
function fakeDb(account: Record<string, unknown> | null, monitors: Record<string, unknown>[]) {
	return {
		prepare(sql: string) {
			const q = {
				bind: () => q,
				async first() {
					if (sql.includes("live_token")) return account ? { id: account.id } : null;
					if (sql.includes("FROM accounts")) return account;
					if (sql.includes("FROM meta")) return null;
					return null;
				},
				async all() { return { results: sql.includes("FROM monitors") ? monitors : sql.includes("FROM alerts") ? [{ at: "2026-11-08T09:00:00Z", subject: "Down: Mail server", urgent: 1 }] : [] }; },
				async run() { return {}; },
			};
			return q;
		},
		batch: async () => [],
	} as unknown as D1Database;
}

test("the Live view shows names and states, worst first, and never server addresses", async () => {
	const acct = { id: "a1", role: "owner", status: "active", tz: "Europe/London" };
	const mons = [
		{ id: "m1", kind: "website", url: "https://example.com/", name: null, state: null, checked_at: "2026-11-08T10:00:00Z", paused_until: null },
		{ id: "m2", kind: "mail", host: "mail.secret-host.example", port: 587, name: null, state: JSON.stringify({ fails: 3, since: "2026-11-08T09:00:00Z" }), checked_at: "2026-11-08T10:00:00Z", paused_until: null },
	];
	const res = await renderLive(fakeDb(acct, mons), "0".repeat(32));
	assert.equal(res.status, 200);
	const html = await res.text();
	assert.match(html, /1 is down/);
	assert.ok(html.indexOf("Mail server") < html.indexOf("example.com"), "down first");
	assert.ok(!html.includes("secret-host"), "no server address");
	assert.ok(!html.includes("Latest alerts"), "alerts stay off unless switched on");
});

test("the latest alerts show when the owner switches them on", async () => {
	const acct = { id: "a1", role: "owner", status: "active", tz: "UTC", live_alerts: 1 };
	const html = await (await renderLive(fakeDb(acct, []), "0".repeat(32))).text();
	assert.match(html, /Latest alerts/);
	assert.match(html, /Down: Mail server/);
});

test("a turned off link says so", async () => {
	const res = await renderLive(fakeDb(null, []), "0".repeat(32));
	assert.equal(res.status, 404);
});
