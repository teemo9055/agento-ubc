import { expect, test } from "@playwright/test";
import { draft, finished, openReceipt, prefs, start } from "./helpers";

const receipt = finished;

test("explore is free, then the approved move runs with no popup", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await expect(page.getByTestId("ask-status")).toContainText("Practice: nothing real is paid");
  await page.fill("#task", "What are BTC odds right now?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("msg-agent")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("adopt-move").click();
  await expect(page.getByTestId("review-cost")).toContainText("order");
  // The four answers sit under the review, with the total below them.
  await expect(page.getByTestId("card-price")).toBeVisible();
  await expect(page.getByTestId("review-most")).toContainText("$");
  await page.getByTestId("open-approve").click();
  await receipt(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // One line says what happened to the order.
  await expect(page.getByTestId("status-headline")).toContainText("Practice run: no order was sent");
  await openReceipt(page);
  await expect(page.getByText("Practice · not a real payment")).toBeVisible();
});

test("back to chat from the work order keeps the conversation", async ({ page }) => {
  await draft(page, [], "BTC odds back test");
  await page.getByTestId("back-to-chat").click();
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await page.getByTestId("chat-input").fill("what about ETH?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-agent")).toHaveCount(2, { timeout: 30_000 });
});

test("card edit happens in the chat: explains why it can't, offers alternatives, applies one", async ({ page }) => {
  await draft(page, [], "BTC odds");
  await page.getByTestId("edit-deliverable").click();
  await expect(page.getByTestId("chat-focus")).toContainText("Outcome");
  await expect(page.getByTestId("edit-deliverable")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("chat-input").fill("place a real bet on yes");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Can't do that")).toBeVisible();
  await page.getByRole("button", { name: "Skip recent trades" }).click();
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await page.getByTestId("apply-edit").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("card-deliverable")).not.toContainText("Recent trades");
  await expect(page.getByTestId("chat-focus")).toHaveCount(0);
});

test("graph steps are editable in the chat: focus a step, preview, apply", async ({ page }) => {
  await draft(page, [], "BTC odds step edit");
  const step = page.getByTestId("phase-r1");
  // Centre it so the sticky approve bar isn't on top.
  await step.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("chat-focus")).toContainText("step");
  await page.getByTestId("chat-input").fill("drop it");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await page.getByTestId("apply-edit").click();
  await expect(page.getByTestId("phase-r1")).toHaveCount(0);
  await expect(page.getByTestId("chat-focus")).toHaveCount(0);
});

test("re-approval can be edited to a smaller amount", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("reapprove-edit").click();
  await page.fill("#reamount", "0.04");
  await page.getByTestId("reapprove-edited").click();
  await openReceipt(page);
  await expect(page.getByText("edited by user").first()).toBeVisible();
});

test("price_increase opens re-approval; approve continues", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  const dlg = page.getByRole("dialog", { name: "Needs your OK" });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByText("Seller asks more than approved")).toBeVisible();
  await page.getByTestId("reapprove").click();
  await openReceipt(page);
  await expect(page.getByText("approved by user").first()).toBeVisible();
});

