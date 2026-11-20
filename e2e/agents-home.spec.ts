import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test("Inso's home starts from the problems it solves, and a pick opens a job that shapes the cover", async ({ page }) => {
  await prefs(page);
  await page.goto("/inso");
  await expect(page.getByLabel("What do you want to protect?")).toBeVisible();
  await expect(page.getByTestId("recipe")).toHaveCount(6);
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

test("Worko's home lists the trips it plans; a drive shows only what matters and nothing is booked", async ({ page }) => {
  await prefs(page);
  await page.goto("/travo"); // the old name still lands on Worko
  await expect(page).toHaveURL(/\/worko$/);
  await expect(page.getByLabel("Where are you driving?")).toBeVisible();
  await expect(page.getByTestId("recipe")).toHaveCount(3);
  // Typing a problem points at the closest recipe.
  await page.getByTestId("agent-ask").fill("ev road trip, will I find chargers");
  await expect(page.getByTestId("closest-recipe")).toContainText("Will I find chargers on my EV road trip?");
  await page.getByTestId("agent-ask").fill("Plan a drive from Vancouver to Seattle, and we need a hotel");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  const sheet = page.getByTestId("trip-sheet");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByTestId("trip-drive")).toBeVisible();
  await expect(sheet.getByTestId("trip-stay")).toContainText("You book the one you like yourself");
  await expect(sheet.getByTestId("trip-food")).toHaveCount(0);
  await page.getByTestId("adopt-move").click();
  await page.getByTestId("open-approve").click();
  await expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 60_000 });
  // No booking links anywhere: Agento doesn't book.
  await expect(page.getByTestId("left-for-you")).toHaveCount(0);
});

test("the recipe book finds the closest recipe for a problem in your own words", async ({ page }) => {
  await prefs(page);
  await page.goto("/home");
  await page.getByTestId("home-recipes").click();
  await expect(page).toHaveURL(/\/recipes/);
  await page.getByTestId("recipe-search").fill("a cold snap would ruin our wedding on saturday");
  const first = page.getByTestId("recipe").first();
  await expect(first).toHaveAttribute("data-recipe", "event-weather");
  // Filter by agent: only that agent's recipes.
  await page.getByTestId("recipe-search").fill("");
  await page.getByRole("button", { name: /Trado/ }).click();
  await expect(page.locator('[data-testid="recipe"]')).toHaveCount(4);
  await page.locator('[data-recipe="whats-coming"]').getByTestId("recipe-start").click();
  await expect(page).toHaveURL(/\/runs\//);
});
