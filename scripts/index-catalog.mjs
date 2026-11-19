// Crawls Circle's Agent Marketplace catalog into Agento's capability map, through a running server.
// Usage: node scripts/index-catalog.mjs [http://localhost:3000] [max listings]
// If the server sets LIVE_ACCESS_CODE, pass it as ACCESS_CODE=… (crawling spends model calls).
const [base = "http://localhost:3000", max] = process.argv.slice(2);
const t0 = Date.now();
console.log(`Crawling the catalog through ${base}…`);
const r = await fetch(`${base}/api/catalog`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ accessCode: process.env.ACCESS_CODE, ...(max ? { max: Number(max) } : {}) }),
});
const body = await r.json();
if (!r.ok) {
  console.error(`Crawl failed (${r.status}): ${body.error ?? JSON.stringify(body)}`);
  process.exit(1);
}
console.log(`${body.seen} of ${body.total} listings read · ${body.tagged} tagged · ${body.kept} unchanged · ${body.pruned} removed · ${body.aiCalls} model calls · ${Math.round((Date.now() - t0) / 1000)}s`);
const stats = await (await fetch(`${base}/api/catalog?stats=1`)).json();
console.log(`Map: ${stats.total} listings, ${stats.tagged} with typed inputs or outputs, ${stats.payableNow} payable now, ${stats.payableMainnet} payable on Arc mainnet`);
