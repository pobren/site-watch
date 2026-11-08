import { test } from "node:test";
import assert from "node:assert/strict";
import { lasted } from "../src/status.ts";

test("lasted words the length of a notice", () => {
	assert.equal(lasted("2026-11-08T14:18:07Z", "2026-11-08T14:18:41Z"), "Under a minute");
	assert.equal(lasted("2026-11-08T14:00:00Z", "2026-11-08T14:01:00Z"), "1 minute");
	assert.equal(lasted("2026-11-08T14:00:00Z", "2026-11-08T16:10:00Z"), "2 hours 10 minutes");
	assert.equal(lasted("2026-11-08T14:00:00Z", "2026-11-08T15:00:00Z"), "1 hour");
	assert.equal(lasted("2026-11-08T14:00:00Z", "2026-11-11T18:00:00Z"), "3 days 4 hours");
});
