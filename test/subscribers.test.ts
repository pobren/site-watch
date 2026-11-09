import { test } from "node:test";
import assert from "node:assert/strict";
import { hookHostOk } from "../src/subscribers.ts";

test("chat room addresses must come from the chat service they claim to be", () => {
	assert.equal(hookHostOk("slack", "https://hooks.slack.com/services/T0/B0/xyz"), true);
	assert.equal(hookHostOk("slack", "https://example.com/services/T0"), false);
	assert.equal(hookHostOk("discord", "https://discord.com/api/webhooks/1/abc"), true);
	assert.equal(hookHostOk("discord", "https://discord.com/channels/1"), false);
	assert.equal(hookHostOk("teams", "https://acme.webhook.office.com/webhookb2/abc"), true);
	assert.equal(hookHostOk("teams", "https://webhook.office.com.evil.com/x"), false);
	assert.equal(hookHostOk("google", "https://chat.googleapis.com/v1/spaces/x/messages?key=1"), true);
	assert.equal(hookHostOk("google", "https://chat.googleapis.com.example.com/v1"), false);
	assert.equal(hookHostOk("webhook", "https://example.com/hook"), true);
	assert.equal(hookHostOk("webhook", "not a link"), false);
});
