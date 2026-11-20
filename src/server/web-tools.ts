import type { Hex } from "viem";
import type { Paid } from "./onchain";
import { payRequest } from "./nanopay";

/**
 * Checks bought from Orthogonal on Circle's Agent Marketplace, paid with Gateway nanopayments on
 * Arc mainnet (real USDC; Orthogonal doesn't take Arc testnet). Only the cheap, tested endpoints:
 * each one was run for real before it was offered, and each answer is cut down to what a person
 * needs before anything else sees it.
 */
const BASE = process.env.ORTHOGONAL_BASE ?? "https://np.orthogonal.com";
/** Orthogonal's payee for the Serper endpoints, and Tomba's for the phone check (from their 402 quotes). */
export const SERPER_PAYEE: Hex = "0x1563CdE0042d17F53b23d91Fd9B73ACE9Da26a09";
export const TOMBA_PAYEE: Hex = "0xaC9ad2609466fB92C69640fa2b9Ee7B22a76E8fe";
const VIA = "Orthogonal x402 · Circle Gateway nanopayment";

/** Listed prices, in USDC base units. The seller's own quote is checked against these before paying. */
export const WEB_PRICES = { search: 2_000n, news: 2_000n, places: 2_000n, reviews: 2_000n, shopping: 4_000n, lens: 6_000n, phone: 10_000n } as const;

const paidOf = (r: { amount: bigint; payTo: Hex; at: string }): Paid => ({ amountUsdc: Number(r.amount) / 1e6, payTo: r.payTo, via: VIA, at: r.at });
const sum = (a: Paid, b: Paid): Paid => ({ ...b, amountUsdc: Number((a.amountUsdc + b.amountUsdc).toFixed(6)) });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : undefined);

async function serper<T>(path: string, body: Record<string, unknown>, price: bigint) {
  return payRequest<T>(`${BASE}/serper/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, price, SERPER_PAYEE);
}

export interface WebResults {
  query: string;
  results: { title: string; link: string; snippet?: string; date?: string; source?: string }[];
  paid: Paid;
}

type SerperOrganic = { organic?: { title?: string; link?: string; snippet?: string; date?: string }[]; news?: { title?: string; link?: string; snippet?: string; date?: string; source?: string }[] };

export async function webSearch(query: string): Promise<WebResults> {
  const r = await serper<SerperOrganic>("search", { q: query, num: 8 }, WEB_PRICES.search);
  const results = (r.data.organic ?? []).slice(0, 6).map((o) => ({ title: clip(o.title, 120) ?? "", link: o.link ?? "", snippet: clip(o.snippet, 240), date: o.date }));
  return { query, results, paid: paidOf(r) };
}

export async function newsSearch(query: string): Promise<WebResults> {
  const r = await serper<SerperOrganic>("news", { q: query, num: 8 }, WEB_PRICES.news);
  const results = (r.data.news ?? []).slice(0, 6).map((o) => ({ title: clip(o.title, 120) ?? "", link: o.link ?? "", snippet: clip(o.snippet, 240), date: o.date, source: o.source }));
  return { query, results, paid: paidOf(r) };
}

export interface PlaceReviews {
  place: string;
  found?: { name: string; address?: string; phone?: string; website?: string };
  reviews: { rating: number; when?: string; text?: string }[];
  average?: number;
  paid: Paid;
}

/** Finds a business on Google, then reads its most recent reviews (two requests). */
export async function placeReviews(place: string): Promise<PlaceReviews> {
  const p = await serper<{ places?: { title?: string; address?: string; phoneNumber?: string; website?: string; cid?: string }[] }>("places", { q: place, num: 3 }, WEB_PRICES.places);
  const top = (p.data.places ?? [])[0];
  if (!top?.cid) return { place, reviews: [], paid: paidOf(p) };
  const r = await serper<{ reviews?: { rating?: number; date?: string; snippet?: string }[] }>("reviews", { cid: top.cid }, WEB_PRICES.reviews);
  const reviews = (r.data.reviews ?? []).slice(0, 8).map((x) => ({ rating: Number(x.rating ?? 0), when: x.date, text: clip(x.snippet, 220) }));
  const rated = reviews.filter((x) => x.rating > 0);
  return {
    place,
    found: { name: top.title ?? place, address: top.address, phone: top.phoneNumber, website: top.website?.split("?")[0] },
    reviews,
    average: rated.length ? Math.round((rated.reduce((a, x) => a + x.rating, 0) / rated.length) * 10) / 10 : undefined,
    paid: sum(paidOf(p), paidOf(r)),
  };
}

export interface ShoppingPrices {
  product: string;
  offers: { title: string; store?: string; price: number }[];
  lowest?: number;
  median?: number;
  highest?: number;
  paid: Paid;
}

const dollars = (s?: string) => {
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(s ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
};

export async function shoppingPrices(product: string): Promise<ShoppingPrices> {
  const r = await serper<{ shopping?: { title?: string; source?: string; price?: string }[] }>("shopping", { q: product, num: 20 }, WEB_PRICES.shopping);
  const offers = (r.data.shopping ?? [])
    .map((s) => ({ title: clip(s.title, 90) ?? "", store: s.source, price: dollars(s.price) }))
    .filter((o) => Number.isFinite(o.price) && o.price > 0)
    .slice(0, 15);
  const sorted = offers.map((o) => o.price).sort((a, b) => a - b);
  return { product, offers: offers.slice(0, 8), lowest: sorted[0], median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined, highest: sorted.at(-1), paid: paidOf(r) };
}

export interface ImageCheck {
  imageUrl: string;
  matches: { title: string; link: string; source?: string }[];
  paid: Paid;
}

/** Google Lens: where else the same picture appears. A listing photo found on other sites is a warning sign. */
export async function imageCheck(imageUrl: string): Promise<ImageCheck> {
  if (!/^https:\/\//.test(imageUrl)) throw new Error("The photo needs a public https link");
  const r = await serper<{ organic?: { title?: string; link?: string; source?: string }[]; visualMatches?: { title?: string; link?: string; source?: string }[] }>("lens", { url: imageUrl }, WEB_PRICES.lens);
  const list = [...(r.data.organic ?? []), ...(r.data.visualMatches ?? [])].slice(0, 8).map((m) => ({ title: clip(m.title, 110) ?? "", link: m.link ?? "", source: m.source }));
  return { imageUrl, matches: list, paid: paidOf(r) };
}

export interface PhoneCheck {
  phone: string;
  valid: boolean;
  lineType?: string;
  carrier?: string;
  region?: string;
  formatted?: string;
  paid: Paid;
}

export async function phoneCheck(phone: string): Promise<PhoneCheck> {
  const r = await payRequest<{ data?: { valid?: boolean; line_type?: string; carrier?: string; region?: { name?: string }; intl_format?: string } }>(`${BASE}/tomba/v1/phone-validator?${new URLSearchParams({ phone })}`, { method: "GET" }, WEB_PRICES.phone, TOMBA_PAYEE);
  const d = r.data.data ?? {};
  return { phone, valid: Boolean(d.valid), lineType: d.line_type, carrier: clip(d.carrier, 80), region: d.region?.name, formatted: d.intl_format, paid: paidOf(r) };
}
