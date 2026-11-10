import { test } from "node:test";
import assert from "node:assert/strict";
import { dueToday, refundable, teamFits, toMinor } from "../src/money.ts";

test("refund amounts are read as pounds and pence", () => {
	assert.equal(toMinor("2.50"), 250);
	assert.equal(toMinor("£29"), 2900);
	assert.equal(toMinor(" 1,000.5 "), 100050);
	assert.equal(toMinor("0"), null);
	assert.equal(toMinor("-3"), null);
	assert.equal(toMinor("2.555"), null);
	assert.equal(toMinor("abc"), null);
});

test("a refund is all that's left, or a part no bigger than that", () => {
	const paid = { amount: 2900, amount_refunded: 500, status: "succeeded", currency: "gbp" };
	assert.deepEqual(refundable(paid, null), { amount: 2400 });
	assert.deepEqual(refundable(paid, 1000), { amount: 1000 });
	assert.match((refundable(paid, 2401) as { error: string }).error, /more than is left.*£24\.00/);
	assert.match((refundable({ ...paid, amount_refunded: 2900 }, null) as { error: string }).error, /already/);
	assert.match((refundable({ ...paid, status: "failed" }, null) as { error: string }).error, /went through/);
});

test("changing plan charges the prorated difference, or the whole new period when it changes length", () => {
	const lines = [{ proration: true, amount: -400 }, { proration: true, amount: 2300 }, { proration: false, amount: 29000 }];
	assert.equal(dueToday(lines, false), 1900);
	assert.equal(dueToday(lines, true), 30900);
	assert.equal(dueToday([{ proration: true, amount: -1500 }, { proration: true, amount: 400 }], false), -1100);
});

test("a smaller plan needs the team to fit, unless it sells extra logins", () => {
	assert.equal(teamFits(1, { seats: 0, seat_price: null, seat_price_year: null }), true);
	assert.equal(teamFits(3, { seats: 1, seat_price: null, seat_price_year: null }), false);
	assert.equal(teamFits(3, { seats: 3, seat_price: null, seat_price_year: null }), true);
	assert.equal(teamFits(5, { seats: 3, seat_price: "price_x", seat_price_year: null }), true);
});
