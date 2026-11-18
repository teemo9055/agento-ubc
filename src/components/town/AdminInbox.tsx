"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { toast } from "@/components/Toaster";
import type { HallItem } from "@/server/town/hall";
import type { Post } from "@/server/town/boards";
import type { Listing } from "@/server/town/listings";
import type { LogEntry } from "@/server/town/admin";
import { KIND_LABEL, Panel, StatusPill, inputCls, usd, when } from "./bits";
import { SECTIONS as TOWN_SECTIONS } from "@/server/town/sections";

const KEY = "agento:admin-key";
const NAME = "agento:admin-name";

type Item = HallItem & { posts: number };
interface Inbox {
  who: string;
  waiting: Item[];
  others: Item[];
  solutions: Post[];
  offers: Post[];
  listings: Listing[];
  log: LogEntry[];
}
const SECTIONS: Record<string, string> = TOWN_SECTIONS;

const statusWord = (i: HallItem) =>
  i.state === "answered" ? "answered" : i.state === "abandoned" ? "abandoned" : i.state === "spam" ? "kept as spam" : i.state === "routed" ? "routed" : i.deposit.state === "refunded" ? "refunded" : "received";

function ItemCard({ i, act }: { i: Item; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [why, setWhy] = useState<string | null>(null);
  const held = i.deposit.state === "held";
  const closed = i.state === "spam" || i.state === "abandoned";
  return (
    <li className="rounded-xl border border-line p-3.5" data-testid="admin-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-ink-3" suppressHydrationWarning>
            <b className="font-semibold text-ink-2">{KIND_LABEL[i.kind]}</b> · {i.by === "agent" ? "agent" : "person"}
            {i.from ? ` · ${i.from}` : ""}
            {i.contact ? ` · ${i.contact}` : ""} · {when(i.createdAt)} · {i.deposit.mode === "practice" ? "practice deposit" : "$1 deposit"} {i.deposit.state}
            {i.routes.length ? ` · in ${i.routes.join(" and ")}` : ""}
            {i.posts ? ` · ${i.posts} ${i.posts === 1 ? "post" : "posts"}` : ""}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[14.5px]">{i.text}</p>
        </div>
        <Link href={`/town/hall/${i.id}`} className="shrink-0">
          <StatusPill status={statusWord(i)} />
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {held && !closed && (
          <Button className="h-9" onClick={() => act({ action: "refund", itemId: i.id })}>
            Not spam: refund the $1
          </Button>
        )}
        {held && (
          <Button variant="danger" className="h-9" onClick={() => act({ action: "spam", itemId: i.id })}>
            Spam: keep the deposit
          </Button>
        )}
        {!closed && i.state !== "answered" && (
          <>
            {!i.routes.includes("lab") && (
              <Button variant="ghost" className="h-9" onClick={() => act({ action: "route", itemId: i.id, to: ["lab"] })}>
                Route to Lab
              </Button>
            )}
            {!i.routes.includes("forum") && (
              <Button variant="ghost" className="h-9" onClick={() => act({ action: "route", itemId: i.id, to: ["forum"] })}>
                Route to Forum
              </Button>
            )}
            {!i.routes.length && (
              <Button variant="ghost" className="h-9" onClick={() => act({ action: "route", itemId: i.id, to: ["lab", "forum"] })}>
                Route to both
              </Button>
            )}
            {why == null && (
              <Button variant="quiet" className="h-9" onClick={() => setWhy("")}>
                Abandon…
              </Button>
            )}
          </>
        )}
      </div>
      {why != null && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ action: "abandon", itemId: i.id, reason: why })) setWhy(null);
          }}
        >
          <label className="min-w-[220px] flex-1 text-[13px] font-medium">
            <span className="sr-only">Why set it aside</span>
            <input autoFocus required minLength={3} maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="A short reason the sender will see" className={inputCls} />
          </label>
          <Button type="submit" variant="ghost" className="h-9">
            Set aside
          </Button>
          <Button type="button" variant="quiet" className="h-9" onClick={() => setWhy(null)}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

