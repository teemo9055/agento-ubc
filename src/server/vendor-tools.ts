import type { Hex } from "viem";
import type { ResearchStep } from "@/lib/types";
import { chainlinkPrice } from "./chainlink";
import { QUICKNODE_PAYEE, bitcoinNetwork, gasPrice, walletBalance, type BitcoinNetwork, type GasPrice, type OraclePrice, type Paid, type WalletBalance } from "./onchain";
import { callService, findService, type ServiceResult } from "./marketplace";
import type { Net } from "@/lib/networks";
import { BLOCKRUN_PAYEE, companyRecord, imageCheck, MRSCRAPER_PAYEE, newsSearch, otherOdds, phoneCheck, placeReviews, readListing, readPage, SERPER_PAYEE, shoppingPrices, TOMBA_PAYEE, WEB_PRICES, webSearch, type CompanyRecord, type ImageCheck, type ListingRead, type OtherOdds, type PageRead, type PhoneCheck, type PlaceReviews, type ShoppingPrices, type WebResults } from "./web-tools";
import { companyEvents, CORESIGNAL_PAYEE, DATA_PRICES, deepSearch, EXA_PAYEE, fundingHistory, headcountHistory, PREDICTLEADS_PAYEE, readArticle, type ArticleRead, type CompanyEvents, type DeepSearch, type FundingHistory, type HeadcountHistory } from "./web-tools";

/**
 * Paid lookups bought from vendors on Circle's Agent Marketplace with Gateway nanopayments.
 * Each entry says who is paid, what a request costs, how to run it and how to say the result
 * in one line. The orchestrator checks every purchase against the approved line before paying.
 */
export { QUICKNODE_PAYEE } from "./onchain";
const QUICKNODE = "Quicknode (Agent Marketplace)";
/** Quicknode's listed price per request, in USDC base units. */
const CALL = 100n;

export interface VendorTool {
  /** What the cost line calls the purchase. */
  service(args: Record<string, string>): string;
  payeeName(args: Record<string, string>): string;
  payee(args: Record<string, string>): Hex;
  price(args: Record<string, string>): bigint;
  run(args: Record<string, string>, maxAmount: bigint): Promise<{ paid: Paid }>;
  /** One line for the step once it's done. */
  note(data: unknown): string;
  /** The facts the write-up may use. */
  stat(data: unknown): Record<string, unknown>;
  /** Networks the seller takes payment on; every network when not set. */
  nets?: Net[];
}

const ORTHOGONAL = "Orthogonal (Agent Marketplace)";
const usd0 = (x?: number) => (x == null ? "?" : `$${x.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const firstTitles = (r: WebResults, n = 2) => r.results.slice(0, n).map((x) => `“${x.title.slice(0, 60)}”`).join(", ");

const money = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 4 : 2 })}`;

/** A short, safe view of whatever a third-party service answered. */
export function brief(v: unknown, max = 700): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return (s ?? "").replace(/\s+/g, " ").slice(0, max);
}

