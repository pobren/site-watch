import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
	alertFor, certAlert, certFromCt, cleanChannel, cleanHost, cleanPort, cleanRules, cleanUrl, dailyBars, domainOf, heartbeatOutcome, mailDialog, markSent, NEW_STATE, overall,
	pageOutcome, payloadFor, rawEmail, rdapExpiry, reminderDue, remindersPassed, renewalAlert, step, statusOf, uptime, verifyStripe, webhookHeaders, type MailIo, type State,
} from "../src/core.ts";

const at = (s: string) => new Date(s);
const fresh = (): State => ({ ...NEW_STATE, outages: [], days: {}, hours: {} });

test("one failed check is forgiven; two make an outage with one alert, and back up follows", () => {
	let s = fresh();
	let r = step(s, { state: "down", why: "x" }, at("2026-11-04T10:00:00Z"));
	assert.equal(r.events.length, 0);
	r = step(r.next, { state: "up" }, at("2026-11-04T10:05:00Z"), 120);
	assert.equal(r.events.length, 0);
	assert.equal(r.next.fails, 0);
	r = step(r.next, { state: "down", why: "it answered with an error (502)" }, at("2026-11-04T10:10:00Z"));
	r = step(r.next, { state: "down", why: "it answered with an error (502)" }, at("2026-11-04T10:15:00Z"));
	assert.deepEqual(r.events.map((e) => e.kind), ["down"]);
	r = step(r.next, { state: "down", why: "still" }, at("2026-11-04T10:20:00Z"));
	assert.equal(r.events.length, 0, "no second down alert");
	r = step(r.next, { state: "up" }, at("2026-11-04T10:25:00Z"), 90);
	assert.deepEqual(r.events.map((e) => e.kind), ["up"]);
	assert.equal(r.next.outages.length, 1);
	assert.equal(r.next.outages[0].from, "2026-11-04T10:10:00Z");
	s = r.next;
	assert.ok(uptime(s, at("2026-11-04T12:00:00Z"))! < 100);
	assert.equal(dailyBars(s, at("2026-11-04T12:00:00Z")).length, 90);
});

test("going up and down three times in an hour sends one flapping alert", () => {
	let s = fresh();
	const kinds: string[] = [];
	let t = Date.parse("2026-11-04T10:00:00Z");
	for (let i = 0; i < 3; i++) {
		for (const o of [{ state: "down", why: "x" }, { state: "down", why: "x" }, { state: "up" }] as const) {
			const r = step(s, o, new Date(t));
			kinds.push(...r.events.map((e) => e.kind));
			s = r.next;
			t += 60_000;
		}
	}
	assert.deepEqual(kinds, ["down", "up", "down", "up", "down", "flapping"]);
});

test("a mail server turning us away isn't counted as down", () => {
	let r = step(fresh(), { state: "blocked", why: "refused" }, at("2026-11-04T10:00:00Z"));
	r = step(r.next, { state: "blocked", why: "refused" }, at("2026-11-04T10:05:00Z"));
	assert.deepEqual(r.events.map((e) => e.kind), ["blocked"]);
	assert.equal(statusOf(r.next, true, false), "blocked");
	assert.equal(r.next.fails, 0);
});

test("page rules", () => {
	assert.equal(pageOutcome({ status: 200, ms: 100, body: "Hello" }, { contains: "hello" }).state, "up");
	assert.equal(pageOutcome({ status: 200, ms: 100, body: "Hello" }, { contains: "basket" }).state, "down");
	assert.equal(pageOutcome({ status: 200, ms: 100, body: "Database error" }, { missing: "database error" }).state, "down");
	assert.equal(pageOutcome({ status: 301, ms: 100 }, { status: 200 }).state, "down");
	assert.equal(pageOutcome({ status: 403, ms: 100 }, {}).state, "up");
	assert.equal(pageOutcome({ status: 503, ms: 100 }, {}).state, "down");
	assert.equal(pageOutcome({ status: 526, ms: 100 }, {}).state, "cert");
	assert.equal(pageOutcome({ status: 200, ms: 4000 }, { maxMs: 2000 }).state, "down");
	assert.equal(pageOutcome({ error: "TypeError: SSL handshake failed", ms: 10 }, {}).state, "cert");
	assert.deepEqual(cleanRules({ status: "200", contains: "  Shop  ", maxMs: "" }), { status: 200, contains: "Shop" });
	assert.ok("error" in cleanRules({ maxMs: 100 }));
});

