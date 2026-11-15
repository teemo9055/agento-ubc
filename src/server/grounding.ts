import { z } from "zod";
import type { Proposal } from "@/lib/types";
import { aiJson, FAST_MODEL, type AiUsage } from "./ai";

/**
 * Checks the money numbers in a reply ($, ¢, %) against what the tools returned, so the agent
 * can't state a price it didn't see. Unsupported numbers trigger one rewrite with the fast model;
 * whatever still can't be matched is reported, never shown as fact.
 */

const NUM = /\d[\d,]*(?:\.\d+)?/g;

/** Every number found anywhere in the data, including inside strings like "$65,000 or above". */
function collect(v: unknown, out: number[], depth = 0) {
  if (depth > 8 || v == null) return;
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (typeof v === "string") for (const m of v.match(NUM) ?? []) out.push(Number(m.replace(/,/g, "")));
  else if (Array.isArray(v)) for (const x of v.slice(0, 400)) collect(x, out, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) collect(x, out, depth + 1);
}

/** Numbers the reply may use: the data, the same values as cents/percent, complements, and the move's own costs. */
export function knownNumbers(sources: unknown[], move?: Proposal): number[] {
  const base: number[] = [];
  for (const s of sources) collect(s, base);
  const a = move?.action;
  if (a?.kind === "prediction_order") base.push(a.maxPrice, a.quantity, a.maxPrice * a.quantity, a.quantity * 1, a.quantity - a.maxPrice * a.quantity);
  if (a?.kind === "spot_order") base.push(a.amountUsd, a.limitPrice);
  if (move?.budgetUsd) base.push(move.budgetUsd);
  const out = new Set<number>();
  // "down 4.6%" states a negative change as a positive number.
  for (const x of base.map(Math.abs)) {
    out.add(x);
    if (x >= 0 && x <= 1) {
      out.add(x * 100);
      out.add(1 - x);
      out.add((1 - x) * 100);
    }
    if (x > 1 && x <= 100) out.add(x / 100);
  }
  return [...out];
}

export interface Claim {
  text: string;
  value: number;
  unit: "$" | "¢" | "%";
}

/** The $ / ¢ / % figures in a reply. */
export function claims(text: string): Claim[] {
  const out: Claim[] = [];
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(k)?/gi)) out.push({ text: m[0], value: Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1), unit: "$" });
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?¢/g)) out.push({ text: m[0], value: Number(m[1].replace(/,/g, "")), unit: "¢" });
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?%/g)) out.push({ text: m[0], value: Number(m[1].replace(/,/g, "")), unit: "%" });
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.006);

/** Claims that match nothing the tools returned. Rounded and "k" forms are accepted. */
export function unsupported(text: string, known: number[]): Claim[] {
  return claims(text).filter((c) => {
    const candidates = c.unit === "$" ? [c.value] : [c.value, c.value / 100];
    return !candidates.some((v) => known.some((k) => close(v, k) || (v >= 1000 && Math.abs(v - k) <= Math.max(1, k * 0.006)) || (c.value % 1 === 0 && Math.round(k) === v)));
  });
}

const Fixed = z.object({ text: z.string().max(1200) });

/** One rewrite with the fast model: keep the reply, use only numbers from the data. */
export async function groundReply(text: string, sources: unknown[], move?: Proposal): Promise<{ text: string; unverified: string[]; usage?: AiUsage }> {
  const known = knownNumbers(sources, move);
  const bad = unsupported(text, known);
  if (!bad.length) return { text, unverified: [] };
  const r = await aiJson(Fixed, {
    name: "ground_reply",
    model: FAST_MODEL,
    maxTokens: 800,
    system:
      "You fix numbers in a chat reply. Keep the wording, tone and length. Every price, cent value and percentage must come from DATA (rounding is fine). Replace wrong ones with the right value from DATA, or remove the claim if DATA doesn't support it. Don't add new claims.",
    user: `REPLY: ${text}\nNUMBERS THAT DON'T MATCH: ${bad.map((b) => b.text).join(", ")}\nDATA: ${JSON.stringify(sources).slice(0, 9000)}`,
  });
  if (!r) return { text, unverified: bad.map((b) => b.text) };
  const still = unsupported(r.value.text, known);
  return { text: r.value.text, unverified: still.map((b) => b.text), usage: r.usage };
}
