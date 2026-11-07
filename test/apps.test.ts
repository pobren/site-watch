import assert from "node:assert/strict";
import { test } from "node:test";
import { apnsPayload, cleanDeviceToken, importP8, providerToken } from "../src/apns.ts";
import { cleanDeviceName, cleanPlatform, connectLink, qrSvg } from "../src/apps.ts";
import { unb64url } from "../src/push.ts";

const dec = new TextDecoder();

/** A .p8 file as Apple hands it over: PKCS#8 in PEM. */
async function p8() {
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
	const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
	return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, pub: pair.publicKey };
}

test("the Apple token is an ES256 JWT that the key's public half verifies", async () => {
	const { pem, pub } = await p8();
	const token = await providerToken(await importP8(pem), "ABC123DEFG", "TEAM123456", 1_700_000_000_000);
	const [h, b, s] = token.split(".");
	assert.deepEqual(JSON.parse(dec.decode(unb64url(h))), { alg: "ES256", kid: "ABC123DEFG" });
	assert.deepEqual(JSON.parse(dec.decode(unb64url(b))), { iss: "TEAM123456", iat: 1_700_000_000 });
	assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64url(s), new TextEncoder().encode(`${h}.${b}`)));
});

test("the key still works pasted on one line or with \\n in it", async () => {
	const { pem } = await p8();
	await importP8(pem.replace(/\n/g, " "));
	await importP8(pem.replace(/\n/g, "\\n"));
});

test("down alerts are Time Sensitive and grouped by monitor", () => {
	const down = JSON.parse(apnsPayload({ title: "Down: example.com", body: "Not answering", urgent: true, monitorId: "abcd1234abcd1234" }));
	assert.equal(down.aps["interruption-level"], "time-sensitive");
	assert.equal(down.aps["thread-id"], "abcd1234abcd1234");
	assert.equal(down.monitor, "abcd1234abcd1234");
	const up = JSON.parse(apnsPayload({ title: "Back up", body: "", urgent: false }));
	assert.equal(up.aps["interruption-level"], "active");
	assert.equal(up.aps["thread-id"], undefined);
});

test("device tokens, names and platforms are cleaned", () => {
	assert.equal(cleanDeviceToken("AB".repeat(32)), "ab".repeat(32));
	assert.equal(cleanDeviceToken("xyz"), null);
	assert.equal(cleanDeviceToken(42), null);
	assert.equal(cleanDeviceName("  Paul's\n iPhone "), "Paul's iPhone");
	assert.equal(cleanDeviceName(""), "My app");
	assert.equal(cleanPlatform("iphone"), "iphone");
	assert.equal(cleanPlatform("toaster"), "other");
});

test("the QR code is an SVG picture of the sign-in address", () => {
	const link = connectLink("https://sitepatrol.app", "0123456789abcdef0123456789abcdef");
	assert.equal(link, "https://sitepatrol.app/app/connect?code=0123456789abcdef0123456789abcdef");
	const svg = qrSvg(link);
	assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
	assert.ok(svg.length > 1000);
});