test("cleaning addresses", () => {
	assert.equal(cleanUrl("example.com"), "https://example.com/");
	assert.equal(cleanUrl("http://example.co.uk/shop#x"), "http://example.co.uk/shop");
	assert.equal(cleanUrl("https://user:pw@example.com"), null);
	assert.equal(cleanUrl("https://10.0.0.1/"), null);
	assert.equal(cleanHost("smtp://Mail.Example.com:587/"), "mail.example.com");
	assert.equal(cleanPort(25), null);
	assert.equal(cleanPort("22"), 22);
	assert.equal(domainOf("www.shop.example.co.uk"), "example.co.uk");
	assert.equal(domainOf("blog.example.com"), "example.com");
});

test("heartbeats are late after their interval plus a margin", () => {
	const created = "2026-11-04T00:00:00Z";
	assert.equal(heartbeatOutcome(60, "2026-11-04T09:00:00Z", created, at("2026-11-04T10:05:00Z")).state, "up");
	assert.equal(heartbeatOutcome(60, "2026-11-04T09:00:00Z", created, at("2026-11-04T10:07:00Z")).state, "down");
});

test("certificates from CT logs, and reminders once each", () => {
	const now = at("2026-11-04T00:00:00Z");
	const cert = certFromCt([
		{ name_value: "example.com\nwww.example.com", not_before: "2026-09-01T00:00:00", not_after: "2026-11-30T00:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R11" },
		{ name_value: "other.com", not_before: "2026-10-01T00:00:00", not_after: "2027-01-01T00:00:00" },
	], "www.example.com", now)!;
	assert.equal(cert.issuer, "Let's Encrypt");
	assert.equal(cert.auto, true);
	assert.equal(cert.expires, "2026-11-30T00:00:00.000Z");
	const steps = [14, 7, 1];
	const exp = "2026-11-10T12:00:00Z";
	// Added 6 days before: the 14 and 7 day reminders are already "used up" (it's on screen), the 1 day one waits.
	assert.equal(remindersPassed(exp, now, steps), "14,7");
	assert.equal(reminderDue(exp, now, "14,7", steps), null);
	// Known for longer: the 7 day reminder is due once, then not again.
	let sent = "14";
	assert.equal(reminderDue(exp, now, sent, steps), 7);
	sent = markSent(sent, exp, now, steps);
	assert.equal(reminderDue(exp, now, sent, steps), null);
	assert.equal(reminderDue(exp, at("2026-11-10T00:00:00Z"), sent, steps), 1);
});

