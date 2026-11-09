import { test } from "node:test";
import assert from "node:assert/strict";
import { maintenanceWindow, windowWords } from "../src/maintenance.ts";
import { uptimeCsv } from "../src/core.ts";

const now = new Date("2026-11-09T21:00:00Z");

test("maintenance windows need a start before an end, in the future, at most two weeks long", () => {
	assert.deepEqual(maintenanceWindow("", "", now), { startsAt: null, endsAt: null });
	assert.deepEqual(maintenanceWindow("2026-11-10T22:00:00.000Z", "2026-11-10T23:30:00.000Z", now), { startsAt: "2026-11-10T22:00:00Z", endsAt: "2026-11-10T23:30:00Z" });
	assert.ok("error" in maintenanceWindow("2026-11-10T22:00:00Z", "", now));
	assert.ok("error" in maintenanceWindow("2026-11-10T22:00:00Z", "2026-11-10T21:00:00Z", now));
	assert.ok("error" in maintenanceWindow("2026-11-08T22:00:00Z", "2026-11-09T20:00:00Z", now));
	assert.ok("error" in maintenanceWindow("2026-11-10T22:00:00Z", "2026-12-10T22:00:00Z", now));
});

test("windows read naturally in the account's time zone", () => {
	assert.equal(windowWords("2026-11-10T22:00:00Z", "2026-11-10T23:30:00Z", "Europe/London"), "Tue 10 Nov, 22:00 to 23:30 (Europe/London)");
	assert.match(windowWords("2026-11-10T22:00:00Z", "2026-11-11T02:00:00Z", "Not/AZone"), /\(UTC\)$/);
});

test("uptime for chosen dates, a line a day and a total", () => {
	const csv = uptimeCsv("Shop, main", { days: { "2026-11-01": [99, 1], "2026-11-03": [100, 0] } }, "2026-11-01", "2026-11-03").split("\r\n");
	assert.equal(csv[0], "Date,Checks up,Checks down,Uptime %");
	assert.equal(csv[1], "2026-11-01,99,1,99");
	assert.equal(csv[2], "2026-11-02,0,0,");
	assert.equal(csv[4], '"Shop, main 2026-11-01 to 2026-11-03",199,1,99.5');
});
