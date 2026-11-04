#!/usr/bin/env node
// `npx @mrpwob/site-watch`: installs and updates Site Watch on your own Cloudflare account. It uses Cloudflare's
// own tool, Wrangler, which signs you in to Cloudflare in your browser (or uses CLOUDFLARE_API_TOKEN if it's set).
// Nothing is sent anywhere but Cloudflare.
//
//   npx @mrpwob/site-watch setup     install, or update an existing install (your data stays)
//   npx @mrpwob/site-watch help

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
const { version } = require("./package.json");
const tty = process.stdout.isTTY;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const say = (s = "") => process.stdout.write(`${s}\n`);

function run(args, opts = {}) {
	const r = spawnSync(process.execPath, [wrangler, ...args], { cwd: here, encoding: "utf8", stdio: opts.capture ? ["inherit", "pipe", "inherit"] : "inherit", input: opts.input, env: process.env });
	if (opts.capture && r.stdout) process.stdout.write(r.stdout);
	if (r.status !== 0 && !opts.ok) {
		say(`\nWrangler stopped with an error (above). Nothing else was changed.`);
		process.exit(r.status ?? 1);
	}
	return r;
}

const cmd = process.argv[2] ?? "help";
if (cmd === "help" || cmd === "--help" || cmd === "-h") {
	say(`${bold(`Site Watch ${version}`)}

  npx @mrpwob/site-watch setup    Install Site Watch on your Cloudflare account, or update it

The first time, Cloudflare asks you to sign in and allow Wrangler in your browser. To use an API token instead,
set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID if the token can see more than one account). The token
needs: Workers Scripts Edit, D1 Edit and Account Settings Read.

More: https://paulobrien.dev/watch/`);
	process.exit(0);
}
if (cmd !== "setup" && cmd !== "update") {
	say(`Unknown command "${cmd}". Try: npx @mrpwob/site-watch help`);
	process.exit(1);
}

say(bold(`Installing Site Watch ${version} on your Cloudflare account`));
say("Wrangler makes the database on the first install and keeps it on updates.\n");
const deploy = run(["deploy", "--config", "wrangler.json"], { capture: true });
const address = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(deploy.stdout ?? "")?.[0] ?? null;

// A set-up code, only the first time (an update keeps the one you have).
const list = spawnSync(process.execPath, [wrangler, "secret", "list", "--config", "wrangler.json"], { cwd: here, encoding: "utf8" });
const hasCode = /SETUP_TOKEN/.test(list.stdout ?? "");
let code = null;
if (!hasCode) {
	code = randomBytes(18).toString("hex");
	run(["secret", "put", "SETUP_TOKEN", "--config", "wrangler.json"], { input: code, capture: true });
}

say("");
say(green(bold("Site Watch is installed.")));
if (code) {
	say(`\nMake your account with this one-time link (keep it private: it works until you've used it, and again to reset your password):\n`);
	say(bold(`${address ?? "https://<your Site Watch address>"}/setup?code=${code}`));
} else {
	say(`\nUpdated. Open ${address ?? "your Site Watch address"} and sign in as before.`);
}
say(`\nTo use your own domain, add it in Cloudflare under Workers & Pages › site-watch › Settings › Domains & Routes.`);
say(`Email alerts: see https://github.com/pobren/site-watch#email-alerts`);
