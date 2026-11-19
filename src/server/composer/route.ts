import { RELEVANT, searchCapabilities, type Hit } from "../catalog/search";
import { reliability } from "../catalog/store";
import type { Capability, IoType } from "../catalog/types";
import { MAX_SERVICE } from "../tools";
import type { Fact, Given } from "./facts";

/**
 * Step B: chaining backwards. For a fact, find services that give back what it wants; for each
 * input a service needs, feed it from what the user gave, or find another service that produces it
 * (up to three deep). All plain code: the same problem and catalog always give the same routes.
 */
export type Feed = { from: "given"; name: string } | { from: number; path: string };
export interface RouteStep {
  capability: Capability;
  /** Where each required input comes from: a given, or an earlier step in this route (by index). */
  feeds: Record<string, Feed>;
  /** Where in this step's answer the fact (or the next step's input) is. */
  outPath: string;
  outType: IoType;
}
export interface Route {
  steps: RouteStep[];
  cost: number;
  reliability: number;
  payable: "now" | "mainnet";
  score: number;
  /** Answers with exactly the kind of thing the fact wants (not just "some answer"). */
  exact: boolean;
}
export type Payable = "now" | "mainnet" | "any";

export interface RouteCtx {
  payable: Payable;
  /** Searches made in this compose call; at most 40. */
  searches: number;
  memo: Map<string, Hit[]>;
  /** Every service that scored as relevant, for the funnel. */
  relevant: Set<string>;
  considered: number;
  /** Why candidates were dropped, for an honest gap reason. */
  dropped: { price: number; network: number; inputs: Set<string> };
}

export const newRouteCtx = (payable: Payable): RouteCtx => ({ payable, searches: 0, memo: new Map(), relevant: new Set(), considered: 0, dropped: { price: 0, network: 0, inputs: new Set() } });

const MAX_SEARCHES = 40;
const MAX_DEPTH = 3;
const maxRouteUsd = () => Number(process.env.COMPOSE_MAX_ROUTE_USD ?? 0.25);
const costWeight = () => Number(process.env.COMPOSE_COST_WEIGHT ?? 2);

/** Which given types can fill a field of each type. Code normalises the value when it's sent (dataflow.coerce). */
const ACCEPTS: Partial<Record<IoType, IoType[]>> = {
  url: ["url", "listing_url"],
  listing_url: ["listing_url", "url"],
  domain: ["domain", "url", "listing_url"],
  image_url: ["image_url"],
  text_query: ["person_name", "company_name", "product_name", "phone", "email", "domain", "listing_url", "url", "text_query", "ticker", "token_symbol"],
  token_symbol: ["token_symbol", "ticker", "wallet_address"],
  ticker: ["ticker"],
  company_name: ["company_name"],
  person_name: ["person_name"],
  phone: ["phone"],
  email: ["email"],
  wallet_address: ["wallet_address"],
  tx_hash: ["tx_hash"],
  place: ["place", "address"],
  address: ["address"],
  product_name: ["product_name"],
};

/** Words that find producers of a type when an input has to come from another service. */
const PRODUCE_QUERY: Partial<Record<IoType, string>> = {
  company_name: "company name from domain website lookup",
  domain: "domain of a website or email",
  image_url: "images from a listing page scrape",
  phone: "phone number lookup",
  email: "find email address",
  geo: "geocode address to coordinates",
  address: "address lookup",
  person_name: "person name lookup",
  wallet_address: "wallet address lookup",
};

async function search(ctx: RouteCtx, key: string, q: string, outputs: IoType[], limit: number, have: IoType[]): Promise<Hit[]> {
  const k = `${key}|${ctx.payable}`;
  const hit = ctx.memo.get(k);
  if (hit) return hit;
  if (ctx.searches >= MAX_SEARCHES) return [];
  ctx.searches++;
  const where = ctx.payable === "any" ? "arc" : ctx.payable;
  const found = await searchCapabilities(q, { outputs, inputsAvailable: have, payable: where, limit: limit * 2 });
  for (const h of found) if (h.score >= RELEVANT) ctx.relevant.add(h.cap.resource);
  const ok = found.filter((h) => {
    if (h.cap.priceUsd == null || h.cap.priceUsd * 1e6 > Number(MAX_SERVICE)) {
      ctx.dropped.price++;
      return false;
    }
    return true;
  });
  // Nothing payable on Arc: look once more across every network, so the gap says why.
  if (!found.length && ctx.searches < MAX_SEARCHES) {
    ctx.searches++;
    const elsewhere = await searchCapabilities(q, { outputs, payable: "any", limit: 3 });
    for (const h of elsewhere) if (h.score >= RELEVANT) ctx.relevant.add(h.cap.resource);
    ctx.dropped.network += elsewhere.length;
  }
  const out = ok.slice(0, limit);
  ctx.memo.set(k, out);
  return out;
}

