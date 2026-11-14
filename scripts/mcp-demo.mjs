// Plays "your AI" over MCP: look up markets, propose its own move, wait for the human to approve, read results.
// Usage: node scripts/mcp-demo.mjs [http://localhost:3000] [--auto-approve]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const autoApprove = process.argv.includes("--auto-approve");
const headers = process.env.MCP_TOKEN ? { authorization: `Bearer ${process.env.MCP_TOKEN}` } : {};
const client = new Client({ name: "mcp-demo", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(`${name}: ${t}`);
  try { return JSON.parse(t); } catch { return t; }
};

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const found = await call("look_up", { tool: "search_markets", args: { query: "BTC" } });
const event = found.data.find((e) => e.contracts.some((c) => c.ask != null)) ?? found.data[0];
const contract = event.contracts.find((c) => c.ask != null) ?? event.contracts[0];
const max = Math.min(0.99, Math.round(((contract.ask ?? contract.last ?? 0.5) + 0.01) * 100) / 100);
console.log("my AI picked:", event.title, "·", contract.label, "at", max);
const draft = await call("propose_move", {
  agent: "inso",
  task: "Small BTC bet if the price holds",
  move: {
    title: `Buy YES: ${contract.label}`.slice(0, 60),
    why: "Picked by the client's own AI from the free lookup.",
    ask: `Buy 2 YES at ${Math.round(max * 100)}¢ or less?`,
    research: [{ tool: "odds_history", args: { symbol: contract.symbol, tf: "15m" }, label: "Odds history", why: "trend first" }],
    action: { kind: "prediction_order", eventTicker: event.ticker, symbol: contract.symbol, label: contract.label.slice(0, 60), side: "yes", maxPrice: max, quantity: 2 },
    condition: { metric: "yes_price", symbol: contract.symbol, op: "<=", value: max },
  },
});
console.log("draft:", draft.cost.approvedUSDC, "USDC ·", draft.nextStep);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("can the AI approve?", tools.some((t) => /approve/.test(t)) ? "YES (bad)" : "no — approval is human-only");
if (autoApprove) await fetch(`${base}/api/runs/${draft.id}/approve`, { method: "POST" });
else console.log(`Approve it yourself: ${draft.url}`);
for (let i = 0; i < 90; i++) {
  const job = await call("get_job", { id: draft.id });
  if (job.status === "done" || job.status === "cancelled") break;
  await new Promise((r) => setTimeout(r, 2000));
}
const data = await call("get_job_data", { id: draft.id });
console.log("result:", data.headline);
const receipt = await call("get_receipt", { id: draft.id });
console.log("receipt:", receipt.total, "paid in", receipt.lines.length, "payments ·", receipt.decisions.length, "decisions");
await client.close();
