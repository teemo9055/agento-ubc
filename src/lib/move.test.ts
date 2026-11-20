import { describe, expect, it } from "vitest";
import { RESEARCH_PRICE } from "./move";
import { VENDOR_TOOLS } from "@/server/vendor-tools";

describe("prices shown before approving", () => {
  it("match what the server pays for every outside lookup", () => {
    for (const [tool, t] of Object.entries(VENDOR_TOOLS)) {
      if (tool === "service") continue;
      expect([tool, RESEARCH_PRICE[tool]]).toEqual([tool, Number(t.price({})) / 1e6]);
    }
  });
});
