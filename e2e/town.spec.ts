import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN_KEY = "e2e-admin-key";
const ADMIN = { "x-admin-key": ADMIN_KEY };
const BUILDINGS = ["Library", "Store", "Town Hall", "Lab", "Forum", "Office"];
/** Keeps texts unique when a running server is reused. */
const RUN = Date.now().toString(36);

/** Sends something to Town Hall from the app (practice mode) and returns its status page's path. */
async function send(page: Page, text: string, kind = "Need") {
  await page.goto("/town/hall");
  const form = page.getByTestId("hall-form");
  await form.getByText(kind, { exact: true }).click();
  await page.getByTestId("hall-text").fill(text);
  await page.getByTestId("hall-send").click();
  await expect(page).toHaveURL(/\/town\/hall\/[A-Za-z0-9]{6,}$/);
  return new URL(page.url()).pathname;
}

/** The same through the API, routed by the admin: returns the item's id. */
async function routed(request: APIRequestContext, text: string, to: ("lab" | "forum")[]) {
  const r = await request.post("/api/town/hall", { data: { kind: "need", text, from: "e2e" } });
  expect(r.status()).toBe(201);
  const id = (await r.json()).item.id as string;
  expect((await request.post("/api/town/admin", { headers: ADMIN, data: { action: "route", itemId: id, to } })).status()).toBe(200);
  return id;
}

test("the map shows every building as a link, and the bar gets around without it", async ({ page }) => {
  await page.goto("/town");
  await expect(page.getByTestId("town-scene")).toBeVisible();
  const map = page.getByRole("navigation", { name: "Town map" });
  for (const name of BUILDINGS) await expect(map.getByRole("link", { name })).toBeVisible();
  await expect(page.getByTestId("town-purse")).toContainText("Practice");

  await map.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/town\/library$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
  await expect(page.getByTestId("building-banner")).toBeVisible();

  await page.goto("/town");
  const bar = page.getByRole("navigation", { name: "Town", exact: true });
  await bar.getByRole("link", { name: /Store/ }).click();
  await expect(page).toHaveURL(/\/town\/store$/);
  await page.getByRole("navigation", { name: "Town", exact: true }).getByRole("link", { name: /Forum/ }).click();
  await expect(page).toHaveURL(/\/town\/forum$/);
});

test("sending a request in practice mode shows its status page and timeline", async ({ page }) => {
  const path = await send(page, "Please add a gas price check on Arc before a job runs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Received");
  const status = page.getByTestId("hall-status");
  await expect(status).toContainText("Please add a gas price check on Arc");
  await expect(page.getByTestId("hall-timeline")).toContainText("Practice deposit of $1 recorded (no money moved)");
  // The link is shareable: it loads on its own, and the public queue lists it.
  await page.goto(path);
  await expect(page.getByTestId("hall-status")).toContainText("Please add a gas price check");
  await page.goto("/town/hall");
  await expect(page.getByTestId("hall-queue")).toContainText("Please add a gas price check on Arc");
});

test("an admin with the key refunds one item and routes another", async ({ page }) => {
  const refundMe = await send(page, `Feedback for refund ${RUN}: the receipt page could print to PDF`, "Feedback");
  const routeMe = await send(page, `Route me ${RUN}: a weather service that takes Arc testnet`, "Request");

  await page.goto("/town/hall/admin");
  await page.getByTestId("admin-key").fill(ADMIN_KEY);
  await page.getByTestId("admin-unlock").click();
  const waiting = page.getByTestId("admin-waiting");
  await expect(waiting).toBeVisible();

  const first = waiting.getByTestId("admin-item").filter({ hasText: `Feedback for refund ${RUN}` });
  await first.getByRole("button", { name: "Not spam: refund the $1" }).click();
  await expect(waiting.getByTestId("admin-item").filter({ hasText: `Feedback for refund ${RUN}` })).toHaveCount(0);

  const second = waiting.getByTestId("admin-item").filter({ hasText: `Route me ${RUN}` });
  await second.getByRole("button", { name: "Route to both" }).click();
  await expect(waiting.getByTestId("admin-item").filter({ hasText: `Route me ${RUN}` })).toHaveCount(0);
  await expect(page.getByTestId("admin-log")).toContainText("refund");
  await expect(page.getByTestId("admin-log")).toContainText("route");

  await page.goto(refundMe);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Refunded");
  await expect(page.getByTestId("hall-status")).toContainText("Practice deposit refunded (no money moved)");
  await page.goto(routeMe);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Routed");

  await page.goto("/town/lab");
  await expect(page.getByTestId("lab-board")).toContainText(`Route me ${RUN}`);
  await page.goto("/town/forum");
  await expect(page.getByTestId("forum-board")).toContainText(`Route me ${RUN}`);
});

