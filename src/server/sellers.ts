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
    name: "Data Feed",
    address: addr(process.env.SELLER_ADDRESS, "0x000000000000000000000000000000000000dA7A"),
    markup: 100n,
  },
};

export const priceAt = (base: bigint, s: Seller) => (base * s.markup) / 100n;
