import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeSvg, decodeWords, lastMonth, monthOf, noticeFromSubject, readEmail, reportText } from "../src/extras.ts";

test("the badge shows its words and colour", () => {
	const svg = badgeSvg("status", "All working", "#15803d");
	assert.match(svg, /^<svg /);
	assert.match(svg, /All working/);
	assert.match(svg, /#15803d/);
	assert.match(badgeSvg("status", "<b>", "#000"), /&lt;b&gt;/);
});

test("emailed subjects choose the notice type, or resolve the latest", () => {
	assert.deepEqual(noticeFromSubject("Maintenance: database upgrade tonight"), { resolve: false, impact: "maintenance", title: "database upgrade tonight" });
	assert.deepEqual(noticeFromSubject("Major - checkout is down"), { resolve: false, impact: "major", title: "checkout is down" });
	assert.deepEqual(noticeFromSubject("Email is slow"), { resolve: false, impact: "minor", title: "Email is slow" });
	assert.equal(noticeFromSubject("Re: Resolved, all fine now").resolve, true);
	assert.equal(noticeFromSubject("Fixed").resolve, true);
	assert.equal(noticeFromSubject("").title, "Update");
});

test("encoded subject words are decoded", () => {
	assert.equal(decodeWords("=?utf-8?B?Q2Fmw6kgaXMgZG93bg==?="), "Café is down");
	assert.equal(decodeWords("=?UTF-8?Q?Caf=C3=A9_is_down?="), "Café is down");
});

test("reads the plain text from a multipart email and drops the quoted reply and signature", () => {
	const raw = [
		"From: Paul <me@example.com>",
		"Subject: =?utf-8?Q?Maintenance:_caf=C3=A9_tonight?=",
		'Content-Type: multipart/alternative; boundary="b1"',
		"",
		"--b1",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: quoted-printable",
		"",
		"We're upgrading the caf=C3=A9 server from 10pm.=",
		" Back by midnight.",
		"",
		"--",
		"Paul",
		"--b1",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<p>We're upgrading</p>",
		"--b1--",
	].join("\r\n");
	const r = readEmail(raw);
	assert.equal(r.subject, "Maintenance: café tonight");
	assert.equal(r.text, "We're upgrading the café server from 10pm. Back by midnight.");
});

test("falls back to the HTML part, and base64 bodies are decoded", () => {
	const html = Buffer.from("<p>Checkout is down</p><p>Working on it</p>").toString("base64");
	const raw = `Subject: Major: checkout\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${html}\r\n`;
	assert.equal(readEmail(raw).text, "Checkout is down\nWorking on it");
	const reply = "Subject: Resolved\r\nContent-Type: text/plain\r\n\r\nAll fine now.\r\n\r\nOn Mon, 9 Nov 2026, Site Patrol wrote:\r\n> earlier\r\n";
	assert.equal(readEmail(reply).text, "All fine now.");
});

test("the monthly report covers last month only", () => {
	assert.equal(lastMonth(new Date("2026-11-01T08:00:00Z")), "2026-10");
	assert.equal(lastMonth(new Date("2027-01-02T08:00:00Z")), "2026-12");
	const state = JSON.stringify({ days: { "2026-10-01": [99, 1], "2026-10-31": [100, 0], "2026-11-01": [0, 100] }, outages: [{ from: "2026-10-01T10:00:00Z", to: "2026-10-01T10:45:00Z", why: "x" }, { from: "2026-09-30T10:00:00Z", to: "2026-09-30T11:00:00Z", why: "y" }] });
	assert.deepEqual(monthOf({ state }, "2026-10"), { uptime: 99.5, outages: 1, downMinutes: 45 });
	assert.deepEqual(monthOf({ state: null }, "2026-10"), { uptime: null, outages: 0, downMinutes: 0 });
	const text = reportText("2026-10", [{ name: "Shop", uptime: 99.5, outages: 1, downMinutes: 45 }, { name: "Blog", uptime: 100, outages: 0, downMinutes: 0 }], "https://x.test/");
	assert.match(text, /October 2026/);
	assert.match(text, /Average uptime: 99\.75%/);
	assert.match(text, /Shop: 99\.5% up, 1 outage \(45 minutes in all\)/);
	assert.match(text, /Blog: 100% up, no outages/);
});
