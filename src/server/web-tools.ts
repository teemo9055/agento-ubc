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
  /** Google's own panel about the thing searched for: its name, type, website and listed facts. */
  facts?: { title?: string; type?: string; website?: string; description?: string; attributes?: Record<string, string> };
  /** Google's direct answer, when it gives one. */
  answer?: string;
  paid: Paid;
}

type SerperOrganic = {
  organic?: { title?: string; link?: string; snippet?: string; date?: string }[];
  news?: { title?: string; link?: string; snippet?: string; date?: string; source?: string }[];
  knowledgeGraph?: { title?: string; type?: string; website?: string; description?: string; attributes?: Record<string, string> };
  answerBox?: { answer?: string; snippet?: string; title?: string };
};

export async function webSearch(query: string): Promise<WebResults> {
  const r = await serper<SerperOrganic>("search", { q: query, num: 8 }, WEB_PRICES.search);
  const results = (r.data.organic ?? []).slice(0, 8).map((o) => ({ title: clip(o.title, 160) ?? "", link: o.link ?? "", snippet: clip(o.snippet, 320), date: o.date }));
  const kg = r.data.knowledgeGraph;
  const facts = kg?.title
    ? {
        title: clip(kg.title, 120),
        type: clip(kg.type, 80),
        website: kg.website,
        description: clip(kg.description, 400),
        attributes: kg.attributes ? Object.fromEntries(Object.entries(kg.attributes).slice(0, 12).map(([k, v]) => [clip(k, 40) ?? k, clip(String(v), 160) ?? ""])) : undefined,
      }
    : undefined;
  const ab = r.data.answerBox;
  const answer = clip(ab?.answer ?? ab?.snippet, 400);
  return { query, results, ...(facts ? { facts } : {}), ...(answer ? { answer } : {}), paid: paidOf(r) };
}

export async function newsSearch(query: string): Promise<WebResults> {
  const r = await serper<SerperOrganic>("news", { q: query, num: 8 }, WEB_PRICES.news);
  const results = (r.data.news ?? []).slice(0, 8).map((o) => ({ title: clip(o.title, 160) ?? "", link: o.link ?? "", snippet: clip(o.snippet, 320), date: o.date, source: o.source }));
  return { query, results, paid: paidOf(r) };
}

export interface PlaceReviews {
  place: string;
  found?: { name: string; address?: string; phone?: string; website?: string; category?: string };
  reviews: { rating: number; when?: string; text?: string }[];
  /** The average of the recent reviews read here. */
  average?: number;
  /** Google's own all-time rating and how many reviews it rests on. */
  rating?: number;
  ratingCount?: number;
  paid: Paid;
}

/** Finds a business on Google, then reads its most recent reviews (two requests). */
export async function placeReviews(place: string): Promise<PlaceReviews> {
  const p = await serper<{ places?: { title?: string; address?: string; phoneNumber?: string; website?: string; cid?: string; rating?: number; ratingCount?: number; category?: string }[] }>("places", { q: place, num: 3 }, WEB_PRICES.places);
  const top = (p.data.places ?? [])[0];
  if (!top?.cid) return { place, reviews: [], paid: paidOf(p) };
  const r = await serper<{ reviews?: { rating?: number; date?: string; snippet?: string }[] }>("reviews", { cid: top.cid }, WEB_PRICES.reviews);
  const reviews = (r.data.reviews ?? []).slice(0, 10).map((x) => ({ rating: Number(x.rating ?? 0), when: x.date, text: clip(x.snippet, 280) }));
  const rated = reviews.filter((x) => x.rating > 0);
  return {
    place,
    found: { name: top.title ?? place, address: top.address, phone: top.phoneNumber, website: top.website?.split("?")[0], category: top.category },
    reviews,
    ...(typeof top.rating === "number" ? { rating: top.rating } : {}),
    ...(typeof top.ratingCount === "number" ? { ratingCount: top.ratingCount } : {}),
    average: rated.length ? Math.round((rated.reduce((a, x) => a + x.rating, 0) / rated.length) * 10) / 10 : undefined,
    paid: sum(paidOf(p), paidOf(r)),
  };
}

export interface ShoppingPrices {
  product: string;
  /** The offers the numbers below were worked out from: the same item, bundles and other models left out. */
  offers: { title: string; store?: string; price: number }[];
  lowest?: number;
  median?: number;
  highest?: number;
  /** Offers left out because they're a bundle, a multi-pack or a different model. */
  leftOut?: number;
  paid: Paid;
}

