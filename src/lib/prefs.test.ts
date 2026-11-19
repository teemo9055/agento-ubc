import { describe, expect, it } from "vitest";
import { jobNetwork, mainnetHeldBack, type Prefs } from "./prefs";

const p = (network?: "testnet" | "mainnet"): Prefs => ({ payFrom: "app", faults: [], network });
const cfg = (mainnet: boolean) => ({ networks: { testnet: { live: true }, mainnet: { live: mainnet } } });

describe("the network a job pays on", () => {
  it("is mainnet only when chosen and the server can pay there", () => {
    expect(jobNetwork(p("mainnet"), cfg(true))).toBe("mainnet");
    expect(jobNetwork(p("mainnet"), cfg(false))).toBe("testnet");
    expect(jobNetwork(p("mainnet"), null)).toBe("testnet");
    expect(jobNetwork(p(), cfg(true))).toBe("testnet");
  });
  it("says when mainnet was chosen but is held back", () => {
    expect(mainnetHeldBack(p("mainnet"), cfg(false))).toBe(true);
    expect(mainnetHeldBack(p("mainnet"), cfg(true))).toBe(false);
    expect(mainnetHeldBack(p("testnet"), cfg(false))).toBe(false);
    expect(mainnetHeldBack(p("mainnet"), null)).toBe(false);
  });
});
