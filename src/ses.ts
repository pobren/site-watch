// Amazon SES with nothing but Web Crypto (AWS Signature Version 4), for emails to status page subscribers. Big lists
// cost about a tenth of a penny per 10 emails this way. Without SES keys, the EMAIL binding sends them instead.

const enc = new TextEncoder();

async function sha256Hex(data: string): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
	const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

function hex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** AWS's flavour of URI encoding: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export function awsEncode(s: string): string {
	return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface AwsKeys {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
}

export interface SignInput {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	service: string;
	/** "YYYYMMDDTHHMMSSZ"; defaults to now. */
	amzDate?: string;
	/** S3 only: the body's SHA-256, or UNSIGNED-PAYLOAD for a body streamed from R2. Defaults to the hash of body. */
	payloadHash?: string;
}

/** Returns the headers to send: the given ones plus host, x-amz-date and authorization. */
export async function signAws(input: SignInput, keys: AwsKeys): Promise<Record<string, string>> {
	const url = new URL(input.url);
	const amzDate = input.amzDate ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const day = amzDate.slice(0, 8);
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v.trim();
	headers.host = url.host;
	headers["x-amz-date"] = amzDate;

	const names = Object.keys(headers).sort();
	const query = [...url.searchParams].map(([k, v]) => [awsEncode(k), awsEncode(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
	const path = url.pathname.split("/").map((p) => awsEncode(decodeURIComponent(p))).join("/") || "/";
	const canonical = [input.method, path, query.map(([k, v]) => `${k}=${v}`).join("&"), names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), input.payloadHash ?? (await sha256Hex(input.body))].join("\n");
	const scope = `${day}/${keys.region}/${input.service}/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");

	let key = await hmac(enc.encode(`AWS4${keys.secretAccessKey}`), day);
	key = await hmac(key, keys.region);
	key = await hmac(key, input.service);
	key = await hmac(key, "aws4_request");
	const signature = hex(await hmac(key, toSign));

	const { host: _host, ...rest } = headers;
	return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

export interface AwsAnswer {
	ok: boolean;
	status: number;
	data: any;
	text: string;
}

/** One signed SES v2 call (JSON). */
export async function ses(keys: AwsKeys, method: string, path: string, body: unknown = null, fetcher: typeof fetch = fetch): Promise<AwsAnswer> {
	const url = `https://email.${keys.region}.amazonaws.com/v2/email${path}`;
	const text = body === null ? "" : JSON.stringify(body);
	const headers = await signAws({ method, url, headers: body === null ? {} : { "content-type": "application/json" }, body: text, service: "ses" }, keys);
	const res = await fetcher(url, { method, headers, body: body === null ? undefined : text });
	const out = await res.text();
	let data: any = null;
	try {
		data = out ? JSON.parse(out) : null;
	} catch {}
	// SESv2 puts the error name in a header and only a sentence in the body, so keep the name with the text.
	const kind = res.headers.get("x-amzn-errortype")?.split(":")[0] ?? "";
	return { ok: res.ok, status: res.status, data, text: kind ? `${kind} ${out}` : out };
}

/** Sends one raw email (MIME, as rawEmail makes) through SES. Null when sent, otherwise what went wrong; "slow" when
 *  Amazon asks us to slow down, so the batch can be tried again later. */
export async function sesSend(keys: AwsKeys, from: string, to: string, raw: string, fetcher: typeof fetch = fetch): Promise<string | null> {
	const data = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
	const a = await ses(keys, "POST", "/outbound-emails", { FromEmailAddress: from, Destination: { ToAddresses: [to] }, Content: { Raw: { Data: data } } }, fetcher);
	if (a.ok) return null;
	if (a.status === 429 || /Throttl|TooManyRequests|Maximum sending rate/i.test(a.text)) return "slow";
	return a.text.slice(0, 200) || `error ${a.status}`;
}
