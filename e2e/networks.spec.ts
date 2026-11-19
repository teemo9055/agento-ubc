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

test("mainnet picked on a server that can't pay there: jobs use testnet, and the page says so before Ask", async ({ page, request }) => {
  const cfg = await (await request.get("/api/config")).json();
  test.skip(!cfg.live || cfg.networks.mainnet.live, "needs a server live on testnet only");
  await page.addInitScript(() => localStorage.setItem("agento:prefs", JSON.stringify({ mode: "live", network: "mainnet", payFrom: "app", faults: [] })));
  let sent: { network?: string } | null = null;
  await page.route("**/api/runs", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: "stopped by the test" } });
  });
  await page.goto("/new");
  await expect(page.getByTestId("mainnet-held-back")).toContainText("jobs run on Arc testnet");
  await expect(page.getByTestId("ask-status")).toContainText("test USDC on Arc testnet");
  await page.fill("#task", "What are BTC odds right now?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect.poll(() => sent?.network).toBe("testnet");
  // Settings shows where jobs really pay.
  await page.goto("/settings");
  await expect(page.getByTestId("rail-testnet")).toHaveAttribute("aria-checked", "true");
});
