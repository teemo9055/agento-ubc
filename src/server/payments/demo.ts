import type { Hex } from "viem";
import { PRODUCTS, requirements } from "../x402";
import { SELLERS, priceAt } from "../sellers";
import type { PaymentAdapter } from "./index";
import { PaymentError } from "./index";

const SCALE = Number(process.env.DEMO_DELAY_SCALE ?? 1);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms * SCALE));
const spentByRun = new Map<string, bigint>();
const fundedByRun = new Map<string, bigint>();
const closedRuns = new Set<string>();

/** Same flow as the Arc adapter, with real market data and simulated settlement. */
export const demoAdapter: PaymentAdapter = {
  live: false,

  async open(run) {
    fundedByRun.set(run.id, BigInt(run.cap));
    spentByRun.set(run.id, 0n);
    await wait(600);
    return {};
  },

  async setLine() {
    await wait(400);
    return undefined;
  },

  async topUp(run, amount) {
    fundedByRun.set(run.id, (fundedByRun.get(run.id) ?? 0n) + amount);
    await wait(400);
    return undefined;
  },

  async quote(req) {
    const p = PRODUCTS[req.product];
    if (!p) throw new Error(`unknown product ${req.product}`);
    const seller = SELLERS[req.seller];
    const price = priceAt(p.price, seller) * (req.fault === "price_increase" ? 2n : 1n);
    if (req.fault === "seller_402_timeout") {
      await wait(2500);
      throw new PaymentError("seller_402_timeout", `${seller.name} did not answer`);
    }
    await wait(250);
    return requirements(p, `/api/x402/${p.id}`, seller.address, price);
  },

  async payX402(run, _line, req, quote, onState) {
    const amount = BigInt(quote.maxAmountRequired);
    const funded = fundedByRun.get(run.id) ?? 0n;
    const spent = spentByRun.get(run.id) ?? 0n;
    if (req.fault === "insufficient_balance" || spent + amount > funded)
      throw new PaymentError("insufficient_balance", "Vault balance can't cover this spend");
    onState("signing");
    await wait(350);
    if (req.fault === "payment_rejected") throw new PaymentError("payment_rejected", "Facilitator rejected the authorization");
    onState("pending");
    await wait(700);
    if (req.fault === "settle_fails") throw new PaymentError("settle_fails", "Signed, but settlement failed");
    const data = await PRODUCTS[req.product].run(new URLSearchParams(req.params));
    // Mirrors the vault: once closed, pending authorizations can't settle.
    if (closedRuns.has(run.id)) throw new PaymentError("settle_fails", "Vault closed before settlement");
    spentByRun.set(run.id, (spentByRun.get(run.id) ?? 0n) + amount);
    return { data, result: { amount } };
  },

  async payDirect(run, _line, amount, _ref: Hex, onState) {
    onState("signing");
    await wait(300);
    onState("pending");
    await wait(600);
    spentByRun.set(run.id, (spentByRun.get(run.id) ?? 0n) + amount);
    return { amount };
  },

  async close(run) {
    closedRuns.add(run.id);
    await wait(500);
    const refunded = (fundedByRun.get(run.id) ?? 0n) - (spentByRun.get(run.id) ?? 0n);
    return { refunded };
  },
};
