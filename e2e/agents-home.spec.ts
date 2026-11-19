import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test("Inso's home starts from the problems it solves, and a pick opens a job that shapes the cover", async ({ page }) => {
  await prefs(page);
  await page.goto("/inso");
  await expect(page.getByLabel("What do you want to protect?")).toBeVisible();
  await expect(page.getByTestId("recipe")).toHaveCount(7);
  await expect(page.locator('[data-recipe="ticket-cover"]')).toContainText("Works today");
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

test("Worko's home lists what it gets done; a trip shows only what matters, and the ride is left for you with a ready link", async ({ page }) => {
  await prefs(page);
  await page.goto("/travo"); // the old name still lands on Worko
  await expect(page).toHaveURL(/\/worko$/);
  await expect(page.getByLabel("What needs doing?")).toBeVisible();
  await expect(page.getByTestId("recipe")).toHaveCount(9);
  // Steps that can't be paid here yet are marked, not hidden.
  await expect(page.locator('[data-recipe="scam-shield"]')).toContainText("Some steps on Arc mainnet");
  // Typing a problem points at the closest recipe.
  await page.getByTestId("agent-ask").fill("is this marketplace seller a scam");
  await expect(page.getByTestId("closest-recipe")).toContainText("Is this deal real?");
  await page.getByTestId("agent-ask").fill("Plan a drive from Vancouver to Seattle, I land at YVR airport at 6pm");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  const sheet = page.getByTestId("trip-sheet");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByTestId("trip-arrival")).toBeVisible();
  await expect(sheet.getByTestId("trip-drive")).toBeVisible();
  await expect(sheet.getByTestId("trip-food")).toHaveCount(0);
  // The ride needs your own account: the review says you finish it, and it costs nothing here.
  await page.getByTestId("adopt-move").click();
  await expect(page.getByTestId("review-yours")).toContainText("You finish it in Uber");
  await page.getByTestId("open-approve").click();
  await expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 60_000 });
  const link = page.getByTestId("left-for-you");
  await expect(link).toContainText("Book the ride to Seattle");
  expect(new URL((await link.getAttribute("href"))!).host).toBe("m.uber.com");
  await expect(page.getByTestId("phase-h1")).toHaveAttribute("data-status", "done");
});

test("the recipe book finds the closest recipe for a problem in your own words", async ({ page }) => {
  await prefs(page);
  await page.goto("/home");
  await page.getByTestId("home-recipes").click();
  await expect(page).toHaveURL(/\/recipes/);
  await page.getByTestId("recipe-search").fill("buying a used bike from a stranger, is it a scam?");
  const first = page.getByTestId("recipe").first();
  await expect(first).toHaveAttribute("data-recipe", /scam-shield|big-purchase/);
  // Filter by agent: only that agent's recipes.
  await page.getByTestId("recipe-search").fill("");
  await page.getByRole("button", { name: /Trado/ }).click();
  await expect(page.locator('[data-testid="recipe"]')).toHaveCount(5);
  await page.locator('[data-recipe="whats-coming"]').getByTestId("recipe-start").click();
  await expect(page).toHaveURL(/\/runs\//);
});
