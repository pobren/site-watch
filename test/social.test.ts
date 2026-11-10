import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSocial, readSocial, socialLine } from "../src/social.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

test("social accounts: keeps good addresses, adds https, drops blanks", () => {
	const r = cleanSocial({ x: "x.com/acme", bluesky: "https://bsky.app/profile/acme.bsky.social", linkedin: "", mastodon: "https://mastodon.social/@acme" });
	assert.equal(typeof r, "string");
	assert.deepEqual(readSocial(r as string), { x: "https://x.com/acme", bluesky: "https://bsky.app/profile/acme.bsky.social", mastodon: "https://mastodon.social/@acme" });
	assert.equal(cleanSocial({ x: "", facebook: "" }), null);
	assert.equal(cleanSocial(null), null);
});

test("social accounts: refuses the wrong site, http and odd values", () => {
	assert.ok(typeof cleanSocial({ x: "https://evil.example/acme" }) === "object");
	assert.ok(typeof cleanSocial({ facebook: "http://facebook.com/acme" }) === "object");
	assert.ok(typeof cleanSocial({ x: 5 }) === "object");
	assert.ok(typeof cleanSocial("x.com/acme") === "object");
	assert.ok(typeof cleanSocial({ mastodon: "javascript:alert(1)" }) === "object");
	assert.equal(typeof cleanSocial({ x: "https://www.twitter.com/acme" }), "string");
});

test("social accounts: footer line reads naturally and is escaped", () => {
	assert.equal(socialLine({}, esc), "");
	assert.equal(socialLine({ x: "https://x.com/a" }, esc), 'Follow us on <a href="https://x.com/a" rel="me noopener" target="_blank">X</a>');
	const three = socialLine({ linkedin: "https://linkedin.com/a", x: "https://x.com/a", bluesky: "https://bsky.app/a" }, esc);
	assert.match(three, />X<\/a>, <a[^>]+>Bluesky<\/a> and <a[^>]+>LinkedIn<\/a>$/);
	assert.ok(!socialLine({ x: 'https://x.com/"><script>' }, esc).includes("<script>"));
	assert.deepEqual(readSocial("not json"), {});
});