test("approval_timeout counts as deny, then retry", async ({ page }) => {
  await start(page, ["Re-approval times out"]);
  await expect(page.getByRole("dialog", { name: "Approval timed out" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-retry").click();
  await openReceipt(page);
  await expect(page.getByText("timed out by system")).toBeVisible();
});

for (const [label, title] of [
  ["Seller times out", "Seller didn't answer"],
  ["Payment rejected", "Payment rejected"],
  ["Settlement fails", "Settlement failed"],
] as const) {
  test(`${label}: retry without paying twice`, async ({ page }) => {
    const approved = await start(page, [label]);
    const dlg = page.getByRole("dialog", { name: title });
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await expect(dlg.getByText("Charged this attempt")).toBeVisible();
    await page.getByTestId("failure-retry").click();
    await receipt(page);
    // Every planned request paid exactly once.
    await expect(page.getByTestId("receipt-total")).toContainText(approved);
  });
}

test("seller sends an empty answer: it isn't used, the money comes back, retry finishes", async ({ page }) => {
  await start(page, ["Seller sends an empty answer"]);
  const dlg = page.getByRole("dialog", { name: "The seller didn't deliver" });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByTestId("failure-refunded")).toContainText("Sent back");
  await page.getByTestId("failure-retry").click();
  await receipt(page);
});

test("the safety page shows the loop, the limits in force and the delivery checks", async ({ page }) => {
  await page.goto("/safety");
  await expect(page.getByRole("heading", { name: "How it stays safe" })).toBeVisible();
  await expect(page.getByTestId("safety-loop").getByRole("listitem")).toHaveCount(8);
  await expect(page.getByTestId("safety-limits")).toContainText("A whole plan, every step together");
  await expect(page.getByTestId("safety-checks").getByRole("listitem")).toHaveCount(5);
});

test("vault runs dry: top up then finish", async ({ page }) => {
  await start(page, ["Vault runs dry"]);
  await expect(page.getByRole("dialog", { name: "Not enough set aside" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-topup").click();
  await receipt(page);
});

test("off-plan spend is routed to the user; deny then cancel returns funds", async ({ page }) => {
  await start(page, ["Agent tries off-plan spend"]);
  const dlg = page.getByRole("dialog", { name: "Needs your OK" });
  await expect(dlg.getByText("Spend not in the approved plan")).toBeVisible({ timeout: 30_000 });
  await dlg.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("dialog", { name: "Change denied" })).toBeVisible();
  await page.getByTestId("failure-cancel").click();
  await expect(page.getByTestId("status-headline")).toHaveText("Stopped", { timeout: 30_000 });
  await openReceipt(page);
  await expect(page.getByText("Job cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Returned to you")).toBeVisible();
});

test("model_error: retry", async ({ page }) => {
  await start(page, ["Analysis crashes"]);
  await expect(page.getByRole("dialog", { name: "Analysis crashed" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("failure-retry").click();
  await receipt(page);
});

test("dismissed re-approval stays pending, never auto-approved", async ({ page }) => {
  await start(page, ["Seller raises price"]);
  await expect(page.getByRole("dialog", { name: "Needs your OK" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  await expect(page.getByTestId("status-headline")).toContainText("Paused: it needs your decision");
  // The graph is on the page while it runs, and shows the step that needs you.
  await expect(page.getByTestId("phase-r1")).toHaveAttribute("data-status", "awaiting_reapproval");
  await page.getByRole("button", { name: "1 needs you" }).click();
  await page.getByTestId("reapprove").click();
  await receipt(page);
});

test("a worko drive runs end to end", async ({ page }) => {
  await start(page, [], "Drive from Vancouver to Seattle", "Worko");
  await receipt(page);
  await expect(page.getByRole("img", { name: "Route map" })).toBeVisible();
  // Where the driving day ends there's a shortlist of places to sleep, and a plain note that nothing is booked.
  await expect(page.getByTestId("stay").first()).toContainText("Places to stay in");
  await expect(page.getByText("Nothing is booked", { exact: false })).toBeVisible();
});

test("dashboard lists jobs by folder and status, and opens them", async ({ page }) => {
  await start(page, [], "BTC odds dashboard check", "Inso");
  await receipt(page);
  const url = page.url();
  const card = page.getByTestId(`job-${url.split("/runs/")[1]}`);
  await page.goto("/home?folder=inso");
  await expect(page.getByRole("heading", { name: "Inso jobs" })).toBeVisible();
  // A card: the job's own title, a status badge, the agent handling it, and it opens the job.
  await expect(card).toBeVisible();
  await expect(card.getByTestId("card-status")).toHaveText(/Complete/);
  await expect(card).toContainText("Inso");
  await page.goto("/home?folder=worko");
  await expect(card).toHaveCount(0);
  await page.goto("/home");
  await expect(page.getByTestId("new-job-tile")).toBeVisible();
  await page.getByLabel("Search jobs").fill("dashboard check");
  await card.click();
  await expect(page).toHaveURL(url);
});

test("a plan across agents runs step by step, and says plainly what it can't book", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.fill("#task", "What are BTC odds right now, then plan a drive from Vancouver to Seattle, and book a hotel in Seattle");
  await page.getByRole("button", { name: /Ask/ }).click();
  const card = page.getByTestId("plan-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId("plan-step")).toHaveCount(2);
  // Agento can't book the hotel: the plan says so instead of pretending.
  await expect(card.getByTestId("plan-unavailable")).toContainText("can't book hotels");
  // Several jobs together are a project: its own page, one review totalled across the jobs.
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId("project-title")).not.toBeEmpty();
  await expect(page.getByTestId("project-review")).toBeVisible();
  await expect(page.getByTestId("project-most")).toContainText("$");
  await page.getByTestId("start-all").click();
  await expect(card.getByTestId("plan-status")).toHaveText("Finished", { timeout: 60_000 });
  await expect(card.getByTestId("plan-step-status")).toHaveText(["Done", "Done"]);
  await card.getByTestId("plan-step-link").nth(1).click();
  await expect(page.getByTestId("back-to-plan")).toContainText("Part of:");
  await expect(page.getByTestId("handoff")).toContainText("Inso");
  await expect(page.getByTestId("receipt-total")).toBeVisible();
});

test("an empty project can be made and filled by hand", async ({ page, request }) => {
  await prefs(page);
  const r = await (await request.post("/api/projects", { data: { title: "Austin trip" } })).json();
  await page.goto(r.url);
  await expect(page.getByTestId("project-title")).toHaveText("Austin trip");
  await expect(page.getByTestId("plan-status")).toHaveText("No jobs yet");
  await page.getByTestId("plan-add-input").fill("Plan a drive from Dallas to Austin");
  await page.getByRole("button", { name: /Add job/ }).click();
  await expect(page.getByTestId("plan-step")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("start-all")).toBeVisible();
});

test("limits are set once in Settings", async ({ page }) => {
  await prefs(page);
  await page.goto("/settings");
  // A harmless change: other tests run at the same time and share these limits.
  await page.getByTestId("limit-maxJobUsdc").fill("6");
  await page.getByTestId("save-limits").click();
  await expect(page.getByText("Limits saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("limit-maxJobUsdc")).toHaveValue("6");
  await page.getByTestId("limit-maxJobUsdc").fill("5");
  await page.getByTestId("save-limits").click();
  await expect(page.getByText("Limits saved")).toBeVisible();
});

test("a finished job can be saved and run again at today's prices", async ({ page }) => {
  await start(page, [], "BTC odds rerun check");
  await finished(page);
  const first = page.url();
  await page.getByTestId("save-job").click();
  await expect(page.getByTestId("save-job")).toHaveText("Saved ✓");
  await page.getByTestId("run-again").click();
  await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toBe(first);
  await page.goto("/home?folder=saved");
  await expect(page.getByTestId(`job-${first.split("/runs/")[1]}`)).toBeVisible();
});

test("starting from a goal: the agent asks one question, then proposes", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.getByTestId("goals").getByRole("button", { name: /Protect against a cost/ }).click();
  // No guessing: one question with answers to tap.
  await expect(page.getByTestId("msg-agent").last()).toContainText("What would cost you money");
  const answers = page.getByTestId("answer-options").getByRole("button");
  await expect(answers).toHaveCount(3);
  await answers.first().click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  // The card's own button is the one next step.
  await expect(page.getByTestId("adopt-move")).toHaveText(/Review and approve/);
});

test("a job has one thing in focus: the conversation is there when asked for", async ({ page }) => {
  await start(page, [], "BTC odds focus check");
  await finished(page);
  await expect(page.getByTestId("chat-input")).toHaveCount(0);
  await page.getByTestId("toggle-chat").click();
  await expect(page.getByTestId("msg-agent").first()).toBeVisible();
});

test("the work is drawn beside the chat, and the likeliest next step is one tap", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.fill("#task", "What are BTC odds right now?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  // Left: the move as a drawing, with what it reads and does and the most it can cost.
  const space = page.getByTestId("workspace");
  await expect(space).toHaveAttribute("data-filled", "");
  await expect(space.getByTestId("cover-sheet")).toBeVisible();
  await expect(space.locator("[data-ghost]")).toHaveCount(0);
  await expect(page.getByTestId("workspace-cost")).toContainText("Up to $");
  // The move's market is followed live: what it costs to buy right now.
  await expect(page.getByTestId("live-price")).toContainText(/Costs now|Nobody is selling|happen/, { timeout: 15_000 });
  await expect(page.getByTestId("stages").locator("[aria-current=step]")).toHaveText(/Shape it/);
  // Right: ways to change it, one tap each.
  await expect(page.getByTestId("quick").getByRole("button").first()).toBeVisible();
  await page.getByTestId("adopt-move").click();
  await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("stages").locator("[aria-current=step]")).toHaveText(/Review/);
  // The chat stays beside the review; the one approve button is on the review card.
  await expect(page.getByTestId("quick-primary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approve and start/ })).toHaveCount(1);
  await page.getByTestId("open-approve").click();
  await finished(page);
  await expect(page.getByTestId("stages").locator("[aria-current=step]")).toHaveText(/Done/);
});

test("before there is a move, the workspace shows the outline of the kind of work", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.getByTestId("goals").getByRole("button", { name: /Protect against a cost/ }).click();
  await expect(page.getByTestId("answer-options")).toBeVisible({ timeout: 30_000 });
  const space = page.getByTestId("workspace");
  await expect(space).toHaveAttribute("data-kind", "hedge");
  await expect(space.locator("[data-ghost]").first()).toBeVisible();
  // No category to pick: the outline follows what was asked.
  await expect(page.locator("[data-testid^=kind-]")).toHaveCount(0);
});

test("the showcase builds a long plan that can be changed before anything is paid", async ({ page, request }) => {
  await prefs(page);
  const made = await (await request.post("/api/runs", { data: { agent: "inso", task: "Run the showcase", mode: "demo", template: "showcase" } })).json();
  await page.goto(`/runs/${made.id}`);
  const board = page.getByTestId("plan-card");
  await expect(board).toBeVisible({ timeout: 60_000 });
  const steps = board.getByTestId("plan-step");
  const n = await steps.count();
  expect(n).toBeGreaterThanOrEqual(6);
  // The chat leads with starting it; nothing has run.
  await expect(page.getByTestId("start-all")).toBeVisible();
  await expect(board.getByTestId("plan-status")).not.toHaveText("Finished");
  // Take a step off the board.
  await steps.last().click();
  await expect(page.getByTestId("plan-inspector")).toBeVisible();
  // A step is a whole job: opened, it shows the same drawing a single job gets.
  await expect(page.getByTestId("step-blueprint").locator("[data-block]").first()).toBeVisible();
  await page.getByTestId("plan-remove").click();
  await expect(steps).toHaveCount(n - 1);
  await expect(board.getByTestId("plan-status")).toContainText(`${n - 1} jobs`);
});

test("settings shows what Agento sells to other agents and what it earned", async ({ page }) => {
  await prefs(page);
  await page.goto("/settings");
  const selling = page.getByTestId("selling");
  await expect(selling).toBeVisible();
  await expect(page.getByTestId("earned-outside")).toHaveText(/^\$/);
  await page.getByTestId("selling-toggle").click();
  await expect(page.getByTestId("selling-list")).toContainText("/api/x402/cover.quote");
  // The catalog and the spec are what another agent reads before paying.
  const spec = await (await page.request.get("/api/x402/openapi.json")).json();
  expect(Object.keys(spec.paths)).toContain("/api/x402/cover.quote");
  const unpaid = await page.request.get("/api/x402/markets.new?list=new");
  expect(unpaid.status()).toBe(402);
  expect((await unpaid.json()).accepts[0]).toMatchObject({ scheme: "exact", maxAmountRequired: "5000" });
});

test("quick changes are applied at once: the drawing and the cost follow without the agent", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.fill("#task", "What are BTC odds right now?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  const does = page.getByTestId("cover-pay");
  const before = await does.innerText();
  // More, right on the thing it changes.
  await page.getByTestId("step-more").click();
  await expect(does).not.toHaveText(before, { timeout: 3_000 });
  await expect(page.getByTestId("move-changes")).toBeVisible();
  // The options above the chat box: the step forward first, then changes with the numbers they lead to.
  await expect(page.getByTestId("quick-primary")).toHaveText("Review and approve");
  await expect(page.getByTestId("quick-option").first()).toHaveText(/more|fewer|instead|only/);
  const mid = await does.innerText();
  await page.getByTestId("quick-option").filter({ hasText: /fewer|only/ }).first().click();
  await expect(does).not.toHaveText(mid, { timeout: 3_000 });
  await page.getByTestId("quick-primary").click();
  await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
  // The review: the title and numbered steps on top, then what you get, how, the limits and the price, then the total.
  await expect(page.getByTestId("review-title")).not.toBeEmpty();
  await expect(page.getByTestId("review-steps").getByTestId("brief-step").first()).toBeVisible();
  for (const card of ["deliverable", "method", "risk", "price"]) await expect(page.getByTestId(`card-${card}`)).toBeVisible();
  await expect(page.getByTestId("review-risk").first()).toBeVisible();
  await expect(page.getByTestId("review-most")).toContainText("$");
  // While reviewing, the same changes rebuild the work order and its total.
  const most = await page.getByTestId("review-most").innerText();
  await page.getByTestId("quick-option").filter({ hasText: /more|instead/ }).first().click();
  await expect(page.getByTestId("review-most")).not.toHaveText(most, { timeout: 3_000 });
  await page.getByTestId("open-approve").click();
  await finished(page);
});
