"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import type { PublicItem } from "@/server/town/hall";
import type { Post } from "@/server/town/boards";
import { KIND_LABEL, StatusPill, inputCls, usd, when } from "./bits";

type Which = "lab" | "forum";
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
const POST_LABEL: Record<Post["kind"], string> = { finding: "Finding", solution: "Solution", offer: "Offer" };
const STATE_LABEL: Record<Post["state"], string> = { open: "", accepted: "Published to the Library", trusted: "Listed in the Store" };

function Reply({ which, itemId, onDone }: { which: Which; itemId: string; onDone: () => void }) {
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
        <textarea required minLength={5} maxLength={1000} rows={3} value={text} onChange={(e) => setText(e.target.value)} className={`mt-1 ${inputCls}`} />
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

/** A board of routed items: each with what people and agents posted on it, and a way to add to it. */
export function Board({ which }: { which: Which }) {
  const [rows, setRows] = useState<{ item: PublicItem; posts: Post[] }[] | null>(null);
  const load = useCallback(
    () =>
      fetch(`/api/town/${which}`)
        .then((r) => r.json())
        .then((j) => setRows(j.board))
        .catch(() => setRows([])),
    [which],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows)
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <Spinner /> Opening the {which === "lab" ? "mailbox" : "board"}…
      </p>
    );
  if (!rows.length)
    return (
      <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-8 text-center text-sm text-ink-2">
        Nothing here yet. Requests arrive once an admin at{" "}
        <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
          Town Hall
        </Link>{" "}
        sends them on.
      </p>
    );
  return (
    <ul className="space-y-4" data-testid={`${which}-board`}>
      {rows.map(({ item, posts }) => (
        <li key={item.id} className="rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3" suppressHydrationWarning>
                {KIND_LABEL[item.kind]}
                {item.from ? ` from ${item.from}` : ""} · {when(item.createdAt)}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{item.text}</p>
            </div>
            <Link href={`/town/hall/${item.id}`} className="shrink-0" aria-label={`Status: ${item.status}`}>
              <StatusPill status={item.status} />
            </Link>
          </div>
          {posts.length > 0 && (
            <ul className="space-y-2 border-t border-[#f1f0ec] px-4 py-3 sm:px-5">
              {posts.map((p) => (
                <li key={p.id} className="rounded-xl bg-[#f6f5f1] px-3 py-2.5 text-[14px]">
                  <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3" suppressHydrationWarning>
                    <b className="font-semibold text-ink">{POST_LABEL[p.kind]}</b>
                    {p.from ? `by ${p.from}` : p.by === "agent" ? "by an agent" : ""} · {when(p.createdAt)}
                    {STATE_LABEL[p.state] && <span className="rounded bg-good/10 px-1.5 py-0.5 font-semibold text-good">{STATE_LABEL[p.state]}</span>}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap">{p.text}</p>
                  {p.url && (
                    <p className="mt-1 text-[12.5px] text-ink-2">
                      <span className="font-mono">{p.url}</span> · {usd(p.priceUsd)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {item.status !== "answered" && (
            <div className="border-t border-[#f1f0ec] px-4 py-3 sm:px-5">
              <Reply which={which} itemId={item.id} onDone={load} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
