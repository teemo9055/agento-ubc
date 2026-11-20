import type { Hex } from "viem";
import { settledBy, type Paid } from "./onchain";
import { payRequest } from "./nanopay";
import { normalizePhone } from "./dataflow";

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
/** BlockRun (Polymarket and Kalshi data) and MrScraper (reads a web page), from their 402 quotes. */
export const BLOCKRUN_PAYEE: Hex = "0x6E007731870EDe419CfB31889Cd5C4493CEcb04c";
export const MRSCRAPER_PAYEE: Hex = "0x3D8628dD13bBE17C7ffF7BD839c7c7036f12f674";
const BLOCKRUN = process.env.BLOCKRUN_BASE ?? "https://nano.blockrun.ai";
const MRSCRAPER = process.env.MRSCRAPER_BASE ?? "https://api.mrscraper.com";
const VIA = "Orthogonal x402 · Circle Gateway nanopayment";

/** Listed prices, in USDC base units. The seller's own quote is checked against these before paying. */
export const WEB_PRICES = { search: 2_000n, news: 2_000n, places: 2_000n, reviews: 2_000n, shopping: 4_000n, lens: 6_000n, phone: 10_000n, company: 10_000n, page: 1_000n, odds: 1_000n } as const;

const paidOf = (r: { amount: bigint; payTo: Hex; at: string; settlement?: unknown }): Paid => ({ amountUsdc: Number(r.amount) / 1e6, payTo: r.payTo, via: VIA, at: r.at, ...settledBy(r.settlement) });
/** Two requests for one lookup: both transfers are kept, joined, so each can be looked up. */
const sum = (a: Paid, b: Paid): Paid => ({ ...b, amountUsdc: Number((a.amountUsdc + b.amountUsdc).toFixed(6)), transfer: [a.transfer, b.transfer].filter(Boolean).join(",") || undefined });
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

export async function phoneCheck(given: string): Promise<PhoneCheck> {
  // Listings write numbers without a country code ("(415) 668-8000"); the checker needs +1415…
  const phone = normalizePhone(given);
  if (!phone) throw new Error(`“${given}” isn't a full phone number`);
  const r = await payRequest<{ data?: { valid?: boolean; line_type?: string; carrier?: string; region?: { name?: string }; intl_format?: string } }>(`${BASE}/tomba/v1/phone-validator?${new URLSearchParams({ phone, ...(phone.startsWith("+1") ? { country_code: "US" } : {}) })}`, { method: "GET" }, WEB_PRICES.phone, TOMBA_PAYEE);
  const d = r.data.data ?? {};
  return { phone, valid: Boolean(d.valid), lineType: d.line_type, carrier: clip(d.carrier, 80), region: d.region?.name, formatted: d.intl_format, paid: paidOf(r) };
}