function Accept({ p, act }: { p: Post; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [title, setTitle] = useState(p.text.split(/[.\n]/)[0].slice(0, 80));
  const [section, setSection] = useState("practices");
  const [entryId, setEntryId] = useState("");
  return (
    <li className="rounded-xl border border-line p-3.5">
      <p className="text-[12px] text-ink-3">
        Solution {p.from ? `by ${p.from}` : p.by === "agent" ? "by an agent" : ""} on{" "}
        <Link href={`/town/hall/${p.itemId}`} className="underline underline-offset-2">
          its request
        </Link>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[14.5px]">{p.text}</p>
      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_170px_150px_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void act({ action: "accept", postId: p.id, title, section, entryId: entryId || undefined });
        }}
      >
        <label className="text-[12.5px] font-medium">
          Library title
          <input required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="text-[12.5px] font-medium">
          Section
          <select value={section} onChange={(e) => setSection(e.target.value)} className={`mt-1 ${inputCls}`}>
            {Object.entries(SECTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12.5px] font-medium">
          Update entry <span className="font-normal text-ink-3">(id, optional)</span>
          <input pattern="[a-z0-9-]{2,60}" value={entryId} onChange={(e) => setEntryId(e.target.value)} className={`mt-1 font-mono ${inputCls}`} />
        </label>
        <Button type="submit" className="h-[38px]">
          Publish
        </Button>
      </form>
    </li>
  );
}

function Reject({ l, act }: { l: Listing; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [why, setWhy] = useState<string | null>(null);
  return (
    <li className="rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <b className="font-semibold">{l.name}</b> <span className="text-[12.5px] text-ink-3">by {l.seller} · {l.by}</span>
        </span>
        <span className="num text-[13px]">
          {usd(l.priceUsd)} · {l.network}
        </span>
      </div>
      <p className="mt-0.5 text-[14px] text-ink-2">{l.description}</p>
      <p className="mt-0.5 break-all font-mono text-[12px] text-ink-3">{l.url}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button className="h-9" onClick={() => act({ action: "approve-listing", listingId: l.id })}>
          Checked: list it
        </Button>
        {why == null ? (
          <Button variant="quiet" className="h-9" onClick={() => setWhy("")}>
            Don&apos;t list…
          </Button>
        ) : (
          <form
            className="flex flex-1 flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "reject-listing", listingId: l.id, reason: why });
            }}
          >
            <input autoFocus aria-label="Why it isn't listed" required minLength={3} maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason" className={`min-w-[200px] flex-1 ${inputCls}`} />
            <Button type="submit" variant="ghost" className="h-9">
              Don&apos;t list
            </Button>
          </form>
        )}
      </div>
    </li>
  );
}

