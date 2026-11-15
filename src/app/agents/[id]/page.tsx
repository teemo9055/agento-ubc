"use client";
import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { motion } from "framer-motion";
import { AgentPortrait, Banner } from "@/components/AgentPortrait";
import { Mascot } from "@/components/Mascot";
import { Icon } from "@/components/Icon";
import { useAgentRecords, TOPIC } from "@/components/agentStats";
import { Knowledge } from "@/components/AgentKnowledge";
import { useAgentTheme } from "@/components/useRun";
import { KITS } from "@/lib/agentKit";
import { THEMES } from "@/lib/themes";
import { fmt } from "@/lib/money";
import { OUTFIT_LABEL, type Mood, type Outfit } from "@/lib/outfit";
import type { AgentId } from "@/lib/types";

const OUTFITS: Outfit[] = ["none", "sports", "health", "crypto", "commodities", "weather", "politics", "travel", "finance"];
const MOODS: { mood: Mood; label: string }[] = [
  { mood: "idle", label: "Draft" },
  { mood: "working", label: "Running" },
  { mood: "alert", label: "Needs you" },
  { mood: "happy", label: "Done" },
  { mood: "sad", label: "Cancelled" },
];
const STATUS: Record<string, { label: string; cls: string }> = {
  exploring: { label: "Chatting", cls: "bg-agent-soft text-agent-ink" },
  draft: { label: "Draft", cls: "bg-[#f1f0ec] text-ink-2" },
  funding: { label: "Funding", cls: "bg-agent-soft text-agent-ink" },
  running: { label: "Running", cls: "bg-agent-soft text-agent-ink" },
  done: { label: "Done", cls: "bg-good/10 text-good" },
  cancelled: { label: "Cancelled", cls: "bg-[#f1f0ec] text-ink-2" },
};

