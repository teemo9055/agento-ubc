"use client";
import { useState } from "react";
import Link from "next/link";
import { Mascot } from "./Mascot";
import { Icon } from "./Icon";
import { Button, Spinner } from "./ui";
import { useAgentTheme } from "./useRun";
import { useRuns } from "./runsStore";
import { useStartJob } from "./useStartJob";
import { TradeBoard } from "./AgentSheets";
import { Band, Card } from "./JobCard";
import { THEMES } from "@/lib/themes";
import type { AgentId } from "@/lib/types";

/** Small pixel pictures for the quick builds, 8×8, drawn in the agent's colour. */
const GLYPH: Record<string, string[]> = {
  ticket: ["........", "########", "#..##..#", "#......#", "#......#", "#..##..#", "########", "........"],
  shop: ["........", "########", "#.#.#.##", "########", "#......#", "#.##.#.#", "#.##...#", "########"],
  plane: ["...##...", "...##...", "..####..", "########", "########", "...##...", "..####..", "........"],
  rain: ["..####..", ".######.", "########", "........", ".#..#..#", "#..#..#.", ".#..#..#", "........"],
  crash: ["#.......", "##......", "#.#.....", "#..#..#.", "#...##.#", "#......#", "#.......", "########"],
  cold: ["...#....", "..###...", "...#....", "...#....", "...#....", "..###...", ".#####..", "..###..."],
  coin: ["..####..", ".#....#.", "#..##..#", "#.#..#.#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
  car: ["........", "..####..", ".#....#.", "########", "########", "#.####.#", ".#....#.", "........"],
  bed: ["........", "#.......", "#.##....", "#.######", "########", "#......#", "#......#", "........"],
  food: ["#.#.#..#", "#.#.#.##", "#####.##", "..#..###", "..#...##", "..#....#", "..#....#", "........"],
  map: ["...##...", "..#..#..", "..#..#..", "...##...", "...##...", "...##...", "....#...", "........"],
  pin: ["........", ".######.", "#......#", "#.####.#", "#......#", ".######.", "...##...", "...##..."],
};

function Glyph({ name, size = 32 }: { name: string; size?: number }) {
  const rows = GLYPH[name] ?? GLYPH.coin;
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--agent)" /> : null)))}
    </svg>
  );
}

interface Build {
  glyph: string;
  title: string;
  sub: string;
  say: string;
}

const STARTS: Record<AgentId, { ask: string; placeholder: string; buildsTitle: string; builds: Build[] }> = {
  inso: {
    ask: "What do you want to protect?",
    placeholder: "e.g. my rides cost double when it snows",
    buildsTitle: "Quick builds",
    builds: [
      { glyph: "ticket", title: "Save your ticket money if the match doesn't happen", sub: "Cover a sports ticket against a cancelled or lost game", say: "I bought a ticket to a game. Cover my ticket money if the match doesn't happen or my team doesn't play." },
      { glyph: "shop", title: "Hedge your business's running costs", sub: "When fuel, power or supplies jump, get paid back", say: "I run a small business and my running costs keep jumping. Help me hedge them." },
      { glyph: "plane", title: "Insure your flight and hotel if something unexpected happens", sub: "Weather or events that could ruin the trip", say: "Insure my flight and hotel bookings in case something unexpected happens on the trip." },
      { glyph: "rain", title: "Cover your ride fares in bad weather", sub: "Rides cost more in storms and cold snaps", say: "Cover my ride fares if the weather turns bad tomorrow in my city." },
      { glyph: "crash", title: "Protect your investments from a big crash", sub: "Get paid if prices fall below a line you pick", say: "Protect my crypto savings: cover me if BTC crashes this month." },
      { glyph: "cold", title: "Cover your heating bill in a cold snap", sub: "Paid if it gets colder than a temperature you pick", say: "A cold snap would raise my heating bill. Cover me if it gets very cold this week." },
    ],
  },
  trado: {
    ask: "What are you trying to trade today?",
    placeholder: "e.g. buy $10 of ETH if it dips 2%",
    buildsTitle: "Start from",
    builds: [
      { glyph: "coin", title: "Buy a coin at your price", sub: "Waits for the price you set", say: "Buy $10 of BTC if it dips about 2% from here." },
      { glyph: "crash", title: "Sell what moves the most", sub: "Take profit on your jumpiest holding", say: "Sell my most volatile position." },
      { glyph: "map", title: "How is a coin doing?", sub: "Trend, swings and today's move", say: "How is ETH doing this week?" },
    ],
  },
  travo: {
    ask: "Where are you headed?",
    placeholder: "e.g. a ride from SEA airport when I land at 6pm",
    buildsTitle: "What Travo can do",
    builds: [
      { glyph: "car", title: "Book a ride", sub: "From the airport, the hotel or anywhere", say: "I need a ride from the airport to my hotel when my flight lands." },
      { glyph: "bed", title: "Hotel booking", sub: "Places to stay near where you'll be", say: "Find me a hotel for two nights near downtown." },
      { glyph: "food", title: "Restaurant reservation", sub: "Places to eat near you, for when you want", say: "Find a restaurant for dinner tonight near my hotel." },
      { glyph: "map", title: "Plan a drive", sub: "Route, distance and day-by-day stops", say: "Plan a drive from Dallas to Austin with a stop for lunch." },
      { glyph: "pin", title: "Things to do nearby", sub: "What's around a place you name", say: "What's worth seeing near Pike Place Market?" },
    ],
  },
};

