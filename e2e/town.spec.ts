import { expect, test, type Page } from "@playwright/test";

const ADMIN_KEY = "e2e-admin-key";
const BUILDINGS = ["Library", "Store", "Town Hall", "Lab", "Forum", "Office"];

/** Sends something to Town Hall from the app (practice mode) and returns its status page's path. */
async function send(page: Page, text: string, kind = "Need") {
  await page.goto("/town/hall");
  await page.getByText(kind, { exact: true }).click();
  await page.getByTestId("hall-text").fill(text);
  await page.getByTestId("hall-send").click();
  await expect(page).toHaveURL(/\/town\/hall\/[A-Za-z0-9]{6,}$/);
  return new URL(page.url()).pathname;
}

test("the map shows every building as a link, and the bar gets around without it", async ({ page }) => {
  await page.goto("/town");
  const map = page.getByRole("navigation", { name: "Town map" });
  for (const name of BUILDINGS) await expect(map.getByRole("link", { name })).toBeVisible();
  await expect(page.getByTestId("town-purse")).toContainText("Practice");

  await map.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/town\/library$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");

  await page.goto("/town");
  const bar = page.getByRole("navigation", { name: "Town", exact: true });
  await bar.getByRole("link", { name: /Store/ }).click();
  await expect(page).toHaveURL(/\/town\/store$/);
  await page.getByRole("navigation", { name: "Town", exact: true }).getByRole("link", { name: /Forum/ }).click();
  await expect(page).toHaveURL(/\/town\/forum$/);
});

test("sending a request in practice mode shows its status page", async ({ page }) => {
  const path = await send(page, "Please add a gas price check on Arc before a job runs");
  const status = page.getByTestId("hall-status");
  await expect(status.getByRole("heading", { level: 1 })).toHaveText("Received");
  await expect(status).toContainText("Please add a gas price check on Arc");
  await expect(status).toContainText("Practice deposit of $1 recorded (no money moved)");
  // The link is shareable: it loads on its own.
  await page.goto(path);
  await expect(page.getByTestId("hall-status")).toContainText("Received");
});

test("an admin with the key refunds one item and routes another", async ({ page }) => {
  const refundMe = await send(page, "Feedback for refund: the receipt page could print to PDF", "Feedback");
  const routeMe = await send(page, "Route me: a weather service that takes Arc testnet", "Request");

  await page.goto("/town/hall/admin");
  await page.getByTestId("admin-key").fill(ADMIN_KEY);
  await page.getByTestId("admin-unlock").click();
  const waiting = page.getByTestId("admin-waiting");
  await expect(waiting).toBeVisible();

  const first = waiting.getByTestId("admin-item").filter({ hasText: "Feedback for refund" });
  await first.getByRole("button", { name: "Not spam: refund the $1" }).click();
  await expect(waiting.getByTestId("admin-item").filter({ hasText: "Feedback for refund" })).toHaveCount(0);

  const second = waiting.getByTestId("admin-item").filter({ hasText: "Route me" });
  await second.getByRole("button", { name: "Route to both" }).click();
  await expect(waiting.getByTestId("admin-item").filter({ hasText: "Route me" })).toHaveCount(0);
  await expect(page.getByTestId("admin-log")).toContainText("refund");
  await expect(page.getByTestId("admin-log")).toContainText("route");

  await page.goto(refundMe);
  await expect(page.getByTestId("hall-status").getByRole("heading", { level: 1 })).toHaveText("Refunded");
  await expect(page.getByTestId("hall-status")).toContainText("Practice deposit refunded (no money moved)");
  await page.goto(routeMe);
  await expect(page.getByTestId("hall-status").getByRole("heading", { level: 1 })).toHaveText("Routed");

  await page.goto("/town/lab");
  await expect(page.getByTestId("lab-board")).toContainText("Route me");
  await page.goto("/town/forum");
  await expect(page.getByTestId("forum-board")).toContainText("Route me");
});

test("admin needs the key", async ({ page, request }) => {
  expect((await request.get("/api/town/admin")).status()).toBe(401);
  expect((await request.get("/api/town/admin", { headers: { "x-admin-key": ADMIN_KEY } })).status()).toBe(200);
  await page.goto("/town/hall/admin");
  await page.getByTestId("admin-key").fill("wrong");
  await page.getByTestId("admin-unlock").click();
  await expect(page.getByText("That admin key isn't right.")).toBeVisible();
});

test("library search finds how to pay with x402", async ({ page }) => {
  await page.goto("/town/library");
  await page.getByTestId("library-search").fill("x402");
  await expect(page.getByText(/entries for “x402”/)).toBeVisible();
  await page.getByRole("link", { name: /Pay for one answer at a time/ }).click();
  await expect(page.getByTestId("library-entry")).toContainText("X-PAYMENT");
});
