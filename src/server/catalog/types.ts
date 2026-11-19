/**
 * The capability map: every listing on Circle's Agent Marketplace, with what it takes, what it gives
 * back, its price, where it can be paid and how reliably it has delivered. Types come from a fixed
 * vocabulary so a planner written in code can match one service's outputs to another's inputs.
 */

/** A fixed vocabulary, so a planner written in code can match outputs to inputs. Extend with care. */
export const IO_TYPES = [
  "text_query",
  "person_name",
  "company_name",
  "phone",
  "email",
  "domain",
  "url",
  "image_url",
  "address",
  "place",
  "geo",
  "country",
  "date",
  "product_name",
  "listing_url",
  "price",
  "wallet_address",
  "tx_hash",
  "chain",
  "token_symbol",
  "ticker",
  "currency_pair",
  "reviews",
  "risk_signal",
  "identity_signal",
  "company_record",
  "web_results",
  "news",
  "price_quote",
  "route",
  "weather",
  "document",
  "verdict",
  "any",
] as const;
export type IoType = (typeof IO_TYPES)[number];

export const isIoType = (t: unknown): t is IoType => typeof t === "string" && (IO_TYPES as readonly string[]).includes(t);

export interface CapabilityInput {
  field: string;
  type: IoType;
  required: boolean;
  /** Not in a published schema: guessed from the description, so its name may not be the real one. */
  guessed?: boolean;
}
export interface CapabilityOutput {
  /** Where the value sits in the answer, e.g. "carrier.type". Empty for the whole answer. */
  path: string;
  type: IoType;
  label: string;
}

export interface Capability {
  /** The listing's URL; primary key. */
  resource: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  priceUsd: number | null;
  networks: string[];
  /** Payable on the current pay network through Gateway. */
  payableNow: boolean;
  /** Payable on Arc mainnet through Gateway. */
  payableMainnet: boolean;
  /** Who is paid on the current pay network, from the listing (strikes are kept per payee). */
  payTo?: string;
  /**
   * Only reads something. A listing that sends, buys, books, calls or changes something is kept in
   * the map (so the app can say it exists) but is never put in a plan.
   */
  readOnly: boolean;
  inputs: CapabilityInput[];
  outputs: CapabilityOutput[];
  /** 2-5 plain questions it answers ("Is this phone number a VoIP line?"). */
  answers: string[];
  /** Over name + description + answers, when an embedding model is available. */
  embedding?: number[];
  /** "rules" (code only) or "ai" (rules, then the model filled the rest). */
  taggedBy: "rules" | "ai";
  taggedAt: string;
  /** Re-tag only when the listing changes. */
  schemaHash: string;
}

export interface Reliability {
  resource: string;
  delivered: number;
  failed: number;
  lastFailAt?: string;
}

/** A listing as the crawler sees it, schemas included. */
export interface RawListing {
  resource: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  method: Capability["method"];
  priceUsd: number | null;
  networks: string[];
  payableNow: boolean;
  payableMainnet: boolean;
  payTo?: string;
  /** The listing's own input schema (query params or body), as published. */
  input?: unknown;
  /** The listing's own output schema, when it publishes one. */
  output?: unknown;
}
