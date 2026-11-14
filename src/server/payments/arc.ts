import { decodeEventLog, toHex, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { FACTORY, USDC, accounts, addresses, factoryAbi, publicClient, send, usdcAbi, vaultAbi } from "../chain";
import { lineProof, lineTuple, planTree } from "../merkle";
import { decodeHeader, encodeHeader, type PaymentPayload, type PaymentRequirements } from "../x402";
import type { PaymentAdapter, X402Request } from "./index";
import { PaymentError } from "./index";

const APP_URL = process.env.APP_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const AUTH_WINDOW_SEC = 30;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const url = (req: X402Request) => {
  const q = new URLSearchParams({ ...req.params, seller: req.seller });
  return `${APP_URL}/api/x402/${req.product}?${q}`;
};

const headers = (req: X402Request, extra: Record<string, string> = {}) => ({
  ...(req.fault ? { "x-agento-fault": req.fault } : {}),
  ...extra,
});

const vaultOf = (run: { vault?: Hex }) => {
  if (!run.vault) throw new Error("work order has no vault");
  return run.vault;
};

export const arcAdapter: PaymentAdapter = {
  live: true,

  async open(run, planHash) {
    if (!FACTORY || !accounts.client || !addresses.agent) throw new Error("live mode is not configured");
    const cap = BigInt(run.cap);
    const root = planTree(run.lines).root as Hex;
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "allowance",
      args: [accounts.client.address, FACTORY],
    });
    if (allowance < cap) await send("client", { address: USDC, abi: usdcAbi, functionName: "approve", args: [FACTORY, cap] });
    const tx = await send("client", {
      address: FACTORY,
      abi: factoryAbi,
      functionName: "open",
      args: [addresses.agent, root, planHash, cap],
    });
    const vault = await publicClient.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "vaultFor",
      args: [accounts.client.address, planHash],
    });
    return { vault, fundingTx: tx.hash };
  },

  async setLine(run, line, planHash) {
    const tx = await send("client", {
      address: vaultOf(run),
      abi: vaultAbi,
      functionName: "setPlan",
      args: [planTree(run.lines).root as Hex],
    });
    return tx.hash;
  },

  async topUp(run, amount) {
    const vault = vaultOf(run);
    await send("client", { address: USDC, abi: usdcAbi, functionName: "approve", args: [vault, amount] });
    return (await send("client", { address: vault, abi: vaultAbi, functionName: "topUp", args: [amount] })).hash;
  },

  async quote(req) {
    let res: Response;
    try {
      res = await fetch(url(req), { headers: headers(req), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    } catch {
      throw new PaymentError("seller_402_timeout", "Seller did not answer");
    }
    if (res.status !== 402) throw new PaymentError("seller_402_timeout", `Seller answered ${res.status} instead of a price`);
    const body = (await res.json()) as { accepts: PaymentRequirements[] };
    return body.accepts[0];
  },

  async payX402(run, line, req, quote, onState) {
    const vault = vaultOf(run);
    const value = BigInt(quote.maxAmountRequired);
    const bal = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] });
    if (req.fault === "insufficient_balance" || bal < value)
      throw new PaymentError("insufficient_balance", "Vault balance can't cover this spend");

    onState("signing");
    const nonce = toHex(randomBytes(32));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + AUTH_WINDOW_SEC);
    const auth = await send("agent", {
      address: vault,
      abi: vaultAbi,
      functionName: "authorize",
      args: [lineTuple(line), lineProof(run.lines, line).proof, quote.payTo, value, 0n, validBefore, nonce],
    });

    const payment: PaymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: quote.network,
      payload: {
        signature: "0x",
        // Test switch: offer one base unit less than the quote, so the seller's own verification rejects it.
        authorization: { from: vault, to: quote.payTo, value: (req.fault === "payment_rejected" ? value - 1n : value).toString(), validAfter: "0", validBefore: validBefore.toString(), nonce },
      },
    };
    onState("pending", { fee: auth.fee });
    const res = await fetch(url(req), { headers: headers(req, { "x-payment": encodeHeader(payment) }), cache: "no-store" });

    if (res.ok) {
      const settled = decodeHeader<{ transaction: Hex }>(res.headers.get("x-payment-response") ?? "");
      const body = (await res.json()) as { data: unknown };
      return { data: body.data, result: { amount: value, txHash: settled.transaction, fee: auth.fee } };
    }

    const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
    const rejected = /underpaid|wrong payee|wrong network|expired|already used/i.test(reason);

    // Not settled: wait until chain time passes the authorization's expiry, confirm it was never used, release the cap.
    for (let i = 0; i < 60; i++) {
      const block = await publicClient.getBlock();
      if (block.timestamp > validBefore) break;
      await wait(Math.max(1000, (Number(validBefore - block.timestamp) + 1) * 1000));
    }
    const used = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [vault, nonce] });
    if (used) {
      // Settled after all; treat as paid.
      return { data: null, result: { amount: value, fee: auth.fee } };
    }
    await send("agent", { address: vault, abi: vaultAbi, functionName: "release", args: [nonce] });
    if (rejected) throw new PaymentError("payment_rejected", `Seller rejected the payment (${reason}). Authorization released, nothing charged`);
    throw new PaymentError("settle_fails", `Signed, but settlement failed (${reason}). Authorization expired and was released`);
  },

  async payDirect(run, line, amount, ref, onState) {
    onState("signing");
    const tx = await send("agent", { address: vaultOf(run), abi: vaultAbi, functionName: "pay", args: [lineTuple(line), lineProof(run.lines, line).proof, amount, ref] });
    onState("pending");
    return { amount, txHash: tx.hash, fee: tx.fee };
  },

  async close(run) {
    const tx = await send("agent", { address: vaultOf(run), abi: vaultAbi, functionName: "close", args: [] });
    let refunded = 0n;
    for (const log of tx.receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Closed") refunded = ev.args.refunded;
      } catch {
        // not a vault event
      }
    }
    return { refunded, txHash: tx.hash };
  },
};
