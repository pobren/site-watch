// The page owner's social accounts (1.17.0), shown as links in the status page footer so visitors can follow
// updates there too. Each is the full https:// address of their profile on that network.

export const SOCIALS = [
	{ key: "x", name: "X", hosts: ["x.com", "twitter.com"] },
	{ key: "bluesky", name: "Bluesky", hosts: ["bsky.app"] },
	{ key: "linkedin", name: "LinkedIn", hosts: ["linkedin.com"] },
	{ key: "facebook", name: "Facebook", hosts: ["facebook.com", "fb.com"] },
	{ key: "instagram", name: "Instagram", hosts: ["instagram.com"] },
	{ key: "threads", name: "Threads", hosts: ["threads.net", "threads.com"] },
	{ key: "youtube", name: "YouTube", hosts: ["youtube.com"] },
	// Mastodon lives on many servers, so any https address is fine.
	{ key: "mastodon", name: "Mastodon", hosts: null },
] as const;

export type Social = Partial<Record<(typeof SOCIALS)[number]["key"], string>>;

/** Checks what the page editor sent: null clears them all, a string is the JSON to keep, or what's wrong. */
export function cleanSocial(x: unknown): string | null | { error: string } {
	if (x === null || x === "") return null;
	if (typeof x !== "object" || Array.isArray(x)) return { error: "Please give your social accounts as web addresses." };
	const out: Social = {};
	for (const s of SOCIALS) {
		const v = (x as Record<string, unknown>)[s.key];
		if (v === undefined || v === null || v === "") continue;
		if (typeof v !== "string") return { error: `Please give the ${s.name} address as a web address.` };
		let u: URL;
		try {
			u = new URL(v.trim().startsWith("http") ? v.trim() : `https://${v.trim()}`);
		} catch {
			return { error: `That ${s.name} address doesn't look right. Copy it from your profile page.` };
		}
		const host = u.hostname.replace(/^(www|m)\./, "");
		if (u.protocol !== "https:" || u.href.length > 300 || (s.hosts && !s.hosts.some((h) => host === h || host.endsWith(`.${h}`))))
			return { error: `That ${s.name} address doesn't look right. Copy it from your profile page, such as https://${s.hosts ? s.hosts[0] : "mastodon.social"}/yourname.` };
		out[s.key] = u.href;
	}
	return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** The saved accounts, in the order above. */
export function readSocial(raw: string | null | undefined): Social {
	if (!raw) return {};
	try {
		const j = JSON.parse(raw) as Record<string, unknown>;
		const out: Social = {};
		for (const s of SOCIALS) if (typeof j[s.key] === "string") out[s.key] = j[s.key] as string;
		return out;
	} catch {
		return {};
	}
}

/** Links for the page footer: "Follow us on X, Bluesky and LinkedIn". Empty when there are none. */
export function socialLine(social: Social, esc: (s: string) => string): string {
	const links = SOCIALS.filter((s) => social[s.key]).map((s) => `<a href="${esc(social[s.key]!)}" rel="me noopener" target="_blank">${s.name}</a>`);
	if (!links.length) return "";
	const list = links.length === 1 ? links[0] : `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}`;
	return `Follow us on ${list}`;
}