export const VENDOR_TOOLS: Record<string, VendorTool> = {
  oracle_price: {
    service: () => "Chainlink price via Quicknode",
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => chainlinkPrice(a.symbol.toLowerCase()),
    note: (d) => {
      const q = d as OraclePrice;
      return `${q.description} ${money(q.price)} · ${q.ageMinutes} min old`;
    },
    stat: (d) => {
      const q = d as OraclePrice;
      return { oracle: q.price, ageMinutes: q.ageMinutes, source: `${q.description} · Chainlink on Ethereum` };
    },
  },
  gas_price: {
    service: (a) => `Gas price on ${a.chain} via Quicknode`,
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => gasPrice(a.chain),
    note: (d) => {
      const g = d as GasPrice;
      return `${g.chain} gas ${g.gwei < 1 ? g.gwei.toFixed(3) : g.gwei.toFixed(1)} gwei · a transfer costs about ${g.transferCost.toFixed(7)} ${g.coin}`;
    },
    stat: (d) => {
      const g = d as GasPrice;
      return { chain: g.chain, gasGwei: g.gwei, transferCost: g.transferCost, coin: g.coin };
    },
  },
  btc_network: {
    service: () => "Bitcoin fees and mempool via Quicknode",
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    // Two requests: the fee estimate and the mempool.
    price: () => CALL * 2n,
    run: () => bitcoinNetwork(),
    note: (d) => {
      const b = d as BitcoinNetwork;
      return `Bitcoin fee ${b.feeSatVb} sat/vB · ${b.mempoolTxs.toLocaleString()} payments waiting (${b.mempoolMb} MB)`;
    },
    stat: (d) => {
      const b = d as BitcoinNetwork;
      return { feeSatPerVbyte: b.feeSatVb, typicalFeeBtc: b.typicalFeeBtc, mempoolTransactions: b.mempoolTxs, mempoolMb: b.mempoolMb };
    },
  },
  wallet_balance: {
    service: (a) => `Wallet balance on ${a.chain} via Quicknode`,
    payeeName: () => QUICKNODE,
    payee: () => QUICKNODE_PAYEE,
    price: () => CALL,
    run: (a) => walletBalance(a.chain, a.address),
    note: (d) => {
      const w = d as WalletBalance;
      return `${w.address.slice(0, 6)}…${w.address.slice(-4)} on ${w.chain}: ${w.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC · ${w.native} ${w.coin}`;
    },
    stat: (d) => {
      const w = d as WalletBalance;
      return { chain: w.chain, address: w.address, usdc: w.usdc, native: w.native, coin: w.coin };
    },
  },
  company_record: {
    service: (a) => `Company record: ${a.site ?? "the website found earlier"}`.slice(0, 80),
    payeeName: () => "Tomba via Orthogonal (Agent Marketplace)",
    payee: () => TOMBA_PAYEE,
    price: () => WEB_PRICES.company,
    nets: ["mainnet"],
    run: (a) => companyRecord(a.site),
    note: (d) => {
      const c = d as CompanyRecord;
      if (!c.found) return `No company record for ${c.domain}`;
      return `${c.name ?? c.domain}${c.founded ? ` · founded ${c.founded}` : ""}${c.domainAgeYears != null ? ` · site ${c.domainAgeYears} years old` : ""}${c.phones.length ? ` · ${c.phones.length} official phone${c.phones.length > 1 ? "s" : ""}` : ""}`;
    },
    stat: (d) => {
      const { paid: _p, ...rest } = d as CompanyRecord;
      return rest;
    },
  },
  read_listing: {
    service: (a) => `Read listing: ${a.url ?? "the link you gave"}`.slice(0, 80),
    payeeName: () => "MrScraper (Agent Marketplace)",
    payee: () => MRSCRAPER_PAYEE,
    price: () => WEB_PRICES.page,
    nets: ["mainnet"],
    run: (a) => readListing(a.url),
    note: (d) => {
      const r = d as ListingRead;
      if (!r.title) return "Couldn't read what the listing sells";
      return `“${r.title.slice(0, 50)}”${r.price != null ? ` · ${r.currency === "USD" || !r.currency ? "$" : `${r.currency} `}${r.price.toLocaleString()}` : ""}${r.seller ? ` · ${r.seller}` : ""}`;
    },
    stat: (d) => {
      const { paid: _p, ...rest } = d as ListingRead;
      return rest;
    },
  },
  headcount_history: {
    service: (a) => `Staff history: ${a.site ?? "the website found earlier"}`.slice(0, 80),
    payeeName: () => "Coresignal via Orthogonal (Agent Marketplace)",
    payee: () => CORESIGNAL_PAYEE,
    price: () => DATA_PRICES.headcount,
    nets: ["mainnet"],
    run: (a) => headcountHistory(a.site),
    note: (d) => {
      const h = d as HeadcountHistory;
      if (!h.found) return `No staff record for ${h.domain}`;
      const pct = (x?: number) => (x == null ? "" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);
      return `${h.name ?? h.domain}${h.employees != null ? ` · ${h.employees.toLocaleString()} staff` : ""}${h.change12m != null ? ` · ${pct(h.change12m)} in 12 months` : h.change6m != null ? ` · ${pct(h.change6m)} in 6 months` : ""}${h.openJobs != null ? ` · ${h.openJobs} open jobs` : ""}`;
    },
    stat: (d) => {
      const { paid: _p, byMonth, ...rest } = d as HeadcountHistory;
      // The whole curve in short: every third month, plus the latest.
      const curve = byMonth.filter((_, i) => i % 3 === 0 || i === byMonth.length - 1);
      return { ...rest, staffByMonth: curve };
    },
  },
  funding_events: {
    service: (a) => `Funding rounds: ${a.site ?? "the website found earlier"}`.slice(0, 80),
    payeeName: () => "PredictLeads via Orthogonal (Agent Marketplace)",
    payee: () => PREDICTLEADS_PAYEE,
    price: () => DATA_PRICES.funding,
    nets: ["mainnet"],
    run: (a) => fundingHistory(a.site),
    note: (d) => {
      const f = d as FundingHistory;
      const last = f.rounds[0];
      if (!last) return `No funding rounds on record for ${f.domain}`;
      const amt = last.amountUsd ? ` $${last.amountUsd >= 1e6 ? `${Math.round(last.amountUsd / 1e5) / 10}M` : last.amountUsd.toLocaleString()}` : "";
      return `${f.rounds.length} round${f.rounds.length === 1 ? "" : "s"} · last:${amt} ${last.type ?? "round"}${last.date ? ` (${last.date})` : ""}`;
    },
    stat: (d) => {
      const { paid: _p, ...rest } = d as FundingHistory;
      return rest;
    },
  },
  company_events: {
    service: (a) => `Company events: ${a.site ?? "the website found earlier"}`.slice(0, 80),
    payeeName: () => "PredictLeads via Orthogonal (Agent Marketplace)",
    payee: () => PREDICTLEADS_PAYEE,
    price: () => DATA_PRICES.events,
    nets: ["mainnet"],
    run: (a) => companyEvents(a.site, a.since),
    note: (d) => {
      const e = d as CompanyEvents;
      if (!e.events.length) return `No events on record since ${e.since}`;
      const top = Object.entries(e.counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`);
      return `${e.events.length} events since ${e.since}${top.length ? ` · ${top.join(", ")}` : ""}`;
    },
    stat: (d) => {
      const { paid: _p, ...rest } = d as CompanyEvents;
      return rest;
    },
  },
  deep_search: {
    service: (a) => `Deep search: ${a.query ?? "from an earlier step"}`.slice(0, 80),
    payeeName: () => "Exa (Agent Marketplace)",
    payee: () => EXA_PAYEE,
    price: () => DATA_PRICES.deepSearch,
    nets: ["mainnet"],
    run: (a) => deepSearch(a.query, a.since, a.exclude),
    note: (d) => {
      const r = d as DeepSearch;
      return r.results.length ? `${r.results.length} pages · top: “${(r.results[0].title ?? r.results[0].url).slice(0, 60)}”${r.results[0].date ? ` (${r.results[0].date})` : ""}` : "Nothing found";
    },
    stat: (d) => {
      const { paid: _p, ...rest } = d as DeepSearch;
      return rest;
    },
  },
  read_article: {
    service: (a) => `Read article: ${a.url ?? "the link found earlier"}`.slice(0, 80),
    payeeName: () => "Exa (Agent Marketplace)",
    payee: () => EXA_PAYEE,
    price: () => DATA_PRICES.article,
    nets: ["mainnet"],
    run: (a) => readArticle(a.url),
    note: (d) => {
      const r = d as ArticleRead;
      return r.text ? `${r.title ? `“${r.title.slice(0, 60)}” · ` : ""}${r.text.split(/\s+/).length.toLocaleString()} words read` : "The article came back empty";
    },
    stat: (d) => {
      const r = d as ArticleRead;
      return { url: r.url, title: r.title, date: r.date, text: r.text.slice(0, 3000) };
    },
  },
  read_page: {
    service: (a) => `Read page: ${a.url ?? "the page found earlier"}`.slice(0, 80),
    payeeName: () => "MrScraper (Agent Marketplace)",
    payee: () => MRSCRAPER_PAYEE,
    price: () => WEB_PRICES.page,
    nets: ["mainnet"],
    run: (a) => readPage(a.url),
    note: (d) => {
      const r = d as PageRead;
      return `${r.title ? `“${r.title.slice(0, 60)}” · ` : ""}${r.words.toLocaleString()} words read`;
    },
    stat: (d) => {
      const r = d as PageRead;
      return { url: r.url, title: r.title, headings: r.headings, text: r.text.slice(0, 2400) };
    },
  },
  market_odds: {
    service: (a) => `Polymarket and Kalshi odds: ${a.query}`.slice(0, 80),
    payeeName: () => "BlockRun (Agent Marketplace)",
    payee: () => BLOCKRUN_PAYEE,
    // One request to each market.
    price: () => WEB_PRICES.odds * 2n,
    nets: ["mainnet"],
    run: (a) => otherOdds(a.query),
    note: (d) => {
      const r = d as OtherOdds;
      const top = r.markets[0];
      return r.markets.length ? `${r.markets.length} markets · e.g. ${top.source}: “${top.title.slice(0, 50)}” at ${Math.round(top.yes * 100)}%` : "No matching markets on Polymarket or Kalshi";
    },
    stat: (d) => ({ query: (d as OtherOdds).query, markets: (d as OtherOdds).markets.slice(0, 8) }),
  },
  web_search: {
    service: (a) => `Web search: ${a.query ?? "from an earlier step"}`.slice(0, 80),
    payeeName: () => ORTHOGONAL,
    payee: () => SERPER_PAYEE,
    price: () => WEB_PRICES.search,
    nets: ["mainnet"],
    run: (a) => webSearch(a.query),
    note: (d) => {
      const r = d as WebResults;
      return r.results.length ? `${r.results.length} results · top: ${firstTitles(r, 1)}` : "No results";
    },
    stat: (d) => {
      const r = d as WebResults;
      return { query: r.query, ...(r.facts ? { googleFacts: r.facts } : {}), ...(r.answer ? { googleAnswer: r.answer } : {}), results: r.results.slice(0, 8) };
    },
  },
  news_search: {
    service: (a) => `News: ${a.query}`.slice(0, 80),
    payeeName: () => ORTHOGONAL,
    payee: () => SERPER_PAYEE,
    price: () => WEB_PRICES.news,
    nets: ["mainnet"],
    run: (a) => newsSearch(a.query),
    note: (d) => {
      const r = d as WebResults;
      return r.results.length ? `${r.results.length} stories · latest: ${firstTitles(r, 1)}${r.results[0]?.date ? ` (${r.results[0].date})` : ""}` : "No recent news";
    },
    stat: (d) => ({ query: (d as WebResults).query, stories: (d as WebResults).results.slice(0, 8) }),
  },
  place_reviews: {
    service: (a) => `Google reviews: ${a.place ?? "the place found earlier"}`.slice(0, 80),
    payeeName: () => ORTHOGONAL,
    payee: () => SERPER_PAYEE,
    // Two requests: find the place, then read its reviews.
    price: () => WEB_PRICES.places + WEB_PRICES.reviews,
    nets: ["mainnet"],
    run: (a) => placeReviews(a.place),
    note: (d) => {
      const r = d as PlaceReviews;
      if (!r.found) return `Couldn't find “${r.place}” on Google`;
      const all = r.rating != null ? ` · ${r.rating}★ from ${r.ratingCount?.toLocaleString() ?? "?"} reviews` : "";
      return `${r.found.name}${all}${r.average ? ` · recent ${r.average}★` : ""}`;
    },
    stat: (d) => {
      const r = d as PlaceReviews;
      return { business: r.found, googleRating: r.rating, googleReviewCount: r.ratingCount, averageOfRecent: r.average, recentReviews: r.reviews.slice(0, 10) };
    },
  },
  shopping_prices: {
    service: (a) => `Store prices: ${a.product}`.slice(0, 80),
    payeeName: () => ORTHOGONAL,
    payee: () => SERPER_PAYEE,
    price: () => WEB_PRICES.shopping,
    nets: ["mainnet"],
    run: (a) => shoppingPrices(a.product),
    note: (d) => {
      const r = d as ShoppingPrices;
      return r.offers.length ? `${r.offers.length} offers · ${usd0(r.lowest)} to ${usd0(r.highest)}, typical ${usd0(r.median)}` : "No prices found";
    },
    stat: (d) => {
      const r = d as ShoppingPrices;
      return { product: r.product, lowest: r.lowest, typical: r.median, highest: r.highest, ...(r.leftOut ? { bundlesAndOtherModelsLeftOut: r.leftOut } : {}), offers: r.offers.slice(0, 10) };
    },
  },
  image_check: {
    service: () => "Reverse image search (Google Lens)",
    payeeName: () => ORTHOGONAL,
    payee: () => SERPER_PAYEE,
    price: () => WEB_PRICES.lens,
    nets: ["mainnet"],
    run: (a) => imageCheck(a.imageUrl),
    note: (d) => {
      const r = d as ImageCheck;
      return r.matches.length ? `The photo appears on ${r.matches.length} other page${r.matches.length === 1 ? "" : "s"}, e.g. ${r.matches[0].source ?? new URL(r.matches[0].link).host}` : "The photo wasn't found anywhere else online";
    },
    stat: (d) => {
      const r = d as ImageCheck;
      return { foundElsewhere: r.matches.length, matches: r.matches.slice(0, 5) };
    },
  },
  phone_check: {
    service: (a) => `Phone check: ${a.phone ?? "the number found earlier"}`.slice(0, 80),
    payeeName: () => "Tomba via Orthogonal (Agent Marketplace)",
    payee: () => TOMBA_PAYEE,
    price: () => WEB_PRICES.phone,
    nets: ["mainnet"],
    run: (a) => phoneCheck(a.phone),
    note: (d) => {
      const r = d as PhoneCheck;
      if (!r.valid) return `${r.phone} isn't a valid phone number`;
      const kind = /voip/i.test(r.lineType ?? "") ? "an internet (VoIP) line" : r.lineType ? `a ${r.lineType.toLowerCase()} line` : "a line of unknown type";
      return `${r.formatted ?? r.phone} is ${kind}${r.carrier ? ` from ${r.carrier}` : ""}${r.region ? `, ${r.region}` : ""}`;
    },
    stat: (d) => {
      const r = d as PhoneCheck;
      return { phone: r.formatted ?? r.phone, valid: r.valid, lineType: r.lineType, carrier: r.carrier, region: r.region };
    },
  },
  // Any marketplace listing that takes our network. Price and payee were read from the seller
  // when the move was checked, and are part of the approved line.
  service: {
    service: (a) => `${a.provider || "Marketplace service"}: ${a.what || new URL(a.url).host}`,
    payeeName: (a) => `${a.provider || new URL(a.url).host} (Agent Marketplace)`,
    payee: (a) => a.payTo as Hex,
    price: (a) => BigInt(a.price ?? "0"),
    run: async (a, maxAmount) => {
      const listing = await findService(a.url);
      if (!listing) throw new Error("This service is no longer listed as payable on our network");
      return callService(listing, JSON.parse(a.input || "{}") as Record<string, unknown>, maxAmount, a.payTo);
    },
    note: (d) => {
      const r = d as ServiceResult;
      return `${r.provider} answered: ${brief(r.data, 110)}`;
    },
    stat: (d) => {
      const r = d as ServiceResult;
      return { provider: r.provider, answer: brief(r.data) };
    },
  },
};

export const isVendorTool = (tool: string) => tool in VENDOR_TOOLS;
export const vendorPrice = (r: Pick<ResearchStep, "tool" | "args">) => VENDOR_TOOLS[r.tool].price(r.args);
