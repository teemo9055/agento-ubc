import { it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";

it.skipIf(!process.env.LIVE_ANCHOR)("writes an order fingerprint to Arc", async () => {
  (process.env as Record<string, string>).NODE_ENV = "development";
  loadEnvConfig(process.cwd(), true);
  const { anchorOrder } = await import("./anchor");
  const r = await anchorOrder({ id: "selftest", mode: "live" } as never, { venue: "gemini-sandbox", status: "open", detail: "test", orderId: "1" });
  console.log("ANCHOR", r.digest, r.tx);
  expect(r.tx).toMatch(/^0x/);
}, 120_000);