const BUNDLE = /(\+|\bbundle\b|\bkit\b|\bcombo\b|\bwith\b.*\b(panel|battery|charger|case)s?\b|\b\d+\s*x\b|\b\d+\s*-?\s*pack\b|\bset of\b)/i;
const VARIANTS = ["plus", "pro", "max", "mini", "ultra", "lite", "se"];

/**
 * Is a store offer the same item that was asked about? Bundles and multi-packs aren't, and nor is a
 * different model ("Plus", "Pro") that the item's own name doesn't have. Kept when nothing says otherwise.
 */
export function sameItem(product: string, title: string): boolean {
  const want = ` ${product.toLowerCase()} `;
  const got = title.toLowerCase();
  if (BUNDLE.test(title) && !BUNDLE.test(product)) return false;
  for (const v of VARIANTS) {
    const re = new RegExp(`\\b${v}\\b`);
    if (re.test(got) !== re.test(want)) return false;
  }
  return true;
}

const dollars = (s?: string) => {
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(s ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
};

export async function shoppingPrices(product: string): Promise<ShoppingPrices> {
  const r = await serper<{ shopping?: { title?: string; source?: string; price?: string }[] }>("shopping", { q: product, num: 20 }, WEB_PRICES.shopping);
  const all = (r.data.shopping ?? []).map((s) => ({ title: clip(s.title, 110) ?? "", store: s.source, price: dollars(s.price) })).filter((o) => Number.isFinite(o.price) && o.price > 0);
  const same = all.filter((o) => sameItem(product, o.title));
  // When the filter would leave too little to compare, the plain list is better than nothing.
  const offers = (same.length >= 3 ? same : all).slice(0, 15);
  const sorted = offers.map((o) => o.price).sort((a, b) => a - b);
  return { product, offers, lowest: sorted[0], median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined, highest: sorted.at(-1), leftOut: all.length - offers.length, paid: paidOf(r) };
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
  const r = await payRequest<{ markdown?: string; data?: { markdown?: string } }>(`${MRSCRAPER}/v1/circle/scrape-markdown?${new URLSearchParams({ url })}`, { method: "GET" }, WEB_PRICES.page, MRSCRAPER_PAYEE, 60_000);
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

export interface ListingRead {
  url: string;
  title?: string;
  /** The title cut down to what a store search needs: no condition words, no shop names. */
  searchTitle?: string;
  price?: number;
  currency?: string;
  condition?: string;
  seller?: string;
  sellerFeedback?: number;
  photo?: string;
  paid: Paid;
}

const LISTING_PROMPT =
  "Return JSON with: title (the item name), price (number, in the listing's currency), currency, condition, seller (seller username or shop name), sellerFeedback (percent positive, number, if shown), photo (main image URL).";

/** "EcoFlow DELTA 3 Max Power Station Backup Refurbished | eBay" → "EcoFlow DELTA 3 Max Power Station Backup". */
export function searchTitleOf(title: string): string {
  return title
    .replace(/\|.*$/, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(certified|refurbished|renewed|used|brand new|new|open box|free shipping|fast shipping|sealed|unlocked|oem|genuine|authentic|lot of \d+)\b/gi, " ")
    .replace(/[^\w\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 9)
    .join(" ");
}

/** Reads a listing page (MrScraper, structured): what's for sale, at what price, by whom, with its photo. */
export async function readListing(url: string): Promise<ListingRead> {
  if (!/^https?:\/\//.test(url)) throw new Error("Reading a listing needs its full link, starting with https://");
  const r = await payRequest<{ data?: Record<string, unknown> }>(`${MRSCRAPER}/v1/circle/scrape-json?${new URLSearchParams({ url, prompt: LISTING_PROMPT })}`, { method: "GET" }, WEB_PRICES.page, MRSCRAPER_PAYEE, 75_000);
  const d = r.data.data ?? {};
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x.replace(/[^\d.]/g, "")) : NaN);
  const title = clip(d.title, 160);
  const price = num(d.price);
  const feedback = num(d.sellerFeedback);
  const photo = typeof d.photo === "string" && /^https:\/\//.test(d.photo) ? d.photo : undefined;
  return {
    url,
    title,
    searchTitle: title ? searchTitleOf(title) : undefined,
    price: Number.isFinite(price) && price > 0 ? price : undefined,
    currency: clip(d.currency, 8),
    condition: clip(d.condition, 60),
    seller: clip(d.seller, 60),
    sellerFeedback: Number.isFinite(feedback) ? feedback : undefined,
    photo,
    paid: paidOf(r),
  };
}

// ---------- Company data that a web search can't show: history and dated events ----------

export const CORESIGNAL_PAYEE: Hex = "0x12E8DE0712aEbe6579A9E16deE2AE9FfCc4E7dC2";
export const PREDICTLEADS_PAYEE: Hex = "0xcA37dE138574432B96F92B0Cd9826DaDFd1cf443";
export const EXA_PAYEE: Hex = "0xB98eF29eb2be19Ae646A8FC0248255B90A332dbC";
const EXA = process.env.EXA_BASE ?? "https://api.exa.ai";
export const DATA_PRICES = { headcount: 84_000n, funding: 40_000n, events: 40_000n, deepSearch: 7_000n, article: 1_000n } as const;

type Obj = Record<string, unknown>;
/** The first of several possible fields that holds a value: vendors name the same thing differently. */
const pick = (o: unknown, ...keys: string[]): unknown => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) {
    const v = (o as Obj)[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown, n = 160): string | undefined => (typeof v === "string" ? clip(v, n) : typeof v === "number" ? String(v) : undefined);
const monthOf = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : undefined);
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

export interface HeadcountHistory {
  domain: string;
  found: boolean;
  name?: string;
  industry?: string;
  sizeRange?: string;
  employees?: number;
  /** Staff count by month, oldest first (up to the last 36 months). */
  byMonth: { month: string; employees: number }[];
  /** Worked out here from the monthly counts: change over the last 6 and 12 months, as a share. */
  change6m?: number;
  change12m?: number;
  hq?: string;
  founded?: number;
  /** Senior people who joined, newest first. */
  executiveArrivals: { name?: string; title?: string; date?: string }[];
  openJobs?: number;
  openJobsChange?: { monthly?: number; quarterly?: number; yearly?: number };
  lastRound?: { type?: string; date?: string; amountUsd?: number };
  about?: string;
  paid: Paid;
}

/** Reads a monthly series in any of the shapes vendors use: a list of {date, count} or a {month: count} map. */
function seriesOf(v: unknown): { month: string; employees: number }[] {
  const rows: { month: string; employees: number }[] = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      const m = monthOf(pick(x, "date", "month", "period", "snapshot_date"));
      const n = num(pick(x, "employees_count", "employee_count", "count", "value", "headcount"));
      if (m && n != null) rows.push({ month: m, employees: n });
    }
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Obj)) {
      const m = monthOf(k);
      const n = num(x);
      if (m && n != null) rows.push({ month: m, employees: n });
    }
  }
  const byMonth = new Map(rows.map((r) => [r.month, r.employees]));
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, employees]) => ({ month, employees }));
}

