import { createHash } from "node:crypto";

/**
 * Did a paid answer arrive? A small, fixed set of tests that only check what a seller promised
 * in its listing before the sale, so a buyer and a seller running them on the same answer always
 * agree. It never judges whether an answer is good, useful or what the agent hoped for.
 */
export type DeliveryTest = "answered" | "readable" | "complete" | "about" | "fresh";

export type DeliveryVerdict = { ok: true } | { ok: false; test: DeliveryTest; reason: string };

/** What a seller promises about its answers. Published with each listing. */
export interface DeliveryPromise {
  /** Fields every answer has (checked on the object, or on the first item of a list). */
  fields?: string[];
  /** The answer is a list. An empty list is a real answer ("nothing matched"), not a failure. */
  list?: boolean;
  /** "Not found" (null) is a real answer for this product. */
  nullable?: boolean;
  /** The answer's own age (`ageMinutes` or `updatedAt`) is at most this many minutes. */
  maxAgeMin?: number;
}

/** The plain names of the tests, for receipts and the published policy. */
export const TEST_LABEL: Record<DeliveryTest, string> = {
  answered: "An answer came back",
  readable: "The answer is readable data, not an error",
  complete: "It has every field the listing promises",
  about: "It is about what was asked (same coin, market, chain or address)",
  fresh: "It is no older than the listing says",
};

/** Keys whose value in the request must match the same key in the answer, when the answer names one. */
const ABOUT = ["symbol", "ticker", "chain", "address"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkDelivery(data: unknown, promise: DeliveryPromise = {}, asked: Record<string, string> = {}, now = Date.now()): DeliveryVerdict {
  if (data === undefined) return { ok: false, test: "answered", reason: "Nothing came back after payment" };
  if (data === null) return promise.nullable ? { ok: true } : { ok: false, test: "readable", reason: "The answer was empty" };
  if (typeof data === "string") return data.trim() ? { ok: false, test: "readable", reason: "The answer was text, not data" } : { ok: false, test: "readable", reason: "The answer was empty" };
  if (isObj(data)) {
    if (Object.keys(data).length === 0) return { ok: false, test: "readable", reason: "The answer was empty" };
    const err = data.error;
    if (err && Object.keys(data).length <= 3 && (typeof err === "string" || isObj(err))) return { ok: false, test: "readable", reason: "The answer was an error message" };
  }
  if (promise.list && !Array.isArray(data)) return { ok: false, test: "complete", reason: "The listing promises a list" };
  const first = Array.isArray(data) ? data[0] : data;
  if (promise.fields?.length && first !== undefined) {
    if (!isObj(first)) return { ok: false, test: "complete", reason: "The answer isn't the kind of data the listing promises" };
    const missing = promise.fields.filter((f) => first[f] === undefined || first[f] === null);
    if (missing.length) return { ok: false, test: "complete", reason: `Missing ${missing.join(", ")}` };
  }
  if (isObj(data)) {
    for (const k of ABOUT) {
      const want = asked[k];
      const got = data[k];
      if (want && typeof got === "string" && got.toLowerCase() !== want.toLowerCase()) return { ok: false, test: "about", reason: `Asked about ${want}, got ${got}` };
    }
    if (promise.maxAgeMin != null) {
      const age = typeof data.ageMinutes === "number" ? data.ageMinutes : typeof data.updatedAt === "string" ? (now - Date.parse(data.updatedAt)) / 60_000 : null;
      if (age != null && Number.isFinite(age) && age > promise.maxAgeMin) return { ok: false, test: "fresh", reason: `${Math.round(age)} minutes old; the listing promises at most ${promise.maxAgeMin}` };
    }
  }
  return { ok: true };
}

/** A fingerprint of an answer, so buyer and seller can show they are talking about the same bytes. */
export const answerHash = (data: unknown) => createHash("sha256").update(JSON.stringify(data ?? null)).digest("hex");

/** Thrown by a paid lookup when the seller was paid but its answer failed a test. */
export class DeliveryError extends Error {
  constructor(
    public verdict: Extract<DeliveryVerdict, { ok: false }>,
    public data?: unknown,
  ) {
    super(verdict.reason);
  }
}

/** Thrown when a payment was signed but the answer was lost on the way (a timeout or dropped connection). It may still settle. */
export class MaybeChargedError extends Error {}

/**
 * Promises for the lookups bought from outside vendors. Chainlink feeds update at least once a
 * day (some hourly); an answer older than a day and an hour means the feed has stopped.
 */
export const VENDOR_PROMISES: Record<string, DeliveryPromise> = {
  oracle_price: { fields: ["price", "updatedAt"], maxAgeMin: 25 * 60 },
  gas_price: { fields: ["gwei"] },
  btc_network: { fields: ["feeSatVb"] },
  wallet_balance: { fields: ["address"] },
};
