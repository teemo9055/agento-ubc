import { expect, test, type Page } from "@playwright/test";
import { prefs } from "./helpers";

const HEADLINES = [/Say what you\s*want done/, /See the work\s*on a map/, /Approve\s*once/, /Watch it\s*happen/];

const carousel = (page: Page) => page.locator('[aria-roledescription="carousel"]');
const current = (page: Page) => page.locator('[aria-roledescription="slide"][data-active="true"]');

test.describe("landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows the four panels' headlines", async ({ page }) => {
    await page.goto("/");
    await expect(carousel(page)).toHaveAttribute("aria-label", "How Agento works");
    await expect(carousel(page).locator('[aria-roledescription="slide"]')).toHaveCount(4);
    await expect(carousel(page).locator("h2")).toHaveText(HEADLINES);
    await expect(current(page)).toHaveAttribute("aria-label", "1 of 4");
  });

  test("the next arrow advances and the dots follow", async ({ page }) => {
    await page.goto("/");
    await expect(current(page).getByRole("button", { name: "Go to panel 1" })).toHaveAttribute("aria-current", "true");
    await current(page).getByRole("button", { name: "Next" }).click();
    await expect(current(page)).toHaveAttribute("aria-label", "2 of 4");
    await expect(current(page).getByRole("button", { name: "Go to panel 2" })).toHaveAttribute("aria-current", "true");
    await expect(current(page).getByRole("button", { name: "Go to panel 1" })).not.toHaveAttribute("aria-current", "true");
    await page.keyboard.press("ArrowRight");
    await expect(current(page)).toHaveAttribute("aria-label", "3 of 4");
    await current(page).getByRole("button", { name: "Back" }).click();
    await expect(current(page)).toHaveAttribute("aria-label", "2 of 4");
  });

  test("Skip goes to the app home", async ({ page }) => {
    await page.goto("/");
    await current(page).getByRole("link", { name: "Skip" }).click();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("the last panel's Open Agento goes to the app home", async ({ page }) => {
    await page.goto("/");
    for (let i = 2; i <= 4; i++) {
      await current(page).getByRole("button", { name: "Next" }).click();
      await expect(current(page)).toHaveAttribute("aria-label", `${i} of 4`);
    }
    await expect(current(page).getByRole("button", { name: "Next" })).toHaveCount(0);
    await current(page).getByRole("link", { name: "Open Agento" }).click();
    await expect(page).toHaveURL(/\/home$/);
  });
});

test("asking for something nothing here can do makes no job, and offers what works", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.fill("#task", "Find me a flight from San Francisco to New York next Friday");
  await page.getByRole("button", { name: /Ask/ }).click();
  const card = page.getByTestId("not-possible");
  await expect(card).toContainText("Agento can't search or book flights.");
  await expect(card).toContainText("No job was made");
  await expect(page).toHaveURL(/\/new/);
  // One tap on a suggestion starts a job that can be done.
  await card.getByTestId("not-possible-try").first().click();
  await expect(page).toHaveURL(/\/runs\//);
});
