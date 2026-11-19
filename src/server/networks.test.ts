import { describe, expect, it } from "vitest";
import { NETWORKS } from "@/lib/networks";
import { chainOf, liveReady, setupProblems } from "./chain";
import { currentNet, onMainnet, withNet } from "./netContext";
import { netOfCaip, requirements, PRODUCTS } from "./x402";
import { txUrl } from "@/lib/format";

describe("Arc testnet and mainnet side by side", () => {
  it("each network has its own chain, contracts and explorer", () => {
    expect(chainOf("testnet").chain.id).toBe(5042002);
    expect(chainOf("mainnet").chain.id).toBe(5042);
    expect(chainOf("mainnet").explorer).toBe("https://explorer.arc.io");
    // USDC is Arc's native asset with the same ERC-20 address on both; CCTP and Gateway differ.
    expect(NETWORKS.mainnet.usdc).toBe(NETWORKS.testnet.usdc);
    expect(NETWORKS.mainnet.gateway.wallet).not.toBe(NETWORKS.testnet.gateway.wallet);
    expect(NETWORKS.mainnet.cctpDomain).toBe(26);
    expect(txUrl("0xabc", "mainnet")).toBe("https://explorer.arc.io/tx/0xabc");
  });

  it("mainnet stays off, with the reason, until its vault factory is deployed", () => {
    const had = process.env.MAINNET_FACTORY_ADDRESS;
    delete process.env.MAINNET_FACTORY_ADDRESS;
    expect(liveReady("mainnet")).toBe(false);
    expect(setupProblems("mainnet")[0]).toMatch(/MAINNET_FACTORY_ADDRESS/);
    if (had) process.env.MAINNET_FACTORY_ADDRESS = had;
  });

  it("work inside a job follows that job's network, and testnet outside one", async () => {
    expect(currentNet()).toBe("testnet");
    await withNet("mainnet", async () => {
      await Promise.resolve();
      expect(currentNet()).toBe("mainnet");
      expect(onMainnet()).toBe(true);
    });
    expect(currentNet()).toBe("testnet");
  });

  it("a price quote names the network and the USDC it is paid in", () => {
    const p = PRODUCTS["spot.candles"];
    const r = requirements(p, "/x", "0x00000000000000000000000000000000000000aa", p.price, "mainnet");
    expect(r.network).toBe("eip155:5042");
    expect(netOfCaip(r.network)).toBe("mainnet");
    expect(netOfCaip("eip155:1")).toBeUndefined();
  });
});
