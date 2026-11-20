/**
 * Requests no service in this app can ever carry out. They never become a job: the ask screen says
 * so in one plain sentence and offers close things that do work. Checked by code, before any model
 * call, so the answer is instant and the same every time.
 */
export interface NotPossible {
  /** "Agento can't search or book flights." */
  what: string;
  /** Close things it can do, ready to ask. */
  instead: string[];
}

const TRIP = ["Plan a drive from Austin to Denver in 3 days", "Find hotels near Bend, Oregon"];
const MONEY = ["What are BTC odds right now?", "What's the gas price on Base right now?"];

const RULES: { re: RegExp; what: string; instead: string[]; /** Possible on Arc mainnet, where paid search, reviews and checks run. */ mainnetOk?: boolean }[] = [
  { re: /\b(flights?|airfare|plane tickets?|airlines?)\b/i, what: "Agento can't search or book flights.", instead: TRIP },
  {
    re: /\b(book|reserve|reservation)\b[^.?!]{0,40}\b(hotels?|rooms?|stays?|airbnb|motels?|tables?|restaurants?|dinner|lunch|rides?|uber|lyft|taxi|cab|cars?|trains?|bus|tickets?|seats?)\b|\b(get|call|order|send) me an? (uber|lyft|taxi|cab|ride)\b|\bbuy\b[^.?!]{0,20}\b(concert|game|show|event|movie|plane|train|bus) tickets?\b/i,
    what: "Agento can't book or buy hotels, tables, rides or tickets.",
    instead: TRIP,
  },
  { re: /\b(search the web|search online|google it|browse the web|latest news|news (about|on))\b/i, what: "Agento can't search the web or read the news.", instead: MONEY, mainnetOk: true },
  { re: /\breviews?\b/i, what: "Agento can't read reviews.", instead: TRIP, mainnetOk: true },
  {
    re: /\b(scam|scammer|legit|fraud(ulent)?)\b|\bis (this|that|it) (website|site|seller|number|listing|store|shop|link)\b[^.?!]*\b(safe|real|trustworthy|genuine)\b/i,
    what: "Agento can't check whether a website, seller or phone number is safe.",
    instead: MONEY,
    mainnetOk: true,
  },
  { re: /\bweather (forecast|risk|report)\b|\bwill it (rain|snow)\b|\b(rain|snow) (tomorrow|today|tonight|this weekend)\b/i, what: "Agento can't give weather forecasts. It can show what the temperature markets expect.", instead: ["What do the markets expect for New York's temperature tomorrow?", ...TRIP.slice(0, 1)] },
  { re: /\b(call|phone|text|email|message) (the |my |a )?(landlord|seller|restaurant|hotel|business|them|him|her|someone)\b/i, what: "Agento can't make calls or send messages for you.", instead: TRIP },
];

/** Splits a request into its parts ("…, then …", "… and book …"). Kept in step with the planner's split. */
const parts = (text: string) =>
  text
    .split(/\s*(?:,?\s*(?:and\s+)?then\s+|;\s*|\.\s+(?:then\s+)?|,\s*and\s+(?=(?:plan|book|buy|sell|drive|get|find)\b))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

/**
 * Whether the whole request is impossible here. A request with several parts goes through when any
 * part can be done: the plan names the parts it can't do instead of refusing everything.
 */
export function notPossible(text: string, opts: { mainnet?: boolean } = {}): NotPossible | null {
  const ps = parts(text);
  const hits = (ps.length ? ps : [text]).map((p) => RULES.find((r) => r.re.test(p) && !(opts.mainnet && r.mainnetOk)));
  if (hits.some((h) => !h)) return null;
  const h = hits[0]!;
  return { what: h.what, instead: h.instead };
}
