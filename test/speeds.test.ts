import { test } from "node:test";
import assert from "node:assert/strict";
import { addSpeed, HELPER_REGIONS, speedLogOf, speedSummary } from "../src/core.ts";

test("region timings are kept by the hour for two days, and failures aren't counted", () => {
	const now = new Date("2026-11-09T17:20:00Z");
	let log = speedLogOf(null);
	log = addSpeed(log, "weur", 100, now);
	log = addSpeed(log, "weur", 300, now);
	log = addSpeed(log, "weur", null, now);
	log = addSpeed(log, "enam", 250, new Date("2026-11-09T15:00:00Z"));
	assert.deepEqual(log.weur["2026-11-09T17"], [400, 2]);
	log = addSpeed(log, "enam", 50, new Date("2026-11-11T16:00:00Z"));
	assert.equal(log.enam["2026-11-09T15"], undefined);
	assert.deepEqual(speedLogOf("not json"), {});
});

test("the summary gives each region's average and slowest hour over the last day", () => {
	const now = new Date("2026-11-09T17:20:00Z");
	let log = speedLogOf(null);
	for (const [h, ms] of [["2026-11-09T10:00:00Z", 100], ["2026-11-09T10:05:00Z", 200], ["2026-11-09T16:00:00Z", 600], ["2026-11-07T10:00:00Z", 9000]] as const) log = addSpeed(log, "apac", ms, new Date(h));
	const s = speedSummary(log, HELPER_REGIONS, now);
	assert.equal(s.length, 1);
	assert.equal(s[0].region, "Asia Pacific");
	assert.equal(s[0].avg, 300);
	assert.equal(s[0].worst, 600);
});
