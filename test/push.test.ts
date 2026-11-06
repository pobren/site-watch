import assert from "node:assert/strict";
import { test } from "node:test";
import { b64url, cleanSub, encrypt, unb64url, vapidHeader, type Vapid } from "../src/push.ts";

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A browser: its key pair and auth secret, and how it reads what we send (RFC 8291, done the browser's way). */
async function browser() {
	const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
	const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const sub = { endpoint: "https://push.example.net/send/abc", keys: { p256dh: b64url(pub), auth: b64url(auth) } };
	const read = async (body: Uint8Array) => {
		const salt = body.slice(0, 16);
		const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
		const idlen = body[20];
		const asPublic = body.slice(21, 21 + idlen);
		const theirs = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
		const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs } as EcdhKeyDeriveParams, pair.privateKey, 256));
		const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...pub, ...asPublic]);
		const ikm = await hkdf(auth, shared, info, 32);
		const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
		const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
		const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
		const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + idlen)));
		assert.equal(plain[plain.length - 1], 2, "last record ends with the 0x02 delimiter");
		return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
	};
	return { sub, read };
}

test("a browser can read the alert we encrypt for it", async () => {
	const b = await browser();
	const msg = JSON.stringify({ title: "shop.example.com is down", body: "We'll tell you when it's back. 🔴" });
	const body = await encrypt(b.sub, msg);
	const got = await b.read(body);
	assert.equal(got.text, msg);
	assert.equal(got.rs, 4096);
});

test("only real subscriptions are kept", async () => {
	const b = await browser();
	assert.deepEqual(cleanSub(b.sub), b.sub);
	assert.equal(cleanSub({ ...b.sub, endpoint: "http://push.example.net/x" }), null);
	assert.equal(cleanSub({ ...b.sub, keys: { ...b.sub.keys, auth: "short" } }), null);
	assert.equal(cleanSub(null), null);
	assert.equal(cleanSub({ endpoint: "not a url", keys: b.sub.keys }), null);
});

test("the VAPID token is signed with our key and names the push service", async () => {
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	const v: Vapid = { publicKey: b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer), privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey };
	const h = await vapidHeader(v, "https://fcm.googleapis.com/fcm/send/xyz", "mailto:alerts@example.com", Date.UTC(2026, 10, 6));
	const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
	assert.ok(m);
	const claims = JSON.parse(new TextDecoder().decode(unb64url(m[2])));
	assert.equal(claims.aud, "https://fcm.googleapis.com");
	assert.equal(claims.sub, "mailto:alerts@example.com");
	assert.equal(claims.exp, Date.UTC(2026, 10, 6) / 1000 + 12 * 3600);
	assert.equal(m[4], v.publicKey);
	const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, unb64url(m[3]), enc.encode(`${m[1]}.${m[2]}`));
	assert.equal(ok, true);
});
