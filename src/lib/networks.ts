/**
 * The two Arc networks the app works on, side by side. Each job runs on one of them: testnet for
 * trying things with free test USDC, mainnet for real money. Everything that differs between them
 * lives here (chain, explorer, contract addresses, which onramp widget, which Circle APIs), so the
 * rest of the app asks "which network is this job on?" and never hard-codes one.
 *
 * Addresses are from docs.arc.io/arc/references/contract-addresses (checked 2026-11-19).
 * Safe to import from the browser: no keys, nothing server-only.
 */
export type Net = "testnet" | "mainnet";
export const NETS: Net[] = ["testnet", "mainnet"];

export interface ArcNetwork {
  net: Net;
  name: string;
  chainId: number;
  /** CAIP-2 id, as x402 and Circle's marketplace write it. */
  caip: string;
  rpc: string;
  explorer: string;
  /** USDC's ERC-20 interface (6 decimals); the same balance is Arc's native gas token (18 decimals). */
  usdc: `0x${string}`;
  eurc: `0x${string}`;
  /** CCTP domain id for Arc. */
  cctpDomain: number;
  cctp: { tokenMessenger: `0x${string}`; messageTransmitter: `0x${string}` };
  gateway: { wallet: `0x${string}`; minter: `0x${string}`; api: string };
  /** Arc's Onramp widget: sandbox sends testnet USDC, production sells real USDC. */
  onrampWidget: string;
  /** Circle's attestation service for CCTP. */
  iris: string;
  /** Chain names Circle's Bridge Kit uses. */
  bridgeName: string;
  /** Where USDC can be bridged in from with CCTP (Bridge Kit names, then a plain name). */
  bridgeFrom: { id: string; name: string; chainId: number }[];
  faucet?: string;
  realMoney: boolean;
}

export const NETWORKS: Record<Net, ArcNetwork> = {
  testnet: {
    net: "testnet",
    name: "Arc testnet",
    chainId: 5042002,
    caip: "eip155:5042002",
    rpc: "https://rpc.testnet.arc.network",
    explorer: "https://explorer.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    cctpDomain: 26,
    cctp: { tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" },
    gateway: { wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B", api: "https://gateway-api-testnet.circle.com" },
    onrampWidget: "https://onramp-sandbox.arc.io",
    iris: "https://iris-api-sandbox.circle.com",
    bridgeName: "Arc_Testnet",
    bridgeFrom: [
      { id: "Ethereum_Sepolia", name: "Ethereum Sepolia", chainId: 11155111 },
      { id: "Base_Sepolia", name: "Base Sepolia", chainId: 84532 },
      { id: "Arbitrum_Sepolia", name: "Arbitrum Sepolia", chainId: 421614 },
      { id: "Optimism_Sepolia", name: "OP Sepolia", chainId: 11155420 },
      { id: "Polygon_Amoy_Testnet", name: "Polygon Amoy", chainId: 80002 },
    ],
    faucet: "https://faucet.circle.com",
    realMoney: false,
  },
  mainnet: {
    net: "mainnet",
    name: "Arc mainnet",
    chainId: 5042,
    caip: "eip155:5042",
    rpc: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    cctpDomain: 26,
    cctp: { tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" },
    gateway: { wallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", minter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205", api: "https://gateway-api.circle.com" },
    onrampWidget: "https://onramp.arc.io",
    iris: "https://iris-api.circle.com",
    bridgeName: "Arc",
    bridgeFrom: [
      { id: "Ethereum", name: "Ethereum", chainId: 1 },
      { id: "Base", name: "Base", chainId: 8453 },
      { id: "Arbitrum", name: "Arbitrum", chainId: 42161 },
      { id: "Optimism", name: "OP Mainnet", chainId: 10 },
      { id: "Polygon", name: "Polygon", chainId: 137 },
    ],
    realMoney: true,
  },
};

export const netOf = (v: unknown): Net => (v === "mainnet" ? "mainnet" : "testnet");
export const txLink = (net: Net, hash: string) => `${NETWORKS[net].explorer}/tx/${hash}`;
export const addressLink = (net: Net, address: string) => `${NETWORKS[net].explorer}/address/${address}`;