/**
 * An agent's own home: how it starts (Inso: quick builds for cover; Trado: what to trade and the
 * trading board; Travo: the kinds of trip help), and your jobs with it. Picking anything opens a
 * job, where that agent shapes it with you; every job then shares the same review, graph and receipt.
 */
export function AgentHome({ agent }: { agent: AgentId }) {
  useAgentTheme(agent);
  const t = THEMES[agent];
  const s = STARTS[agent];
  const { start, busy, err } = useStartJob();
  const [text, setText] = useState("");
  const { runs } = useRuns();
  const mine = (runs ?? []).filter((r) => r.agent === agent && !r.parentId).slice(0, 6);

  return (
    <div className="flex flex-col gap-6" data-agent={agent} data-testid={`agent-home-${agent}`}>
      <Band single />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="pix-shadow inline-flex rounded-xl border-[1.5px] border-ink bg-agent-soft p-1.5">
            <Mascot agent={agent} mood="happy" size={64} />
          </span>
          <div className="min-w-0">
            <h1 className="font-pixel text-[30px] leading-tight text-agent-ink sm:text-[34px]">{t.name}</h1>
            <p className="text-[14px] text-ink-2">{t.domain}</p>
          </div>
        </div>
      </header>

      <form
        className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--agent)] sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void start(agent, text, "ask");
        }}
      >
        <label htmlFor="agent-ask" className="block text-[20px] font-semibold leading-tight sm:text-[22px]">
          {s.ask}
        </label>
        <div className="mt-3 flex gap-2">
          <input id="agent-ask" value={text} onChange={(e) => setText(e.target.value)} placeholder={s.placeholder} maxLength={1000} className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-ink/50" data-testid="agent-ask" />
          <Button type="submit" variant="agent" className="h-12 px-5" disabled={text.trim().length < 3 || Boolean(busy)}>
            {busy === "ask" ? <Spinner /> : <Icon name="send" size={16} />} Ask
          </Button>
        </div>
        {err && (
          <p className="mt-2 text-[13px] text-bad" role="alert">
            {err}
          </p>
        )}
      </form>

      <section aria-labelledby="builds">
        <h2 id="builds" className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
          {s.buildsTitle}
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.builds.map((b) => (
            <li key={b.title}>
              <button type="button" onClick={() => void start(agent, b.say, b.title)} disabled={Boolean(busy)} className="pix-lift pressable group flex h-full w-full flex-col rounded-2xl border border-line bg-panel p-2.5 text-left hover:border-ink disabled:opacity-60" data-testid="quick-build">
                <span className="preview-blocks relative flex aspect-[16/7] w-full items-center justify-center rounded-xl border border-ink/10">
                  <span className="pix-shadow inline-flex rounded-xl border-[1.5px] border-ink bg-panel p-2.5">
                    <Glyph name={b.glyph} size={44} />
                  </span>
                  {busy === b.title && (
                    <span className="absolute right-2 top-2 text-agent-ink">
                      <Spinner />
                    </span>
                  )}
                </span>
                <span className="flex flex-1 items-end justify-between gap-3 px-1.5 pb-1 pt-2.5">
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold leading-snug">{b.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{b.sub}</span>
                  </span>
                  <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-line px-3 text-[12px] font-semibold text-ink-2 transition-colors group-hover:border-ink group-hover:text-ink">Start</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {agent === "trado" && (
        <section aria-labelledby="board">
          <h2 id="board" className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Your trading
          </h2>
          <TradeBoard />
        </section>
      )}

      <section aria-labelledby="yours">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="yours" className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Your jobs with {t.name}
          </h2>
          <Link href={`/home?folder=${agent}`} className="text-[13px] font-medium underline underline-offset-2">
            All of them
          </Link>
        </div>
        {mine.length ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((r) => (
              <Card key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#d5d4ce] bg-panel/60 p-5 text-center text-[14px] text-ink-2">No jobs with {t.name} yet.</p>
        )}
      </section>
    </div>
  );
}
