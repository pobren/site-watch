import { test } from "node:test";
import assert from "node:assert/strict";
import { memberMay } from "../src/team.ts";

const member = (role: "admin" | "viewer") => ({ member: { id: "a".repeat(16), email: "sam@example.com", name: null, role, password: null, session_ver: 0, alerts: false } });

test("the account's own login may do anything", () => {
	assert.equal(memberMay({}, "POST", "/api/team"), null);
	assert.equal(memberMay({}, "POST", "/api/billing/checkout"), null);
});

test("viewers look but don't change", () => {
	assert.equal(memberMay(member("viewer"), "GET", "/api/state"), null);
	assert.match(memberMay(member("viewer"), "POST", "/api/monitors") ?? "", /look/);
	assert.match(memberMay(member("viewer"), "DELETE", "/api/monitors/abc") ?? "", /look/);
});

test("admins change things, but not billing, the team, keys or the account", () => {
	assert.equal(memberMay(member("admin"), "POST", "/api/monitors"), null);
	assert.equal(memberMay(member("admin"), "POST", "/api/pages"), null);
	for (const p of ["/api/team", "/api/team/0123456789abcdef", "/api/keys", "/api/billing/portal", "/api/account/delete", "/api/admin/plans", "/api/app/qr", "/api/live-link", "/api/connector/disconnect"])
		assert.ok(memberMay(member("admin"), "POST", p), p);
});
