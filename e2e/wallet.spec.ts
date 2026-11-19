import { expect, test, type Page } from "@playwright/test";
import { prefs } from "./helpers";

// Never moves money: Arc RPC reads, the session route and the widget are all answered here.
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
  await expect(page.getByTestId("onramp-start")).toBeDisabled();

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
  await expect(page.getByTestId("onramp-start")).toHaveText(/Buy USDC/);
  await expect(page.getByTestId("explorer-link")).toHaveAttribute("href", `https://explorer.arc.io/address/${ADDR}`);

  // The choice is kept for this page only: looking at mainnet here never moves jobs onto real money.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("agento:prefs") ?? "{}"));
  expect(stored.walletNetwork).toBe("mainnet");
  expect(stored.network).toBeUndefined();
  await net.getByRole("radio", { name: /Testnet/ }).click();
  await expect(page.getByTestId("faucet-card")).toBeVisible();
});

test("buy with card on testnet asks for a sandbox session and mounts the widget", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/onramp/sessions", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "e2e",
        sessionToken: "e2e-token",
        traceId: "e2e-trace",
        destinationWallet: ADDR,
        widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=e2e-token&pairs=USDC%3Aarc",
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      }),
    });
  });
  await page.route("https://onramp-sandbox.arc.io/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>widget</title><p>Fake onramp widget</p>" }));

  await page.goto("/wallet");
  await page.getByTestId("address-input").fill(ADDR);
  await expect(page.getByTestId("onramp-card")).toContainText("test card data");
  await page.getByTestId("onramp-start").click();

  await expect(page.getByTestId("onramp-panel")).toBeVisible();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toMatchObject({ network: "testnet", destinationAddress: ADDR });
  expect(String(sent!.appUserId)).toMatch(/^u_[0-9a-f]{32}$/);
  await expect(page.locator('[data-testid="onramp-widget"] iframe')).toHaveAttribute("src", /^https:\/\/onramp-sandbox\.arc\.io\//);
});

test("buying on mainnet without the production key says so plainly", async ({ page }) => {
  await page.route("**/api/onramp/sessions", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Buying real USDC needs the app's production Circle key, which isn't set up yet" }) }),
  );
  await page.goto("/wallet");
  await page.getByRole("radiogroup", { name: "Network" }).getByRole("radio", { name: /Mainnet/ }).click();
  await page.getByTestId("address-input").fill(ADDR);
  await page.getByTestId("onramp-start").click();
  await expect(page.getByTestId("onramp-error")).toContainText("production Circle key");
});

test("with a browser wallet, the transfer panel loads Bridge Kit and offers the source chains", async ({ page }) => {
  // A stub wallet that can only say who it is: nothing can be signed or sent.
  await page.addInitScript(() => {
    const account = "0x1111111111111111111111111111111111111111";
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
        if (method === "eth_chainId") return "0xaa36a7";
        throw new Error(`stub wallet: ${method} not supported`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
  await page.goto("/wallet");
  await page.getByTestId("address-input").fill(ADDR);
  await page.getByTestId("bridge-start").click();
  await page.getByTestId("bridge-connect").click();
  const source = page.getByTestId("bridge-source");
  await expect(source).toBeVisible({ timeout: 20_000 });
  await expect(source.locator("option")).toHaveText(["Ethereum Sepolia", "Base Sepolia", "Arbitrum Sepolia", "OP Sepolia", "Polygon Amoy"]);
  await expect(page.getByTestId("bridge-panel").getByRole("alert")).toHaveCount(0);
  await page.getByTestId("bridge-amount").fill("1.5");
  await expect(page.getByTestId("bridge-estimate")).toBeEnabled();
});

test("no browser wallet: the transfer panel says so", async ({ page }) => {
  await page.goto("/wallet");
  await page.getByTestId("address-input").fill(ADDR);
  await expect(page.getByTestId("bridge-card")).toContainText("No browser wallet found");
  await page.getByTestId("bridge-start").click();
  await expect(page.getByTestId("no-browser-wallet")).toBeVisible();
});
