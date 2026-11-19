import { beforeAll, describe, expect, it } from "vitest";

// Throwaway mainnet setup: well-known local test keys that hold nothing anywhere real, and a made-up
// factory. Nothing here is approved, so nothing ever reaches a chain.
const MAINNET_SELLER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
process.env.MAINNET_SELLER_PRIVATE_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
process.env.MAINNET_CLIENT_PRIVATE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
process.env.MAINNET_AGENT_PRIVATE_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
process.env.MAINNET_FACTORY_ADDRESS = "0x00000000000000000000000000000000000fac70";
process.env.AI_DISABLED = "true";

let orch: typeof import("@/server/orchestrator");
let x402: typeof import("@/server/x402");
let SELLERS: typeof import("@/server/sellers").SELLERS;
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
  x402 = await import("@/server/x402");
  SELLERS = (await import("@/server/sellers")).SELLERS;
});

const move = {
  id: "p1",
  title: "Odds history",
  why: "test",
  ask: "Pull odds history?",
  research: [{ id: "r1", tool: "odds_history", args: { symbol: "GEMI-BTC-A", tf: "15m" }, label: "Odds history", why: "trend" }],
  venue: "paper",
} as const;

describe("our own seller is paid at the address of the job's network", () => {
  it("knows the seller by either network's address", () => {
    expect(x402.payToOn("mainnet", SELLERS.primary.address)).toBe(MAINNET_SELLER);
    expect(x402.ownSellerAt(MAINNET_SELLER.toLowerCase())?.id).toBe("primary");
    expect(x402.ownSellerAt(SELLERS.primary.address)?.id).toBe("primary");
    expect(x402.ownSellerAt("0x00000000000000000000000000000000000000aa")).toBeUndefined();
  });

  it("a mainnet job's line names the mainnet seller, the one its price quote will ask to be paid", async () => {
    const run = await orch.createRun({ agent: "inso", task: "BTC odds", mode: "live", network: "mainnet", proposal: { ...move, research: [...move.research] } });
    expect(run.lines[0].payee).toBe(MAINNET_SELLER);
    expect(run.lines[0].payeeName).toBe(SELLERS.primary.name);
  });

  it("a testnet job keeps the testnet seller", async () => {
    const run = await orch.createRun({ agent: "inso", task: "BTC odds", proposal: { ...move, research: [...move.research] } });
    expect(run.lines[0].payee).toBe(SELLERS.primary.address);
  });
});
