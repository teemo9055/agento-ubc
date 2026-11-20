import { describe, expect, it } from "vitest";
import { figures, sentences, tidy } from "./tidy";

const PRICE = "Yes, the $823.75 asking price is competitive, sitting just below the typical $854 price charged across stores such as Walmart, Off Grid Stores, and EcoFlow Official, within an overall range of $699 to $1,449.";

describe("tidy", () => {
  it("pulls the figures out with a short caption", () => {
    expect(figures(PRICE).map((f) => f.value)).toEqual(["$823.75", "$854", "$699–$1,449"]);
    expect(figures(PRICE).map((f) => f.label)).toEqual(["asking price", "typical price", "price range"]);
    expect(figures("Try an offer between $700 and $800 since the lowest found is $699.").map((f) => [f.value, f.label])).toEqual([["$700–$800", "offer range"], ["$699", "lowest found"]]);
    expect(figures("The lowest is $699, and the typical is $1,250.").map((f) => f.value)).toEqual(["$699", "$1,250"]);
    expect(figures("It holds 99.8% positive buyer feedback.")[0].label).toBe("positive feedback");
  });
  it("leads with the answer and lists the supporting clauses", () => {
    const t = tidy(PRICE);
    expect(t.lead).toBe("Yes, the $823.75 asking price is competitive.");
    expect(t.points[0]).toMatch(/^Sits just below/);
    expect(tidy("The seller is EcoFlow, which holds 99.8% positive feedback.").points[0]).toBe("Holds 99.8% positive feedback.");
    expect(t.points[1]).toMatch(/^Within an overall range/);
  });
  it("splits sentences but not decimals or abbreviations", () => {
    expect(sentences("It costs $1.50 a day, e.g. Walmart. Then it rises.")).toEqual(["It costs $1.50 a day, e.g. Walmart.", "Then it rises."]);
  });
  it("keeps a plain sentence whole", () => {
    expect(tidy("The seller is trusted.")).toEqual({ figures: [], lead: "The seller is trusted.", points: [] });
  });
});
