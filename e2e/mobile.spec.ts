import { devices, expect, test } from "@playwright/test";
import { prefs } from "./helpers";

test.use({ ...devices["iPhone 14"], browserName: "chromium" });

async function newDemoJob(page: import("@playwright/test").Page, task: string, faults: string[] = []) {
  await prefs(page, faults);
  await page.goto("/new");
  await page.fill("#task", task);
  await page.getByRole("button", { name: /Ask/ }).click();
  await page.getByTestId("adopt-move").click({ timeout: 30_000 });
  await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
}

test("bottom tab bar navigates", async ({ page }) => {
  await page.goto("/home");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  await bar.getByRole("link", { name: "Agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await bar.getByRole("link", { name: "New" }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test("Edit on a card opens the chat focused on that card", async ({ page }) => {
  await newDemoJob(page, "BTC odds focus test");
  await page.getByTestId("edit-price").click();
  await expect(page.getByRole("tab", { name: /Chat/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("chat-focus")).toContainText("Price");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("sheets swipe down to dismiss", async ({ page }) => {
  await newDemoJob(page, "BTC odds swipe test");
  await page.getByRole("button", { name: "Discard" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400); // let the sheet finish sliding up before grabbing its handle
  const box = (await dialog.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 14; // the drag handle
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 80, { steps: 4 });
  await page.mouse.move(x, y + 260, { steps: 6 });
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
});

test("approve is instant with a toast, and a waiting job shows in the tab title", async ({ page }) => {
  await newDemoJob(page, "BTC odds title test", ["Seller raises price"]);
  await page.getByTestId("open-approve").click();
  await expect(page.getByText(/Approved · funding vault/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(/^\(\d+\) agento$/);
});

test("no page is wider than the phone", async ({ page }) => {
  await newDemoJob(page, "BTC odds width check");
  const job = page.url();
  await page.getByTestId("open-approve").click();
  await expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 85_000 });
  for (const path of ["/", "/new", "/agents", "/settings", job, `${job}/receipt`]) {
    await page.goto(path);
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, path).toBe(0);
  }
});
