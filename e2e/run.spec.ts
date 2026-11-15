import { expect, test, type Page } from "@playwright/test";

/** Ask, then say yes to the agent's move: lands on the priced work order. */
async function draft(page: Page, faults: string[] = [], task = "How have BTC odds moved today?", agent = "Inso") {
  await page.goto("/new");
  await page.getByRole("tab", { name: new RegExp(agent) }).click();
  await page.fill("#task", task);
  await page.getByRole("radio", { name: "Demo rail" }).click();
  if (faults.length) {
    await page.getByText("Test mode").click();
    for (const f of faults) await page.locator("label", { hasText: f }).click();
  }
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("adopt-move").click();
  await expect(page.getByTestId("card-price")).toBeVisible();
}

async function start(page: Page, faults: string[] = [], task = "How have BTC odds moved today?", agent = "Inso") {
  await draft(page, faults, task, agent);
  const approved = (await page.getByTestId("big-number").innerText()).replace(/USDC|\s/g, "");
  await page.getByTestId("open-approve").click();
  await page.getByTestId("approve").click();
  return approved;
}

const receipt = (page: Page) => expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 60_000 });

test("explore is free, then the approved move runs with no popup", async ({ page }) => {
  await page.goto("/new");
  await page.fill("#task", "What are BTC odds right now?");
  await page.getByRole("radio", { name: "Demo rail" }).click();
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("msg-agent")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Exploring is free", { exact: true })).toBeVisible();
  await page.getByTestId("adopt-move").click();
  await expect(page.getByText("Order limit · paid on the exchange")).toBeVisible();
  await page.getByTestId("open-approve").click();
  await page.getByTestId("approve").click();
  await receipt(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("order-result")).toContainText(/Simulated/);
  await expect(page.getByTestId("venue-badge").first()).toContainText("Simulation");
});

test("back to chat from the work order keeps the conversation", async ({ page }) => {
  await draft(page, [], "BTC odds back test");
  await page.getByTestId("back-to-chat").click();
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await page.getByTestId("chat-input").fill("what about ETH?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-agent")).toHaveCount(2, { timeout: 30_000 });
});

test("card edit happens in the chat: explains why it can't, offers alternatives, applies one", async ({ page }) => {
  await draft(page, [], "BTC odds");
  await page.getByTestId("card-deliverable").click();
  await expect(page.getByTestId("chat-focus")).toContainText("Deliverable");
  await expect(page.getByTestId("card-deliverable")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("chat-input").fill("place a real bet on yes");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Can't do that")).toBeVisible();
  await page.getByRole("button", { name: "Drop the trade tape" }).click();
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await page.getByTestId("apply-edit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("card-deliverable")).not.toContainText("Trade tape");
  await expect(page.getByTestId("chat-focus")).toHaveCount(0);
});

test("graph steps are editable in the chat: focus a step, preview, apply", async ({ page }) => {
  await draft(page, [], "BTC odds step edit");
  const step = page.getByTestId("phase-r1");
  // Centre it so the sticky approve bar isn't on top.
  await step.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("chat-focus")).toContainText("step");
  await page.getByTestId("chat-input").fill("drop it");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await page.getByTestId("apply-edit").click();
  await expect(page.getByTestId("phase-r1")).toHaveCount(0);
  await expect(page.getByTestId("chat-focus")).toHaveCount(0);
});

test("re-approval can be edited to a smaller amount", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("reapprove-edit").click();
  await page.fill("#reamount", "0.04");
  await page.getByTestId("reapprove-edited").click();
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
  await expect(page.getByTestId("phase-r1")).toHaveAttribute("data-status", "awaiting_reapproval");
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

test("dashboard lists jobs by folder and status, and opens them", async ({ page }) => {
  await start(page, [], "BTC odds dashboard check", "Inso");
  await receipt(page);
  const url = page.url();
  await page.goto("/?folder=inso");
  await expect(page.getByRole("heading", { name: "Inso jobs" })).toBeVisible();
  const card = page.getByText("BTC odds dashboard check").first();
  await expect(card).toBeVisible();
  await page.goto("/?folder=travo");
  await expect(page.getByText("BTC odds dashboard check")).toHaveCount(0);
  await page.goto("/");
  await page.getByLabel("Search jobs").fill("dashboard check");
  await page.getByText("BTC odds dashboard check").first().click();
  await expect(page).toHaveURL(url);
});

test("a plan across agents runs step by step and says what it can't do", async ({ page }) => {
  await page.goto("/new");
  await page.fill("#task", "What are BTC odds right now, then plan a drive from Vancouver to Seattle, and book a hotel in Seattle");
  await page.getByRole("radio", { name: "Demo rail" }).click();
  await page.getByRole("button", { name: /Ask/ }).click();
  const card = page.getByTestId("plan-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId("plan-step")).toHaveCount(2);
  await expect(card.getByTestId("plan-unavailable")).toContainText("hotel");
  await card.getByTestId("start-plan").click();
  await expect(card.getByTestId("plan-status")).toHaveText("Finished", { timeout: 60_000 });
  await expect(card.getByTestId("plan-step-status")).toHaveText(["Done", "Done"]);
  await card.getByTestId("plan-step-link").nth(1).click();
  await expect(page.getByTestId("back-to-plan")).toContainText("Step 2 of a plan");
  await expect(page.getByTestId("receipt-total")).toBeVisible();
});
