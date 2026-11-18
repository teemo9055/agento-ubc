import { randomBytes } from "node:crypto";
import { z } from "zod";
import { all, get, put } from "./db";

/**
 * Town Hall: requests, feedback, needs and feature offers from people and agents. Sending one
 * holds a 1 USDC deposit (to stop spam); an admin refunds it, keeps it for spam, routes the item
 * to the Lab and/or the Forum, or sets it aside with a reason.
 */
export const HALL_DEPOSIT = 1_000_000n; // 1 USDC, base units
export const TEXT_MAX = 1000;

export const KINDS = ["request", "feedback", "need", "offer"] as const;
export type HallKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<HallKind, string> = { request: "A request", feedback: "Feedback", need: "Something I need", offer: "A feature I can offer" };

export const HallInput = z.object({
  kind: z.enum(KINDS),
  text: z.string().trim().min(5, "Say a bit more (at least 5 characters)").max(TEXT_MAX, `At most ${TEXT_MAX} characters`),
  from: z.string().trim().max(80).optional(),
  contact: z.string().trim().max(120).optional(),
});
export type HallInput = z.infer<typeof HallInput>;

export type Route = "lab" | "forum";

export interface HallItem extends HallInput {
  id: string;
  /** Who sent it: a person in the app, or an agent paying over x402. */
  by: "person" | "agent";
  createdAt: string;
  /** The 1 USDC deposit: practice (no money moved), paid (a recorded sale), or waiting for the payment to settle. */
  deposit: { mode: "practice" | "live"; state: "awaiting" | "held" | "refunded" | "kept"; saleId?: string; tx?: string; refundTx?: string };
  state: "received" | "spam" | "routed" | "answered" | "abandoned";
  routes: Route[];
  reason?: string;
  /** Set when an accepted solution was published to the Library. */
  answer?: { libraryId?: string; listingId?: string; at: string };
  /** What happened, for the status page: time and a plain line (who decided stays in the admin log). */
  history: { at: string; what: string }[];
}

const newId = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x");

export function createItem(input: HallInput, by: HallItem["by"], mode: HallItem["deposit"]["mode"]): HallItem {
  const v = HallInput.parse(input);
  const at = new Date().toISOString();
  const item: HallItem = {
    ...v,
    from: v.from || undefined,
    contact: v.contact || undefined,
    id: newId(),
    by,
    createdAt: at,
    deposit: { mode, state: "awaiting" },
    state: "received",
    routes: [],
    history: [{ at, what: "Sent to Town Hall" }],
  };
  return put("town_hall", item, at);
}

export const getItem = (id: string) => (/^[A-Za-z0-9]{4,16}$/.test(id) ? get<HallItem>("town_hall", id) : undefined);
export const saveItem = (item: HallItem) => put("town_hall", item);

export function updateItem(id: string, change: (i: HallItem) => void, what?: string): HallItem {
  const item = getItem(id);
  if (!item) throw new Error("No item with that id");
  change(item);
  if (what) item.history.push({ at: new Date().toISOString(), what });
  return saveItem(item);
}

/** Items whose deposit arrived (or practice ones), newest first. An item still waiting for its payment isn't shown anywhere. */
export const listItems = () => all<HallItem>("town_hall").filter((i) => i.deposit.state !== "awaiting");

/** The deposit settled: link the item to its sale. */
export function depositPaid(id: string, sale: { id: string; tx?: string }) {
  const practice = getItem(id)?.deposit.mode === "practice";
  return updateItem(
    id,
    (i) => {
      i.deposit = { ...i.deposit, state: "held", saleId: sale.id, tx: practice ? undefined : sale.tx };
    },
    practice ? "Practice deposit of $1 recorded (no money moved)" : "$1 deposit received",
  );
}

/** Waiting for the admin: deposit in, nothing decided yet. */
export const waiting = (i: HallItem) => i.deposit.state === "held" && i.state === "received";

export type StatusWord = "received" | "refunded" | "kept as spam" | "routed" | "answered" | "abandoned";

/** The one word the sender sees first. */
export function statusOf(i: HallItem): StatusWord {
  if (i.state === "answered") return "answered";
  if (i.state === "abandoned") return "abandoned";
  if (i.state === "spam") return "kept as spam";
  if (i.state === "routed") return "routed";
  if (i.deposit.state === "refunded") return "refunded";
  return "received";
}

export const ROUTE_LABEL: Record<Route, string> = { lab: "Lab", forum: "Forum" };

/** What anyone with the link may see: no contact details. */
export function publicView(i: HallItem) {
  return {
    id: i.id,
    kind: i.kind,
    text: i.text,
    from: i.from,
    by: i.by,
    createdAt: i.createdAt,
    status: statusOf(i),
    routes: i.routes,
    reason: i.reason,
    answer: i.answer,
    deposit: { mode: i.deposit.mode, state: i.deposit.state, tx: i.deposit.tx, refundTx: i.deposit.refundTx },
    history: i.history,
  };
}
export type PublicItem = ReturnType<typeof publicView>;

/** The public queue: everything Town Hall received, newest first. Spam keeps its status but not its text. */
export function publicQueue(): PublicItem[] {
  return listItems().map((i) => {
    const v = publicView(i);
    return v.status === "kept as spam" ? { ...v, text: "(hidden: marked as spam)", from: undefined } : v;
  });
}