test("RDAP expiry and registrar", () => {
	const r = rdapExpiry({ events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" }],
		entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar Ltd"]]] }] });
	assert.deepEqual(r, { expires: "2027-01-01T00:00:00.000Z", registrar: "Example Registrar Ltd" });
	assert.deepEqual(rdapExpiry(null), { expires: null, registrar: null });
});

function fakeIo(lines: string[]): MailIo & { sent: string[]; upgraded: boolean } {
	const io = { sent: [] as string[], upgraded: false, async line() { const l = lines.shift(); if (l === undefined) throw new Error("closed"); return l; }, async send(t: string) { io.sent.push(t); }, async upgrade() { io.upgraded = true; } };
	return io;
}

test("SMTP STARTTLS conversation", async () => {
	const io = fakeIo(["220 mail.example.com ESMTP", "250-mail.example.com", "250-SIZE 1000", "250 STARTTLS", "220 Go ahead", "250-mail.example.com", "250 AUTH PLAIN"]);
	const r = await mailDialog("smtp", "starttls", io, "watch.example.com");
	assert.equal(r.ok, true);
	assert.ok(io.upgraded);
	assert.deepEqual(io.sent, ["EHLO watch.example.com", "STARTTLS", "EHLO watch.example.com", "QUIT"]);
	const no = await mailDialog("smtp", "starttls", fakeIo(["220 hi", "250 mail.example.com"]), "x");
	assert.equal(no.ok, false);
	const refused = await mailDialog("smtp", "on", fakeIo(["554 No cloud connections"]), "x");
	assert.equal(!refused.ok && refused.kind, "refused");
	assert.equal((await mailDialog("imap", "on", fakeIo(["* OK IMAP ready"]), "x")).ok, true);
	assert.equal((await mailDialog("pop3", "on", fakeIo(["+OK POP3 ready"]), "x")).ok, true);
});

test("alert channels: right addresses only, and each service's format", () => {
	assert.ok("error" in cleanChannel({ kind: "slack", url: "https://example.com/hook" }));
	assert.ok(!("error" in cleanChannel({ kind: "slack", url: "https://hooks.slack.com/services/T/B/x" })));
	assert.ok("error" in cleanChannel({ kind: "webhook", url: "https://127.0.0.1/x" }));
	assert.ok("error" in cleanChannel({ kind: "webhook", url: "http://example.com/x" }));
	const e = { event: "alert" as const, subject: "Down: example.com", text: "It's down", urgent: true, url: "https://watch.example.com/", sentAt: "2026-11-04T00:00:00Z", app: "Acme Monitor" };
	assert.equal((payloadFor("discord", e) as { username: string }).username, "Acme Monitor");
	assert.match(JSON.stringify(payloadFor("slack", e)), /Open Acme Monitor/);
});

test("alert words use the brand and time zone", () => {
	const a = alertFor({ kind: "website", name: null, url: "https://example.com/", host: null, port: null, every: 5 }, { kind: "down", why: "it answered with an error (502)", since: "2026-11-04T10:00:00Z" }, "Europe/London", "https://w.example.com/", "Acme Monitor");
	assert.equal(a.subject, "Down: example.com");
	assert.match(a.text, /Open Acme Monitor: https:\/\/w\.example\.com\//);
	assert.match(a.text, /5 minutes apart/);
});

test("raw email headers", () => {
	const raw = rawEmail("alerts@example.com", "me@example.com", "Down: café.com", "Hello", at("2026-11-04T00:00:00Z"), "abc", "Acme \"Monitor\"");
	assert.match(raw, /^From: Acme Monitor <alerts@example.com>\r\n/);
	assert.match(raw, /Subject: =\?UTF-8\?B\?/);
	assert.match(raw, /Message-ID: <abc@example.com>/);
});

test("status page summary", () => {
	assert.equal(overall(["up", "up"]).text, "All systems working");
	assert.equal(overall(["up", "down"]).text, "Partial outage");
	assert.equal(overall(["down"]).text, "Major outage");
	assert.equal(overall(["up", "degraded"]).state, "degraded");
});

test("Stripe webhook signatures", async () => {
	const body = '{"type":"x"}';
	const t = 1_800_000_000;
	const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
	assert.equal(await verifyStripe("whsec_test", `t=${t},v1=${sig}`, body, t * 1000), true);
	assert.equal(await verifyStripe("whsec_test", `t=${t},v1=${sig}`, body + " ", t * 1000), false);
	assert.equal(await verifyStripe("whsec_test", `t=${t},v1=${sig}`, body, (t + 600) * 1000), false);
});

// -- 1.2.0: webhook events and signatures --------------------------------------------------------

test("each alert names its webhook event", () => {
	const m = { kind: "website" as const, name: "Shop", url: "https://example.com/", host: null, port: null, every: 5 };
	const now = new Date("2026-11-04T12:00:00Z");
	assert.equal(alertFor(m, { kind: "down", why: "it timed out", since: "2026-11-04T11:50:00Z" }, "UTC", "https://w/").type, "monitor.down");
	assert.equal(alertFor(m, { kind: "up", outage: { from: "2026-11-04T11:50:00Z", to: "2026-11-04T12:00:00Z", why: "" } }, "UTC", "https://w/").type, "monitor.up");
	assert.equal(certAlert({ expires: "2026-11-10T00:00:00Z", issuer: null, host: "example.com", checkedAt: "", issued: "", auto: false }, now, "https://w/").type, "cert.expiring");
	assert.equal(renewalAlert({ domain: "example.com", expires: "2026-11-30T00:00:00Z", registrar: null, checkedAt: "" }, now, "https://w/").type, "domain.expiring");
});

test("webhook signature checks out the same way as Mail App's", async () => {
	const body = '{"type":"monitor.down"}';
	const h = await webhookHeaders("whsec_test", "monitor.down", "evt_1", body, 1_760_520_601_000);
	const parts = Object.fromEntries(h["site-watch-signature"].split(",").map((p: string) => p.split("=")));
	assert.equal(parts.t, "1760520601");
	assert.equal(parts.v1, createHmac("sha256", "whsec_test").update(`${parts.t}.${body}`).digest("hex"));
	assert.equal(h["x-sitewatch-signature"], `sha256=${parts.v1}`);
});
