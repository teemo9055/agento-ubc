import { expect, test } from "@playwright/test";
import { prefs } from "./helpers";

/**
 * The composer end to end, on the sample catalog (recorded answers, no money moves): a messy
 * problem becomes three plans; the most certain one runs with a value flowing between steps, two
 * sources that disagree, a tie-breaker, and a report with its evidence.
 */
const PROBLEM = "I'm about to send $400 to someone on Facebook Marketplace for a bike, here's the listing https://www.facebook.com/marketplace/item/1234567890 and their number (604) 555-0199";

async function compose(page: import("@playwright/test").Page) {
  await prefs(page);
  await page.goto("/new");
  await page.getByRole("tab", { name: /Worko/ }).click();
  await page.fill("#task", PROBLEM);
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("compose-funnel")).toBeVisible({ timeout: 30_000 });
}

for (const motion of ["full", "reduced"] as const) {
  test(`a problem becomes three plans, and the most certain one cross-checks and reports (${motion} motion)`, async ({ page }) => {
    if (motion === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    await compose(page);
    // The funnel's numbers are the map's: every service searched, the relevant ones, the plans built.
    await expect(page.getByTestId("funnel-searched")).toHaveAttribute("data-value", "6");
    await expect(page.getByTestId("funnel-plans")).toHaveAttribute("data-value", "3");
    for (const t of ["quick", "thorough", "certain"]) await expect(page.getByTestId(`tier-${t}`)).toBeVisible();
    await expect(page.getByTestId("tier-thorough")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("tier-certain").getByTestId("cross-checked")).toBeVisible();

    await page.getByTestId("tier-certain").click();
    await expect(page.getByTestId("tier-certain")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("adopt-move").click();
    await expect(page.getByTestId("review-card")).toBeVisible({ timeout: 30_000 });
    // Before approval: the plan as a graph, with the value that will flow between steps named on its edge.
    const draftGraph = page.getByTestId("draft-graph");
    await expect(draftGraph.getByTestId("vault-node")).toBeVisible();
    await expect(draftGraph.locator('[data-testid^="edge-label-"]').first()).toContainText("seller →");
    await expect(page.getByTestId("review-maybe")).toContainText("Only if the sources disagree");

    await page.getByTestId("open-approve").click();
    await expect(page.getByTestId("report")).toBeVisible({ timeout: 60_000 });

    const graph = page.getByTestId("done-graph");
    // Two phone checks disagreed (≠), so the tie-breaker was bought.
    await expect(graph.locator('[data-agree="false"]').first()).toBeVisible();
    await expect(graph.locator('[data-tiebreaker="true"]')).toHaveAttribute("data-status", "done");
    // What each step found, and how it reads.
    await expect(graph.locator('[data-finding-tone="bad"]').first()).toBeVisible();
    await expect(graph.getByTestId("graph-spend")).toContainText("spent $");
    await expect(graph.getByTestId("verdict-node")).toHaveAttribute("data-lean", /do_not_proceed|be_careful/);

    // Replay: at the very start, every step is waiting again.
    const scrubber = graph.getByTestId("replay-scrubber");
    await scrubber.fill("0");
    await expect(graph.locator('[data-testid^="phase-"][data-status="planned"]')).toHaveCount(await graph.locator('[data-testid^="phase-"][data-status]').count());
    await scrubber.fill(await scrubber.getAttribute("max") ?? "0");
    await expect(graph.locator('[data-tiebreaker="true"]')).toHaveAttribute("data-status", "done");

    // The report: claims with evidence chips, the conflict explained, the spend from the receipt.
    const report = page.getByTestId("report");
    await expect(report.getByTestId("report-conflicts")).toContainText("third source");
    await report.locator('[data-testid^="evidence-"]').first().click();
    await expect(page.getByTestId("evidence-popover")).toContainText("Practice: no money moved");
    // It worked, so it's a recipe now.
    await expect(page.getByTestId("learned-banner")).toContainText("Saved as a recipe");
    // Watch what it found: priced per check and in total before anything runs.
    if (motion === "full") {
      await expect(page.getByTestId("watch-cost")).toContainText(/Each check about \$[\d.]+ · at most \$[\d.]+ total/);
      await page.getByTestId("watch-start").click();
      await expect(page.getByTestId("watch-made")).toBeVisible();
    }
    if (process.env.SHOT && motion === "full") {
      await page.keyboard.press("Escape");
      await graph.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "test-results/compose-done.png", fullPage: true });
    }
  });
}

test("a question no sample service covers shows as a gap that can be skipped", async ({ page }) => {
  await prefs(page);
  await page.goto("/new");
  await page.getByRole("tab", { name: /Worko/ }).click();
  await page.fill("#task", "Is this seller legit? Their listing https://www.facebook.com/marketplace/item/42 and email sam@example.com");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByTestId("compose-funnel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="fact-"][data-covered="false"]').first()).toBeVisible();
  await page.getByTestId("adopt-move").click();
  const gap = page.getByTestId("draft-graph").locator('[data-gap="true"]').first();
  await expect(gap).toContainText("No service found for this");
  await gap.locator('[data-testid^="gap-skip-"]').click();
  await expect(page.getByTestId("draft-graph").locator('[data-gap="true"]')).toHaveCount(0, { timeout: 10_000 });
});