/** A website's host from a link or a bare domain: "https://www.rivian.com/x" → "rivian.com". */
export function domainOf(x: string): string | null {
  const s = x.trim().toLowerCase();
  try {
    const host = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export interface CompanyRecord {
  domain: string;
  found: boolean;
  name?: string;
  founded?: string;
  kind?: string;
  location?: string;
  phones: string[];
  emails: string[];
  social: Record<string, string>;
  /** When the website's domain was registered: a brand-new domain is a warning sign. */
  domainSince?: string;
  domainAgeYears?: number;
  emailProvider?: string;
  about?: string;
  paid: Paid;
}

type TombaCompany = {
  data?: {
    name?: string;
    domain?: string;
    foundedYear?: string;
    type?: string;
    description?: string;
    emailProvider?: string;
    site?: { phoneNumbers?: string[]; emailAddresses?: string[] };
    geo?: { city?: string; state?: string; country?: string };
    whois?: { created_date?: string };
    twitter?: { handle?: string };
    facebook?: { handle?: string };
    linkedin?: { handle?: string };
  };
};

/** The company behind a website (Tomba): official phones and emails, age, location, social accounts. */
export async function companyRecord(site: string): Promise<CompanyRecord> {
  const domain = domainOf(site);
  if (!domain) throw new Error("The company check needs a website, like rivian.com");
  const r = await payRequest<TombaCompany>(`${BASE}/tomba/v1/companies/find?${new URLSearchParams({ domain })}`, { method: "GET" }, WEB_PRICES.company, TOMBA_PAYEE);
  const d = r.data.data;
  const since = d?.whois?.created_date?.slice(0, 10);
  const age = since ? Math.floor((Date.now() - Date.parse(since)) / (365.25 * 86400e3)) : undefined;
  const social = Object.fromEntries(
    (["twitter", "facebook", "linkedin"] as const).flatMap((k) => (d?.[k]?.handle ? [[k, d[k]!.handle!]] : [])),
  );
  return {
    domain,
    found: Boolean(d?.name),
    name: clip(d?.name, 80),
    founded: d?.foundedYear ?? undefined,
    kind: d?.type ?? undefined,
    location: [d?.geo?.city, d?.geo?.state, d?.geo?.country].filter(Boolean).join(", ") || undefined,
    phones: (d?.site?.phoneNumbers ?? []).slice(0, 4),
    emails: (d?.site?.emailAddresses ?? []).slice(0, 6),
    social,
    domainSince: since,
    domainAgeYears: Number.isFinite(age) ? age : undefined,
    emailProvider: d?.emailProvider ?? undefined,
    about: clip(d?.description, 240),
    paid: paidOf(r),
  };
}

export interface PageRead {
  url: string;
  title?: string;
  headings: string[];
  text: string;
  words: number;
  paid: Paid;
}

/** Reads a public web page as text (MrScraper): its title, headings and the opening of its text. */
export async function readPage(url: string): Promise<PageRead> {
  if (!/^https?:\/\//.test(url)) throw new Error("Reading a page needs a full link starting with https://");
  const r = await payRequest<{ markdown?: string; data?: { markdown?: string } }>(`${MRSCRAPER}/v1/circle/scrape-markdown?${new URLSearchParams({ url })}`, { method: "GET" }, WEB_PRICES.page, MRSCRAPER_PAYEE);
  const md = r.data.markdown ?? r.data.data?.markdown ?? "";
  // Links and images are noise for a reader: keep their words, drop the addresses.
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ");
  const headings = [...plain.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).filter((h) => h.length > 2).slice(0, 10);
  const text = plain.replace(/^#{1,6}\s+/gm, "").replace(/\n{2,}/g, "\n").trim();
  return { url, title: headings[0], headings, text: text.slice(0, 2400), words: text.split(/\s+/).length, paid: paidOf(r) };
}

export interface OtherOdds {
  query: string;
  markets: { source: "Polymarket" | "Kalshi"; title: string; yes: number; volumeUsd?: number; closes?: string }[];
  paid: Paid;
}

type PolyMarket = { title?: string; status?: string; end_time?: string; total_volume_usd?: number; outcomes?: { label?: string; price?: number }[] };
type KalshiMarket = { title?: string; status?: string; close_time?: string; last_price?: number; dollar_volume?: number; outcomes?: { label?: string; bid?: number; ask?: number }[] };

/** What Polymarket and Kalshi price for the same question (BlockRun): a second and third opinion on the odds. */
export async function otherOdds(query: string): Promise<OtherOdds> {
  const q = new URLSearchParams({ search: query, limit: "5", status: "open" });
  const [p, k] = await Promise.all([
    payRequest<{ markets?: PolyMarket[] }>(`${BLOCKRUN}/api/v1/pm/polymarket/markets?${q}`, { method: "GET" }, WEB_PRICES.odds, BLOCKRUN_PAYEE),
    payRequest<{ markets?: KalshiMarket[] }>(`${BLOCKRUN}/api/v1/pm/kalshi/markets?${q}`, { method: "GET" }, WEB_PRICES.odds, BLOCKRUN_PAYEE),
  ]);
  const poly = (p.data.markets ?? []).flatMap((m) => {
    const yes = m.outcomes?.find((o) => /^yes$/i.test(o.label ?? ""))?.price;
    return yes == null || !m.title ? [] : [{ source: "Polymarket" as const, title: clip(m.title, 120)!, yes: Math.round(yes * 1000) / 1000, volumeUsd: m.total_volume_usd ? Math.round(m.total_volume_usd) : undefined, closes: m.end_time?.slice(0, 10) }];
  });
  const kal = (k.data.markets ?? []).flatMap((m) => {
    const o = m.outcomes?.find((x) => /^yes$/i.test(x.label ?? ""));
    const yes = o?.bid != null && o?.ask != null ? (o.bid + o.ask) / 2 : (m.last_price ?? undefined);
    return yes == null || !m.title ? [] : [{ source: "Kalshi" as const, title: clip(m.title, 120)!, yes: Math.round(yes * 1000) / 1000, volumeUsd: m.dollar_volume ? Math.round(m.dollar_volume) : undefined, closes: m.close_time?.slice(0, 10) }];
  });
  return { query, markets: [...poly, ...kal].slice(0, 10), paid: sum(paidOf(p), paidOf(k)) };
}