/** The share a monthly series changed over the last n months, if it reaches back that far. */
export function changeOver(series: { month: string; employees: number }[], months: number): number | undefined {
  const last = series.at(-1);
  if (!last) return undefined;
  const then = [...series].reverse().find((r) => monthsBetween(r.month, last.month) >= months);
  if (!then || !then.employees) return undefined;
  return Math.round(((last.employees - then.employees) / then.employees) * 1000) / 1000;
}

/** Coresignal (via Orthogonal): a company's staff count month by month, senior hires, open jobs, last round. */
export async function headcountHistory(site: string): Promise<HeadcountHistory> {
  const domain = domainOf(site);
  if (!domain) throw new Error("The staff history needs the company's website, like ramp.com");
  const r = await payRequest<Obj>(`${BASE}/coresignal/v2/company_multi_source/enrich?${new URLSearchParams({ website: domain })}`, { method: "GET" }, DATA_PRICES.headcount, CORESIGNAL_PAYEE, 60_000);
  const d = (pick(r.data, "data") as Obj | undefined) ?? r.data;
  const byMonth = seriesOf(pick(d, "employees_count_by_month", "employee_count_by_month", "headcount_by_month")).slice(-36);
  const arrivals = (pick(d, "key_executive_arrivals", "key_executives_arrivals") as unknown[] | undefined) ?? [];
  const jobsChange = pick(d, "active_job_postings_count_change") as Obj | undefined;
  const hq = [pick(d, "hq_city"), pick(d, "hq_state", "hq_region"), pick(d, "hq_country")].filter((x) => typeof x === "string").join(", ") || str(pick(d, "hq_location", "headquarters"));
  const employees = num(pick(d, "employees_count", "employee_count", "size_employees_count")) ?? byMonth.at(-1)?.employees;
  return {
    domain,
    found: Boolean(pick(d, "company_name", "name")),
    name: str(pick(d, "company_name", "name"), 100),
    industry: str(pick(d, "industry", "categories_and_keywords"), 100),
    sizeRange: str(pick(d, "size_range", "company_size_range", "size"), 40),
    employees,
    byMonth,
    change6m: changeOver(byMonth, 6),
    change12m: changeOver(byMonth, 12),
    hq: hq || undefined,
    founded: num(pick(d, "founded_year", "founded")),
    executiveArrivals: arrivals
      .slice(0, 8)
      .map((a) => ({ name: str(pick(a, "member_full_name", "full_name", "name"), 80), title: str(pick(a, "member_position_title", "position_title", "title"), 100), date: str(pick(a, "arrival_date", "date"), 10) }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    openJobs: num(pick(d, "active_job_postings_count", "job_postings_count")),
    openJobsChange: jobsChange
      ? { monthly: num(pick(jobsChange, "change_monthly", "monthly")), quarterly: num(pick(jobsChange, "change_quarterly", "quarterly")), yearly: num(pick(jobsChange, "change_yearly", "yearly")) }
      : undefined,
    lastRound: pick(d, "last_funding_round_name", "last_funding_round_announced_date")
      ? { type: str(pick(d, "last_funding_round_name"), 60), date: str(pick(d, "last_funding_round_announced_date"), 10), amountUsd: num(pick(d, "last_funding_round_amount_raised")) }
      : undefined,
    about: str(pick(d, "description", "description_enriched"), 400),
    paid: paidOf(r),
  };
}

type JsonApi = { data?: { id?: string; type?: string; attributes?: Obj; relationships?: Record<string, { data?: { id?: string; type?: string } | { id?: string; type?: string }[] }> }[]; included?: { id?: string; type?: string; attributes?: Obj }[] };
const includedById = (j: JsonApi) => new Map((j.included ?? []).map((x) => [`${x.type}:${x.id}`, x.attributes ?? {}]));
const relIds = (rel: unknown): { id?: string; type?: string }[] => (Array.isArray(rel) ? rel : rel ? [rel as { id?: string; type?: string }] : []);

export interface FundingHistory {
  domain: string;
  /** Rounds, newest first. */
  rounds: { date?: string; type?: string; amountUsd?: number; investors: string[]; source?: string }[];
  totalRaisedUsd?: number;
  lastRoundDate?: string;
  /** Worked out here: whole months since the last round. */
  monthsSinceLast?: number;
  paid: Paid;
}

/** PredictLeads (via Orthogonal): a company's funding rounds with dates, amounts and investors. */
export async function fundingHistory(site: string): Promise<FundingHistory> {
  const domain = domainOf(site);
  if (!domain) throw new Error("The funding history needs the company's website, like ramp.com");
  const r = await payRequest<JsonApi>(`${BASE}/predictleads/v3/companies/${encodeURIComponent(domain)}/financing_events`, { method: "GET" }, DATA_PRICES.funding, PREDICTLEADS_PAYEE, 60_000);
  const inc = includedById(r.data);
  const rounds = (r.data.data ?? [])
    .map((e) => {
      const a = e.attributes ?? {};
      const investors = relIds(e.relationships?.investors?.data)
        .map((x) => str(pick(inc.get(`${x.type}:${x.id}`), "company_name", "name", "domain"), 60))
        .filter((x): x is string => Boolean(x));
      return {
        date: str(pick(a, "effective_date", "found_at", "date"), 10),
        type: str(pick(a, "financing_type_normalized", "financing_type", "round"), 40),
        amountUsd: num(pick(a, "amount_normalized", "amount")),
        investors: investors.slice(0, 6),
        source: str(pick(a, "source_url", "url"), 300),
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 12);
  const total = rounds.reduce((x, o) => x + (o.amountUsd ?? 0), 0);
  const last = rounds.find((o) => o.date)?.date;
  const now = new Date().toISOString().slice(0, 7);
  return { domain, rounds, totalRaisedUsd: total || undefined, lastRoundDate: last, monthsSinceLast: last ? monthsBetween(last.slice(0, 7), now) : undefined, paid: paidOf(r) };
}

export interface CompanyEvents {
  domain: string;
  since: string;
  /** Dated events (hires, layoffs, launches, acquisitions, new offices…), newest first, each with its source. */
  events: { date?: string; category?: string; summary?: string; source?: string; title?: string }[];
  /** How many of each kind. */
  counts: Record<string, number>;
  paid: Paid;
}

/** PredictLeads (via Orthogonal): what a company did, as dated, labelled events with the article behind each. */
export async function companyEvents(site: string, since?: string): Promise<CompanyEvents> {
  const domain = domainOf(site);
  if (!domain) throw new Error("The company's events need its website, like ramp.com");
  const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : new Date(Date.now() - 548 * 86_400_000).toISOString().slice(0, 10);
  const r = await payRequest<JsonApi>(`${BASE}/predictleads/v3/companies/${encodeURIComponent(domain)}/news_events?${new URLSearchParams({ first_seen_at_from: from })}`, { method: "GET" }, DATA_PRICES.events, PREDICTLEADS_PAYEE, 60_000);
  const inc = includedById(r.data);
  const events = (r.data.data ?? [])
    .map((e) => {
      const a = e.attributes ?? {};
      const src = relIds(e.relationships?.most_relevant_source?.data ?? e.relationships?.sources?.data)[0];
      const art = src ? inc.get(`${src.type}:${src.id}`) : undefined;
      return {
        date: str(pick(a, "effective_date", "found_at", "published_at"), 10),
        category: str(pick(a, "category", "categories"), 40),
        summary: str(pick(a, "summary", "article_sentence", "text"), 240),
        source: str(pick(art, "url") ?? pick(a, "url", "source_url"), 300),
        title: str(pick(art, "title"), 160),
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 15);
  const counts: Record<string, number> = {};
  for (const e of events) if (e.category) counts[e.category] = (counts[e.category] ?? 0) + 1;
  return { domain, since: from, events, counts, paid: paidOf(r) };
}

export interface DeepSearch {
  query: string;
  since?: string;
  results: { title?: string; url: string; date?: string; highlights: string[] }[];
  paid: Paid;
}

/** Exa: a search that reads pages by meaning, limited by date and leaving out a domain, with the key sentences of each. */
export async function deepSearch(query: string, since?: string, exclude?: string): Promise<DeepSearch> {
  const body: Obj = {
    query,
    numResults: 6,
    type: "auto",
    contents: { highlights: { numSentences: 2, highlightsPerUrl: 2, query } },
    ...(since && /^\d{4}-\d{2}-\d{2}/.test(since) ? { startPublishedDate: `${since.slice(0, 10)}T00:00:00.000Z` } : {}),
    ...(exclude && domainOf(exclude) ? { excludeDomains: [domainOf(exclude)] } : {}),
  };
  const r = await payRequest<{ results?: Obj[] }>(`${EXA}/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, DATA_PRICES.deepSearch, EXA_PAYEE, 45_000);
  const results = (r.data.results ?? []).slice(0, 6).map((x) => ({
    title: str(pick(x, "title"), 160),
    url: String(pick(x, "url", "id") ?? ""),
    date: str(pick(x, "publishedDate"), 10),
    highlights: ((pick(x, "highlights") as unknown[]) ?? []).filter((h): h is string => typeof h === "string").map((h) => clip(h, 300)!).slice(0, 2),
  }));
  return { query, since, results, paid: paidOf(r) };
}

export interface ArticleRead {
  url: string;
  title?: string;
  date?: string;
  text: string;
  paid: Paid;
}

/** Exa: the clean text of an article or page someone else found, without the page's clutter. */
export async function readArticle(url: string): Promise<ArticleRead> {
  if (!/^https?:\/\//.test(url)) throw new Error("Reading an article needs its full link");
  const r = await payRequest<{ results?: Obj[] }>(`${EXA}/contents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ urls: [url], text: { maxCharacters: 5000 } }) }, DATA_PRICES.article, EXA_PAYEE, 45_000);
  const x = r.data.results?.[0] ?? {};
  return { url, title: str(pick(x, "title"), 160), date: str(pick(x, "publishedDate"), 10), text: (str(pick(x, "text"), 5000) ?? "").trim(), paid: paidOf(r) };
}
