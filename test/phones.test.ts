import assert from "node:assert/strict";
import { test } from "node:test";
import { allowanceFrom, canSend, cleanPhone, maskPhone, nameList, phoneReady, phoneText, waVars } from "../src/phones.ts";

const C = ["44", "1"];

test("mobile numbers are tidied into +44 form, and only allowed countries pass", () => {
	assert.deepEqual(cleanPhone("07700 900123", C), { number: "+447700900123" });
	assert.deepEqual(cleanPhone("+44 (0)7700-900123".replace("(0)", ""), C), { number: "+447700900123" });
	assert.deepEqual(cleanPhone("0044 7700 900123", C), { number: "+447700900123" });
	assert.deepEqual(cleanPhone("+1 (415) 555-2671", C), { number: "+14155552671" });
	assert.ok("error" in cleanPhone("020 7946 0000", C), "a UK landline isn't a mobile");
	assert.ok("error" in cleanPhone("+49 151 23456789", C), "Germany isn't on the list");
	assert.ok("error" in cleanPhone("+1 015 555 2671", C), "US area codes don't start 0");
	assert.ok("error" in cleanPhone("hello", C));
	assert.deepEqual(cleanPhone("+49 151 23456789", ["49"]), { number: "+4915123456789" });
});

test("numbers are masked so phones can be told apart", () => {
	assert.equal(maskPhone("+447700900123"), "+44 7••• ••0123");
	assert.equal(maskPhone("+14155552671"), "+1 4••• ••2671");
});

test("what this install can send depends on its Twilio settings", () => {
	assert.deepEqual(phoneReady({}), { sms: false, whatsapp: false });
	const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_SMS_FROM: "SitePatrol" };
	assert.deepEqual(phoneReady(env), { sms: true, whatsapp: false });
	assert.equal(canSend(env, "sms", "+447700900123"), true);
	assert.equal(canSend(env, "sms", "+14155552671"), false, "US texts need their own sender");
	assert.equal(canSend({ ...env, TWILIO_SMS_FROM_US: "+18005550100" }, "sms", "+14155552671"), true);
	const wa = { ...env, TWILIO_WHATSAPP_FROM: "+447700900000", TWILIO_WA_DOWN: "HX1", TWILIO_WA_UP: "HX2", TWILIO_WA_CODE: "HX3" };
	assert.equal(phoneReady(wa).whatsapp, true);
	assert.equal(phoneReady({ ...wa, TWILIO_WA_CODE: undefined }).whatsapp, false, "all three templates are needed");
});

test("several alerts become one short message", () => {
	assert.equal(nameList(["a"]), "a");
	assert.equal(nameList(["a", "b"]), "a and b");
	assert.equal(nameList(["a", "b", "c"]), "a, b and c");
	assert.equal(nameList(["a", "b", "c", "d", "a"]), "a, b and 2 more");
	const at = "2026-11-08T14:02:00Z";
	assert.equal(phoneText([{ event: "down", label: "shop.example.com", at }], "Europe/London", "https://sitepatrol.app/", "Site Patrol"),
		"Site Patrol: shop.example.com is down, since about 14:02. We'll text again when it's back. https://sitepatrol.app/");
	assert.equal(phoneText([{ event: "up", label: "a.com", at }, { event: "up", label: "b.com", at }], "UTC", "https://x/", "Site Patrol"),
		"Site Patrol: good news, a.com and b.com are working again. https://x/");
	assert.ok(phoneText([{ event: "down", label: "a-rather-long-shop-name.example.com", at }, { event: "down", label: "b.example.com", at }, { event: "down", label: "c.example.com", at }, { event: "down", label: "d.example.com", at }], "UTC", "https://sitepatrol.app/", "Site Patrol").length <= 160);
	assert.deepEqual(waVars([{ event: "down", label: "a.com", at }], "UTC", "https://x/"), { 1: "a.com", 2: "14:02", 3: "https://x/" });
	assert.deepEqual(waVars([{ event: "up", label: "a.com", at }], "UTC", "https://x/"), { 1: "a.com", 2: "https://x/" });
});

