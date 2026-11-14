import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { buildMcpServer } from "@/server/mcp";

export const dynamic = "force-dynamic";

/** Optional shared token. Set MCP_TOKEN wherever the app is reachable by others. */
function authorized(req: Request) {
  const want = process.env.MCP_TOKEN;
  // Hosted deployments must set a token; without one, only local use is allowed.
  if (!want) return process.env.NODE_ENV !== "production" || process.env.MCP_OPEN === "true";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
  const base = process.env.APP_PUBLIC_URL ?? new URL(req.url).origin;
  // Stateless: a fresh server and transport per request.
  const server = buildMcpServer(base);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