test("admin needs the key", async ({ page, request }) => {
  expect((await request.get("/api/town/admin")).status()).toBe(401);
  expect((await request.get("/api/town/admin", { headers: ADMIN })).status()).toBe(200);
  await page.goto("/town/hall/admin");
  await page.getByTestId("admin-key").fill("wrong");
  await page.getByTestId("admin-unlock").click();
  await expect(page.getByText("That admin key isn't right.")).toBeVisible();
});

test("library search as you type opens an article with its infobox", async ({ page }) => {
  await page.goto("/town/library");
  await expect(page.getByTestId("library-categories")).toContainText("Glossary");
  await page.getByTestId("library-search").fill("x402");
  await expect(page.getByText(/articles for “x402”/)).toBeVisible();
  await page.getByTestId("library-results").getByRole("link", { name: /Pay for one answer at a time/ }).click();
  await expect(page).toHaveURL(/\/town\/library\/pay-per-request$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pay for one answer at a time");
  const box = page.getByTestId("infobox").locator("visible=true");
  await expect(box).toContainText("Fundamental action");
  await expect(box).toContainText("Arc testnet");
  await expect(page.getByTestId("diagram")).toContainText("402 price");
  await expect(page.getByTestId("library-entry")).toContainText("X-PAYMENT");
});

test("“For agents” shows the article's Markdown with the same title, and its JSON", async ({ page }) => {
  await page.goto("/town/library/open-a-vault");
  const title = await page.getByRole("heading", { level: 1 }).textContent();
  await page.getByRole("tab", { name: "For agents" }).click();
  await expect(page).toHaveURL(/view=agents/);
  const md = page.getByTestId("agent-md");
  await expect(md.locator("h1")).toHaveText(title!);
  await expect(page.getByTestId("agent-view")).toContainText("/api/town/library/open-a-vault?format=md");
  await expect(page.getByTestId("agent-view")).toContainText('library_read { id: "open-a-vault" }');
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.getByTestId("agent-json")).toContainText('"slug": "open-a-vault"');
  // Back to the people view.
  await page.getByRole("tab", { name: "For people" }).click();
  await expect(page.getByTestId("library-entry")).toBeVisible();
});