test("the monthly allowance comes first, then top ups until they run out", () => {
	const now = new Date("2026-11-08T12:00:00Z");
	assert.equal(allowanceFrom(20, 5, 0, null, now).left, 15);
	assert.equal(allowanceFrom(20, 25, 0, null, now).left, 0);
	assert.equal(allowanceFrom(20, 20, 100, "2027-11-01T00:00:00Z", now).left, 100);
	assert.equal(allowanceFrom(20, 20, 100, "2026-11-01T00:00:00Z", now).left, 0, "old top ups have run out");
	assert.equal(allowanceFrom(null, 500, 0, null, now).left, Infinity, "the owner has no monthly limit");
});

// -- The whole path, on a real SQLite database standing in for D1, with Twilio faked --
import { DatabaseSync } from "node:sqlite";
import { confirmCode, flushPhones, queuePhone, sendCode } from "../src/phones.ts";

function sqliteD1() {
	const raw = new DatabaseSync(":memory:");
	raw.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT, on_off INTEGER NOT NULL DEFAULT 1, fails INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '');
		CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, at TEXT, monitor_id TEXT, subject TEXT, text TEXT, urgent INTEGER, sent TEXT NOT NULL DEFAULT '');
		CREATE TABLE accounts (id TEXT PRIMARY KEY, phone_credits INTEGER NOT NULL DEFAULT 0, phone_credits_until TEXT);
		CREATE TABLE phone_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, alert_id INTEGER, event TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, claim TEXT);
		CREATE TABLE phone_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, channel_id INTEGER, kind TEXT NOT NULL, counted INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL);`);
	const stmt = (sql: string, args: unknown[] = []) => ({
		bind: (...a: unknown[]) => stmt(sql, a),
		async first<T>() { return (raw.prepare(sql).get(...(args as never[])) ?? null) as T; },
		async all<T>() { return { results: raw.prepare(sql).all(...(args as never[])) as T[] }; },
		async run() { const r = raw.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
	});
	const db = { prepare: (sql: string) => stmt(sql), batch: async (list: { run: () => Promise<unknown> }[]) => { for (const s of list) await s.run(); return []; } };
	return { db: db as unknown as D1Database, raw };
}

function fakeTwilio(answer: (body: URLSearchParams) => { status: number; code?: number } = () => ({ status: 201 })) {
	const sent: URLSearchParams[] = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const body = new URLSearchParams(String(init.body));
		sent.push(body);
		const a = answer(body);
		return new Response(JSON.stringify({ code: a.code, message: "no" }), { status: a.status });
	}) as typeof fetch;
	return sent;
}

const ENV = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_SMS_FROM: "SitePatrol", TWILIO_WHATSAPP_FROM: "+447700900000", TWILIO_WA_DOWN: "HXdown", TWILIO_WA_UP: "HXup", TWILIO_WA_CODE: "HXcode" };
const client = (over: Record<string, unknown> = {}) => ({ id: "c1", role: "client", plan: "pro", tz: "Europe/London", phone_credits: 0, phone_credits_until: null, alert_to: "me@example.com", ...over }) as never;
const pro = { id: "pro", phone_alerts: 2 } as never;

test("a phone gets a code, and only the right code turns it on", async () => {
	const { db, raw } = sqliteD1();
	const sent = fakeTwilio();
	raw.prepare("INSERT INTO channels (account_id, kind, name, url, secret, on_off) VALUES ('c1', 'sms', 'Mine', '+447700900123', '{\"verified\":false}', 0)").run();
	const ch = { id: 1, kind: "sms", url: "+447700900123" };
	assert.equal(await sendCode(db, ENV, "c1", ch, "Site Patrol"), null);
	const code = sent[0].get("Body")!.slice(0, 6);
	assert.equal(sent[0].get("From"), "SitePatrol");
	const row = () => raw.prepare("SELECT id, secret, on_off FROM channels WHERE id = 1").get() as { id: number; secret: string; on_off: number };
	assert.match((await confirmCode(db, row(), "000000")) ?? "", /isn't right/);
	assert.equal(row().on_off, 0);
	assert.equal(await confirmCode(db, row(), code.split("").join(" ")), null);
	assert.equal(row().on_off, 1);
	assert.equal(JSON.parse(row().secret).verified, true);
	// Codes are limited to 3 a day.
	assert.equal(await sendCode(db, ENV, "c1", ch, "Site Patrol"), null);
	assert.equal(await sendCode(db, ENV, "c1", ch, "Site Patrol"), null);
	assert.match((await sendCode(db, ENV, "c1", ch, "Site Patrol")) ?? "", /3 codes today/);
});

test("alerts in one run go as one message per phone, and stop when the allowance is used", async () => {
	const { db, raw } = sqliteD1();
	const sent = fakeTwilio();
	raw.prepare("INSERT INTO channels (account_id, kind, name, url, secret, on_off) VALUES ('c1', 'whatsapp', 'WhatsApp', '+447700900123', '{\"verified\":true}', 1)").run();
	raw.prepare("INSERT INTO channels (account_id, kind, name, url, secret, on_off) VALUES ('c1', 'sms', 'Pending', '+447700900456', '{\"verified\":false}', 1)").run();
	raw.prepare("INSERT INTO accounts (id) VALUES ('c1')").run();
	raw.prepare("INSERT INTO alerts (account_id, sent) VALUES ('c1', 'email')").run();
	const now = new Date("2026-11-08T14:02:00Z");
	let ranOut = 0;
	const deps = { account: async () => client(), plan: async () => pro, ranOut: async () => { ranOut++; }, link: "https://sitepatrol.app/", app: "Site Patrol" };
	await queuePhone(db, "c1", 1, { event: "down", label: "a.com", at: now.toISOString() });
	await queuePhone(db, "c1", null, { event: "down", label: "b.com", at: now.toISOString() });
	await flushPhones(db, ENV, deps, now);
	assert.equal(sent.length, 1, "two sites down, one message, and the unconfirmed phone gets nothing");
	assert.equal(sent[0].get("ContentSid"), "HXdown");
	assert.deepEqual(JSON.parse(sent[0].get("ContentVariables")!), { 1: "a.com and b.com", 2: "14:02", 3: "https://sitepatrol.app/" });
	assert.equal((raw.prepare("SELECT sent FROM alerts WHERE id = 1").get() as { sent: string }).sent, "email, WhatsApp");
	assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM phone_outbox").get() as { n: number }).n, 0);
	await flushPhones(db, ENV, deps, now);
	assert.equal(sent.length, 1, "nothing is sent twice");
	// The plan includes 2 a month: the second goes, the third is held.
	await queuePhone(db, "c1", null, { event: "up", label: "a.com", at: now.toISOString() });
	await flushPhones(db, ENV, deps, now);
	await queuePhone(db, "c1", 1, { event: "down", label: "c.com", at: now.toISOString() });
	await flushPhones(db, ENV, deps, now);
	assert.equal(sent.length, 2);
	assert.equal(ranOut, 1);
	assert.match((raw.prepare("SELECT sent FROM alerts WHERE id = 1").get() as { sent: string }).sent, /held \(no phone alerts left\)/);
	// A top up carries on where the month left off.
	raw.prepare("UPDATE accounts SET phone_credits = 5, phone_credits_until = '2027-11-01T00:00:00Z'").run();
	const topped = { ...deps, account: async () => client({ phone_credits: 5, phone_credits_until: "2027-11-01T00:00:00Z" }) };
	await queuePhone(db, "c1", null, { event: "down", label: "c.com", at: now.toISOString() });
	await flushPhones(db, ENV, topped, now);
	assert.equal(sent.length, 3);
	assert.equal((raw.prepare("SELECT phone_credits AS n FROM accounts").get() as { n: number }).n, 4);
});

test("a number Twilio says is gone is switched off, and a failed send isn't charged", async () => {
	const { db, raw } = sqliteD1();
	fakeTwilio(() => ({ status: 400, code: 21610 }));
	raw.prepare("INSERT INTO channels (account_id, kind, name, url, secret, on_off) VALUES ('c1', 'sms', 'Text', '+447700900123', '{\"verified\":true}', 1)").run();
	raw.prepare("INSERT INTO accounts (id) VALUES ('c1')").run();
	const deps = { account: async () => client(), plan: async () => pro, ranOut: async () => {}, link: "https://x/", app: "Site Patrol" };
	await queuePhone(db, "c1", null, { event: "down", label: "a.com", at: new Date().toISOString() });
	await flushPhones(db, ENV, deps);
	assert.equal((raw.prepare("SELECT on_off FROM channels").get() as { on_off: number }).on_off, 0);
	assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM phone_sends").get() as { n: number }).n, 0);
});
