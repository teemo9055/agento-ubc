import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("../marketplace", async (orig) => ({
  ...(await orig<typeof import("../marketplace")>()),
  searchServices: async () => [
    { name: "Quicknode rpc", provider: "Quicknode", category: "INFRASTRUCTURE", description: "Pay-per-call blockchain reads", resource: "https://x402.quicknode.com/arc", method: "POST", priceUsd: 0.0001, networks: ["eip155:5042002"], payableHere: true },
  ],
  payableServices: async () => [],
}));

const { resetTown } = await import("./db");
const { resetSales } = await import("../sales");
const { allEntries, readEntry, mcpToolOf, MCP_TOOLS, perRequest } = await import("./library");
const { FREE_TOOLS, RESEARCH, TOOLKIT, researchPrice } = await import("../tools");
const { PRODUCTS } = await import("../x402");
const { limits } = await import("../settings");
const { searchStore, findStoreItem } = await import("./market");
const { sendFromApp } = await import("./deposit");
const { act } = await import("./admin");
const { addPost, board } = await import("./boards");
const { publicQueue } = await import("./hall");
const F = await import("./format");
const { BUILDINGS } = await import("./sections");

const BASE = "http://town.test";
beforeEach(() => {
  resetTown();
  resetSales();
});

describe("every Library entry matches the code it describes", () => {
  it("free tools: one entry each, free, naming the tool and the agents that have it", () => {
    for (const name of Object.keys(FREE_TOOLS)) {
      const e = readEntry(`tool-${name}`)!;
      expect(e, name).toBeDefined();
      expect(e.price).toBe("Free");
      expect(e.priceUsdc).toBe("0");
      expect(e.tool).toContain(`"${name}"`);
      expect(mcpToolOf(e)).toBe("look_up");
      expect(e.agents).toEqual((["inso", "trado", "travo"] as const).filter((a) => TOOLKIT[a].free.includes(name)));
    }
  });

  it("paid lookups: price from researchPrice, and the agents that can buy it", () => {
    for (const name of Object.keys(RESEARCH)) {
      const e = readEntry(`tool-${name}`)!;
      expect(e, name).toBeDefined();
      expect(e.tool).toContain(`"${name}"`);
      expect(e.agents).toEqual((["inso", "trado", "travo"] as const).filter((a) => TOOLKIT[a].research.includes(name)));
      if (name === "service") continue; // priced by each seller
      expect(e.priceUsdc).toBe(researchPrice(name).toString());
      expect(e.price).toBe(perRequest(researchPrice(name)));
    }
  });

  it("everything Agento sells: price from PRODUCTS, and the same price in the Store", async () => {
    for (const p of Object.values(PRODUCTS)) {
      const e = readEntry(`sold-${p.id}`)!;
      expect(e.priceUsdc).toBe(p.price.toString());
      expect(e.call).toBe(`GET /api/x402/${p.id}?${p.example}`);
      const item = (await findStoreItem(e.storeId!))!;
      expect(Math.round(item.priceUsd! * 1e6)).toBe(Number(p.price));
      expect(F.storeItemJson(item, BASE).priceUsdc).toBe(p.price.toString());
    }
  });

  it("any entry with a fixed price states it the same way in words", () => {
    for (const e of allEntries().filter((x) => x.priceUsdc && x.priceUsdc !== "0")) expect(e.price, e.id).toContain(perRequest(BigInt(e.priceUsdc!)).split(" ")[0]);
  });

  it("limits come from Settings", () => {
    const l = limits();
    expect(readEntry("limit-order")!.body).toContain(`$${l.maxOrderUsd}`);
    expect(readEntry("limit-job")!.body).toContain(`${l.maxJobUsdc} USDC`);
    expect(readEntry("limit-plan")!.body).toContain(`$${l.maxPlanUsd}`);
    expect(readEntry("limit-big-spend")!.body).toContain(`${l.bigSpendUsdc} USDC`);
  });

  it("names only MCP tools the server really has, links only to entries and Store items that exist", async () => {
    const { buildMcpServer } = await import("../mcp");
    const server: McpServer = buildMcpServer(BASE);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect([...MCP_TOOLS].sort()).toEqual(names);
    const ids = new Set(allEntries().map((e) => e.id));
    for (const e of allEntries()) {
      const first = e.tool?.match(/^([a-z_]+)[ {]/)?.[1];
      if (first && !e.tool!.startsWith("GET")) expect(names, `${e.id}: ${first}`).toContain(first);
      for (const s of e.seeAlso ?? []) expect(ids.has(s), `${e.id} → ${s}`).toBe(true);
      if (e.storeId) expect(await findStoreItem(e.storeId), e.storeId).toBeDefined();
    }
  });

  it("has a glossary with the words people ask about", () => {
    const g = allEntries().filter((e) => e.section === "glossary").map((e) => e.title);
    for (const w of ["x402", "USDC", "Arc", "Vault", "Circle Gateway"]) expect(g).toContain(w);
  });
});

describe("the agent formats carry the same ids as the people view", () => {
  it("Library: index and article", () => {
    const people = allEntries();
    const doc = F.libraryDoc(BASE, people);
    expect((doc.json.entries as { id: string }[]).map((e) => e.id)).toEqual(people.map((e) => e.id));
    expect(doc.json).toMatchObject({ schemaVersion: F.SCHEMA_VERSION, building: "library" });
    for (const e of people) expect(doc.md).toContain(`\`${e.id}\``);
    const e = readEntry("pay-per-request")!;
    const a = F.articleDoc(e, BASE);
    expect(a.md.split("\n")[0]).toBe(`# ${e.title}`);
    expect(a.json).toMatchObject({ id: e.id, slug: e.id, title: e.title, updatedAt: e.updated, price: e.price });
    expect(a.md).toContain(`/api/x402/markets.search?${PRODUCTS["markets.search"].example}`);
    expect(a.md).not.toContain("{BASE}");
  });

  it("Store: both groups, the same ids in JSON and Markdown", async () => {
    const r = await searchStore("", { origin: BASE });
    const doc = F.storeDoc(BASE, r);
    expect((doc.json.independent as { id: string }[]).map((i) => i.id)).toEqual(r.independent.map((i) => i.id));
    expect((doc.json.verifiedByCircle as { id: string }[]).map((i) => i.id)).toEqual(r.circle.map((i) => i.id));
    for (const i of [...r.circle, ...r.independent]) expect(doc.md).toContain(`\`${i.id}\``);
    expect(r.circle[0].id).toBe(r.circle[0].id.match(/^circle-[0-9a-f]{12}$/)?.[0]);
  });

  it("Town Hall, Lab and Forum", async () => {
    const r = await sendFromApp({ kind: "need", text: "A weather feed on Arc testnet", from: "Sam" }, { live: false });
    if (!r.ok) throw new Error(r.reason);
    const id = r.item.id;
    await act({ action: "route", itemId: id, to: ["lab", "forum"] }, "admin");
    const post = addPost({ itemId: id, board: "lab", kind: "finding", text: "Two sellers list weather on Base only" }, "agent");

    const hall = F.hallDoc(BASE);
    expect((hall.json.queue as { id: string }[]).map((i) => i.id)).toEqual(publicQueue().map((i) => i.id));
    expect(hall.md).toContain(`\`${id}\``);
    const ticket = F.ticketDoc(publicQueue()[0], BASE);
    expect(ticket.json).toMatchObject({ id, status: "routed" });

    const lab = F.boardDoc("lab", BASE);
    expect((lab.json.threads as { id: string; stage: string }[]).map((t) => [t.id, t.stage])).toEqual([[id, "investigating"]]);
    expect(lab.md).toContain(`\`${id}\``);
    const t = F.threadDoc("lab", board("lab")[0], BASE);
    expect(t.md).toContain(`\`${post.id}\``);
    expect((t.json.posts as { id: string }[])[0].id).toBe(post.id);
    expect((F.boardDoc("forum", BASE).json.threads as { id: string }[]).map((x) => x.id)).toEqual(board("forum").map((x) => x.item.id));
  });

  it("llms.txt lists every building and every article", () => {
    const txt = F.llmsTxt(BASE);
    for (const b of BUILDINGS) expect(txt).toContain(`${BASE}${b.api}?format=md`);
    for (const e of allEntries()) expect(txt).toContain(`/api/town/library/${e.id}?format=md`);
  });
});
