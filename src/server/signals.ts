import type { Run } from "@/lib/types";
import { answerOf } from "./dataflow";
import type { CompanyRecord, OtherOdds, PageRead, PhoneCheck, PlaceReviews, ShoppingPrices, WebResults } from "./web-tools";
import type { OraclePrice } from "./onchain";

/**
 * What the answers mean, decided by code. Each rule reads one or two stages' answers and says, the
 * same way every time, whether it's reassuring, worth a second look, or a red flag. The write-up
 * may word these but never contradict or soften them, and every one points to the stages behind it.
 */
export type Signal = { level: "good" | "warn" | "bad"; text: string; evidence: string[] };

/** How a line type reads: "FIXED_LINE" → "landline", "mobile" → "mobile". */
const lineName = (t: string) => (/fixed/i.test(t) ? "landline" : /mobile/i.test(t) ? "mobile" : t.toLowerCase().replace(/_/g, " "));
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const RED_WORDS = /\b(lawsuit|sued|recall|scam|fraud|bankrupt\w*|investigation|layoffs?|shut(s|ting)? down|closure|complaints?|fined|charged)\b/i;

/** The dollar amount someone said they'd pay ("$14,000", "$500"), to compare with what stores charge. */
function askedPrice(text: string): number | undefined {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/.exec(text);
  const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function signalsOf(run: Run): Signal[] {
  const steps = run.proposal?.research ?? [];
  const got = (id: string) => answerOf(run.results?.[id]);
  const done = steps.filter((s) => run.results?.[s.id] !== undefined);
  const of = <T>(tool: string) => done.filter((s) => s.tool === tool).map((s) => ({ id: s.id, label: s.label, data: got(s.id) as T }));
  const out: Signal[] = [];

  // Phone lines: invalid or internet-only numbers are the classic scam sign.
  const phones = of<PhoneCheck>("phone_check");
  for (const p of phones) {
    const line = (p.data.lineType ?? "").toLowerCase();
    if (!p.data.valid) out.push({ level: "bad", text: `${p.data.phone} isn't a working phone number.`, evidence: [p.id] });
    else if (/voip/.test(line)) out.push({ level: "warn", text: `${p.data.formatted ?? p.data.phone} is an internet-only (VoIP) line${p.data.carrier ? ` from ${p.data.carrier}` : ""}: anyone can get one in minutes, so it proves little.`, evidence: [p.id] });
    else if (line) out.push({ level: "good", text: `${p.data.formatted ?? p.data.phone} is a real ${lineName(line)}${p.data.carrier ? ` (${p.data.carrier})` : ""}.`, evidence: [p.id] });
  }

  // The company behind a website: does it exist, and how long has the site been around?
  const companies = of<CompanyRecord>("company_record");
  for (const c of companies) {
    if (!c.data.found) out.push({ level: "warn", text: `No company record exists for ${c.data.domain}.`, evidence: [c.id] });
    if (c.data.domainAgeYears != null && c.data.domainAgeYears < 1) out.push({ level: "bad", text: `${c.data.domain} was registered less than a year ago (${c.data.domainSince}). Scam sites are usually brand new.`, evidence: [c.id] });
    else if (c.data.domainAgeYears != null && c.data.domainAgeYears >= 3) out.push({ level: "good", text: `${c.data.domain} has been registered since ${c.data.domainSince?.slice(0, 4)}, ${c.data.domainAgeYears} years ago.`, evidence: [c.id] });
  }

  // Cross-check: is the number we were given one of the company's own numbers?
  for (const p of phones) {
    for (const c of companies.filter((x) => x.data.phones.length)) {
      const match = c.data.phones.some((x) => digits(x) === digits(p.data.phone));
      out.push(
        match
          ? { level: "good", text: `The number checked matches one of ${c.data.name ?? c.data.domain}'s official phone numbers.`, evidence: [p.id, c.id] }
          : { level: "warn", text: `The number checked isn't one of ${c.data.name ?? c.data.domain}'s official numbers (${c.data.phones.slice(0, 2).join(", ")}). Call the official one to confirm.`, evidence: [p.id, c.id] },
      );
    }
  }

  // Reviews: the average, and how many recent ones are bad.
  for (const r of of<PlaceReviews>("place_reviews")) {
    if (!r.data.found) {
      out.push({ level: "warn", text: `“${r.data.place}” couldn't be found on Google.`, evidence: [r.id] });
      continue;
    }
    const low = r.data.reviews.filter((x) => x.rating > 0 && x.rating <= 2).length;
    if (r.data.average != null && r.data.average < 3.5) out.push({ level: "warn", text: `${r.data.found.name} averages ${r.data.average}★ across its recent reviews.`, evidence: [r.id] });
    else if (r.data.average != null && r.data.average >= 4.3) out.push({ level: "good", text: `${r.data.found.name} averages ${r.data.average}★ across its recent reviews.`, evidence: [r.id] });
    if (low >= 2) out.push({ level: "warn", text: `${low} of its ${r.data.reviews.length} most recent reviews are 1 or 2 stars.`, evidence: [r.id] });
  }

  // Price: is what they were asked far from what stores charge?
  const asked = askedPrice(`${run.task} ${run.proposal?.ask ?? ""}`);
  for (const s of of<ShoppingPrices>("shopping_prices")) {
    const typical = s.data.median;
    if (!typical || !asked) continue;
    const ratio = asked / typical;
    if (ratio < 0.6) out.push({ level: "bad", text: `$${asked.toLocaleString()} is ${Math.round((1 - ratio) * 100)}% below the typical $${Math.round(typical).toLocaleString()}: too good to be true is the most common scam sign.`, evidence: [s.id] });
    else if (ratio > 1.15) out.push({ level: "warn", text: `$${asked.toLocaleString()} is ${Math.round((ratio - 1) * 100)}% above the typical $${Math.round(typical).toLocaleString()}. Worth negotiating.`, evidence: [s.id] });
    else out.push({ level: "good", text: `$${asked.toLocaleString()} is in line with the typical $${Math.round(typical).toLocaleString()}.`, evidence: [s.id] });
  }

  // News: stories about lawsuits, recalls, layoffs or fraud.
  for (const n of of<WebResults>("news_search")) {
    const hits = n.data.results.filter((x) => RED_WORDS.test(`${x.title} ${x.snippet ?? ""}`));
    if (hits.length) out.push({ level: "warn", text: `${hits.length} recent ${hits.length === 1 ? "story mentions" : "stories mention"} trouble, e.g. “${hits[0].title.slice(0, 90)}”.`, evidence: [n.id] });
    else if (n.data.results.length) out.push({ level: "good", text: `None of the ${n.data.results.length} recent stories mention lawsuits, recalls, layoffs or fraud.`, evidence: [n.id] });
  }

  // Before an order: is the same outcome cheaper elsewhere, and how far is the price from the line?
  const order = run.proposal?.action?.kind === "prediction_order" ? run.proposal.action : undefined;
  if (order) {
    const label = order.label ?? "";
    const strike = Number((/\$?([\d,]+(?:\.\d+)?)/.exec(label)?.[1] ?? "").replace(/,/g, ""));
    const words = label.toLowerCase().match(/[><]?\d+\s*bps|hike|cut|maintain\w*/g) ?? [];
    const same = (title: string) => {
      const t = title.toLowerCase().replace(/,/g, "");
      if (Number.isFinite(strike) && strike > 0 && t.includes(String(strike))) return true;
      return words.length > 0 && words.every((w) => t.includes(w.replace(/\s+/g, "")));
    };
    const ours = order.maxPrice;
    for (const o of of<OtherOdds>("market_odds")) {
      const match = o.data.markets.find((m) => same(m.title));
      if (!match || ours == null) continue;
      const gap = Math.round((ours - match.yes) * 100);
      out.push(
        gap > 3
          ? { level: "warn", text: `${match.source} prices the same outcome at ${Math.round(match.yes * 100)}¢; Gemini's ${Math.round(ours * 100)}¢ is ${gap}¢ dearer (“${match.title.slice(0, 70)}”).`, evidence: [o.id] }
          : gap < -3
            ? { level: "good", text: `Gemini's ${Math.round(ours * 100)}¢ is ${-gap}¢ cheaper than ${match.source}'s ${Math.round(match.yes * 100)}¢ for the same outcome.`, evidence: [o.id] }
            : { level: "good", text: `${match.source} prices the same outcome at ${Math.round(match.yes * 100)}¢, in line with Gemini's ${Math.round(ours * 100)}¢.`, evidence: [o.id] },
      );
    }
    for (const p of of<OraclePrice>("oracle_price")) {
      if (!Number.isFinite(strike) || strike <= 0 || !p.data.price) continue;
      const away = (strike - p.data.price) / p.data.price;
      const where = `${p.data.description ?? "The price"} is $${Math.round(p.data.price).toLocaleString()} on Chainlink`;
      if (away > 0.1) out.push({ level: "warn", text: `${where}, ${Math.round(away * 100)}% short of the $${strike.toLocaleString()} line: a long shot.`, evidence: [p.id] });
      else if (away > 0) out.push({ level: "good", text: `${where}, ${(away * 100).toFixed(1)}% short of the $${strike.toLocaleString()} line.`, evidence: [p.id] });
      else out.push({ level: "good", text: `${where}, already above the $${strike.toLocaleString()} line.`, evidence: [p.id] });
    }
  }

  // A website with almost nothing on it.
  for (const p of of<PageRead>("read_page")) if (p.data.words < 60) out.push({ level: "warn", text: `${new URL(p.data.url).hostname} has almost no content (${p.data.words} words).`, evidence: [p.id] });

  return out;
}
