// Status page names: the part before the dot in name.sitepatrol.app (or after /status/ on installs without
// their own page domain). Checked as people type, so nobody ends up with a rude name, one that pretends to be
// a bank or a big company, or one we need for ourselves.

/** Ours, or names that would confuse people (mail, admin and so on). */
const RESERVED = new Set(
	"www www1 www2 api app apps admin administrator root mail email webmail smtp imap pop pop3 mx ns ns1 ns2 dns ftp sftp cdn static assets media img images files download downloads status statuspage live dashboard account accounts billing pay payment payments checkout invoice stripe help support helpdesk docs doc blog news about contact terms privacy legal security abuse postmaster hostmaster webmaster noreply no-reply info team sales test testing dev staging beta demo preview internal localhost autodiscover autoconfig login logout signin signup register auth oauth sso id my mcp hb connect site-patrol sitepatrol site-watch sitewatch patrol official".split(" "),
);

/** Rude, hateful or adult words: refused anywhere in the name, even run together with other words. */
const NEVER = [
	"fuck", "fuk", "fck", "shit", "cunt", "nigg", "nigga", "faggot", "fagg", "nazi", "hitler", "porn", "pr0n", "wank", "twat", "bitch",
	"slut", "whore", "bastard", "bollock", "spastic", "paedo", "pedophil", "childsex", "incest", "bestial", "kkk", "jihad",
	"suicide", "killyou", "motherf", "dickhead", "cocksuck", "asshole", "arsehole", "jizz", "cum-", "dildo", "hentai", "xxx", "nsfw",
	"wetback", "tranny", 
];

/** Words that are fine inside other words (Scunthorpe, Dickens, classic) but not on their own between dashes. */
const NOT_ALONE = new Set(["rape", "rapist", "rapists", "pedo", "pedos", "terror", "terrorist", "isis", "kys", "spic", "coon", "dyke", "paki", "gook", "chink", "kike", "retard", "retards", "ass", "arse", "dick", "cock", "tit", "tits", "piss", "fag", "cum", "sex", "nude", "nudes", "kill", "die", "hate", "anal", "poo", "crap", "damn", "hell", "nonce", "prick", "knob", "bum", "willy", "boob", "boobs", "scam", "hack", "hacked", "virus"]);

/** Names people would trust for the wrong reason: banks, big companies, government, and sign-in words. */
const LOOKALIKE = [
	"paypal", "icloud", "google", "gmail", "microsoft", "outlook", "office365", "amazon", "facebook", "instagram", "whatsapp", "netflix", "spotify",
	"ebay", "stripe", "mastercard", "amex", "coinbase", "binance", "metamask", "bitcoin", "crypto", "wallet", "barclays", "hsbc", "lloyds",
	"natwest", "santander", "nationwide", "monzo", "revolut", "starling", "halifax", "wellsfargo", "citibank", "hmrc", "govuk", "gov-uk", "dvla",
	"royalmail", "fedex", "cloudflare", "github", "verify", "verification", "password", "passwd", "signin",
	"login", "logon", "secure", "unlock", "refund", "giveaway", "freemoney",
];

/** Big names that are also everyday words (pineapple, riverbank, purchase, first): refused only on their own between dashes. */
const LOOKALIKE_ALONE = new Set(["apple", "visa", "bank", "chase", "nhs", "irs", "ups", "dpd", "dhl", "evri", "gov", "police", "meta"]);

export type NameCheck = { ok: true; name: string } | { ok: false; name: string; reason: string };

/** Tidies what someone typed into a name: lower case, spaces to dashes, nothing but letters, numbers and dashes. */
export function tidyName(x: unknown): string {
	if (typeof x !== "string") return "";
	return x.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Whether a name is allowed at all (not whether it's free). */
export function nameProblem(name: string): string | null {
	if (name.length < 3) return "Use at least 3 letters or numbers.";
	if (/^xn-/.test(name)) return "Please use plain letters and numbers.";
	if (/^\d+$/.test(name)) return "Please include at least one letter.";
	if (RESERVED.has(name)) return "That name is kept for us. Please choose another.";
	const flat = name.replace(/-/g, "").replace(/scunthorpe|penistone|clitheroe|shitterton/g, "");
	// Common swaps people use to sneak words past a filter: 0 for o, 1 for i, 3 for e, 4 for a, 5 for s, 7 for t.
	const plain = flat.replace(/0/g, "o").replace(/[1!]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
	const parts = name.split("-");
	if (NEVER.some((w) => flat.includes(w.replace(/-/g, "")) || plain.includes(w.replace(/-/g, ""))) || parts.some((p) => NOT_ALONE.has(p)))
		return "That name isn't allowed. Please choose another.";
	if (LOOKALIKE.some((w) => flat.includes(w.replace(/-/g, "")) || plain.includes(w.replace(/-/g, ""))) || parts.some((p) => LOOKALIKE_ALONE.has(p)))
		return "That name could be mistaken for a bank, a big company or a sign-in page. Please choose another.";
	return null;
}
