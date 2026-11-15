import { expect, type Page } from "@playwright/test";

const FAULT_CODE: Record<string, string> = {
  "Seller raises price": "price_increase",
  "Seller times out": "seller_402_timeout",
  "Payment rejected": "payment_rejected",
  "Settlement fails": "settle_fails",
  "Vault runs dry": "insufficient_balance",
  "Agent tries off-plan spend": "policy_block",
  "Analysis crashes": "model_error",
  "Re-approval times out": "approval_timeout",
};

/** The choices a user makes once in Settings: practice mode, and any failures to inject. */
export async function prefs(page: Page, faults: string[] = []) {
  const value = JSON.stringify({ mode: "demo", payFrom: "app", faults: faults.map((f) => FAULT_CODE[f]) });
  await page.addInitScript((v) => localStorage.setItem("agento:prefs", v), value);
}

/** Ask, then say yes to the agent's move: lands on the review screen. */
export async function draft(page: Page, faults: string[] = [], task = "How have BTC odds moved today?", agent = "Inso") {
  await prefs(page, faults);
  await page.goto("/new");
  await page.getByRole("tab", { name: new RegExp(agent) }).click();
  await page.fill("#task", task);
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("adopt-move").click();
  await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
}

export async function start(page: Page, faults: string[] = [], task = "How have BTC odds moved today?", agent = "Inso") {
  await draft(page, faults, task, agent);
  const approved = (await page.getByTestId("big-number").innerText()).replace(/USDC|\s/g, "");
  await page.getByTestId("open-approve").click();
  await page.getByTestId("approve").click();
  return approved;
}

/** The job finished: its receipt line is on the page. */
export const finished = (page: Page) => expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 60_000 });

/** Opens the full receipt page from a finished job. */
export async function openReceipt(page: Page) {
  await finished(page);
  await page.getByTestId("receipt-summary").click();
  await expect(page.getByRole("region", { name: "Receipt" })).toBeVisible();
}

/** The graph, cards and cost lines are tucked away until asked for. */
export const openDetails = (page: Page) => page.getByTestId("details-toggle").click();
