import { it } from "vitest";
import { loadEnvConfig } from "@next/env";

/**
 * Buys one request from each kind of vendor payable on Arc testnet, through the same code the
 * agents use. Costs about 0.01 USDC of testnet money. Run with LIVE_VENDORS=1; skipped otherwise.
 */
it.skipIf(!process.env.LIVE_VENDORS)("the testnet-payable vendors take our payments", async () => {
  (process.env as Record<string, string>).NODE_ENV = "development";
  loadEnvConfig(process.cwd(), true);
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
  const only = process.env.LIVE_VENDORS;
  const show = (tag: string, v: unknown) => console.log(tag, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)).slice(0, 900));

  if (only === "1" || only === "onchain") {
    const onchain = await import("./onchain");
    show("ORACLE gold", await onchain.oraclePrices(["xauusd", "eurusd"]));
    show("GAS", await onchain.gasPrice("ethereum"));
    show("BTC", await onchain.bitcoinNetwork());
    show("BALANCE", await onchain.walletBalance("base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
  }
  if (only === "1" || only === "service") {
    const { callService, findService } = await import("./marketplace");
    const listing = await findService("https://api.botpay.network/pay");
    show("LISTING", listing);
    show("SERVICE", await callService(listing!, {}));
  }
}, 180_000);
