"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import type { Post } from "@/server/town/boards";
import type { threadJson } from "@/server/town/format";
import { LAB_STAGES, type LabStage } from "@/server/town/sections";
import { KIND_LABEL, StatusPill, inputCls, when } from "./bits";
import { PLACES } from "./places";

type Which = "lab" | "forum";
export type Thread = ReturnType<typeof threadJson>;

const KINDS: Record<Which, { id: Post["kind"]; label: string }[]> = {
  lab: [
    { id: "finding", label: "A finding" },
    { id: "solution", label: "A possible solution" },
  ],
  forum: [
    { id: "solution", label: "A solution" },
    { id: "offer", label: "I sell a service for this" },
  ],
};
export const POST_LABEL: Record<Post["kind"], string> = { finding: "Finding", solution: "Solution", offer: "Offer" };

/** Add a post to a thread: a finding or solution in the Lab; a solution or an offer in the Forum. */
export function Reply({ which, itemId, onDone }: { which: Which; itemId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Post["kind"]>(KINDS[which][0].id);
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <Button variant="ghost" className="h-9" onClick={() => setOpen(true)}>
        {which === "lab" ? "Add a finding or solution" : "Propose a solution or offer"}
      </Button>
    );
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/town/${which}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, kind, text, from: from || undefined, url: kind === "offer" ? url : undefined, priceUsd: kind === "offer" && price !== "" ? Number(price) : undefined }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "Couldn't post it");
      setOpen(false);
      setText("");
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} className="space-y-2.5 rounded-xl border border-line bg-surface p-3">
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">What are you adding?</legend>
        {KINDS[which].map((k) => (
          <label key={k.id} className={`inline-flex h-8 cursor-pointer items-center rounded-md border px-2.5 text-[12.5px] font-medium has-[:focus-visible]:outline-2 ${kind === k.id ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2"}`}>
            <input type="radio" className="sr-only" checked={kind === k.id} onChange={() => setKind(k.id)} name={`kind-${itemId}`} />
            {k.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-[13px] font-medium">
        {kind === "offer" ? "What your service does for this" : "What you found or propose"}
        <textarea required minLength={5} maxLength={1000} rows={3} value={text} onChange={(e) => setText(e.target.value)} className={`mt-1 ${inputCls}`} data-testid="reply-text" />
      </label>
      {kind === "offer" && (
        <div className="grid gap-2.5 sm:grid-cols-[1fr_140px]">
          <label className="text-[13px] font-medium">
            Its web address (https)
            <input required type="url" pattern="https://.*" maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} className={`mt-1 font-mono ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium">
            Price, dollars
            <input type="number" min={0} max={1000} step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} className={`mt-1 ${inputCls}`} />
          </label>
        </div>
      )}
      <label className="block text-[13px] font-medium">
        Your name or your agent&apos;s <span className="font-normal text-ink-3">(optional)</span>
        <input maxLength={80} value={from} onChange={(e) => setFrom(e.target.value)} className={`mt-1 ${inputCls}`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy} className="h-9">
          {busy && <Spinner />} Post
        </Button>
        <Button type="button" variant="quiet" className="h-9" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {err && (
          <p role="alert" className="text-[13px] text-bad">
            {err}
          </p>
        )}
      </div>
    </form>
  );
}

/** Reads a board's threads: the same JSON its "For agents" view shows. */
function useThreads(which: Which) {
  const [rows, setRows] = useState<Thread[] | null>(null);
  const load = useCallback(
    () =>
      fetch(`/api/town/${which}?format=json`)
        .then((r) => r.json())
        .then((j) => setRows(j.threads))
        .catch(() => setRows([])),
    [which],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return rows;
}

function Empty({ which }: { which: Which }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#d5d4ce] bg-panel/60 p-6 text-center text-sm text-ink-2">
      Nothing here yet. Requests arrive once an admin at{" "}
      <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
        Town Hall
      </Link>{" "}
      sends them to the {which === "lab" ? "Lab" : "Forum"}.
    </p>
  );
}

const Loading = () => (
  <p className="flex items-center gap-2 text-[13px] text-ink-3">
    <Spinner /> Opening the board…
  </p>
);

const STAGE_TONE: Record<LabStage, string> = { routed: "#f4f3ef", investigating: "#e9f0fb", proposed: "#fff6df", accepted: "#fdf0ea", published: "#e6f6ed" };

/** The Lab as a research board: one column per stage, a card per request. */
export function LabBoard() {
  const rows = useThreads("lab");
  if (!rows) return <Loading />;
  return (
    <div className="space-y-3">
      {!rows.length && <Empty which="lab" />}
      <div className="-mx-1 overflow-x-auto px-1 pb-2" data-testid="lab-board">
        <ol className="grid min-w-[1000px] grid-cols-5 gap-3" aria-label="Research board">
          {LAB_STAGES.map((st) => {
            const list = rows.filter((r) => r.stage === st.id);
            return (
              <li key={st.id} className="flex min-h-[220px] flex-col rounded-2xl border border-line" style={{ background: STAGE_TONE[st.id] }} data-testid={`lab-col-${st.id}`}>
                <div className="px-3 pb-2 pt-3">
                  <h2 className="flex items-center justify-between gap-2 font-pixel text-[12.5px]">
                    {st.label}
                    <span className="num rounded-[4px] border-[1.5px] border-ink bg-panel px-1.5 font-sans text-[11px] font-bold">{list.length}</span>
                  </h2>
                  <p className="mt-1 text-[12px] leading-snug text-ink-2">{st.means}</p>
                </div>
                <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {list.map((t) => (
                    <li key={t.id}>
                      <Link href={`/town/lab/${t.id}`} className="pix-lift block rounded-xl border border-line bg-panel p-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{KIND_LABEL[t.kind]}</span>
                        <span className="mt-0.5 line-clamp-3 block text-[13.5px] leading-snug">{t.text}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3" suppressHydrationWarning>
                          <span>
                            {t.replies} {t.replies === 1 ? "post" : "posts"}
                          </span>
                          <span>· {when(t.updatedAt)}</span>
                        </span>
                        {t.answer?.libraryId && <span className="mt-1.5 inline-block rounded bg-good/10 px-1.5 py-0.5 text-[11px] font-semibold text-good">In the Library</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** The Forum as a message board: one row per thread, newest activity first, offers highlighted. */
export function ForumBoard() {
  const rows = useThreads("forum");
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty which="forum" />;
  const sorted = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel" aria-label="Threads" data-testid="forum-board">
      <div className="hidden grid-cols-[minmax(0,1fr)_80px_80px_130px] gap-3 border-b border-[#f1f0ec] bg-[#fbfaf7] px-5 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 sm:grid">
        <span>Thread</span>
        <span className="text-right">Replies</span>
        <span className="text-right">Offers</span>
        <span className="text-right">Last activity</span>
      </div>
      <ul className="divide-y divide-[#f1f0ec]">
        {sorted.map((t) => (
          <li key={t.id}>
            <Link
              href={`/town/forum/${t.id}`}
              className="grid gap-1 border-l-4 px-4 py-3 hover:bg-ink/[0.02] sm:grid-cols-[minmax(0,1fr)_80px_80px_130px] sm:items-center sm:gap-3 sm:px-5"
              style={{ borderLeftColor: t.offers ? PLACES.forum.color : "transparent" }}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#8a3a17]" style={{ background: PLACES.forum.soft }}>
                    {KIND_LABEL[t.kind]}
                  </span>
                  {t.offers > 0 && <span className="rounded-md bg-warn/25 px-1.5 py-0.5 text-[11px] font-semibold text-warn-ink">{t.offers === 1 ? "An offer" : `${t.offers} offers`}</span>}
                  {t.listedInStore && <span className="rounded-md bg-[#e6effb] px-1.5 py-0.5 text-[11px] font-semibold text-[#1d4fa8]">Listed in the Store</span>}
                  {t.status === "answered" && <StatusPill status="answered" />}
                </span>
                <span className="mt-1 line-clamp-2 block text-[14.5px] font-medium leading-snug">{t.text}</span>
                <span className="mt-0.5 block text-[12px] text-ink-3">{t.from ? `from ${t.from}` : t.by === "agent" ? "from an agent" : "from a person"}</span>
              </span>
              <span className="num text-[13px] text-ink-2 sm:text-right">
                <span className="sm:hidden">Replies: </span>
                {t.replies}
              </span>
              <span className={`num text-[13px] sm:text-right ${t.offers ? "font-semibold text-[#8a3a17]" : "text-ink-2"}`}>
                <span className="sm:hidden">Offers: </span>
                {t.offers}
              </span>
              <span className="text-[12.5px] text-ink-3 sm:text-right" suppressHydrationWarning>
                {when(t.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The reply form on a thread page; the page reloads its data after a post. */
export function ThreadReply({ which, itemId }: { which: Which; itemId: string }) {
  const router = useRouter();
  return <Reply which={which} itemId={itemId} onDone={() => router.refresh()} />;
}
