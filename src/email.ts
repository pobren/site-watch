// Branded emails: every email goes out as HTML in the install's own name, logo and colour, with the plain text
// beside it for mail apps that prefer text. The HTML is built from the same text, so the two always say the same.
//
// How the text becomes HTML: paragraphs are split on blank lines; a paragraph that is "Label: https://..." or just
// a link becomes a button; any other link is made clickable. Everything else is escaped, so nothing can inject HTML.

import type { Alert } from "./core.ts";
import type { Brand } from "./db.ts";

export type Tone = "down" | "up" | "warn" | null;

export interface EmailLook {
	brand: Brand;
	/** A coloured strip and badge above the title: red for down, green for back up, amber for a warning. */
	tone?: Tone;
	/** The words on the button made from a paragraph that is just a link. */
	button?: string;
	/** A line at the foot, such as why they got this email. */
	footer?: string;
	/** Where the name at the top links to. */
	home?: string | null;
}

const TONES: Record<Exclude<Tone, null>, { colour: string; soft: string; word: string }> = {
	down: { colour: "#B91C1C", soft: "#FEF2F2", word: "Down" },
	up: { colour: "#15803D", soft: "#F0FDF4", word: "Back up" },
	warn: { colour: "#B45309", soft: "#FFFBEB", word: "Needs a look" },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

/** A colour safe to put in a style attribute. */
const colourOf = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#0f766e");

/** Mail apps such as Gmail don't show SVG or data: pictures, so only a normal https picture is used. */
export const emailLogo = (logo: string | null) => (logo && /^https:\/\//i.test(logo) && !/\.svg(\?|#|$)/i.test(logo) ? logo : null);

function linkify(text: string, colour: string): string {
	let out = "";
	let last = 0;
	for (const m of text.matchAll(URL_RE)) {
		out += esc(text.slice(last, m.index));
		out += `<a href="${esc(m[0])}" style="color:${colour};text-decoration:underline">${esc(m[0])}</a>`;
		last = m.index! + m[0].length;
	}
	return (out + esc(text.slice(last))).replace(/\n/g, "<br>");
}

function button(label: string, href: string, colour: string): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:12px;background:${colour}"><a href="${esc(href)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(label)} &rarr;</a></td></tr></table>`;
}

/** The HTML version of an email, in the install's brand. */
export function brandedHtml(subject: string, text: string, look: EmailLook): string {
	const b = look.brand;
	const colour = colourOf(b.colour);
	const tone = look.tone ? TONES[look.tone] : null;
	const logo = emailLogo(b.logo);
	const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
	const firstText = paras.find((p) => !/^(?:[^\n:]{1,60}:\s*)?https?:\/\/\S+$/.test(p)) ?? "";
	const body = paras.map((p) => {
		const labelled = /^([^\n:]{1,60}):\s*(https?:\/\/\S+)$/.exec(p);
		if (labelled) return button(labelled[1], labelled[2], colour);
		if (/^https?:\/\/\S+$/.test(p)) return button(look.button ?? `Open ${b.name}`, p, colour);
		return `<p style="margin:0 0 16px">${linkify(p, colour)}</p>`;
	}).join("\n");
	const name = look.home ? `<a href="${esc(look.home)}" style="color:${colour};text-decoration:none">${esc(b.name)}</a>` : esc(b.name);
	const head = logo
		? `<img src="${esc(logo)}" alt="" width="32" height="32" style="width:32px;height:32px;vertical-align:middle;border:0;margin-right:10px">${name}`
		: name;
	const badge = tone ? `<p style="margin:0 0 10px"><span style="display:inline-block;background:${tone.soft};color:${tone.colour};font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:5px 10px;border-radius:999px">${tone.word}</span></p>` : "";
	const foot = [look.footer ? linkify(look.footer, colour) : "", `Sent by ${name}`, b.hideCredit ? "" : "Runs on Site Watch"].filter(Boolean).join("<br>");
	return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F5F3;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#11201A">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F2F5F3;opacity:0">${esc(firstText.slice(0, 140))}${"&#8203;&nbsp;".repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F5F3"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 16px;font-size:20px;font-weight:800;color:${colour}">${head}</td></tr>
<tr><td style="background:#ffffff;border-radius:18px;border-top:6px solid ${tone ? tone.colour : colour};padding:28px 28px 12px;font-size:16px;line-height:1.6">
${badge}<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#11201A">${esc(subject)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 6px 0;font-size:13px;line-height:1.6;color:#6B7C74">${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

/** The colour an alert email gets: red when something's down, green when it's back, amber for warnings. */
export function toneOf(a: Alert): Tone {
	if (a.type === "monitor.up") return "up";
	if (a.type === "monitor.down" || a.type === "monitor.cert") return "down";
	if (a.type) return a.urgent ? "down" : "warn";
	return null;
}