function Card({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AgentProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Hooks first, always in the same order; then the not-found check.
  useAgentTheme(id in THEMES ? id : undefined);
  const { records } = useAgentRecords();
  if (!(id in THEMES)) notFound();
  const a = id as AgentId;
  const t = THEMES[a];
  const k = KITS[a];
  const rec = records?.[a];

  const stats = [
    { label: "Jobs done", value: rec ? String(rec.done) : "–" },
    { label: "Running now", value: rec ? String(rec.running) : "–" },
    { label: "Paid out for data", value: rec ? fmt(rec.spent) : "–", unit: "USDC" },
    { label: "Returned to you", value: rec ? fmt(rec.returned) : "–", unit: "USDC", good: true },
  ];

  return (
    <div data-agent={a} className="mx-auto max-w-4xl space-y-4">
      <Link href="/agents" className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <Icon name="back" size={15} /> Agent directory
      </Link>

      {/* Top card: banner, headshot, name, title, headline. */}
      <motion.section
        aria-label={`${t.name}'s profile`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-line bg-panel"
      >
        <Banner className="h-28 sm:h-36" />
        <div className="px-5 pb-5 sm:px-7">
          <div className="-mt-16 flex flex-wrap items-end justify-between gap-4 sm:-mt-20">
            <motion.span initial={{ scale: 0.92, rotate: -3 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
              <AgentPortrait agent={a} size={152} />
            </motion.span>
            <div className="flex gap-2 pb-1">
              <Link href={`/new?agent=${a}`} className="pix-press inline-flex h-10 items-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-agent px-4 text-sm font-semibold text-agent-on">
                <Icon name="plus" size={15} stroke={2.2} /> Hire {t.name}
              </Link>
            </div>
          </div>
          <h1 className="mt-3 font-pixel text-[28px] leading-tight text-agent-ink sm:text-[32px]">{t.name}</h1>
          <div className="text-[18px] font-semibold">{k.title}</div>
          <p className="mt-1 text-[15px] text-ink-2">{k.headline}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
            <span>Arc testnet</span>
            <span aria-hidden>·</span>
            <span>Paid per request in USDC</span>
            <span aria-hidden>·</span>
            <span className="italic">{k.quirk}</span>
          </p>
        </div>
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className={`px-5 py-3 sm:px-7 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""} border-line`}>
              <dt className="text-[12px] text-ink-3">{s.label}</dt>
              <dd className={`num mt-0.5 text-[20px] font-semibold ${s.good ? "text-good" : ""}`}>
                {s.value}
                {s.unit && <span className="ml-1 text-[12px] font-medium text-ink-3">{s.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </motion.section>

      <Card title="About">
        <p className="text-[15px] leading-relaxed text-ink-2">{k.about}</p>
      </Card>

      <Card title="Skills">
        <ul className="divide-y divide-[#f1f0ec]">
          <li className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3 first:pt-0">
            <span className="w-44 shrink-0 text-[13px] font-semibold">Free while you chat</span>
            <span className="flex flex-wrap gap-1.5">
              {k.free.map((s) => (
                <span key={s} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#f1f0ec] px-2.5 text-[13px]">
                  <Icon name="search" size={12} /> {s}
                </span>
              ))}
            </span>
          </li>
          <li className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3">
            <span className="w-44 shrink-0 text-[13px] font-semibold">Buys once you approve</span>
            <span className="flex flex-wrap gap-1.5">
              {k.paid.map((s) => (
                <span key={s.label} className="num inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px]">
                  {s.label} <span className="text-ink-3">{s.price} USDC</span>
                </span>
              ))}
            </span>
          </li>
          <li className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3">
            <span className="w-44 shrink-0 text-[13px] font-semibold">Can do</span>
            <span className="text-[14px] text-ink-2">{k.acts}</span>
          </li>
          <li className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3 last:pb-0">
            <span className="w-44 shrink-0 text-[13px] font-semibold">Never does</span>
            <span className="text-[14px] text-ink-2">{k.never}</span>
          </li>
        </ul>
      </Card>

      <Card title="Knows & has learned">
        <Knowledge agent={a} />
      </Card>

      <Card title="Specializes in">
        {rec && rec.topics.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {rec.topics.map((x) => (
              <li key={x.outfit} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
                <Mascot agent={a} outfit={x.outfit} size={36} />
                <span>
                  <span className="block text-[14px] font-semibold">{x.topic}</span>
                  <span className="num block text-[12px] text-ink-3">
                    {x.count} {x.count === 1 ? "job" : "jobs"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-ink-2">Topics show up here as {t.name} works for you, from what each job was about.</p>
        )}
        <h3 className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Dresses for the job</h3>
        <ul className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {OUTFITS.map((o) => (
            <li key={o} className="flex flex-col items-center gap-1.5">
              <Mascot agent={a} outfit={o} size={52} />
              <span className="text-center text-[12px] text-ink-3">{o === "none" ? "Plain" : TOPIC[o] || OUTFIT_LABEL[o]}</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Faces it makes</h3>
        <ul className="mt-2 flex flex-wrap gap-4">
          {MOODS.map((m) => (
            <li key={m.mood} className="flex items-center gap-2">
              <Mascot agent={a} mood={m.mood} size={36} />
              <span className="text-[12px] text-ink-2">{m.label}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Activity">
        {!rec ? (
          <div className="h-16 animate-pulse rounded-xl bg-line/50 motion-reduce:animate-none" aria-busy="true" />
        ) : rec.jobs.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-ink-2">No jobs with {t.name} yet.</p>
            <Link href={`/new?agent=${a}`} className="text-[14px] font-semibold text-agent-ink underline underline-offset-2">
              Start one
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-[#f1f0ec]">
            {rec.jobs.slice(0, 6).map((j) => (
              <li key={j.id}>
                <Link href={`/runs/${j.id}`} className="group flex items-center gap-3 py-3 first:pt-0">
                  <Mascot agent={a} outfit={j.outfit} mood={j.status === "done" ? "happy" : j.status === "cancelled" ? "sad" : j.needsYou ? "alert" : "idle"} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium group-hover:underline">{j.task}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">{j.headline ?? j.move ?? `${j.mode === "live" ? "Arc testnet" : "Demo"} · ${ago(j.finishedAt ?? j.createdAt)}`}</span>
                  </span>
                  <span className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[12px] font-semibold ${STATUS[j.status]?.cls ?? ""}`}>{STATUS[j.status]?.label ?? j.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rec && rec.jobs.length > 6 && (
          <Link href={`/?folder=${a}`} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-agent-ink">
            All {rec.jobs.length} jobs <Icon name="arrow" size={13} />
          </Link>
        )}
      </Card>
    </div>
  );
}
