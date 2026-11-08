import { test } from "node:test";
import assert from "node:assert/strict";
import { nameProblem, tidyName } from "../src/names.ts";

test("tidies names", () => {
	assert.equal(tidyName("  Acme Ltd!! "), "acme-ltd");
	assert.equal(tidyName("a--b"), "a-b");
});

test("good names pass, including ones with rude words hidden inside real words", () => {
	for (const n of ["acme", "scunthorpe-council", "dickens-books", "classic-cars", "essex-plumbing", "paulobrien", "the-cockpit-cafe"]) assert.equal(nameProblem(n), null, n);
});

test("rude, reserved and lookalike names are refused", () => {
	for (const n of ["www", "admin", "f-u-c-k", "sh1t-shop", "my-ass", "paypal-help", "secure-login", "hmrc-refund", "ab", "1234", "xn--abc"]) assert.notEqual(nameProblem(n), null, n);
});

test("everyday words that hide a big name or a rude word are fine", () => {
	for (const n of ["pineapple-cafe", "riverbank-dental", "first-aid", "purchase-ledger", "crisis-line", "torpedo-games", "spicy-food", "the-therapist", "grape-wines", "racoon-rescue"]) assert.equal(nameProblem(n), null, n);
	for (const n of ["apple-support", "nhs-login", "my-bank"]) assert.notEqual(nameProblem(n), null, n);
});
