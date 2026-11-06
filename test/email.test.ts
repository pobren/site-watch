import assert from "node:assert/strict";
import { test } from "node:test";
import { rawEmail } from "../src/core.ts";
import { brandedHtml, emailLogo } from "../src/email.ts";

const brand = { name: "Site Patrol", logo: "https://sitepatrol.app/assets/logo-email.png", colour: "#0F4D33", support: null, hideCredit: true };

test("alert text becomes branded HTML with a button and safe text", () => {
	const html = brandedHtml("Down: shop.example.com", "shop.example.com stopped working <b>now</b>.\n\nSee https://example.com/x.\n\nOpen Site Patrol: https://sitepatrol.app/", { brand, tone: "down" });
	assert.match(html, /#0F4D33/);
	assert.match(html, /logo-email\.png/);
	assert.match(html, /&lt;b&gt;now&lt;\/b&gt;/);
	assert.match(html, /<a href="https:\/\/example.com\/x"/);
	assert.match(html, /Open Site Patrol &rarr;<\/a>/);
	assert.match(html, />Down</);
	assert.doesNotMatch(html, /Runs on Site Watch/);
});

test("a bare link becomes a button with the given words", () => {
	const html = brandedHtml("Confirm your email", "Hello.\n\nhttps://sitepatrol.app/verify?token=abc", { brand, button: "Confirm my email" });
	assert.match(html, /href="https:\/\/sitepatrol.app\/verify\?token=abc"[^>]*>Confirm my email &rarr;/);
});

test("SVG and data: logos are left out, since mail apps don't show them", () => {
	assert.equal(emailLogo("https://x.test/logo.svg"), null);
	assert.equal(emailLogo("data:image/png;base64,AAA"), null);
	assert.equal(emailLogo("https://x.test/logo.png"), "https://x.test/logo.png");
});

test("with HTML the email is multipart, text first", () => {
	const raw = rawEmail("alerts@sitepatrol.app", "a@example.com", "Hi", "Text", new Date(0), "abc", "Site Patrol", "<p>Hi</p>");
	assert.match(raw, /multipart\/alternative; boundary="sw-abc"/);
	assert.ok(raw.indexOf("text/plain") < raw.indexOf("text/html"));
	assert.match(raw, /--sw-abc--/);
});
