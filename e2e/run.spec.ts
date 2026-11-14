import { expect, test, type Page } from "@playwright/test";

async function start(page: Page, faults: string[] = [], task = "How have BTC odds moved today?", agent = "Inso") {
  await page.goto("/");
  await page.getByRole("tab", { name: new RegExp(agent) }).click();
  await page.fill("#task", task);
  await page.getByRole("radio", { name: "Demo rail" }).click();
  if (faults.length) {
    await page.getByText("Test mode").click();
    for (const f of faults) await page.locator("label", { hasText: f }).click();
  }
  await page.getByRole("button", { name: /Get work order/ }).click();
  await expect(page.getByTestId("card-price")).toBeVisible();
  const approved = (await page.getByTestId("big-number").innerText()).replace(/USDC|\s/g, "");
  await page.getByTestId("open-approve").click();
  await page.getByTestId("approve").click();
  return approved;
}

const receipt = (page: Page) => expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 60_000 });

test("pre-approved big spend runs with no popup", async ({ page }) => {
  await start(page);
  await receipt(page);
  await expect(page.getByText("Big spend · approved up front")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("1 big spends pre-approved")).toBeVisible();
});

test("impossible card edit explains why and offers alternatives", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task", "BTC odds");
  await page.getByRole("radio", { name: "Demo rail" }).click();
  await page.getByRole("button", { name: /Get work order/ }).click();
  await page.getByTestId("card-deliverable").click();
  await page.getByRole("dialog").locator("input").fill("place a real bet on yes");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Can't do that")).toBeVisible();
  await page.getByRole("button", { name: "Track 5 markets" }).click();
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await page.getByTestId("apply-edit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("card-deliverable")).toContainText("5 markets");
});

test("method picker re-prices and AI IDE adds a 0 USDC subscription line", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task", "BTC odds");
  await page.getByRole("radio", { name: "Demo rail" }).click();
  await page.getByRole("button", { name: /Get work order/ }).click();
  const before = await page.getByTestId("big-number").innerText();
  await page.getByRole("radio", { name: /Data Mirror/ }).click();
  await expect(page.getByTestId("big-number")).not.toHaveText(before);
  await page.getByRole("radio", { name: /Your AI IDE/ }).click();
  await expect(page.getByTestId("line-ide")).toContainText("your subscription");
});

test("re-approval can be edited to a smaller amount", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("reapprove-edit").click();
  await page.fill("#reamount", "0.04");
  await page.getByTestId("reapprove-edited").click();
  // A smaller amount means the agent asks again when it needs more.
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("reapprove").click();
  await receipt(page);
  await expect(page.getByText("edited by user").first()).toBeVisible();
});

test("price_increase opens re-approval; approve continues", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  const dlg = page.getByRole("dialog", { name: "Needs your OK" });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByText("Seller asks more than approved")).toBeVisible();
  await page.getByTestId("reapprove").click();
  await receipt(page);
  await expect(page.getByText("approved by user").first()).toBeVisible();
});

test("approval_timeout counts as deny, then retry", async ({ page }) => {
  await start(page, ["Re-approval times out"]);
  await expect(page.getByRole("dialog", { name: "Approval timed out" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-retry").click();
  await receipt(page);
  await expect(page.getByText("timed out by system")).toBeVisible();
});

for (const [label, title] of [
  ["Seller times out", "Seller didn't answer"],
  ["Payment rejected", "Payment rejected"],
  ["Settlement fails", "Settlement failed"],
] as const) {
  test(`${label}: retry without paying twice`, async ({ page }) => {
    const approved = await start(page, [label]);
    const dlg = page.getByRole("dialog", { name: title });
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await expect(dlg.getByText("Charged this attempt")).toBeVisible();
    await page.getByTestId("failure-retry").click();
    await receipt(page);
    // Every planned request paid exactly once.
    await expect(page.getByTestId("receipt-total")).toContainText(approved);
  });
}

test("vault runs dry: top up then finish", async ({ page }) => {
  await start(page, ["Vault runs dry"]);
  await expect(page.getByRole("dialog", { name: "Not enough in the vault" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-topup").click();
  await receipt(page);
});

test("off-plan spend is routed to the user; deny then cancel returns funds", async ({ page }) => {
  await start(page, ["Agent tries off-plan spend"]);
  const dlg = page.getByRole("dialog", { name: "Needs your OK" });
  await expect(dlg.getByText("Spend not in the approved plan")).toBeVisible({ timeout: 30_000 });
  await dlg.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("dialog", { name: "Change denied" })).toBeVisible();
  await page.getByTestId("failure-cancel").click();
  await expect(page.getByText("Job cancelled", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Returned to you")).toBeVisible();
});

test("model_error: retry", async ({ page }) => {
  await start(page, ["Analysis crashes"]);
  await expect(page.getByRole("dialog", { name: "Analysis crashed" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-retry").click();
  await receipt(page);
});

test("dismissed re-approval stays pending, never auto-approved", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  await expect(page.getByTestId("phase-history")).toHaveAttribute("data-status", "awaiting_reapproval");
  await page.getByRole("button", { name: "1 needs you" }).click();
  await page.getByTestId("reapprove").click();
  await receipt(page);
});

test("trado and travo run end to end", async ({ page }) => {
  await start(page, [], "Is BTC trending this week?", "Trado");
  await receipt(page);
  await start(page, [], "Drive from Vancouver to Seattle", "Travo");
  await receipt(page);
  await expect(page.getByRole("img", { name: "Route map" })).toBeVisible();
});
