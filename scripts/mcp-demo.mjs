// Plays "your AI" over MCP: browse, draft its own plan, wait for the human to approve, read results.
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
const { events } = await call("browse_options", { agent: "inso", query: "BTC" });
const picks = events.filter((e) => /btc/i.test(e.title)).slice(0, 2);
console.log("my AI picked:", picks.map((e) => e.title).join(" | "));
const draft = await call("draft_work_order", {
  agent: "inso",
  task: "How have BTC odds moved today?",
  plan: { eventTickers: picks.map((e) => e.ticker), markets: 2, tape: false, timeframe: "15m", cards: { deliverableTitle: "BTC odds today", deliverablePoints: ["2 BTC price markets", "Odds over time"], riskPoints: ["Read-only", "Thin markets"] } },
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
