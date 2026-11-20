import { describe, expect, it } from "vitest";
import { autoChain } from "./auto-chain";
import { validateProposal } from "./tools";
import { withNet } from "./netContext";

const move = (research: { tool: string; args: Record<string, string> }[]) => ({
  title: "Fair deal?",
  why: "x",
  ask: "Check it?",
  research: research.map((r) => ({ ...r, label: r.tool, why: "x" })),
  action: null,
  condition: null,
  budgetUsd: null,
});

describe("the chat's moves are wired into chains by code", () => {
  it("a pasted listing feeds the store-price search, the photo check and the seller search", async () => {
    const { move: wired, chained } = autoChain(
      move([
        { tool: "read_listing", args: { url: "https://www.ebay.com/itm/147285431158" } },
        { tool: "shopping_prices", args: {} },
        { tool: "image_check", args: {} },
        { tool: "web_search", args: {} },
      ]),
    );
    expect(chained).toBe(true);
    const r = await withNet("mainnet", () => validateProposal("worko", wired, "ac1", { composed: true }));
    if ("error" in r) throw new Error(r.error);
    const [read, prices, photo, seller] = r.proposal.research;
    expect(prices.bind?.product).toBe(`$${read.id}.searchTitle`);
    expect(photo.bind?.imageUrl).toBe(`$${read.id}.photo`);
    expect(seller.bind?.query).toBe(`$${read.id}.seller`);
  });

  it("leaves a step alone when the person already gave its input", () => {
    const { chained } = autoChain(move([{ tool: "read_listing", args: { url: "https://x.y/z" } }, { tool: "shopping_prices", args: { product: "iPhone 15" } }]));
    expect(chained).toBe(false);
  });
});