/** The output of a service that answers one of these types: a precise path first. */
function outputFor(c: Capability, wants: IoType[]): { path: string; type: IoType } | null {
  const exact = c.outputs.filter((o) => wants.includes(o.type));
  const best = exact.find((o) => o.path) ?? exact[0];
  if (best) return { path: best.path, type: best.type };
  const loose = c.outputs.find((o) => o.type === "any");
  return loose ? { path: loose.path, type: wants[0] } : null;
}

/** Inputs a call can't go without: required ones, or the only one when the listing marks none. */
const needed = (c: Capability) => {
  const req = c.inputs.filter((i) => i.required);
  return req.length ? req : c.inputs.slice(0, 1);
};

const laplace = (c: Capability) => {
  const r = reliability(c.resource);
  return (r.delivered + 1) / (r.delivered + r.failed + 2);
};

/**
 * Routes to one capability: its own step, plus the producer routes for inputs no given covers.
 * Returns the steps in run order (producers first), or null when an input can't be had.
 */
async function resolve(c: Capability, givens: Given[], ctx: RouteCtx, depth: number, out: { path: string; type: IoType }): Promise<RouteStep[] | null> {
  if (depth > MAX_DEPTH) return null;
  const inputs = needed(c);
  if (!inputs.length) return null; // Nothing to ask it about: it can't answer about this problem.
  const steps: RouteStep[] = [];
  const feeds: Record<string, Feed> = {};
  for (const inp of inputs) {
    const fits = ACCEPTS[inp.type] ?? (inp.type === "any" ? [] : [inp.type]);
    const g = givens.find((x) => fits.includes(x.type));
    if (g) {
      feeds[inp.field] = { from: "given", name: g.name };
      continue;
    }
    if (inp.type === "any" || inp.guessed) {
      ctx.dropped.inputs.add(inp.type === "any" ? inp.field : inp.type);
      return null;
    }
    // Recurse: a service whose answer includes what this field needs.
    const producers = await search(ctx, `produce:${inp.type}`, PRODUCE_QUERY[inp.type] ?? inp.type.replace(/_/g, " "), [inp.type], 4, givens.map((x) => x.type));
    let made: RouteStep[] | null = null;
    for (const p of producers) {
      if (p.cap.resource === c.resource) continue;
      const o = outputFor(p.cap, [inp.type]);
      if (!o || !o.path) continue; // A whole answer can't be checked as one field.
      made = await resolve(p.cap, givens, ctx, depth + 1, o);
      if (made) break;
    }
    if (!made) {
      ctx.dropped.inputs.add(inp.type);
      return null;
    }
    const base = steps.length;
    steps.push(...made.map((s) => ({ ...s, feeds: Object.fromEntries(Object.entries(s.feeds).map(([k, f]) => [k, typeof f.from === "number" ? { ...f, from: f.from + base } : f])) as Record<string, Feed> })));
    feeds[inp.field] = { from: steps.length - 1, path: steps[steps.length - 1].outPath };
  }
  steps.push({ capability: c, feeds, outPath: out.path, outType: out.type });
  return steps;
}

/** Up to three routes that answer a fact, best first. */
export async function routeFact(fact: Fact, givens: Given[], ctx: RouteCtx): Promise<Route[]> {
  const candidates = await search(ctx, `fact:${fact.question}`, fact.question, fact.wants, 8, givens.map((g) => g.type));
  const routes: Route[] = [];
  for (const h of candidates) {
    const o = outputFor(h.cap, fact.wants);
    if (!o) continue;
    const steps = await resolve(h.cap, givens, ctx, 1, o);
    ctx.considered++;
    if (!steps) continue;
    const cost = steps.reduce((a, s) => a + (s.capability.priceUsd ?? 0), 0);
    if (cost > maxRouteUsd()) continue;
    const now = steps.every((s) => s.capability.payableNow);
    const main = steps.every((s) => s.capability.payableMainnet);
    const payable = ctx.payable === "now" ? (now ? "now" : null) : ctx.payable === "mainnet" ? (main ? "mainnet" : null) : now ? "now" : main ? "mainnet" : null;
    if (!payable) continue;
    const rel = steps.reduce((a, s) => a * laplace(s.capability), 1);
    const exact = h.cap.outputs.some((x) => fact.wants.includes(x.type));
    const coverage = exact ? 1 : 0.5;
    routes.push({ steps, cost, reliability: rel, payable, score: rel * coverage * (0.5 + h.score) - costWeight() * cost, exact });
  }
  // A service that answers exactly what's asked beats one that merely answers something.
  const pool = routes.some((r) => r.exact) ? routes.filter((r) => r.exact) : routes;
  return pool.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Why a fact has no route, in plain words. */
export function gapReason(ctx: RouteCtx, found: number): string {
  if (found) return "";
  if (ctx.dropped.inputs.size) return `Needs something you didn't give (${[...ctx.dropped.inputs].slice(0, 2).join(", ").replace(/_/g, " ")})`;
  if (ctx.dropped.network) return ctx.payable === "now" ? "Only payable on Arc mainnet" : "Not payable on Arc yet";
  if (ctx.dropped.price) return "Costs more than the per-request limit";
  return "No service sells this";
}
