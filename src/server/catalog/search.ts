import { aiEnabled, aiEndpoint } from "../ai";
import { standing } from "../strikes";
import { allCapabilities, reliabilityScore } from "./store";
import type { Capability, IoType } from "./types";

/**
 * Finding services in the capability map: meaning (embeddings, when a model is available), words
 * (a small BM25) and track record, in one score. Brute force over a few thousand rows is fast enough.
 */

const EMBED_MODEL = () => process.env.CATALOG_EMBED_MODEL ?? "gemini-embedding-001";

/** Embeds texts with the OpenAI-compatible endpoint. Null when AI is off or the call fails. */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!aiEnabled() || !texts.length || process.env.CATALOG_EMBED === "off") return null;
  const { base, key } = aiEndpoint();
  try {
    const r = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL(), input: texts.map((t) => t.slice(0, 2000)) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.warn(`embeddings: HTTP ${r.status}`);
      return null;
    }
    const body = (await r.json()) as { data?: { embedding: number[]; index?: number }[] };
    const rows = body.data ?? [];
    if (rows.length !== texts.length) return null;
    return rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  } catch (e) {
    console.warn("embeddings:", (e as Error).message);
    return null;
  }
}

export const embedText = (c: Pick<Capability, "name" | "description" | "answers" | "provider">) => `${c.provider}: ${c.name}. ${c.description} ${c.answers.join(" ")}`;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- BM25-lite ----------

const STOP = new Set("a an and the of to for in on at by with from is are be it this that or as your you my me i our we can get any what how does do".split(" "));
export const tokens = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

interface Index {
  docs: Map<string, number>[];
  lens: number[];
  avg: number;
  df: Map<string, number>;
  of: Capability[];
}
let index: Index | null = null;

function buildIndex(caps: Capability[]): Index {
  if (index && index.of === caps) return index;
  const docs = caps.map((c) => {
    const tf = new Map<string, number>();
    for (const w of tokens(`${c.name} ${c.provider} ${c.category.replace(/_/g, " ")} ${c.description} ${c.answers.join(" ")} ${c.outputs.map((o) => o.label).join(" ")}`)) tf.set(w, (tf.get(w) ?? 0) + 1);
    return tf;
  });
  const lens = docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  return (index = { docs, lens, avg: lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length), df, of: caps });
}

function bm25(ix: Index, q: string[], i: number): number {
  const k1 = 1.2;
  const b = 0.75;
  const N = ix.docs.length;
  let s = 0;
  for (const w of q) {
    const tf = ix.docs[i].get(w);
    if (!tf) continue;
    const df = ix.df.get(w) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    s += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * ix.lens[i]) / ix.avg));
  }
  return s;
}

// ---------- search ----------

const queryVecs = new Map<string, number[]>();
async function queryVector(q: string): Promise<number[] | null> {
  const hit = queryVecs.get(q);
  if (hit) return hit;
  const v = (await embed([q]))?.[0] ?? null;
  if (v) {
    if (queryVecs.size > 300) queryVecs.delete(queryVecs.keys().next().value!);
    queryVecs.set(q, v);
  }
  return v;
}

export interface SearchOpts {
  /** Keep only services that give back one of these. `any` outputs count at half weight. */
  outputs?: IoType[];
  /** What we already have; services needing something else rank a little lower. */
  inputsAvailable?: IoType[];
  payable?: "now" | "mainnet" | "any";
  /** Only services that read (default true): those that send, buy or change things are never planned. */
  readOnly?: boolean;
  limit?: number;
  /** Search only these (tests, or a narrowed set). */
  among?: Capability[];
}

export interface Hit {
  cap: Capability;
  score: number;
  why: { meaning: number; words: number; record: number };
}

/** Whether a seller is paused by strikes, by its payee address or its name. */
const paused = (c: Capability) => (c.payTo && standing(c.payTo).skipped) || standing(c.provider).skipped;

export const payableFor = (c: Capability, p: SearchOpts["payable"]) => (p === "now" ? c.payableNow : p === "mainnet" ? c.payableMainnet : true);

export async function searchCapabilities(q: string, opts: SearchOpts = {}): Promise<Hit[]> {
  const caps = opts.among ?? allCapabilities();
  if (!caps.length) return [];
  const ix = buildIndex(caps);
  const qt = tokens(q);
  const qv = caps.some((c) => c.embedding) ? await queryVector(q) : null;
  const want = opts.outputs?.length ? new Set(opts.outputs) : null;
  const have = opts.inputsAvailable ? new Set(opts.inputsAvailable) : null;
  const scored: { i: number; words: number; meaning: number; fit: number }[] = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if ((opts.readOnly ?? true) && !c.readOnly) continue;
    if (!payableFor(c, opts.payable ?? "any")) continue;
    let fit = 1;
    if (want) {
      const exact = c.outputs.some((o) => want.has(o.type));
      const loose = c.outputs.some((o) => o.type === "any");
      if (!exact && !loose) continue;
      if (!exact) fit = 0.5;
    }
    if (have && c.inputs.some((x) => x.required && x.type !== "any" && !have.has(x.type))) fit *= 0.7;
    const words = qt.length ? bm25(ix, qt, i) : 0;
    const meaning = qv && c.embedding ? Math.max(0, cosine(qv, c.embedding)) : 0;
    if (!words && !meaning && !want) continue;
    scored.push({ i, words, meaning, fit });
  }
  const maxWords = Math.max(1e-9, ...scored.map((s) => s.words));
  const out: Hit[] = scored
    .map((s) => {
      const c = caps[s.i];
      const words = s.words / maxWords;
      const record = reliabilityScore(c.resource);
      const score = (qv ? 0.6 * s.meaning + 0.25 * words + 0.15 * record : 0.85 * words + 0.15 * record) * s.fit;
      return { cap: c, score, why: { meaning: s.meaning, words, record } };
    })
    .filter((h) => !paused(h.cap))
    .sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 8);
}

/** A hit counts as "relevant" in the funnel above this score. */
export const RELEVANT = 0.2;

export function catalogFunnel(): { total: number; tagged: number; payableNow: number; payableMainnet: number; readOnly: number } {
  const caps = allCapabilities();
  return {
    total: caps.length,
    tagged: caps.filter((c) => c.inputs.some((i) => i.type !== "any") || c.outputs.some((o) => o.type !== "any")).length,
    payableNow: caps.filter((c) => c.payableNow).length,
    payableMainnet: caps.filter((c) => c.payableMainnet).length,
    readOnly: caps.filter((c) => c.readOnly).length,
  };
}