test("/town/llms.txt lists every building, and each building answers in Markdown and JSON", async ({ request }) => {
  const txt = await (await request.get("/town/llms.txt")).text();
  expect(txt).toMatch(/^# Agento Town/);
  for (const b of ["library", "store", "hall", "lab", "forum"]) {
    expect(txt).toContain(`/api/town/${b}?format=md`);
    const md = await request.get(`/api/town/${b}?format=md`);
    expect(md.headers()["content-type"]).toContain("text/markdown");
    const json = await (await request.get(`/api/town/${b}?format=json`)).json();
    expect(json).toMatchObject({ schemaVersion: 1, building: b });
    expect(typeof json.updatedAt).toBe("string");
  }
  for (const name of ["Library", "Store", "Town Hall", "Lab", "Forum"]) expect(txt).toContain(`[${name}]`);
});

test("store filters: Verified by Circle and Independent", async ({ page }) => {
  await page.goto("/town/store");
  await expect(page.getByText(/reading Circle's marketplace/)).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId("store-filter-independent").click();
  const items = page.getByTestId("store-item");
  await expect(items.first()).toBeVisible();
  await expect(page.locator('[data-testid="store-item"][data-group="circle"]')).toHaveCount(0);
  await expect(page.getByTestId("store-grid")).toContainText("cover.quote");
  await page.getByTestId("store-filter-circle").click();
  await expect(page.locator('[data-testid="store-item"][data-group="independent"]')).toHaveCount(0);
  await page.getByTestId("store-filter-all").click();
  await page.getByTestId("store-search").fill("cover.quote");
  await page.getByTestId("store-grid").getByRole("link", { name: /cover\.quote/ }).click();
  await expect(page).toHaveURL(/\/town\/store\/agento-cover\.quote$/);
});

test("a product page shows what you get, the seller, how to buy it and the refund rules", async ({ page }) => {
  await page.goto("/town/store/agento-cover.quote");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("cover.quote");
  const p = page.getByTestId("store-product");
  await expect(p).toContainText("$0.005");
  await expect(page.getByTestId("seller-card")).toContainText("Agento");
  await expect(p).toContainText("How an agent buys it");
  await expect(p).toContainText("/api/x402/cover.quote?legs=");
  await expect(p).toContainText("claim within 10 minutes");
  await page.getByRole("tab", { name: "For agents" }).click();
  await expect(page.getByTestId("agent-md").locator("h1")).toHaveText("cover.quote");
});

test("the Lab is a board with a column per stage", async ({ page, request }) => {
  const id = await routed(request, `Lab board e2e ${RUN}: how fast does Arc settle a payment?`, ["lab"]);
  await page.goto("/town/lab");
  for (const [col, label] of [
    ["routed", "Routed in"],
    ["investigating", "Investigating"],
    ["proposed", "Proposed"],
    ["accepted", "Accepted"],
    ["published", "Published to Library"],
  ])
    await expect(page.getByTestId(`lab-col-${col}`)).toContainText(label);
  await expect(page.getByTestId("lab-col-routed")).toContainText("Lab board e2e");

  // A finding moves it to Investigating.
  expect((await request.post("/api/town/lab", { data: { itemId: id, kind: "finding", text: "About a second on testnet" } })).status()).toBe(201);
  await page.reload();
  await expect(page.getByTestId("lab-col-investigating")).toContainText("Lab board e2e");
  await page.getByTestId("lab-col-investigating").locator(`a[href="/town/lab/${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/town/lab/${id}$`));
  await expect(page.getByTestId("thread-posts")).toContainText("About a second on testnet");
});

test("a Forum thread shows its replies and offers with seller and price", async ({ page, request }) => {
  const id = await routed(request, "Forum thread e2e: a feed of ferry timetables", ["forum"]);
  expect((await request.post("/api/town/forum", { data: { itemId: id, kind: "offer", text: "Ferry times per request, on Arc testnet", url: "https://ferry.example/x402", priceUsd: 0.002, from: "FerryCo" } })).status()).toBe(201);
  await page.goto("/town/forum");
  const row = page.getByTestId("forum-board").locator(`a[href="/town/forum/${id}"]`);
  await expect(row).toContainText("An offer");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/town/forum/${id}$`));
  const posts = page.getByTestId("thread-posts");
  await expect(posts).toContainText("FerryCo");
  await expect(posts).toContainText("$0.002");
  await expect(page.getByTestId("thread")).toContainText("1 reply · 1 offer");

  // A reply from the page.
  await page.getByRole("button", { name: "Propose a solution or offer" }).click();
  await page.getByTestId("reply-text").fill("The city publishes ferry times as open data, too");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(posts).toContainText("The city publishes ferry times");
});
