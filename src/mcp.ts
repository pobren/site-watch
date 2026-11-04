// The AI connector at /mcp: add Site Watch to Claude, ChatGPT or any MCP app and ask "is anything down?" or "what
// was my uptime last month?". It only reads. Sign in through OAuth (oauth.ts), or send an API key (keys.ts) from apps
// that let you add a header. The same answers as the public API (v1.ts).

import { getMonitor, listAlerts, listMonitors, listPages } from "./v1.ts";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Site Watch watches one person's websites, mail servers, ports and scheduled jobs (heartbeats) and alerts them when something stops working. These tools read what it watches.
- status is up, down, cert (a certificate problem), blocked (the server turned the checks away), unsure (one failed check), paused or checking.
- uptime is the share of checks that found it working, over the last 30 and 90 days.
- certificate and domain give when a website's certificate and its domain registration run out.
- Times are UTC.
Start with list_monitors.`;

const TOOLS = [
	{
		name: "list_monitors",
		title: "What's being watched",
		description: "Every website, mail server, port and heartbeat being watched, with whether it's working now, uptime over 30 and 90 days, response time, certificate expiry and domain renewal date.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_monitor",
		title: "One monitor",
		description: "One monitor in full, with its last 10 outages (when each started and ended, and why). Use the id from list_monitors.",
		inputSchema: { type: "object", properties: { id: { type: "string", description: "The monitor's id from list_monitors." } }, required: ["id"] },
	},
	{
		name: "list_alerts",
		title: "Recent alerts",
		description: "The latest alerts sent (down, back up, certificate and renewal reminders), newest first, with where each was sent.",
		inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, description: "How many. Default 25." } } },
	},
	{
		name: "list_status_pages",
		title: "Status pages",
		description: "The public status pages, which monitors each shows, and their notices from the last 14 days.",
		inputSchema: { type: "object", properties: {} },
	},
].map((t) => ({ ...t, annotations: { title: t.title, readOnlyHint: true, openWorldHint: false } }));

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Handles one POST to the connector. The caller has already checked who it is. */
export async function handleMcp(request: Request, db: D1Database, accountId: string, origin: string, version: string): Promise<Response> {
	if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
	}
	const batch = Array.isArray(body);
	const messages = (batch ? body : [body]) as Rpc[];
	const replies = (await Promise.all(messages.map((m) => answer(m, db, accountId, origin, version)))).filter((r) => r !== null);
	if (!replies.length) return new Response(null, { status: 202 });
	return json(batch ? replies : replies[0]);
}

async function answer(msg: Rpc, db: D1Database, accountId: string, origin: string, version: string): Promise<unknown> {
	if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
		return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid request" } };
	}
	if (msg.id === undefined || msg.id === null) return null; // a notification: nothing to send back
	const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
	switch (msg.method) {
		case "initialize": {
			const asked = String(msg.params?.protocolVersion ?? "");
			return ok({
				protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
				capabilities: { tools: {} },
				serverInfo: { name: "site-watch", title: "Site Watch", version, websiteUrl: "https://paulobrien.dev/watch/" },
				instructions: INSTRUCTIONS,
			});
		}
		case "ping":
			return ok({});
		case "tools/list":
			return ok({ tools: TOOLS });
		case "tools/call": {
			const name = String(msg.params?.name ?? "");
			const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
			if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } };
			try {
				const data = await callTool(name, args, db, accountId, origin);
				return ok({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
			} catch (e) {
				return ok({ content: [{ type: "text", text: e instanceof Error ? e.message : "Something went wrong" }], isError: true });
			}
		}
		default:
			return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
	}
}

async function callTool(name: string, args: Record<string, unknown>, db: D1Database, accountId: string, origin: string): Promise<Record<string, unknown>> {
	if (name === "list_monitors") return { monitors: await listMonitors(db, accountId, origin) };
	if (name === "get_monitor") {
		const m = await getMonitor(db, accountId, String(args.id ?? ""), origin);
		if (!m) throw new Error("No monitor has that id. Use list_monitors to see the ids.");
		return { monitor: m };
	}
	if (name === "list_alerts") return { alerts: await listAlerts(db, accountId, Number(args.limit ?? 25)) };
	return { pages: await listPages(db, accountId, origin) };
}
