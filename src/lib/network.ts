/**
 * Which network the app works on. One switch, read everywhere that says "this needs mainnet":
 * the capability list, the solution brief, the agents' instructions and the marketplace filter.
 * Set NEXT_PUBLIC_NETWORK_MODE=mainnet (with mainnet RPC, contracts and funded wallets configured)
 * and everything marked "ready on mainnet" becomes something the agents may plan and run.
 */
export type NetworkMode = "testnet" | "mainnet";

export const networkMode = (): NetworkMode => (process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet" ? "mainnet" : "testnet");
export const mainnetOn = () => networkMode() === "mainnet";

/** How much of one part of a problem the app can take on. */
export type Help = "now" | "partly" | "mainnet" | "no";

export const HELP_LABEL: Record<Help, string> = {
  now: "Can do",
  partly: "Can partly do",
  mainnet: "Ready when mainnet is on",
  no: "Can't help here",
};
