import { devices, expect, test } from "@playwright/test";

test.use({ ...devices["iPhone 14"], browserName: "chromium" });

async function newDemoJob(page: import("@playwright/test").Page, task: string, faults: string[] = []) {
  await page.goto("/new");
  await page.fill("#task", task);
  await page.getByRole("radio", { name: "Demo rail" }).click();
  if (faults.length) {
    await page.getByText("Test mode").click();
    for (const f of faults) await page.locator("label", { hasText: f }).click();
  }
  await page.getByRole("button", { name: /Get work order/ }).click();
  await expect(page.getByTestId("card-price")).toBeVisible({ timeout: 30_000 });
}

test("bottom tab bar navigates", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  await bar.getByRole("link", { name: "Agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await bar.getByRole("link", { name: "New" }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test("sheets swipe down to dismiss", async ({ page }) => {
  await newDemoJob(page, "BTC odds swipe test");
  await page.getByTestId("card-deliverable").click();
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
  await page.getByTestId("approve").click();
  await expect(page.getByRole("dialog", { name: "Approve plan" })).toHaveCount(0);
  await expect(page.getByText(/Approved · funding vault/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(/^\(\d+\) agento$/);
});

test("no page is wider than the phone", async ({ page }) => {
  await newDemoJob(page, "BTC odds width check");
  const job = page.url();
  await page.getByTestId("open-approve").click();
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("receipt-total")).toBeVisible({ timeout: 85_000 });
  for (const path of ["/", "/new", "/agents", job]) {
    await page.goto(path);
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, path).toBe(0);
  }
});
