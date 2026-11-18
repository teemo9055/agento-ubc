import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Hex } from "viem";
import { z } from "zod";
import { refundSale } from "../refunds";
import { all, put } from "./db";
import { getItem, listItems, ROUTE_LABEL, updateItem, waiting, type HallItem } from "./hall";
import { allPosts, getPost, savePost } from "./boards";
import { allListings, getListing, saveListing, submitListing } from "./listings";
import { publishEntry, SECTIONS, type Section } from "./library";

/**
 * The admin side of the town: one key (ADMIN_KEY), every decision logged with who, when and what.
 * Refunds go through the app's one refund path (refundSale), never a separate transfer.
 */
export function adminCheck(headers: Headers): { ok: true; who: string } | { ok: false; status: number; reason: string } {
  const want = process.env.ADMIN_KEY;
  if (!want) return { ok: false, status: 503, reason: "Admin is turned off on this server. Set ADMIN_KEY to use it." };
  const got = Buffer.from(headers.get("x-admin-key") ?? "");
  const key = Buffer.from(want);
  if (got.length !== key.length || !timingSafeEqual(got, key)) return { ok: false, status: 401, reason: "That admin key isn't right." };
  const who = (headers.get("x-admin-name") ?? "").replace(/[^\w .@-]/g, "").trim().slice(0, 40) || "admin";
  return { ok: true, who };
}

export interface LogEntry {
  id: string;
  at: string;
  who: string;
  action: string;
  target: string;
  detail?: string;
}

function log(who: string, action: string, target: string, detail?: string) {
  const e: LogEntry = { id: randomUUID(), at: new Date().toISOString(), who, action, target, detail };
  put("town_log", e, e.at);
  return e;
}
export const adminLog = (limit = 100) => all<LogEntry>("town_log", limit);

const Id = z.string().regex(/^[A-Za-z0-9]{4,16}$/);
const PostId = z.string().regex(/^[a-f0-9-]{6,40}$/);
const Reason = z.string().trim().min(3, "Give a short reason").max(200);

export const AdminAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refund"), itemId: Id }),
  z.object({ action: z.literal("spam"), itemId: Id }),
  z.object({ action: z.literal("abandon"), itemId: Id, reason: Reason }),
  z.object({ action: z.literal("route"), itemId: Id, to: z.array(z.enum(["lab", "forum"])).min(1).max(2) }),
  z.object({
    action: z.literal("accept"),
    postId: PostId,
    section: z.enum(Object.keys(SECTIONS) as [Section, ...Section[]]).default("practices"),
    title: z.string().trim().min(3).max(80),
    /** Update this Library entry instead of adding a new one. */
    entryId: z.string().regex(/^[a-z0-9-]{2,60}$/).optional(),
  }),
  z.object({ action: z.literal("trust"), postId: PostId }),
  z.object({ action: z.literal("approve-listing"), listingId: PostId }),
  z.object({ action: z.literal("reject-listing"), listingId: PostId, reason: Reason }),
]);
export type AdminAction = z.input<typeof AdminAction>;

type Result = { ok: true; message: string } | { ok: false; status: number; reason: string };
const no = (status: number, reason: string): Result => ({ ok: false, status, reason });

