import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test("Inso's home is a dashboard of covers by market, each card opens a ready job", async ({ page }) => {
  await prefs(page);
  await page.goto("/inso");
  for (const s of ["weather", "sports", "commodities"]) await expect(page.getByTestId(`section-${s}`)).toBeVisible();
  // No chat on the home: the ask box only opens on request.
  await expect(page.getByTestId("agent-ask")).toHaveCount(0);
  await expect(page.getByTestId("job-card").first()).toBeVisible();
  await page.getByTestId("create-own").click();
  await page.getByTestId("agent-ask").fill("What are BTC odds right now?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
});

test("Worko's home groups jobs into researching, planning and verifying; a card opens its job in the chat", async ({ page }) => {
  await prefs(page);
  await page.goto("/travo"); // the old name still lands on Worko
  await expect(page).toHaveURL(/\/worko$/);
  for (const s of ["research", "plan", "verify"]) await expect(page.getByTestId(`section-${s}`)).toBeVisible();
  // Checks paid in real USDC say so on the card.
  await expect(page.locator('[data-job="seller-check"]')).toContainText("Real USDC");
  await expect(page.locator('[data-job="road-trip"]')).toContainText("$0.03");
  await page.locator('[data-job="road-trip"]').getByTestId("job-start").click();
  await expect(page).toHaveURL(/\/runs\//, { timeout: 30_000 });
  // The job opens with the move ready in the chat, to change or set up.
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("trip-sheet").getByTestId("trip-drive")).toContainText("Austin");
});

test("Trado isn't offered: its old link lands on Inso", async ({ page }) => {
  await prefs(page);
  await page.goto("/trado");
  await expect(page).toHaveURL(/\/inso$/);
});

test("the recipe book finds the closest recipe for a problem in your own words", async ({ page }) => {
  await prefs(page);
  await page.goto("/recipes");
  await page.getByTestId("recipe-search").fill("a cold snap would ruin our wedding on saturday");
  const first = page.getByTestId("recipe").first();
  await expect(first).toHaveAttribute("data-recipe", "event-weather");
  await page.getByTestId("recipe-search").fill("");
  await page.getByRole("button", { name: /Worko/ }).click();
  await expect(page.locator('[data-testid="recipe"]')).toHaveCount(3);
});
