import { answerOf, getPath } from "../dataflow";
import type { Capability } from "./types";

/**
 * What a marketplace answer says, in a few words, read from the outputs the listing was tagged
 * with ("Line type: voip · Carrier: Twilio"). Code only; at most 48 characters.
 */
const show = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return `${v.length} found`;
  if (typeof v === "object") return `${Object.keys(v).length} fields`;
  return String(v).replace(/\s+/g, " ").trim();
};

export function noteFor(cap: Pick<Capability, "outputs"> | undefined, data: unknown, max = 48): string {
  const a = answerOf(data);
  const parts: string[] = [];
  for (const o of cap?.outputs ?? []) {
    if (!o.path) continue;
    const v = getPath(a, o.path);
    const s = show(v);
    if (!s) continue;
    parts.push(`${o.label.charAt(0).toUpperCase()}${o.label.slice(1)}: ${s}`);
    if (parts.length === 2) break;
  }
  let text = parts.join(" · ");
  if (!text) {
    if (a == null || (Array.isArray(a) && !a.length) || (typeof a === "object" && !Object.keys(a as object).length)) text = "Nothing found";
    else if (Array.isArray(a)) text = `${a.length} result${a.length === 1 ? "" : "s"}`;
    else if (typeof a === "object") {
      const first = Object.entries(a as Record<string, unknown>).find(([, v]) => v != null && typeof v !== "object");
      text = first ? `${first[0].replace(/_/g, " ")}: ${show(first[1])}` : "Answered";
    } else text = show(a);
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
