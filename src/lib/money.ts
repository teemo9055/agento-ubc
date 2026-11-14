import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;
export const NATIVE_DECIMALS = 18;

export const usdc = (v: string): bigint => parseUnits(v, USDC_DECIMALS);
export const sum = (xs: (string | bigint | undefined)[]): bigint => xs.reduce<bigint>((a, x) => a + BigInt(x ?? 0), 0n);

/** Base units -> "1.25". Keeps at least two decimals. */
export function fmt(base: string | bigint | undefined, decimals = USDC_DECIMALS): string {
  const s = formatUnits(BigInt(base ?? 0), decimals);
  const [i, f = ""] = s.split(".");
  return `${i}.${f.padEnd(2, "0")}`;
}

export const fmtUsdc = (base: string | bigint | undefined) => `${fmt(base)} USDC`;

/** Native gas fee (18 decimals) as USDC string. */
export const fmtFee = (wei: string | bigint | undefined) => fmt(wei, NATIVE_DECIMALS);
