import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test("Inso's home starts from quick builds, and a pick opens a job that shapes the cover", async ({ page }) => {
  await prefs(page);
  await page.goto("/inso");
  await expect(page.getByLabel("What do you want to protect?")).toBeVisible();
  await expect(page.getByTestId("quick-build")).toHaveCount(6);
  await page.getByTestId("agent-ask").fill("What are BTC odds right now?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  // The cover, organized: what it uses, what you pay, what you get, what it ensures.
  const sheet = page.getByTestId("cover-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("cover-pay")).toContainText("$");
  await expect(sheet.getByTestId("cover-ensures")).not.toBeEmpty();
});

test("Trado's home asks what to trade and shows buy, sell, pending and balance", async ({ page }) => {
  await prefs(page);
  await page.goto("/trado");
  await expect(page.getByLabel("What are you trying to trade today?")).toBeVisible();
  for (const box of ["board-buy", "board-sell", "board-pending", "board-balance"]) await expect(page.getByTestId(box)).toBeVisible();
  await expect(page.getByTestId("board-balance")).toContainText("Practice");
  // A coin order being shaped sits in its box, marked.
  await page.getByTestId("agent-ask").fill("Buy $10 of BTC if it dips about 2% from here");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("trade-board").getByTestId("board-buy")).toContainText("This order");
});

test("Travo's home lists what it can do, and a trip shows only the parts that matter", async ({ page }) => {
  await prefs(page);
  await page.goto("/travo");
  await expect(page.getByTestId("quick-build")).toHaveCount(5);
  await page.getByTestId("agent-ask").fill("Plan a drive from Dallas to Austin, I land at DFW airport at 6pm");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  const sheet = page.getByTestId("trip-sheet");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByTestId("trip-arrival")).toBeVisible();
  await expect(sheet.getByTestId("trip-drive")).toBeVisible();
  await expect(sheet.getByTestId("trip-food")).toHaveCount(0);
});
