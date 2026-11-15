import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { gateway: 0, wallet: 10, deposits: 0 };
vi.mock("@/server/circle", () => ({
  circleWallets: { agent: { id: "w1", address: "0x00000000000000000000000000000000000000a1" } },
  circleExecute: async () => {
    state.deposits++;
    state.gateway += 0.5; // credited once both txs land
    return "0xdeadbeef00";
  },
  circleSignTypedData: async () => "0x",
}));
vi.mock("@/server/chain", async (orig) => ({
  ...(await orig<typeof import("@/server/chain")>()),
  publicClient: { readContract: async () => BigInt(Math.round(state.wallet * 1e6)) },
}));
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ balances: [{ domain: 26, balance: String(state.gateway) }] })));

process.env.GATEWAY_TOPUP = "1";
process.env.GATEWAY_DAILY_CAP = "2";
const { ensureGatewayFunds, gatewayStatus } = await import("./nanopay");

describe("Gateway top-ups", () => {
  beforeEach(() => {
    state.gateway = 0;
    state.deposits = 0;
    state.wallet = 10;
  });

  it("several purchases at once top up only once", async () => {
    await Promise.all([ensureGatewayFunds(), ensureGatewayFunds(), ensureGatewayFunds()]);
    expect(state.deposits).toBe(2); // approve + deposit, one top-up
  });

  it("stops at the daily cap with a plain reason", async () => {
    await ensureGatewayFunds(); // second top-up today (1 + 1 = cap of 2)
    state.gateway = 0;
    await expect(ensureGatewayFunds()).rejects.toThrow(/Daily top-up limit reached \(2 USDC\)/);
  });

  it("says the wallet is empty instead of stalling, and warns ahead of time", async () => {
    vi.resetModules();
    const fresh = await import("./nanopay");
    state.wallet = 0.2;
    await expect(fresh.ensureGatewayFunds()).rejects.toThrow(/agent wallet has 0\.20 USDC/);
    expect((await fresh.gatewayStatus()).warning).toMatch(/Send USDC on Arc testnet/);
    void gatewayStatus;
  });
});
