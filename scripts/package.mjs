// Builds the npm package @mrpwob/site-watch into npm/: the installer (cli.mjs), the Worker bundled into one file
// (worker.js) and the Wrangler settings it deploys with (wrangler.json). Run: npm run package
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "npm");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

await build({ entryPoints: [join(root, "src/index.ts")], bundle: true, format: "esm", target: "es2022", platform: "neutral", outfile: join(out, "worker.js"), external: ["cloudflare:*"], legalComments: "none" });

// Same settings as wrangler.jsonc, pointing at the bundle.
const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/"\$schema":[^\n]*\n/, ""));
writeFileSync(join(out, "wrangler.json"), JSON.stringify({ ...config, main: "worker.js", no_bundle: true, rules: [{ type: "ESModule", globs: ["**/*.js"] }] }, null, "\t"));

cpSync(join(root, "installer/cli.mjs"), join(out, "cli.mjs"));
for (const f of ["README.md", "LICENSE"]) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, "package.json"), JSON.stringify({
	name: "@mrpwob/site-watch",
	version: pkg.version,
	description: "Install and update Site Watch, a website, server and job monitor, on your own Cloudflare account.",
	type: "module",
	bin: { "site-watch": "cli.mjs" },
	files: ["cli.mjs", "worker.js", "wrangler.json", "README.md", "LICENSE"],
	engines: { node: ">=20" },
	dependencies: { wrangler: pkg.devDependencies.wrangler },
	keywords: ["uptime", "monitoring", "status-page", "cloudflare", "workers", "self-hosted"],
	homepage: "https://paulobrien.dev/watch/",
	repository: { type: "git", url: "git+https://github.com/pobren/site-watch.git" },
	bugs: { url: "https://github.com/pobren/site-watch/issues" },
	license: "SEE LICENSE IN LICENSE",
	publishConfig: { access: "public" },
}, null, "\t") + "\n");
console.log(`npm/ ready: @mrpwob/site-watch ${pkg.version}`);