/** The admin's side of Town Hall, behind the server's ADMIN_KEY. Every decision is logged. */
export function AdminInbox() {
  const [key, setKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [data, setData] = useState<Inbox | null>(null);
  const [state, setState] = useState<"loading" | "off" | "locked" | "open">("loading");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (k: string, n: string) => {
    const r = await fetch("/api/town/admin", { headers: { "x-admin-key": k, "x-admin-name": n } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503) return setState("off"), setMsg(j.error);
    if (!r.ok) return setState("locked"), setMsg(k ? (j.error ?? "That key didn't work") : "");
    setData(j);
    setState("open");
  }, []);

  useEffect(() => {
    const k = localStorage.getItem(KEY) ?? "";
    const n = localStorage.getItem(NAME) ?? "";
    setKey(k);
    setName(n);
    void load(k, n);
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/town/admin", { method: "POST", headers: { "content-type": "application/json", "x-admin-key": key ?? "", "x-admin-name": name }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    toast(r.ok ? j.message : (j.error ?? "That didn't work"), r.ok ? "good" : "bad");
    await load(key ?? "", name);
    return r.ok;
  };

  if (state === "loading")
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <Spinner /> Checking…
      </p>
    );
  if (state === "off")
    return (
      <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-8 text-center text-[15px] text-ink-2" data-testid="admin-off">
        {msg || "Admin is turned off on this server."}
      </p>
    );
  if (state === "locked")
    return (
      <form
        className="mx-auto max-w-md space-y-3 rounded-2xl border border-line bg-panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          localStorage.setItem(KEY, key ?? "");
          localStorage.setItem(NAME, name);
          void load(key ?? "", name);
        }}
      >
        <h2 className="text-[16px] font-semibold">Admins only</h2>
        <p className="text-[13.5px] text-ink-2">Enter the admin key. It stays in this browser.</p>
        <label className="block text-[13px] font-medium">
          Admin key
          <input type="password" required autoComplete="current-password" value={key ?? ""} onChange={(e) => setKey(e.target.value)} className={`mt-1 ${inputCls}`} data-testid="admin-key" />
        </label>
        <label className="block text-[13px] font-medium">
          Your name, for the log <span className="font-normal text-ink-3">(optional)</span>
          <input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
        {msg && (
          <p role="alert" className="text-[13px] text-bad">
            {msg}
          </p>
        )}
        <Button type="submit" data-testid="admin-unlock">
          Open the inbox
        </Button>
      </form>
    );
  const d = data!;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-2">
        <span>
          Signed in as <b className="text-ink">{d.who}</b>. Every decision is logged.
        </span>
        <Button
          variant="quiet"
          className="h-8"
          onClick={() => {
            localStorage.removeItem(KEY);
            setKey("");
            setState("locked");
            setMsg("");
          }}
        >
          Lock
        </Button>
      </div>

      <Panel id="adm-waiting" title={`Waiting for you (${d.waiting.length})`} sub="Deposit in, nothing decided yet.">
        {d.waiting.length ? (
          <ul className="space-y-3" data-testid="admin-waiting">
            {d.waiting.map((i) => (
              <ItemCard key={i.id} i={i} act={act} />
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-3">Nothing waiting.</p>
        )}
      </Panel>

      {d.solutions.length > 0 && (
        <Panel id="adm-sol" title={`Lab solutions to review (${d.solutions.length})`} sub="Publishing writes it into the Library, credited to the request, and marks the request answered.">
          <ul className="space-y-3">
            {d.solutions.map((p) => (
              <Accept key={p.id} p={p} act={act} />
            ))}
          </ul>
        </Panel>
      )}

      {d.offers.length > 0 && (
        <Panel id="adm-offers" title={`Forum offers (${d.offers.length})`} sub="Trusting a vendor lists it in the Store as independent. Only Circle's own marketplace is verified.">
          <ul className="space-y-3">
            {d.offers.map((p) => (
              <li key={p.id} className="rounded-xl border border-line p-3.5">
                <p className="text-[12px] text-ink-3">
                  Offer {p.from ? `by ${p.from}` : ""} · {usd(p.priceUsd)}
                </p>
                <p className="mt-1 text-[14.5px]">{p.text}</p>
                <p className="mt-0.5 break-all font-mono text-[12px] text-ink-3">{p.url}</p>
                <Button className="mt-2.5 h-9" onClick={() => act({ action: "trust", postId: p.id })}>
                  Trust this vendor
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {d.listings.length > 0 && (
        <Panel id="adm-list" title={`Store listings to check (${d.listings.length})`} sub="Open the address and check it sells what it says before listing it.">
          <ul className="space-y-3">
            {d.listings.map((l) => (
              <Reject key={l.id} l={l} act={act} />
            ))}
          </ul>
        </Panel>
      )}

      {d.others.length > 0 && (
        <Panel id="adm-others" title="Everything else" sub="Already decided; you can still route, refund a held deposit, or set aside.">
          <ul className="space-y-3">
            {d.others.map((i) => (
              <ItemCard key={i.id} i={i} act={act} />
            ))}
          </ul>
        </Panel>
      )}

      <Panel id="adm-log" title="Log" sub="Who decided what, and when.">
        {d.log.length ? (
          <ul className="divide-y divide-[#f1f0ec] text-[13px]" data-testid="admin-log">
            {d.log.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>
                  <b className="font-semibold">{e.who}</b> · {e.action} · <span className="font-mono text-[12px]">{e.target}</span>
                  {e.detail ? <span className="text-ink-3"> · {e.detail}</span> : null}
                </span>
                <span className="text-ink-3" suppressHydrationWarning>
                  {when(e.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-3">No decisions yet.</p>
        )}
      </Panel>
    </div>
  );
}
