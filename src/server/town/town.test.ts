import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../marketplace", async (orig) => ({
  ...(await orig<typeof import("../marketplace")>()),
  searchServices: async () => [
    { name: "Quicknode rpc", provider: "Quicknode", category: "INFRASTRUCTURE", description: "Pay-per-call blockchain reads", resource: "https://x402.quicknode.com/arc", method: "POST", priceUsd: 0.0001, networks: ["eip155:5042002"], payableHere: true },
  ],
}));

const { resetTown } = await import("./db");
const { resetSales, findSale, salesSummary, recordSale } = await import("../sales");
const { sendFromApp } = await import("./deposit");
const { act, adminCheck, adminLog, inbox } = await import("./admin");
const { getItem, listItems, statusOf } = await import("./hall");
const { addPost, board } = await import("./boards");
const { submitListing } = await import("./listings");
const { searchStore } = await import("./market");
const { readEntry, searchLibrary } = await import("./library");
const { refundSale } = await import("../refunds");
const { PRODUCTS, BadInput } = await import("../x402");

const ask = { kind: "request" as const, text: "Please add a tool that reads gas on Arc", from: "Sam" };
const practice = async () => {
  const r = await sendFromApp(ask, { live: false });
  if (!r.ok) throw new Error(r.reason);
  return r.item;
};

beforeEach(() => {
  resetTown();
  resetSales();
});

describe("Town Hall deposits", () => {
  it("records a practice deposit as a sale, linked to the item, that isn't counted as earnings", async () => {
    const item = await practice();
    expect(item.deposit).toMatchObject({ mode: "practice", state: "held" });
    const sale = findSale({ id: item.deposit.saleId! })!;
    expect(sale).toMatchObject({ product: "hall.request", amount: "1000000", payer: "practice" });
    expect(salesSummary().own.count).toBe(0);
    expect(statusOf(item)).toBe("received");
    expect(item.history.at(-1)?.what).toMatch(/Practice deposit/);
  });

  it("live: pays 1 USDC from the app wallet and records the sale with its transaction", async () => {
    const pay = vi.fn(async () => "0xabc");
    const r = await sendFromApp(ask, { live: true, pay });
    if (!r.ok) throw new Error(r.reason);
    expect(pay).toHaveBeenCalledOnce();
    expect(r.item.deposit).toMatchObject({ mode: "live", state: "held", tx: "0xabc" });
    expect(findSale({ id: r.item.deposit.saleId! })?.tx).toBe("0xabc");
  });

  it("a failed live payment leaves nothing in the inbox", async () => {
    const r = await sendFromApp(ask, { live: true, pay: async () => Promise.reject(new Error("no funds")) });
    expect(r.ok).toBe(false);
    expect(listItems()).toHaveLength(0);
  });

  it("an agent pays over x402: the item appears only once the payment settled, linked to the sale", async () => {
    const p = PRODUCTS["hall.request"];
    expect(p.price).toBe(1_000_000n);
    await expect(p.run(new URLSearchParams("kind=feedback&text=no"))).rejects.toBeInstanceOf(BadInput);
    const data = (await p.run(new URLSearchParams("kind=feedback&text=More%20Arc%20services%20please&from=bot"))) as { id: string; statusUrl: string };
    expect(data.statusUrl).toBe(`/town/hall/${data.id}`);
    expect(listItems()).toHaveLength(0);
    const sale = recordSale({ product: "hall.request", payer: "0x1111111111111111111111111111111111111111", amount: "1000000", tx: "0xfeed", own: false });
    p.settled!(sale, data);
    expect(getItem(data.id)).toMatchObject({ by: "agent", deposit: { mode: "live", state: "held", saleId: sale.id, tx: "0xfeed" } });
  });
});

