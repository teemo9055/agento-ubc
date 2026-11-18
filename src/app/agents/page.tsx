"use client";
import { Marketplace } from "@/components/Marketplace";
import { Selling } from "@/components/Selling";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AgentPortrait, Banner } from "@/components/AgentPortrait";
import { Icon } from "@/components/Icon";
import { useAgentRecords } from "@/components/agentStats";
import { KITS } from "@/lib/agentKit";
import { THEMES } from "@/lib/themes";
import { fmt } from "@/lib/money";
import type { AgentId } from "@/lib/types";

const AGENTS = Object.keys(THEMES) as AgentId[];

export default function AgentDirectory() {
  const [q, setQ] = useState("");
  const { records } = useAgentRecords();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return AGENTS;
    return AGENTS.filter((a) => {
      const k = KITS[a];
      const topics = records?.[a].topics.map((x) => x.topic) ?? [];
      return [THEMES[a].name, THEMES[a].domain, k.title, k.headline, k.acts, ...k.can, ...k.free, ...k.paid.map((x) => x.label), ...topics].join(" ").toLowerCase().includes(t);
    });
  }, [q, records]);

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Agent directory</h1>
          <p className="mt-1 text-[15px] text-ink-2">Who does what, and what they've done for you so far.</p>
        </div>
        <label className="ring-agent flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 sm:max-w-xs">
          <Icon name="search" size={15} className="text-ink-3" />
          <span className="sr-only">Search agents by name, skill or topic</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by skill or topic" className="w-full bg-transparent text-sm outline-none" />
        </label>
      </header>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Agents">
        {shown.map((a, i) => {
          const k = KITS[a];
          const rec = records?.[a];
          return (
            <motion.li
              key={a}
              data-agent={a}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              className="pix-lift flex flex-col overflow-hidden rounded-2xl border border-line bg-panel"
            >
              <Banner className="h-20" />
              <div className="-mt-12 flex flex-1 flex-col px-5 pb-5">
                <AgentPortrait agent={a} size={96} />
                <h2 className="mt-2 font-pixel text-[20px] text-agent-ink">{THEMES[a].name}</h2>
                <div className="text-[15px] font-semibold">{k.title}</div>
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{k.headline}</p>
                <ul className="mt-3 space-y-1 text-[13px] text-ink-2" aria-label="What you can ask for">
                  {k.can.slice(0, 4).map((x) => (
                    <li key={x} className="flex gap-1.5">
                      <Icon name="check" size={13} stroke={2.4} className="mt-[3px] shrink-0 text-agent-ink" /> {x}
                    </li>
                  ))}
                </ul>
                <div className="num mt-3 text-[12.5px] text-ink-3">
                  {rec ? (
                    rec.done ? (
                      <>
                        <b className="font-semibold text-ink">{rec.done}</b> {rec.done === 1 ? "job" : "jobs"} done for you · {fmt(rec.spent)} USDC paid out
                      </>
                    ) : (
                      "No finished jobs yet"
                    )
                  ) : (
                    <span className="inline-block h-3 w-40 animate-pulse rounded bg-line align-middle motion-reduce:animate-none" />
                  )}
                </div>
                <div className="mt-auto flex gap-2 pt-4">
                  <Link href={`/agents/${a}`} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-line bg-panel text-sm font-medium hover:border-[#c9c8c2]">
                    View profile
                  </Link>
                  <Link href={`/${a}`} className="pix-press inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-agent text-sm font-semibold text-agent-on">
                    Open {THEMES[a].name}
                  </Link>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-8 text-center text-sm text-ink-2">No agent has that skill yet.</p>}
      <Marketplace />
      <Selling />
    </div>
  );
}
