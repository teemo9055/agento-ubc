import { expect, test, type Page } from "@playwright/test";
import { prefs } from "./helpers";

// Never moves money: Arc RPC reads are answered here.
const ADDR = "0x000000000000000000000000000000000000dEaD";
const BALANCE = 12_500_000n; // 12.50 USDC (6 decimals)

async function fakeArc(page: Page) {
  const answer = (req: { id: number; method: string }) => ({
    jsonrpc: "2.0",
    id: req.id,
    result: req.method === "eth_call" ? `0x${BALANCE.toString(16).padStart(64, "0")}` : req.method === "eth_chainId" ? "0x4cef52" : "0x0",
  });
  for (const rpc of ["https://rpc.testnet.arc.network/**", "https://rpc.mainnet.arc.io/**"]) {
    await page.route(rpc, async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
    });
  }
}

test.beforeEach(async ({ page }) => {
  await prefs(page);
  await fakeArc(page);
});

test("add money: network switch, address check, balance", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Add money" })).toBeVisible();
  const net = page.getByRole("radiogroup", { name: "Network" });
  await expect(net.getByRole("radio", { name: /Testnet/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Your address on Arc testnet" })).toBeVisible();
  await expect(page.getByTestId("faucet-card")).toBeVisible();
  await expect(page.getByTestId("real-money")).toHaveCount(0);

  // A bad address is called out and nothing can start.
  await page.getByTestId("address-input").fill("0x1234");
  await expect(page.getByTestId("address-error")).toBeVisible();
  await expect(page.getByTestId("app-faucet")).toBeDisabled();

  // A good one shows its balance and an explorer link on the chosen network.
  await page.getByTestId("address-input").fill(ADDR);
  await expect(page.getByTestId("address-error")).toHaveCount(0);
  await expect(page.getByTestId("balance")).toContainText("12.50");
  await expect(page.getByTestId("explorer-link")).toHaveAttribute("href", `https://explorer.testnet.arc.io/address/${ADDR}`);

  // Mainnet: plainly real money, labels flip, no faucet.
  await net.getByRole("radio", { name: /Mainnet/ }).click();
  await expect(net.getByRole("radio", { name: /Mainnet/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("real-money")).toContainText("real money");
  await expect(page.getByRole("heading", { name: "Your address on Arc mainnet" })).toBeVisible();
  await expect(page.getByTestId("faucet-card")).toHaveCount(0);
  await expect(page.getByTestId("send-card")).toContainText("Send USDC on the Arc network");
  await expect(page.getByTestId("explorer-link")).toHaveAttribute("href", `https://explorer.arc.io/address/${ADDR}`);

  // The choice is kept for this page only: looking at mainnet here never moves jobs onto real money.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("agento:prefs") ?? "{}"));
  expect(stored.walletNetwork).toBe("mainnet");
  expect(stored.network).toBeUndefined();
  await net.getByRole("radio", { name: /Testnet/ }).click();
  await expect(page.getByTestId("faucet-card")).toBeVisible();
});