describe("admin decisions", () => {
  it("needs the key: off without ADMIN_KEY, refused with a wrong one", () => {
    delete process.env.ADMIN_KEY;
    expect(adminCheck(new Headers({ "x-admin-key": "x" }))).toMatchObject({ ok: false, status: 503 });
    process.env.ADMIN_KEY = "secret-key";
    expect(adminCheck(new Headers({ "x-admin-key": "nope" }))).toMatchObject({ ok: false, status: 401 });
    expect(adminCheck(new Headers({ "x-admin-key": "secret-key", "x-admin-name": "Ana" }))).toEqual({ ok: true, who: "Ana" });
  });

  it("refunds once, through the shared refund path", async () => {
    const pay = vi.fn(async () => "0xrefund");
    const r = await sendFromApp(ask, { live: true, pay: async () => "0xdeposit" });
    if (!r.ok) throw new Error(r.reason);
    expect(await act({ action: "refund", itemId: r.item.id }, "Ana", { pay })).toMatchObject({ ok: true });
    expect(pay).toHaveBeenCalledWith(expect.any(String), 1_000_000n);
    expect(findSale({ id: r.item.deposit.saleId! })?.refundTx).toBe("0xrefund");
    expect(getItem(r.item.id)).toMatchObject({ deposit: { state: "refunded", refundTx: "0xrefund" } });
    expect(statusOf(getItem(r.item.id)!)).toBe("refunded");
    // Twice: refused by the item and by the sale's own lock.
    expect(await act({ action: "refund", itemId: r.item.id }, "Ana", { pay })).toMatchObject({ ok: false, status: 409 });
    expect(await refundSale(r.item.deposit.saleId!, "again", { pay })).toMatchObject({ ok: false, status: 409 });
    expect(pay).toHaveBeenCalledOnce();
    expect(adminLog()[0]).toMatchObject({ who: "Ana", action: "refund", target: r.item.id });
  });

  it("refunds a practice deposit with no transfer", async () => {
    const item = await practice();
    const pay = vi.fn();
    expect(await act({ action: "refund", itemId: item.id }, "admin", { pay })).toMatchObject({ ok: true, message: /Practice/ });
    expect(pay).not.toHaveBeenCalled();
    expect(findSale({ id: item.deposit.saleId! })?.refunded).toBeTruthy();
    expect(salesSummary().refunds.count).toBe(0);
  });

  it("spam keeps the deposit, and it can't be refunded or routed after", async () => {
    const item = await practice();
    expect(await act({ action: "spam", itemId: item.id }, "admin")).toMatchObject({ ok: true });
    expect(getItem(item.id)).toMatchObject({ state: "spam", deposit: { state: "kept" } });
    expect(statusOf(getItem(item.id)!)).toBe("kept as spam");
    expect(await act({ action: "refund", itemId: item.id }, "admin")).toMatchObject({ ok: false });
    expect(await act({ action: "route", itemId: item.id, to: ["lab"] }, "admin")).toMatchObject({ ok: false });
    expect(findSale({ id: item.deposit.saleId! })?.refunded).toBeUndefined();
  });

  it("routes to the Lab and the Forum, where people and agents can post", async () => {
    const item = await practice();
    expect(() => addPost({ itemId: item.id, board: "lab", kind: "finding", text: "Found a gas oracle" }, "person")).toThrow(/isn't on the Lab/);
    expect(await act({ action: "route", itemId: item.id, to: ["lab", "forum"] }, "admin")).toMatchObject({ ok: true });
    expect(statusOf(getItem(item.id)!)).toBe("routed");
    expect(board("lab").map((b) => b.item.id)).toEqual([item.id]);
    expect(board("forum").map((b) => b.item.id)).toEqual([item.id]);
    addPost({ itemId: item.id, board: "lab", kind: "finding", text: "Arc has a gas price RPC call" }, "agent");
    expect(board("lab")[0].posts).toHaveLength(1);
    expect(() => addPost({ itemId: item.id, board: "forum", kind: "offer", text: "I sell gas reads" }, "agent")).toThrow();
    expect(() => addPost({ itemId: item.id, board: "forum", kind: "offer", text: "I sell gas reads", url: "http://gas.example" }, "agent")).toThrow(/https/);
    expect(inbox().waiting).toHaveLength(0);
  });

  it("an accepted Lab solution is published to the Library, credited to the request", async () => {
    const item = await practice();
    await act({ action: "route", itemId: item.id, to: ["lab"] }, "admin");
    const post = addPost({ itemId: item.id, board: "lab", kind: "solution", text: "Read gas with eth_gasPrice through read-only Quicknode", from: "Lee" }, "person");
    expect(await act({ action: "accept", postId: post.id, title: "Read gas on Arc", section: "practices" }, "admin")).toMatchObject({ ok: true });
    const found = searchLibrary("gas on Arc").find((e) => e.credit?.itemId === item.id)!;
    expect(found).toMatchObject({ title: "Read gas on Arc", section: "practices", credit: { postId: post.id, from: "Lee" } });
    expect(getItem(item.id)).toMatchObject({ state: "answered", answer: { libraryId: found.id } });
    expect(await act({ action: "accept", postId: post.id, title: "Again" }, "admin")).toMatchObject({ ok: false, status: 409 });
  });

  it("a trusted Forum vendor is listed in the Store as independent, never as Verified by Circle", async () => {
    const item = await practice();
    await act({ action: "route", itemId: item.id, to: ["forum"] }, "admin");
    const offer = addPost({ itemId: item.id, board: "forum", kind: "offer", text: "Gas reads on Arc per request", url: "https://gas.example/x402", priceUsd: 0.001, from: "GasCo" }, "agent");
    expect(await act({ action: "trust", postId: offer.id }, "admin")).toMatchObject({ ok: true });
    const store = await searchStore("gas");
    expect(store.independent.find((s) => s.seller === "GasCo")).toMatchObject({ group: "independent", status: "approved", via: "forum" });
    expect(store.circle.every((s) => s.seller !== "GasCo")).toBe(true);
    expect(statusOf(getItem(item.id)!)).toBe("answered");
  });
});

describe("the Store", () => {
  it("a submitted listing starts pending and is listed once approved", async () => {
    expect(() => submitListing({ name: "Bad", description: "Not secure at all here", url: "http://plain.example", seller: "x" }, "person")).toThrow(/https/);
    const l = submitListing({ name: "Weather now", description: "Current weather for a city", url: "https://wx.example/x402", priceUsd: 0.002, seller: "WxCo" }, "agent");
    expect(l.status).toBe("pending");
    let s = await searchStore("weather");
    expect(s.independent.some((x) => x.seller === "WxCo")).toBe(false);
    expect(s.pending).toBe(1);
    expect(await act({ action: "approve-listing", listingId: l.id }, "admin")).toMatchObject({ ok: true });
    s = await searchStore("weather");
    expect(s.independent.find((x) => x.seller === "WxCo")).toMatchObject({ status: "approved", payableNow: true, group: "independent" });
  });

  it("lists Agento's own answers as independent and Circle's catalog as verified", async () => {
    const s = await searchStore("");
    expect(s.circle[0]).toMatchObject({ group: "circle", seller: "Quicknode", payableNow: true });
    expect(s.independent.find((x) => x.name === "hall.request")).toMatchObject({ priceUsd: 1, seller: expect.stringMatching(/^Agento/) });
  });
});

describe("the Library", () => {
  it("finds how to pay per request with x402", () => {
    const hits = searchLibrary("x402");
    expect(hits.length).toBeGreaterThan(3);
    expect(readEntry("pay-per-request")?.call).toMatch(/X-PAYMENT/);
  });

  it("prices come from the code", () => {
    expect(readEntry("tool-odds_history")?.price).toBe("$0.02 a request");
    expect(readEntry("sold-hall.request")?.price).toBe("$1.00 a request");
    expect(readEntry("tool-read_arc")?.price).toBe("Free");
  });
});
