import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test("Settings offers practice, Arc testnet and Arc mainnet; mainnet says what's missing until it's set up", async ({ page }) => {
  await prefs(page);
  await page.goto("/settings");
  await expect(page.getByTestId("rail-practice")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("rail-testnet")).toBeVisible();
  // This test server has no mainnet factory: the choice is shown, off, with the reason.
  await expect(page.getByTestId("rail-mainnet")).toBeDisabled();
  await expect(page.getByTestId("mainnet-setup")).toContainText("MAINNET_FACTORY_ADDRESS");
});

test("a real-money job is never quietly turned into practice", async ({ request }) => {
  const r = await request.post("/api/runs", { data: { agent: "inso", task: "What are BTC odds right now?", mode: "live", network: "mainnet" } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect((await r.json()).error).toMatch(/mainnet/i);
  // Both networks are described for the app and for other agents.
  const cfg = await (await request.get("/api/config")).json();
  expect(cfg.networks.testnet.name).toBe("Arc testnet");
  expect(cfg.networks.mainnet).toMatchObject({ name: "Arc mainnet", live: false, maxJobUsd: 5 });
});
