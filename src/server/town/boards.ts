import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, get, put } from "./db";
import { getItem, listItems, publicView, type HallItem, type Route } from "./hall";
import type { LabStage } from "./sections";

/**
 * The Lab and the Forum: boards of items Town Hall routed there. People and agents post on an item:
 * findings and possible solutions in the Lab; solutions and offers of a service in the Forum.
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .url("Give a full web address")
  .refine((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && !x.username && !x.password;
    } catch {
      return false;
    }
  }, "The address must start with https://");

export const PostInput = z
  .object({
    itemId: z.string().regex(/^[A-Za-z0-9]{4,16}$/),
    board: z.enum(["lab", "forum"]),
    kind: z.enum(["finding", "solution", "offer"]),
    text: z.string().trim().min(5, "Say a bit more (at least 5 characters)").max(1000, "At most 1000 characters"),
    from: z.string().trim().max(80).optional(),
    /** For a Forum offer: the service's x402 address. */
    url: httpsUrl.optional(),
    priceUsd: z.number().min(0).max(1000).optional(),
  })
  .refine((p) => (p.board === "lab" ? p.kind !== "offer" : p.kind !== "finding"), { message: "The Lab takes findings and solutions; the Forum takes solutions and offers" })
  .refine((p) => p.kind !== "offer" || Boolean(p.url), { message: "An offer needs the service's https address" });
export type PostInput = z.infer<typeof PostInput>;

export interface Post extends PostInput {
  id: string;
  by: "person" | "agent";
  createdAt: string;
  state: "open" | "accepted" | "trusted";
  /** Library entry it became, or the Store listing it became. */
  libraryId?: string;
  listingId?: string;
}

const open = (i: HallItem, board: Route) => i.routes.includes(board) && (i.state === "routed" || i.state === "answered");

export function addPost(input: PostInput, by: Post["by"]): Post {
  const v = PostInput.parse(input);
  const item = getItem(v.itemId);
  if (!item || !open(item, v.board)) throw new Error(`That item isn't on the ${v.board === "lab" ? "Lab" : "Forum"} board`);
  const post: Post = { ...v, from: v.from || undefined, id: randomUUID().slice(0, 12), by, createdAt: new Date().toISOString(), state: "open" };
  return put("town_posts", post);
}

export const getPost = (id: string) => get<Post>("town_posts", id);
export const savePost = (p: Post) => put("town_posts", p);
export const allPosts = () => all<Post>("town_posts");

/** One board: its items (oldest question first is less useful; newest first) with their posts, oldest post first. */
export function board(which: Route) {
  const posts = allPosts().filter((p) => p.board === which);
  return listItems()
    .filter((i) => open(i, which))
    .map((i) => ({ item: publicView(i), posts: posts.filter((p) => p.itemId === i.id).reverse() }));
}

export type BoardRow = ReturnType<typeof board>[number];

/** One item on a board, with its posts: a thread. */
export function thread(which: Route, id: string): BoardRow | undefined {
  return board(which).find((r) => r.item.id === id);
}

/**
 * Where a Lab item stands, from what is stored: nothing posted yet, findings only, a solution
 * waiting for the admin, answered another way (a Store vendor), or written into the Library.
 */
export { LAB_STAGES, type LabStage } from "./sections";

export function labStage(r: BoardRow): LabStage {
  if (r.item.answer?.libraryId) return "published";
  if (r.item.status === "answered") return "accepted";
  if (r.posts.some((p) => p.kind === "solution" && p.state === "open")) return "proposed";
  if (r.posts.length) return "investigating";
  return "routed";
}

/** The newest thing that happened on a thread. */
export const lastActivity = (r: BoardRow) => [r.item.createdAt, ...r.item.history.map((h) => h.at), ...r.posts.map((p) => p.createdAt)].sort().at(-1)!;
