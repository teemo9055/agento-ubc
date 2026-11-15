import type { Hex } from "viem";
import type { ResearchStep } from "@/lib/types";
import { chainlinkPrice } from "./chainlink";
import { QUICKNODE_PAYEE, bitcoinNetwork, gasPrice, walletBalance, type BitcoinNetwork, type GasPrice, type OraclePrice, type Paid, type WalletBalance } from "./onchain";
import { callService, findService, type ServiceResult } from "./marketplace";

/**
 * Paid lookups bought from vendors on Circle's Agent Marketplace with Gateway nanopayments.
 * Each entry says who is paid, what a request costs, how to run it and how to say the result
 * in one line. The orchestrator checks every purchase against the approved line before paying.
 */
export { QUICKNODE_PAYEE } from "./onchain";
const QUICKNODE = "Quicknode (Agent Marketplace)";
/** Quicknode's listed price per request, in USDC base units. */
const CALL = 100n;

export interface VendorTool {
  /** What the cost line calls the purchase. */
  service(args: Record<string, string>): string;
  payeeName(args: Record<string, string>): string;
  payee(args: Record<string, string>): Hex;
  price(args: Record<string, string>): bigint;
  run(args: Record<string, string>, maxAmount: bigint): Promise<{ paid: Paid }>;
  /** One line for the step once it's done. */
  note(data: unknown): string;
  /** The facts the write-up may use. */
  stat(data: unknown): Record<string, unknown>;
}

const money = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 4 : 2 })}`;

/** A short, safe view of whatever a third-party service answered. */
export function brief(v: unknown, max = 700): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return (s ?? "").replace(/\s+/g, " ").slice(0, max);
}

export const VENDOR_TOOLS: Record<string, VendorTool> = {
  oracle_price: {
    service: () => "Chainlink price via Quicknode",
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => chainlinkPrice(a.symbol.toLowerCase()),
    note: (d) => {
      const q = d as OraclePrice;
      return `${q.description} ${money(q.price)} · ${q.ageMinutes} min old`;
    },
    stat: (d) => {
      const q = d as OraclePrice;
      return { oracle: q.price, ageMinutes: q.ageMinutes, source: `${q.description} · Chainlink on Ethereum` };
    },
  },
  gas_price: {
    service: (a) => `Gas price on ${a.chain} via Quicknode`,
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => gasPrice(a.chain),
    note: (d) => {
      const g = d as GasPrice;
      return `${g.chain} gas ${g.gwei < 1 ? g.gwei.toFixed(3) : g.gwei.toFixed(1)} gwei · a transfer costs about ${g.transferCost.toFixed(7)} ${g.coin}`;
    },
    stat: (d) => {
      const g = d as GasPrice;
      return { chain: g.chain, gasGwei: g.gwei, transferCost: g.transferCost, coin: g.coin };
    },
  },
  btc_network: {
    service: () => "Bitcoin fees and mempool via Quicknode",
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    // Two requests: the fee estimate and the mempool.
    price: () => CALL * 2n,
    run: () => bitcoinNetwork(),
    note: (d) => {
      const b = d as BitcoinNetwork;
      return `Bitcoin fee ${b.feeSatVb} sat/vB · ${b.mempoolTxs.toLocaleString()} payments waiting (${b.mempoolMb} MB)`;
    },
    stat: (d) => {
      const b = d as BitcoinNetwork;
      return { feeSatPerVbyte: b.feeSatVb, typicalFeeBtc: b.typicalFeeBtc, mempoolTransactions: b.mempoolTxs, mempoolMb: b.mempoolMb };
    },
  },
  wallet_balance: {
    service: (a) => `Wallet balance on ${a.chain} via Quicknode`,
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => walletBalance(a.chain, a.address),
    note: (d) => {
      const w = d as WalletBalance;
      return `${w.address.slice(0, 6)}…${w.address.slice(-4)} on ${w.chain}: ${w.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC · ${w.native} ${w.coin}`;
    },
    stat: (d) => {
      const w = d as WalletBalance;
      return { chain: w.chain, address: w.address, usdc: w.usdc, native: w.native, coin: w.coin };
    },
  },
  // Any marketplace listing that takes our network. Price and payee were read from the seller
  // when the move was checked, and are part of the approved line.
  service: {
    service: (a) => `${a.provider || "Marketplace service"}: ${a.what || new URL(a.url).host}`,
    payeeName: (a) => `${a.provider || new URL(a.url).host} (Agent Marketplace)`,
    payee: (a) => a.payTo as Hex,
    price: (a) => BigInt(a.price ?? "0"),
    run: async (a, maxAmount) => {
      const listing = await findService(a.url);
      if (!listing) throw new Error("This service is no longer listed as payable on our network");
      return callService(listing, JSON.parse(a.input || "{}") as Record<string, unknown>, maxAmount, a.payTo);
    },
    note: (d) => {
      const r = d as ServiceResult;
      return `${r.provider} answered: ${brief(r.data, 110)}`;
    },
    stat: (d) => {
      const r = d as ServiceResult;
      return { provider: r.provider, answer: brief(r.data) };
    },
  },
};

export const isVendorTool = (tool: string) => tool in VENDOR_TOOLS;
export const vendorPrice = (r: Pick<ResearchStep, "tool" | "args">) => VENDOR_TOOLS[r.tool].price(r.args);