export async function act(input: AdminAction, who: string, opts: { pay?: (to: Hex, amount: bigint) => Promise<string | undefined> } = {}): Promise<Result> {
  const a = AdminAction.parse(input);
  switch (a.action) {
    case "refund": {
      const item = getItem(a.itemId);
      if (!item) return no(404, "No item with that id");
      if (item.deposit.state === "refunded") return no(409, "Its deposit was already refunded");
      if (item.deposit.state !== "held" || !item.deposit.saleId) return no(409, "Its deposit isn't held, so there is nothing to refund");
      if (item.state === "spam") return no(409, "It was marked as spam, so its deposit is kept");
      const r = await refundSale(item.deposit.saleId, "Town Hall: not spam", { pay: opts.pay });
      if (!r.ok) return no(r.status, r.reason);
      updateItem(
        item.id,
        (i) => {
          i.deposit = { ...i.deposit, state: "refunded", refundTx: r.refundTx };
        },
        r.practice ? "Practice deposit refunded (no money moved)" : "$1 deposit refunded",
      );
      log(who, "refund", item.id, r.practice ? "practice, no transfer" : `tx ${r.refundTx ?? "?"}`);
      return { ok: true, message: r.practice ? "Practice deposit marked refunded" : "Refunded $1" };
    }
    case "spam": {
      const item = getItem(a.itemId);
      if (!item) return no(404, "No item with that id");
      if (item.deposit.state !== "held") return no(409, item.deposit.state === "refunded" ? "Its deposit was already refunded" : "Its deposit isn't held");
      updateItem(
        item.id,
        (i) => {
          i.state = "spam";
          i.deposit = { ...i.deposit, state: "kept" };
        },
        "Marked as spam; the $1 deposit is kept",
      );
      log(who, "spam", item.id);
      return { ok: true, message: "Marked as spam; deposit kept" };
    }
    case "abandon": {
      const item = getItem(a.itemId);
      if (!item) return no(404, "No item with that id");
      if (item.state === "spam" || item.state === "answered") return no(409, `It is already ${item.state}`);
      updateItem(
        item.id,
        (i) => {
          i.state = "abandoned";
          i.reason = a.reason;
        },
        `Set aside: ${a.reason}`,
      );
      log(who, "abandon", item.id, a.reason);
      return { ok: true, message: "Set aside" };
    }
    case "route": {
      const item = getItem(a.itemId);
      if (!item) return no(404, "No item with that id");
      if (item.deposit.state === "awaiting") return no(409, "Its deposit hasn't arrived");
      if (item.state === "spam" || item.state === "abandoned") return no(409, `It was ${item.state === "spam" ? "marked as spam" : "set aside"}`);
      const to = a.to.filter((r) => !item.routes.includes(r));
      if (!to.length) return no(409, "It is already there");
      updateItem(
        item.id,
        (i) => {
          i.routes = [...i.routes, ...to];
          if (i.state === "received") i.state = "routed";
        },
        `Routed to the ${to.map((r) => ROUTE_LABEL[r]).join(" and the ")}`,
      );
      log(who, "route", item.id, to.join("+"));
      return { ok: true, message: `Routed to ${to.map((r) => ROUTE_LABEL[r]).join(" and ")}` };
    }
    case "accept": {
      const post = getPost(a.postId);
      if (!post || post.board !== "lab" || post.kind !== "solution") return no(404, "No Lab solution with that id");
      if (post.state !== "open") return no(409, "It was already accepted");
      const item = getItem(post.itemId);
      if (!item) return no(404, "Its request is gone");
      const entry = publishEntry({ id: a.entryId, section: a.section, title: a.title, body: post.text, credit: { itemId: item.id, postId: post.id, from: post.from } });
      savePost({ ...post, state: "accepted", libraryId: entry.id });
      updateItem(
        item.id,
        (i) => {
          i.state = "answered";
          i.answer = { ...i.answer, libraryId: entry.id, at: new Date().toISOString() };
        },
        `Answered: published to the Library as “${entry.title}”`,
      );
      log(who, "accept", post.id, `library ${entry.id} for ${item.id}`);
      return { ok: true, message: `Published to the Library: ${entry.title}` };
    }
    case "trust": {
      const post = getPost(a.postId);
      if (!post || post.board !== "forum" || post.kind !== "offer" || !post.url) return no(404, "No Forum offer with that id");
      if (post.state !== "open") return no(409, "It was already handled");
      const item = getItem(post.itemId);
      const listing = submitListing(
        { name: (post.from || new URL(post.url).host).slice(0, 60), description: post.text.slice(0, 300).padEnd(10, "."), url: post.url, priceUsd: post.priceUsd, network: "Arc testnet", seller: (post.from || new URL(post.url).host).slice(0, 60) },
        post.by,
        { source: "forum", itemId: post.itemId, status: "approved" },
      );
      saveListing({ ...listing, reviewedAt: new Date().toISOString() });
      savePost({ ...post, state: "trusted", listingId: listing.id });
      if (item)
        updateItem(
          item.id,
          (i) => {
            i.state = "answered";
            i.answer = { ...i.answer, listingId: listing.id, at: new Date().toISOString() };
          },
          "Answered: a vendor's offer is now listed in the Store",
        );
      log(who, "trust", post.id, `listing ${listing.id}`);
      return { ok: true, message: "Vendor trusted and listed in the Store as independent" };
    }
    case "approve-listing":
    case "reject-listing": {
      const l = getListing(a.listingId);
      if (!l) return no(404, "No listing with that id");
      if (l.status !== "pending") return no(409, `It was already ${l.status}`);
      const approved = a.action === "approve-listing";
      saveListing({ ...l, status: approved ? "approved" : "rejected", reviewedAt: new Date().toISOString(), reason: approved ? undefined : a.reason });
      log(who, a.action, l.id, approved ? l.url : a.reason);
      return { ok: true, message: approved ? "Listed in the Store" : "Not listed" };
    }
  }
}

/** Everything the admin inbox shows, newest first. */
export function inbox() {
  const items = listItems();
  const posts = allPosts();
  const label = (i: HallItem) => ({ ...i, posts: posts.filter((p) => p.itemId === i.id).length });
  return {
    waiting: items.filter(waiting).map(label),
    others: items.filter((i) => !waiting(i)).map(label),
    solutions: posts.filter((p) => p.board === "lab" && p.kind === "solution" && p.state === "open"),
    offers: posts.filter((p) => p.board === "forum" && p.kind === "offer" && p.state === "open"),
    listings: allListings().filter((l) => l.status === "pending"),
    log: adminLog(),
  };
}
