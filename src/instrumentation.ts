export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MARKET_DATA) {
    const { installFixtures } = await import("./server/fixtures");
    installFixtures();
  }
  // The capability map: crawl the marketplace catalog 30s after boot, then every CATALOG_REFRESH_HOURS.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VITEST && !process.env.MARKET_DATA && process.env.CATALOG_CRAWL !== "off") {
    const { crawlCatalog } = await import("./server/catalog/crawl");
    const run = () => void crawlCatalog().catch((e: Error) => console.warn("catalog crawl:", e.message));
    setTimeout(run, 30_000).unref();
    setInterval(run, Number(process.env.CATALOG_REFRESH_HOURS ?? 12) * 3_600_000).unref();
  }
}
