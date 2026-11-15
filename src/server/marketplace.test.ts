import { describe, expect, it, vi } from "vitest";

const listing = { name: "Acme /facts", provider: "Acme", category: "DATA_ENRICHMENT", description: "A fact about a topic", resource: "https://api.acme.test/facts", method: "GET" as const, priceUsd: 0.002, networks: ["eip155:5042002"], payableHere: true, payTo: "0x00000000000000000000000000000000000000Ac" as const, amount: "2000", input: "topic (string)" };

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd"] }));
vi.mock("@/server/marketplace", async (orig) => {
  const real = await orig<typeof import("@/server/marketplace")>();
  return {
    ...real,
    findService: async (url: string) => (url.replace(/\/$/, "") === listing.resource ? listing : undefined),
    // The seller's live answer to "what does this request cost, and who gets paid?"
    quoteService: async (_s: unknown, input: Record<string, unknown>) => ({ amount: input.topic === "pricey" ? 50_000n : 2000n, payTo: listing.payTo }),
  };
});

const { validateProposal } = await import("./tools");
const { planFromProposal } = await import("./agents/toolbox");
const { serviceRequest } = await import("./marketplace");

const ask = (research: unknown[]) => ({ title: "Look it up", why: "wanted", ask: "Buy this lookup?", research, action: null, condition: null, budgetUsd: null });
const service = (args: Record<string, string>) => ({ tool: "service", args, label: "Acme fact", why: "the user asked" });

describe("buying from any marketplace service", () => {
  it("builds the request the listing expects", () => {
    expect(serviceRequest({ resource: "https://x.test/a", method: "GET" }, { q: "btc", n: 2 }).url).toBe("https://x.test/a?q=btc&n=2");
    const rpc = serviceRequest({ resource: "https://node.test/", method: "POST" }, { method: "eth_blockNumber" });
    expect(JSON.parse(String(rpc.init.body))).toEqual({ jsonrpc: "2.0", id: 1, params: [], method: "eth_blockNumber" });
  });

  it("never sends anything that could move money through a paid node", () => {
    expect(() => serviceRequest({ resource: "https://node.test/", method: "POST" }, { method: "eth_sendRawTransaction", params: ["0x00"] })).toThrow(/only reads/);
  });

  it("takes price and payee from the seller, not from the model", async () => {
    // The model claims it's free and names its own payee; code ignores both.
    const v = await validateProposal("inso", ask([service({ url: "https://api.acme.test/facts", input: '{"topic":"gold"}', price: "0", payTo: "0x000000000000000000000000000000000000dEaD" })]), "m1");
    if (!("proposal" in v)) throw new Error(v.error);
    expect(v.proposal.research[0].args).toMatchObject({ provider: "Acme", price: "2000", payTo: listing.payTo, input: '{"topic":"gold"}' });
    const plan = planFromProposal(v.proposal);
    expect(plan.lines[0]).toMatchObject({ rail: "gateway", payee: listing.payTo, approved: "2000", payeeName: "Acme (Agent Marketplace)" });
  });

  it("refuses services that aren't payable here, cost too much, or get malformed input", async () => {
    const unlisted = await validateProposal("inso", ask([service({ url: "https://elsewhere.test/api", input: "{}" })]), "m2");
    expect("error" in unlisted && unlisted.error).toMatch(/isn't a marketplace service payable on this network/);
    const pricey = await validateProposal("inso", ask([service({ url: "https://api.acme.test/facts", input: '{"topic":"pricey"}' })]), "m3");
    expect("error" in pricey && pricey.error).toMatch(/above the 0.01 USDC per-request limit/);
    const garbled = await validateProposal("inso", ask([service({ url: "https://api.acme.test/facts", input: "topic=gold" })]), "m4");
    expect("error" in garbled && garbled.error).toMatch(/input must be a JSON object/);
  });

  it("typed onchain lookups are priced lines paid to the vendor, and bad input is caught before paying", async () => {
    const v = await validateProposal("trado", ask([
      { tool: "gas_price", args: { chain: "base" }, label: "Base gas", why: "cost to move" },
      { tool: "btc_network", args: {}, label: "Bitcoin fees", why: "how busy" },
      { tool: "oracle_price", args: { symbol: "xauusd" }, label: "Gold", why: "check" },
    ]), "m5");
    if (!("proposal" in v)) throw new Error(v.error);
    const plan = planFromProposal(v.proposal);
    expect(plan.lines.map((l) => [l.payeeName, l.approved, l.rail])).toEqual([
      ["Quicknode (Agent Marketplace)", "100", "gateway"],
      ["Quicknode (Agent Marketplace)", "200", "gateway"],
      ["Quicknode (Agent Marketplace)", "100", "gateway"],
    ]);
    const chain = await validateProposal("trado", ask([{ tool: "gas_price", args: { chain: "dogechain" }, label: "x", why: "y" }]), "m6");
    expect("error" in chain && chain.error).toMatch(/unknown chain/);
    const addr = await validateProposal("trado", ask([{ tool: "wallet_balance", args: { chain: "base", address: "vitalik.eth" }, label: "x", why: "y" }]), "m7");
    expect("error" in addr && addr.error).toMatch(/full wallet address/);
    // Inso doesn't carry the network tools.
    const notMine = await validateProposal("inso", ask([{ tool: "gas_price", args: { chain: "base" }, label: "x", why: "y" }]), "m8");
    expect("error" in notMine && notMine.error).toMatch(/can't buy gas_price/);
  });
});
