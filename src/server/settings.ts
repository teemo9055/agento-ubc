import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Spending limits the user sets once, in Settings. Every job is checked against them in code,
 * whatever the agent proposes.
 */
export const Limits = z.object({
  /** A single purchase above this (USDC) is flagged and shown before approval. */
  bigSpendUsdc: z.number().min(0.01).max(100),
  /** Most one exchange order may cost (USD). */
  maxOrderUsd: z.number().min(1).max(1000),
  /** Most a job may hold in its vault for data and services (USDC). */
  maxJobUsdc: z.number().min(0.05).max(100),
  /** Most a whole plan may cost, every step's orders and data together (USD). Starting a plan approves its steps one by one, so this is the ceiling on that. */
  maxPlanUsd: z.number().min(1).max(5000),
});
export type Limits = z.infer<typeof Limits>;

const DEFAULTS: Limits = { bigSpendUsdc: 0.25, maxOrderUsd: Number(process.env.MAX_ORDER_USD ?? 50), maxJobUsdc: 5, maxPlanUsd: 100 };
const persist = () => process.env.PERSIST !== "false" && !process.env.VITEST;
const file = () => path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "settings.json");

const g = globalThis as unknown as { __agentoLimits?: Limits };

export function limits(): Limits {
  if (g.__agentoLimits) return g.__agentoLimits;
  let saved: unknown = {};
  try {
    if (persist() && existsSync(file())) saved = JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    /* unreadable file: fall back to defaults */
  }
  const parsed = Limits.safeParse({ ...DEFAULTS, ...(saved as object) });
  return (g.__agentoLimits = parsed.success ? parsed.data : DEFAULTS);
}

export function setLimits(next: unknown): Limits {
  const v = Limits.parse({ ...limits(), ...(next as object) });
  g.__agentoLimits = v;
  if (persist()) {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(v, null, 1));
  }
  return v;
}
