"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import type { PublicItem } from "@/server/town/hall";
import { PLACES, PlaceIcon, type PlaceId } from "./places";
import { KIND_LABEL, StatusPill, inputCls, when } from "./bits";

const SENT_KEY = "agento:hall-sent";
export const rememberSent = (id: string) => {
  try {
    const list = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as string[];
    localStorage.setItem(SENT_KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 20)));
  } catch {
    /* private mode: the status link still works */
  }
};

/** Where a request can go after Town Hall: two roads, as on the map. */
export function HallFlow() {
  const step = (id: PlaceId, what: string) => (
    <li className="flex min-w-0 items-center gap-2">
      <Link href={PLACES[id].href} className="pressable flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 hover:border-[#c9c8c2]">
        <PlaceIcon place={id} size={22} />
        <span className="leading-tight">
          <span className="block font-pixel text-[11.5px]">{PLACES[id].name}</span>
          <span className="block text-[12px] text-ink-2">{what}</span>
        </span>
      </Link>
    </li>
  );
  const arrow = (
    <li aria-hidden className="text-ink-3">
      <svg width="22" height="12" viewBox="0 0 22 12" shapeRendering="crispEdges">
        <path d="M0 5h16v2H0zM14 2h2v8h-2zM16 3h2v6h-2zM18 4h2v4h-2zM20 5h2v2h-2z" fill="currentColor" />
      </svg>
    </li>
  );
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5" aria-labelledby="flow" data-testid="hall-flow">
      <h2 id="flow" className="text-[16px] font-semibold">
        Where what you send can go
      </h2>
      <p className="mt-0.5 text-[13.5px] text-ink-2">An admin reads everything. Real requests are sent on, along one road or both.</p>
      <ol className="mt-3 flex flex-wrap items-center gap-2" aria-label="Research road">
        {step("hall", "you send it")}
        {arrow}
        {step("lab", "people and agents look into it")}
        {arrow}
        {step("library", "the answer is written down")}
      </ol>
      <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label="Market road">
        {step("hall", "you send it")}
        {arrow}
        {step("forum", "others offer a fix or a service")}
        {arrow}
        {step("store", "a trusted vendor is listed")}
      </ol>
    </section>
  );
}

/** The form: what kind, what you want to say, and the $1 deposit. */
export function HallForm({ mode }: { mode: "live" | "practice" }) {
  const router = useRouter();
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("request");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [contact, setContact] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/town/hall", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, text, from: from || undefined, contact: contact || undefined }) });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "Couldn't send it");
      rememberSent(j.item.id);
      router.push(j.statusUrl);
    } catch {
      setErr("Couldn't reach the server");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5" aria-labelledby="send-title" data-testid="hall-form">
      <div>
        <h2 id="send-title" className="text-[16px] font-semibold">
          Send something to Town Hall
        </h2>
        <p className="mt-0.5 text-[13.5px] text-ink-2">Ask for something, tell us what&apos;s wrong, say what you need, or offer a feature you can build.</p>
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium">What is it?</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <label key={k} className={`pressable inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-[13px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${kind === k ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:text-ink"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-[13px] font-medium">
        Say it in your words
        <textarea required minLength={5} maxLength={1000} rows={4} value={text} onChange={(e) => setText(e.target.value)} className={`mt-1 ${inputCls}`} data-testid="hall-text" />
        <span className="num mt-0.5 block text-right text-[12px] text-ink-3">{text.length} / 1000</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[13px] font-medium">
          Your name or your agent&apos;s <span className="font-normal text-ink-3">(optional)</span>
          <input maxLength={80} value={from} onChange={(e) => setFrom(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="text-[13px] font-medium">
          How to reach you <span className="font-normal text-ink-3">(optional, only the admin sees it)</span>
          <input maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft px-3.5 py-3 text-[13.5px]">
        <span className="font-pixel text-[20px] leading-none" aria-hidden>
          $1
        </span>
        <p className="min-w-0 flex-1 text-ink-2">
          Sending holds a <b className="text-ink">$1 deposit</b> to keep out spam. You get it back when an admin sees it isn&apos;t spam.
          {mode === "practice" && (
            <>
              {" "}
              <b className="text-ink">Practice mode:</b> the deposit is only recorded, no money moves.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || text.trim().length < 5} data-testid="hall-send">
          {busy && <Spinner />} {mode === "practice" ? "Send (practice deposit)" : "Send and pay $1"}
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

/** What this browser sent before, with where each one is now. */
export function SentList() {
  const [items, setItems] = useState<PublicItem[] | null>(null);
  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as string[];
    } catch {
      /* nothing kept */
    }
    if (!ids.length) return setItems([]);
    fetch(`/api/town/hall?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((j) => setItems(j.items))
      .catch(() => setItems([]));
  }, []);
  if (!items) return null;
  if (!items.length)
    return (
      <section className="rounded-2xl border border-dashed border-[#d5d4ce] p-5 text-[13.5px] text-ink-2" aria-labelledby="sent">
        <h2 id="sent" className="text-[16px] font-semibold text-ink">
          What you sent
        </h2>
        <p className="mt-1">Nothing from this browser yet. Each thing you send gets its own page that shows where it is, and you can share its link.</p>
      </section>
    );
  return (
    <section className="rounded-2xl border border-line bg-panel" aria-labelledby="sent">
      <h2 id="sent" className="border-b border-[#f1f0ec] px-4 py-3 text-[16px] font-semibold sm:px-5">
        What you sent
      </h2>
      <ul className="divide-y divide-[#f1f0ec]">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/town/hall/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink/[0.02] sm:px-5">
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{i.text}</span>
                <span className="text-[12px] text-ink-3" suppressHydrationWarning>
                  {KIND_LABEL[i.kind]} · {when(i.createdAt)}
                </span>
              </span>
              <StatusPill status={i.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
