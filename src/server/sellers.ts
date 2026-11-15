import type { Hex } from "viem";

export interface Seller {
  id: "primary";
  name: string;
  address: Hex;
  markup: bigint; // percent
}

const addr = (v: string | undefined, fallback: Hex) => (v as Hex) ?? fallback;

export const SELLERS: Record<Seller["id"], Seller> = {
  primary: {
    id: "primary",
    // Agento's own x402 seller: it packages Gemini's public market data. Named plainly so nobody mistakes it for a third party.
    name: "Agento data feed (Gemini public data)",
    address: addr(process.env.SELLER_ADDRESS, "0x000000000000000000000000000000000000dA7A"),
    markup: 100n,
  },
};

export const priceAt = (base: bigint, s: Seller) => (base * s.markup) / 100n;
