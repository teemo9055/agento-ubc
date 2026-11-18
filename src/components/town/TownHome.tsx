"use client";
import { usePrefs } from "@/lib/prefs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { useRuns } from "@/components/runsStore";
import { THEMES } from "@/lib/themes";
import { fmt } from "@/lib/money";
import type { TownSummary } from "@/server/town";
import { TownMap } from "./TownMap";
import { TownBar } from "./TownNav";
import { PlaceIcon } from "./places";

const WORD: Record<string, string> = { exploring: "chatting", draft: "waiting for your OK", funding: "getting ready", running: "working", done: "done", cancelled: "stopped" };

/** Top-left: you, and the agent in focus (the one on your latest job). */
function Profile({ compact = false }: { compact?: boolean }) {
  const { runs } = useRuns();
  const latest = runs?.[0];
  const agent = latest?.agent ?? "inso";
  return (
    <div className={`pix-frame flex min-w-0 items-center bg-panel/95 backdrop-blur ${compact ? "gap-2 px-2 py-1.5" : "gap-3 p-2.5 pr-3.5"}`} data-testid={compact ? undefined : "town-profile"}>
      {!compact && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] bg-ink font-pixel text-[13px] text-white" aria-hidden>
          you
        </span>
      )}
      <div className="min-w-0 text-[12.5px] leading-tight">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{compact ? "In focus" : "You · agent in focus"}</div>
        <Link href={latest ? `/runs/${latest.id}` : "/new"} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ink-2 hover:text-ink">
          <Mascot agent={agent} size={20} framed={false} />
          <span className={`truncate ${compact ? "max-w-[118px]" : "max-w-[200px]"}`}>
            <span className="font-pixel text-[11px] text-ink">{THEMES[agent].name}</span> {latest ? `${WORD[latest.status] ?? latest.status}: ${latest.task}` : "has no job yet"}
          </span>
        </Link>
      </div>
    </div>
  );
}

/** Top-right: money in the app's wallet (live) or a plain practice label, and Town Hall's inbox. */
function Purse({ t, compact = false }: { t: TownSummary; compact?: boolean }) {
  const [prefs] = usePrefs();
  const live = t.mode === "live" && prefs.mode === "live";
  const pad = compact ? "px-2 py-1.5" : "px-3 py-2";
  return (
    <div className="pix-frame flex shrink-0 items-stretch divide-x divide-line bg-panel/95 text-[12.5px] leading-tight backdrop-blur" data-testid={compact ? undefined : "town-purse"}>
      <div className={pad}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Balance</div>
        {live ? (
          <div className="num mt-0.5 text-[15px] font-semibold">{t.balance == null ? "—" : `$${fmt(t.balance)}`}</div>
        ) : (
          <div className="mt-0.5 font-semibold" title="Practice: nothing here moves real money. Choose Arc testnet in Settings to use real test money.">
            Practice{!compact && <span className="font-normal text-ink-3"> · no real money</span>}
          </div>
        )}
      </div>
      <Link href="/town/hall" className={`flex items-center gap-2 hover:bg-ink/5 ${pad}`} data-testid={compact ? undefined : "town-inbox"}>
        {!compact && <PlaceIcon place="hall" size={20} />}
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-3">Town Hall</span>
          <span className="num font-semibold">{t.hall.inbox}</span> waiting
        </span>
      </Link>
    </div>
  );
}

export function TownHome({ initial }: { initial: TownSummary }) {
  const [t, setT] = useState(initial);
  useEffect(() => {
    const load = () =>
      fetch("/api/town")
        .then((r) => r.json())
        .then(setT)
        .catch(() => undefined);
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-4 pb-[calc(84px+var(--tabbar-h))] sm:pb-0">
      <header>
        <h1 className="font-pixel text-[26px] leading-tight sm:text-[34px]">The Town</h1>
        <p className="mt-1 text-[14px] text-ink-2 sm:text-[15px]">Where agents and people learn what works, find services, and ask for what&apos;s missing. Pick a building.</p>
      </header>

      <div className="flex items-stretch justify-between gap-2 sm:hidden">
        <Profile compact />
        <Purse t={t} compact />
      </div>

      <div className="grid-paper relative overflow-hidden rounded-2xl border border-line bg-surface">
        <TownMap />
        <div className="pointer-events-none absolute inset-x-3 top-3 hidden items-start justify-between gap-3 sm:flex">
          <div className="pointer-events-auto">
            <Profile />
          </div>
          <div className="pointer-events-auto">
            <Purse t={t} />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+8px)] z-30 sm:relative sm:inset-x-auto sm:bottom-auto sm:z-10 sm:mx-auto sm:-mt-12 sm:max-w-[640px]">
        <TownBar />
      </div>
    </div>
  );
}
