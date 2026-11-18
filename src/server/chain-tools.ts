import { formatUnits, isAddress, isHex, parseAbi, parseEventLogs, type Hex } from "viem";
import { EXPLORER, USDC, addresses, publicClient, usdcAbi, vaultAbi } from "./chain";

/**
 * Reading Arc for the agents, safely. One typed question at a time, answered from fixed contracts
 * with fixed ABIs through a client that holds no key: there is no way to pass raw call data, call an
 * arbitrary method or sign anything from here. Writing to the chain only happens through an approved
 * work order's vault, never from a tool.
 */
export type ChainQuestion =
  | { what: "balance"; address: string }
  | { what: "tx"; hash: string }
  | { what: "vault"; address: string }
  | { what: "payment"; from: string; nonce: string };

const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const usd = (v: bigint) => Number(formatUnits(v, 6));
const TIMEOUT_MS = 10_000;

const within = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("Arc didn't answer in time")), TIMEOUT_MS))]);

/** Checks a question before any call is made, so a bad one costs nothing and reaches no node. */
export function checkQuestion(q: Partial<ChainQuestion> & Record<string, unknown>): ChainQuestion | { error: string } {
  const addr = (v: unknown) => (typeof v === "string" && isAddress(v) && !/^0x0{40}$/i.test(v) ? v : null);
  if (q.what === "balance" || q.what === "vault") {
    const a = addr(q.address);
    return a ? { what: q.what, address: a } : { error: "address must be a 0x address the user or a job gave you; never make one up" };
  }
  if (q.what === "tx") return typeof q.hash === "string" && isHex(q.hash) && q.hash.length === 66 ? { what: "tx", hash: q.hash } : { error: "hash must be a 0x transaction hash (66 characters)" };
  if (q.what === "payment") {
    const from = addr(q.from);
    if (!from) return { error: "from must be the paying address" };
    return typeof q.nonce === "string" && isHex(q.nonce) && q.nonce.length === 66 ? { what: "payment", from, nonce: q.nonce } : { error: "nonce must be the 32-byte authorization nonce" };
  }
  return { error: "what must be balance, tx, vault or payment" };
}

export async function readArc(q: ChainQuestion): Promise<{ data: Record<string, unknown>; summary: string }> {
  if (q.what === "balance") {
    const usdc = await within(publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [q.address as Hex] }));
    return { data: { address: q.address, usdc: usd(usdc), network: "Arc testnet" }, summary: `${usd(usdc).toLocaleString()} USDC at ${q.address.slice(0, 8)}…` };
  }
  if (q.what === "tx") {
    const r = await within(publicClient.getTransactionReceipt({ hash: q.hash as Hex })).catch(() => null);
    if (!r) return { data: { hash: q.hash, found: false }, summary: "No such transaction on Arc testnet (yet)" };
    const block = await within(publicClient.getBlock({ blockNumber: r.blockNumber }));
    const moved = parseEventLogs({ abi: transferAbi, logs: r.logs.filter((l) => l.address.toLowerCase() === USDC.toLowerCase()), eventName: "Transfer" }).map((l) => ({
      from: l.args.from,
      to: l.args.to,
      usdc: usd(l.args.value),
    }));
    return {
      data: { hash: q.hash, status: r.status, from: r.from, to: r.to, block: Number(r.blockNumber), at: new Date(Number(block.timestamp) * 1000).toISOString(), usdcMoved: moved, explorer: `${EXPLORER}/tx/${q.hash}` },
      summary: `${r.status === "success" ? "Succeeded" : "Failed"} · ${moved.length ? moved.map((m) => `${m.usdc} USDC`).join(", ") : "no USDC moved"}`,
    };
  }
  if (q.what === "vault") {
    const v = q.address as Hex;
    const read = <F extends "agent" | "payer" | "funded" | "closed">(functionName: F) => within(publicClient.readContract({ address: v, abi: vaultAbi, functionName }));
    const agent = await read("agent").catch(() => null);
    // Only vaults this app's agent works for: anything else is someone else's contract and isn't read.
    if (!agent || !addresses.agent || (agent as string).toLowerCase() !== addresses.agent.toLowerCase()) return { data: { address: v, ours: false }, summary: "Not a work-order vault of this app" };
    const [payer, funded, closed, held] = await Promise.all([read("payer"), read("funded"), read("closed"), within(publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [v] }))]);
    return {
      data: { address: v, payer, funded: usd(funded as bigint), holdsNow: usd(held), closed, network: "Arc testnet" },
      summary: closed ? "Closed: what was left went back to the payer" : `Holds ${usd(held)} of ${usd(funded as bigint)} USDC funded`,
    };
  }
  const used = await within(publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [q.from as Hex, q.nonce as Hex] }));
  return { data: { from: q.from, nonce: q.nonce, settled: used }, summary: used ? "That payment was collected" : "That payment was never collected" };
}
