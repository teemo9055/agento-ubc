import { timingSafeEqual } from "node:crypto";

/** Live (Arc testnet) actions spend the app's funded wallets, so a public deployment gates them with a code. */
export function liveAllowed(code?: string) {
  const want = process.env.LIVE_ACCESS_CODE;
  if (!want) return true;
  const a = Buffer.from(code ?? "");
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
