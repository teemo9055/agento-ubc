"use client";
import { toCircleSmartAccount, toModularTransport, toPasskeyTransport, toWebAuthnCredential, WebAuthnMode } from "@circle-fin/modular-wallets-core";
import { createPublicClient, encodeFunctionData, parseAbi, type Hex, type Transport } from "viem";
import { createBundlerClient, toWebAuthnAccount } from "viem/account-abstraction";
import { arc, arcTestnet } from "viem/chains";
import type { Net } from "@/lib/networks";

/**
 * The user's own wallet: a Circle modular smart account owned by a passkey
 * (Face ID / Touch ID / security key). Gas is sponsored by Circle's paymaster.
 */
const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ?? "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
const STORE = "agento:passkey";
export { passkeyConfigured, passkeySupported, savedWallet, type SavedWallet } from "./saved";
import { savedWallet, type SavedWallet } from "./saved";

function emitChange() {
  window.dispatchEvent(new Event("agento:wallet"));
}

// Circle pins its own viem version; the transport is shared across both at runtime.
// The same passkey owns a smart account on each Arc network; which one signs follows the job.
const chainFor = (net: Net) => (net === "mainnet" ? arc : arcTestnet);
const modular = (net: Net = "testnet") => toModularTransport(`${CLIENT_URL}/${net === "mainnet" ? "arc" : "arcTestnet"}`, CLIENT_KEY) as unknown as Transport;

async function smartAccount(credential: { id: string; publicKey: Hex }, net: Net = "testnet") {
  const transport = modular(net);
  const client = createPublicClient({ chain: chainFor(net), transport });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = await toCircleSmartAccount({ client: client as any, owner: toWebAuthnAccount({ credential: credential as any }) as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bundler = createBundlerClient({ account: account as any, chain: chainFor(net), transport });
  return { account, bundler };
}

async function remember(credential: { id: string; publicKey: Hex }, username: string) {
  const { account } = await smartAccount(credential);
  const saved: SavedWallet = { id: credential.id, publicKey: credential.publicKey, username, address: account.address };
  localStorage.setItem(STORE, JSON.stringify(saved));
  emitChange();
  return saved;
}

/** Circle usernames: 5-50 chars of letters, digits and _@.:+- ; a short suffix keeps them unique. */
export function toUsername(name: string) {
  const base = name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_@.:+-]/g, "").slice(0, 40) || "agento";
  return `${base}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Creates a new passkey and its smart account. */
export async function createWallet(name: string) {
  const username = toUsername(name);
  const credential = await toWebAuthnCredential({ transport: toPasskeyTransport(CLIENT_URL, CLIENT_KEY), mode: WebAuthnMode.Register, username });
  return remember(credential as { id: string; publicKey: Hex }, username);
}

/** Signs in with a passkey made earlier (on this device or synced). */
export async function signInWallet() {
  const credential = await toWebAuthnCredential({ transport: toPasskeyTransport(CLIENT_URL, CLIENT_KEY), mode: WebAuthnMode.Login });
  return remember(credential as { id: string; publicKey: Hex }, "passkey");
}

export function forgetWallet() {
  localStorage.removeItem(STORE);
  emitChange();
}

export interface Call {
  to: Hex;
  data: Hex;
}

/** Sends one batched user operation; the passkey prompt appears here. Returns the onchain tx hash. */
export async function sendCalls(calls: Call[], net: Net = "testnet"): Promise<Hex> {
  const saved = savedWallet();
  if (!saved) throw new Error("Create or sign in to your passkey wallet first");
  const { bundler, account } = await smartAccount(saved, net);
  // The vault was opened for the address the job was created with; never sign from a different one.
  if (account.address.toLowerCase() !== saved.address.toLowerCase()) throw new Error(`Your passkey wallet has a different address on ${net === "mainnet" ? "Arc mainnet" : "Arc testnet"}; this job can't be funded from it`);
  const hash = await bundler.sendUserOperation({ calls, paymaster: true });
  const { receipt } = await bundler.waitForUserOperationReceipt({ hash });
  return receipt.transactionHash;
}

// ---------- the three things a user signs ----------

const usdcAbi = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const factoryAbi = parseAbi(["function open(address agent, bytes32 planRoot, bytes32 orderId, uint256 amount) returns (address)"]);
const vaultAbi = parseAbi(["function setPlan(bytes32 newRoot)", "function topUp(uint256 amount)"]);

export function fundCalls(f: { factory: Hex; usdc: Hex; agent: Hex; planRoot: Hex; orderId: Hex; cap: string }): Call[] {
  return [
    { to: f.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [f.factory, BigInt(f.cap)] }) },
    { to: f.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "open", args: [f.agent, f.planRoot, f.orderId, BigInt(f.cap)] }) },
  ];
}

export function topUpCalls(usdc: Hex, vault: Hex, amount: bigint): Call[] {
  return [
    { to: usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [vault, amount] }) },
    { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "topUp", args: [amount] }) },
  ];
}

export function changePlanCalls(p: { usdc: Hex; vault: Hex; planRoot: Hex; topUp: string }): Call[] {
  const top = BigInt(p.topUp);
  return [...(top > 0n ? topUpCalls(p.usdc, p.vault, top) : []), { to: p.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "setPlan", args: [p.planRoot] }) }];
}

export async function usdcBalance(address: Hex, usdc: Hex = "0x3600000000000000000000000000000000000000", net: Net = "testnet") {
  const client = createPublicClient({ chain: chainFor(net), transport: modular(net) });
  return client.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] });
}
