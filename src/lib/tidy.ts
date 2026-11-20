/**
 * Turns a generated paragraph into parts that read at a glance: the key figures it mentions, a
 * one-line lead, and the supporting points. Pure text work, so every report lays out the same way
 * whatever the model wrote.
 */

const FIGURE = /(?:between\s+)?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*(?:to|and|–|-)\s*\$\d{1,3}(?:,\d{3})*(?:\.\d+)?)?|\d+(?:\.\d+)?%/gi;
// What a figure is, from a word near it. No match: no caption, rather than a wrong one.
const LABELS: [RegExp, string][] = [
  [/\basking\b|\blisted at\b|\blisting\b/i, "asking price"],
  [/\btypical\b|\baverage\b|\bmedian\b|\bbenchmark\b/i, "typical price"],
  [/\blowest\b|\bcheapest\b/i, "lowest found"],
  [/\bhighest\b/i, "highest found"],
  [/\brange\b/i, "price range"],
  [/\boffer\b/i, "offer"],
  [/\bfeedback\b|\bpositive\b|\brating\b/i, "positive feedback"],
  [/\bchance\b|\bodds\b|\bprobability\b/i, "chance"],
  [/\bfee\b|\bcosts?\b/i, "cost"],
  [/\bsav(?:e|es|ing)\b|\bless\b/i, "saving"],
];
// A supporting clause, reworded to stand on its own as a point.
const OPENER: [RegExp, string][] = [
  [/^which\s+/i, ""],
  [/^sitting\b/i, "Sits"],
  [/^matching\b/i, "Matches"],
  [/^including\b/i, "Includes"],
  [/^meaning\b/i, "That means"],
  [/^making\b/i, "That makes"],
  [/^(?:though|although|but|whereas)\b/i, "But"],
  [/^since\b/i, "Because"],
];
// Words that start a supporting clause after a comma: the lead ends there.
const CLAUSE = /,\s+(?=(?:sitting|within|which|though|although|since|while|matching|including|with|as well as|but|so|because|whereas|meaning|making|compared)\b)/i;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const STOP = new Set(["and", "or", "the", "a", "an", "of", "in", "on", "at", "for", "is", "are", "was", "to"]);
const reword = (p: string) => {
  const hit = OPENER.find(([re]) => re.test(p));
  return hit ? cap(p.replace(hit[0], hit[1]).trim()) : cap(p);
};

export interface Figure {
  value: string;
  /** What the figure is ("asking price"), or empty when no nearby word says. */
  label: string;
}

export interface Tidied {
  figures: Figure[];
  lead: string;
  points: string[];
}


/** Sentences, without breaking on decimals ("$1.50") or common abbreviations. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z$0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<string[]>((out, s) => {
      // "e.g." / "vs." / "approx." end mid-sentence: glue the next piece back on.
      if (out.length && /\b(?:e\.g|i\.e|vs|approx|etc|St|Mr|Ms|Dr|U\.S)\.$/.test(out[out.length - 1])) out[out.length - 1] += ` ${s}`;
      else out.push(s);
      return out;
    }, []);
}

/** Money amounts, ranges and percentages, each with a short caption, at most `max`. */
export function figures(text: string, max = 3): Figure[] {
  const seen = new Set<string>();
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const value = m[0].replace(/^between\s+/i, "").replace(/\s*-\s*/, "–").replace(/\s+(?:to|and)\s+/i, "–");
    if (seen.has(value)) continue;
    seen.add(value);
    const at = m.index ?? 0;
    // The words just before and after it, within its own clause.
    const before = text.slice(0, at).split(/[.,;:()]/).pop()!.trim().split(/\s+/).slice(-3).join(" ");
    const after = text.slice(at + m[0].length).split(/[.,;:()]/)[0].trim().split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase())).slice(0, 3).join(" ");
    const near = `${before} ${m[0]} ${after}`;
    const label = (/^between/i.test(m[0]) && /offer/i.test(before)) || /\boffer\b/i.test(before) ? "offer range" : (LABELS.find(([re]) => re.test(near))?.[1] ?? "");
    out.push({ value, label });
    if (out.length >= max) break;
  }
  return out;
}

/** The lead (first sentence, cut at its first supporting clause) and the rest as points. */
export function tidy(text: string, maxPoints = 4): Tidied {
  const all = sentences(text);
  if (!all.length) return { figures: [], lead: "", points: [] };
  const [first, ...rest] = all;
  const parts = first.split(CLAUSE);
  const lead = end(parts[0].replace(/[.!?]$/, ""));
  const points = [...parts.slice(1).map((p) => end(reword(p.trim().replace(/[.!?]$/, "")))), ...rest].filter((p) => p.length > 2).slice(0, maxPoints);
  return { figures: figures(text), lead: points.length || parts.length === 1 ? lead : end(first), points };
}
