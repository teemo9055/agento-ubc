import { beforeEach, describe, expect, it } from "vitest";
import { answerHash, checkDelivery } from "./delivery";
import { claimRefund, redeliver } from "./refunds";
import { recordSale, resetSales } from "./sales";
import { recordDelivery, resetDeliveries, standing } from "./strikes";
import { PRODUCTS } from "./x402";

describe("delivery check", () => {
  it("fails only on what the listing promised", () => {
    expect(checkDelivery(undefined)).toMatchObject({ ok: false, test: "answered" });
    expect(checkDelivery(null)).toMatchObject({ ok: false, test: "readable" });
    expect(checkDelivery({})).toMatchObject({ ok: false, test: "readable" });
    expect(checkDelivery({ error: "rate limited" })).toMatchObject({ ok: false, test: "readable" });
    expect(checkDelivery("<html>")).toMatchObject({ ok: false, test: "readable" });
    expect(checkDelivery({ ticker: "X" }, { fields: ["ticker", "contracts"] })).toMatchObject({ ok: false, test: "complete", reason: "Missing contracts" });
    expect(checkDelivery({ symbol: "ethusd", price: 1 }, {}, { symbol: "BTCUSD" })).toMatchObject({ ok: false, test: "about" });
    const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
    expect(checkDelivery({ price: 1, updatedAt: old }, { fields: ["price"], maxAgeMin: 25 * 60 })).toMatchObject({ ok: false, test: "fresh" });
  });

  it("is fair to sellers: real answers that are empty or 'not found' pass", () => {
    expect(checkDelivery([], { list: true, fields: ["ticker"] })).toEqual({ ok: true });
    expect(checkDelivery(null, PRODUCTS["places.geocode"].promise)).toEqual({ ok: true });
    expect(checkDelivery({ symbol: "BTCUSD", price: 1 }, {}, { symbol: "btcusd" })).toEqual({ ok: true });
    expect(checkDelivery({ price: 1, updatedAt: new Date().toISOString() }, { fields: ["price"], maxAgeMin: 60 })).toEqual({ ok: true });
    // A field that is simply zero is present.
    expect(checkDelivery({ distanceKm: 0, hours: 0, legs: [] }, PRODUCTS["routes.drive"].promise)).toEqual({ ok: true });
  });
});

describe("refund claims", () => {
  const payer = "0x00000000000000000000000000000000000000aa";
  const sale = (answer: unknown, at?: string) => {
    const s = recordSale({ product: "markets.event", payer, amount: "10000", tx: `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`, own: false, nonce: "0xabc", params: { ticker: "BTC1" }, answerHash: answerHash(answer), answer: JSON.stringify(answer) });
    if (at) s.at = at;
    return s;
  };
  const pay = async () => "0xrefund";
  beforeEach(() => resetSales());

  it("pays back an answer that fails a check, once", async () => {
    const s = sale({});
    const r = await claimRefund({ tx: s.tx, payer, answer: {} }, { pay });
    expect(r).toMatchObject({ ok: true, amount: "10000", refundTx: "0xrefund" });
    expect(await claimRefund({ tx: s.tx, payer, answer: {} }, { pay })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses claims without evidence, from someone else, or too late", async () => {
    const good = { ticker: "BTC1", title: "BTC", contracts: [] };
    const s = sale(good);
    expect(await claimRefund({ tx: s.tx, payer, answer: good }, { pay })).toMatchObject({ ok: false, status: 422 });
    const bad = sale({});
    expect(await claimRefund({ tx: bad.tx, payer, answer: { forged: true } }, { pay })).toMatchObject({ ok: false, status: 422 });
    expect(await claimRefund({ tx: bad.tx, payer: "0x00000000000000000000000000000000000000bb", answer: {} }, { pay })).toMatchObject({ ok: false, status: 403 });
    const late = sale({}, new Date(Date.now() - 11 * 60_000).toISOString());
    expect(await claimRefund({ tx: late.tx, payer, answer: {} }, { pay })).toMatchObject({ ok: false, status: 410 });
  });

  it("lets a failed transfer be claimed again", async () => {
    const s = sale({});
    const failing = async () => {
      throw new Error("rpc down");
    };
    expect(await claimRefund({ tx: s.tx, payer, answer: {} }, { pay: failing })).toMatchObject({ ok: false, status: 502 });
    expect(await claimRefund({ tx: s.tx, payer, answer: {} }, { pay })).toMatchObject({ ok: true });
  });

  it("sends a lost answer again to the payer only", () => {
    const good = { ticker: "BTC1", title: "BTC", contracts: [] };
    sale(good);
    expect(redeliver(payer, "0xABC")).toMatchObject({ ok: true, data: good });
    expect(redeliver("0x00000000000000000000000000000000000000bb", "0xabc")).toMatchObject({ ok: false });
  });
});

describe("seller strikes", () => {
  const v = "0x00000000000000000000000000000000000000cc";
  beforeEach(() => resetDeliveries());

  it("pauses after two misses in a day, and one good delivery clears it", () => {
    recordDelivery({ vendor: v, ok: false });
    expect(standing(v).skipped).toBe(false);
    recordDelivery({ vendor: v, ok: false });
    expect(standing(v)).toMatchObject({ skipped: true });
    recordDelivery({ vendor: v, ok: true });
    expect(standing(v).skipped).toBe(false);
  });

  it("forgets misses older than a day", () => {
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    recordDelivery({ vendor: v, ok: false, at: old });
    recordDelivery({ vendor: v, ok: false });
    expect(standing(v).skipped).toBe(false);
  });
});
