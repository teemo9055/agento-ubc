import { beforeAll, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("../marketplace", async (orig) => ({ ...(await orig<typeof import("../marketplace")>()), searchServices: async () => [] }));

const { registerTownTools } = await import("./mcp");
const { articleMarkdown } = await import("./format");
const { readEntry } = await import("./library");
let client: Client;
beforeAll(async () => {
  const server = new McpServer({ name: "town", version: "0" });
  registerTownTools(server, "http://app.test");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { error: Boolean(r.isError), text: r.content[0].text, json: () => JSON.parse(r.content[0].text) };
};

it("agents reach every building over MCP", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["library_search", "library_read", "store_search", "store_read", "store_submit", "hall_request", "hall_status", "town_board", "town_post"]));

  const hits = (await call("library_search", { query: "x402" })).json();
  expect(hits[0].url).toMatch(/^http:\/\/app\.test\/town\/library\//);
  // library_read returns the same Markdown as the article's "For agents" view.
  const read = await call("library_read", { id: "read-arc" });
  expect(read.text).toBe(articleMarkdown(readEntry("read-arc")!, "http://app.test"));
  expect(read.text).toMatch(/^# Read Arc with read_arc/);
  expect(read.text).toMatch(/read_arc/);

  const item = await call("store_read", { id: "agento-cover.quote" });
  expect(item.text).toContain("# cover.quote");
  expect((await call("store_read", { id: "agento-nope" })).error).toBe(true);

  // Practice mode (no wallets here): recorded with a practice deposit.
  const sent = (await call("hall_request", { kind: "need", text: "A cheaper weather feed", from: "bot" })).json();
  expect(sent).toMatchObject({ status: "received", by: "agent", deposit: { mode: "practice", state: "held" } });
  expect((await call("hall_status", { id: sent.id })).json().status).toBe("received");

  expect((await call("store_submit", { name: "Wx", description: "Weather per request", url: "http://insecure.example", seller: "Wx" })).error).toBe(true);
  expect((await call("store_submit", { name: "Wx", description: "Weather per request", url: "https://wx.example", seller: "Wx" })).json().listing.status).toBe("pending");
  expect((await call("store_search", { query: "" })).json().waitingForCheck).toBe(1);
  expect((await call("town_post", { board: "lab", itemId: sent.id, kind: "finding", text: "Not routed yet" })).error).toBe(true);
});
