import { createHash } from "node:crypto";
import { ARC_MAINNET, payNetwork, rawPage, toService } from "../marketplace";
import { allCapabilities, getCapability, pruneCapabilities, upsertCapability } from "./store";
import { isReadOnly, tagBatch, type TagBudget } from "./tag";
import { embed, embedText } from "./search";
import type { Capability, RawListing } from "./types";

/**
 * Reads the whole discovery catalog (not only what we can pay today), keeps each listing's own
 * schemas while it tags them, and stores the result. Only listings whose description or schemas
 * changed are tagged again; price and payable status are refreshed every time.
 */

const PAGE = 100;
const PARALLEL = 4;

/** One page, tried again with a growing wait when the catalog says "too many requests" or has a hiccup. */
async function pageWithRetry(params: Record<string, string>, tries = 5): Promise<{ items: unknown[]; total: number }> {
  for (let i = 0; ; i++) {
    try {
      return await rawPage(params);
    } catch (e) {
      const msg = (e as Error).message;
      if (i >= tries - 1 || !/429|5\d\d|timeout|aborted|fetch failed/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, Number(process.env.CATALOG_RETRY_MS ?? 1500) * 2 ** i));
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toRaw(i: any, net = payNetwork()): RawListing {
  const s = toService(i, net);
  const accepts = (i.accepts ?? []) as { network: string; extra?: { name?: string } }[];
  const m = i.metadata ?? {};
  const method = String(m.method ?? "GET").toUpperCase();
  return {
    resource: s.resource,
    name: s.name,
    provider: s.provider,
    category: s.category,
    description: String(m.description ?? m.provider?.description ?? "").slice(0, 400),
    method: (["GET", "POST", "PATCH", "DELETE", "PUT"].includes(method) ? method : "GET") as RawListing["method"],
    priceUsd: s.priceUsd,
    networks: s.networks,
    payableNow: s.payableHere,
    payableMainnet: accepts.some((a) => a.network === ARC_MAINNET && a.extra?.name === "GatewayWalletBatched"),
    payTo: s.payTo,
    input: m.input,
    output: m.output,
  };
}

/** Bumped when tagging itself changes, so every listing is tagged again by the new rules. */
const TAG_VERSION = 2;
export const schemaHash = (l: Pick<RawListing, "description" | "input" | "output">) => createHash("sha256").update(`v${TAG_VERSION}${l.description}${JSON.stringify(l.input ?? null)}${JSON.stringify(l.output ?? null)}`).digest("hex");

export interface CrawlResult {
  seen: number;
  total: number;
  tagged: number;
  kept: number;
  pruned: number;
  failedPages: number;
  aiCalls: number;
  tokens: number;
  ms: number;
}

let running: Promise<CrawlResult> | null = null;

/** One crawl at a time; a second call while one runs gets the same result. */
export function crawlCatalog(opts: { max?: number } = {}): Promise<CrawlResult> {
  return (running ??= doCrawl(opts).finally(() => (running = null)));
}

async function doCrawl(opts: { max?: number }): Promise<CrawlResult> {
  const t0 = Date.now();
  const net = payNetwork();
  const first = await pageWithRetry({ limit: String(PAGE), offset: "0" });
  const total = first.total;
  const want = Math.min(total, opts.max ?? Infinity);
  const offsets: number[] = [];
  for (let o = PAGE; o < want; o += PAGE) offsets.push(o);
  const raws: unknown[] = [...first.items];
  let failedPages = 0;
  for (let i = 0; i < offsets.length; i += PARALLEL) {
    const got = await Promise.all(
      offsets.slice(i, i + PARALLEL).map((o) =>
        pageWithRetry({ limit: String(PAGE), offset: String(o) }).catch((e: Error) => {
          console.warn(`catalog page at ${o} failed: ${e.message}`);
          failedPages++;
          return { items: [] as unknown[], total };
        }),
      ),
    );
    for (const g of got) raws.push(...g.items);
  }
  const listings = new Map<string, RawListing>();
  for (const r of raws.slice(0, want)) {
    try {
      const l = toRaw(r, net);
      if (l.resource) listings.set(l.resource, l);
    } catch {
      // a listing we can't read is skipped
    }
  }

  const now = new Date().toISOString();
  const changed: RawListing[] = [];
  let kept = 0;
  for (const l of listings.values()) {
    const hash = schemaHash(l);
    const had = getCapability(l.resource);
    if (had && had.schemaHash === hash) {
      // Same listing: refresh price and where it can be paid, keep its tags.
      upsertCapability({ ...had, name: l.name, provider: l.provider, category: l.category, priceUsd: l.priceUsd, networks: l.networks, payableNow: l.payableNow, payableMainnet: l.payableMainnet, payTo: l.payTo, method: l.method, readOnly: isReadOnly(l) });
      kept++;
    } else changed.push(l);
  }

  const budget: TagBudget = { calls: 0, max: Number(process.env.CATALOG_TAG_MAX_CALLS ?? 400), tokens: 0 };
  const batches: RawListing[][] = [];
  for (let i = 0; i < changed.length; i += 10) batches.push(changed.slice(i, i + 10));
  // Tagged and saved a few batches at a time, so a crawl cut short keeps what it finished.
  let tagged = 0;
  for (let i = 0; i < batches.length; i += 3) {
    const done = await Promise.all(
      batches.slice(i, i + 3).map(async (b) => {
        const tags = await tagBatch(b, budget).catch(() => null);
        return b.map((l, j): Capability => {
          const t = tags?.[j];
          const { input: _i, output: _o, ...rest } = l;
          void _i;
          void _o;
          return { ...rest, readOnly: isReadOnly(l), inputs: t?.inputs ?? [], outputs: t?.outputs ?? [], answers: t?.answers ?? [], taggedBy: t?.taggedBy ?? "rules", taggedAt: now, schemaHash: schemaHash(l) };
        });
      }),
    );
    const fresh = done.flat();
    // Embeddings for what changed, when an embedding model is available.
    const vecs = await embed(fresh.map(embedText)).catch(() => null);
    if (vecs) fresh.forEach((c, j) => (c.embedding = vecs[j] ?? undefined));
    for (const c of fresh) upsertCapability(c);
    tagged += fresh.length;
  }

  // Only a complete crawl may drop listings that disappeared.
  const pruned = !failedPages && opts.max == null && listings.size >= total * 0.9 ? pruneCapabilities(new Set(listings.keys())) : 0;
  const result: CrawlResult = { seen: listings.size, total, tagged, kept, pruned, failedPages, aiCalls: budget.calls, tokens: budget.tokens, ms: Date.now() - t0 };
  console.log(`catalog: ${result.seen}/${total} listings, ${result.tagged} tagged, ${kept} unchanged, ${pruned} gone, ${budget.calls} model calls (${budget.tokens} tokens), ${Math.round(result.ms / 1000)}s`);
  return result;
}

/** How many listings the map holds now (for the funnel when no crawl has run yet). */
export const mapSize = () => allCapabilities().length;
