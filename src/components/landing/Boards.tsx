"use client";
import type { AgentId } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { Board, Cut, MascotSticker, Pill, Sparkle, Sticker } from "./Stickers";

/** Every board is drawn on this canvas and scaled to fit. */
export const BOARD_W = 340;
export const BOARD_H = 320;

const AGENTS: { id: AgentId; name: string; does: string; x: number; y: number; tilt: number }[] = [
  { id: "inso", name: "Inso", does: "Markets & cover", x: 16, y: 150, tilt: -6 },
  { id: "trado", name: "Trado", does: "Coins", x: 126, y: 168, tilt: 4 },
  { id: "worko", name: "Worko", does: "Errands", x: 236, y: 146, tilt: -3 },
];

/** 1. The ask box and the three agents. */
export function AskBoard() {
  return (
    <Board w={BOARD_W} h={BOARD_H} label="An ask box reading “Cover me if BTC drops below $60k”, and the three agents: Inso for markets and cover, Trado for coins, Worko for errands.">
      <Sticker x={14} y={22} w={312} tilt={-2}>
        <Cut radius={20}>
          <div data-agent="inso" className="rounded-[14px] border-[1.5px] border-ink bg-white px-4 pb-3.5 pt-3">
            <div className="font-pixel text-[10px] uppercase text-ink-3">Ask an agent</div>
            <div className="mt-1.5 flex items-end gap-3">
              <div className="flex-1 text-balance text-[17px] font-semibold leading-snug">
                Cover me if BTC drops below $60k
                <span className="lnd-caret ml-0.5 inline-block h-[19px] w-[2px] translate-y-[3px] bg-agent" />
              </div>
              <span className="pix-shadow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-[1.5px] border-ink bg-agent text-agent-on">
                <Icon name="arrow" size={17} stroke={2.4} />
              </span>
            </div>
          </div>
        </Cut>
      </Sticker>
      <Sticker x={298} y={8} tilt={12} delay={300}>
        <Sparkle size={26} />
      </Sticker>
      {AGENTS.map((a, i) => (
        <Sticker key={a.id} x={a.x} y={a.y} w={88} tilt={a.tilt} delay={120 + i * 110} wobble={5 + i * 0.7}>
          <div className="flex flex-col items-center">
            <MascotSticker agent={a.id} size={84} />
            <Pill agent={a.id} className="-mt-1 font-pixel text-[12px]">
              {a.name}
            </Pill>
            <span className="mt-1.5 whitespace-nowrap text-[12px] font-medium text-ink-2">{a.does}</span>
          </div>
        </Sticker>
      ))}
    </Board>
  );
}

function OddsDrawing() {
  const bars = [18, 26, 20, 31, 36];
  return (
    <svg viewBox="0 0 92 44" width="92" height="44" className="block">
      {bars.map((h, i) => (
        <rect key={i} x={4 + i * 18} y={42 - h} width="12" height={h} rx="2" fill="var(--agent)" opacity={0.35 + i * 0.13} />
      ))}
      <path d="M8 22 L26 15 L44 20 L62 9 L80 4" fill="none" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OrderDrawing() {
  return (
    <div className="flex h-[44px] w-[92px] items-center justify-between rounded-[8px] border-[1.5px] border-ink bg-white px-2">
      <span className="rounded-[5px] bg-agent px-1.5 py-0.5 font-pixel text-[11px] text-agent-on">YES</span>
      <span className="text-right text-[10px] font-semibold leading-tight">
        BTC
        <br />
        &lt; 60k
      </span>
    </div>
  );
}

function ReportDrawing() {
  return (
    <svg viewBox="0 0 92 44" width="92" height="44" className="block">
      <rect x="18" y="2" width="44" height="40" rx="4" fill="#fff" stroke="#0b0b0b" strokeWidth="1.6" />
      <path d="M26 12h28M26 20h28M26 28h18" stroke="var(--agent)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="66" cy="32" r="10" fill="#0a7d0a" stroke="#0b0b0b" strokeWidth="1.6" />
      <path d="M61.5 32.2l3 3 5.5-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEPS: { n: number; agent: AgentId; label: string; x: number; y: number; tilt: number; draw: () => React.ReactNode }[] = [
  { n: 1, agent: "inso", label: "Odds history", x: 18, y: 24, tilt: -4, draw: OddsDrawing },
  { n: 2, agent: "trado", label: "Place the order", x: 198, y: 112, tilt: 3, draw: OrderDrawing },
  { n: 3, agent: "worko", label: "Report", x: 34, y: 202, tilt: -2, draw: ReportDrawing },
];

/** 2. The job as a little map of steps joined by a dashed path. */
export function MapBoard() {
  return (
    <Board w={BOARD_W} h={BOARD_H} label="The job drawn as three steps joined by a dashed path: Odds history, then Place the order, then Report.">
      <svg className="absolute inset-0" width={BOARD_W} height={BOARD_H} fill="none" stroke="#0b0b0b" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="7 7">
        <path className="lnd-path" d="M146 70 C 200 62, 246 72, 258 106" />
        <path className="lnd-path" d="M222 196 C 214 232, 196 246, 170 252" />
      </svg>
      <Sticker x={256} y={6} tilt={7} delay={420}>
        <MascotSticker agent="inso" size={60} mood="working" />
      </Sticker>
      {STEPS.map((s, i) => (
        <Sticker key={s.n} x={s.x} y={s.y} tilt={s.tilt} delay={i * 140} wobble={5 + i * 0.6}>
          <div className="relative" data-agent={s.agent}>
            <Cut radius={16}>
              <div className="flex w-[118px] justify-center rounded-[11px] border-[1.5px] border-ink bg-agent-soft px-3 pb-5 pt-3">{s.draw()}</div>
            </Cut>
            <span className="absolute -left-2.5 -top-2.5 flex h-7 w-7 items-center justify-center rounded-[8px] border-[2.5px] border-white bg-ink font-pixel text-[12px] text-white shadow-[0_2px_4px_rgb(40_30_10/0.25)]">
              {s.n}
            </span>
            <Pill agent={s.agent} className="absolute -bottom-4 left-1/2 -translate-x-1/2">
              {s.label}
            </Pill>
          </div>
        </Sticker>
      ))}
      <Sticker x={196} y={250} tilt={-8} delay={520}>
        <svg viewBox="0 0 40 44" width="40" height="44" className="lnd-cut-shape">
          <path d="M8 4v38" stroke="#0b0b0b" strokeWidth="3" strokeLinecap="round" />
          <path d="M9 5h24l-6 8 6 8H9z" fill="#0a7d0a" stroke="#0b0b0b" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </Sticker>
      <Sticker x={292} y={262} tilt={10} delay={600}>
        <Sparkle size={24} color="#6250d6" />
      </Sticker>
    </Board>
  );
}

/** 3. The review card: what you asked, the steps, the most it costs, one Approve. */
export function ApproveBoard() {
  const steps = ["Check the odds history", "Place the order at your price", "Send you a report"];
  return (
    <Board w={BOARD_W} h={344} label="A review card: three numbered steps, at most $2.87, and an Approve button. A note says the rest comes back.">
      <Sticker x={28} y={8} w={284} tilt={-1.5}>
        <Cut radius={20}>
          <div data-agent="inso" className="rounded-[14px] border-[1.5px] border-ink bg-white px-4 pb-3.5 pt-3">
            <div className="flex items-center gap-2">
              <Mascot agent="inso" size={22} />
              <span className="font-pixel text-[10px] uppercase text-agent-ink">Inso&rsquo;s plan</span>
            </div>
            <div className="mt-1.5 text-[14px] font-semibold leading-snug">Cover me if BTC drops below $60k</div>
            <ol className="mt-2 space-y-1.5">
              {steps.map((s, i) => (
                <li key={s} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-agent-soft font-pixel text-[10px] text-agent-ink">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="mt-2.5 flex items-baseline justify-between border-t border-dashed border-line pt-2">
              <span className="text-[12px] font-medium text-ink-2">At most</span>
              <span className="num text-[20px] font-bold">$2.87</span>
            </div>
            <div className="num text-right text-[11px] text-ink-3">order $2.73 + data up to $0.14</div>
            <span className="pix-shadow mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-ink text-[13px] font-semibold text-white">
              <Icon name="check" size={15} stroke={2.4} />
              Approve
            </span>
          </div>
        </Cut>
      </Sticker>
      <Sticker x={276} y={-14} tilt={12} delay={260}>
        <Cut radius={14}>
          <div data-agent="worko" className="flex h-[54px] w-[54px] items-center justify-center rounded-[10px] border-[1.5px] border-ink bg-agent-soft">
            <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden>
              <path d="M10 14v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#0b0b0b" strokeWidth="2.6" />
              <rect x="6.5" y="13.5" width="19" height="15" rx="3" fill="var(--agent)" stroke="#0b0b0b" strokeWidth="2" />
              <rect x="14.5" y="18" width="3" height="6" rx="1.5" fill="#0b0b0b" />
            </svg>
          </div>
        </Cut>
      </Sticker>
      <Sticker x={12} y={292} tilt={-3} delay={380}>
        <Cut radius={14}>
          <div data-agent="worko" className="flex items-center gap-2 px-3 py-1.5">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="text-agent-ink" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
            <span className="lnd-serif text-[19px] text-agent-ink">the rest comes back</span>
          </div>
        </Cut>
      </Sticker>
    </Board>
  );
}

/** 4. The finish card, with sparkles. */
export function DoneBoard() {
  const steps = ["Odds history", "Place the order", "Report"];
  return (
    <Board w={BOARD_W} h={BOARD_H} label="A finished job card: Done, $0.12 spent, $0.02 came back.">
      <Sticker x={206} y={6} w={112} tilt={9} delay={200}>
        <Cut radius={12}>
          <div className="rounded-[8px] border-[1.5px] border-ink bg-white px-2.5 pb-2.5 pt-2">
            <div className="font-pixel text-[9px] uppercase text-ink-3">Receipt</div>
            {["0.02", "0.06", "0.04"].map((v) => (
              <div key={v} className="mt-1.5 flex items-center justify-between gap-2">
                <span className="h-1.5 flex-1 rounded-[2px] bg-line" />
                <span className="num text-[10px] font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </Cut>
      </Sticker>
      <Sticker x={16} y={62} w={302} tilt={-2}>
        <Cut radius={20}>
          <div data-agent="inso" className="rounded-[14px] border-[1.5px] border-ink bg-white px-4 pb-3.5 pt-3">
            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-good/10 px-2 text-[12px] font-semibold text-good">
              <Icon name="check" size={12} stroke={2.6} /> Done
            </span>
            <div className="mt-1.5 text-[15px] font-semibold leading-snug">Cover placed at your price</div>
            <ul className="mt-2 space-y-1">
              {steps.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] bg-good text-white">
                    <Icon name="check" size={10} stroke={3} />
                  </span>
                  {s}
                </li>
              ))}
            </ul>
            <div className="num mt-3 rounded-[10px] bg-[#f3f1ea] px-3 py-2 text-[12.5px] font-semibold">
              Done · $0.12 spent · <span className="text-good">$0.02 came back</span>
            </div>
          </div>
        </Cut>
      </Sticker>
      <Sticker x={262} y={254} tilt={8} delay={320}>
        <MascotSticker agent="inso" size={66} mood="happy" />
      </Sticker>
      <Sticker x={4} y={30} tilt={-10} delay={420}>
        <Sparkle size={28} className="lnd-twinkle" />
      </Sticker>
      <Sticker x={150} y={18} tilt={6} delay={480}>
        <Sparkle size={18} color="#2368c4" className="lnd-twinkle [animation-delay:400ms]" />
      </Sticker>
      <Sticker x={22} y={272} tilt={4} delay={540}>
        <Sparkle size={24} color="#6250d6" className="lnd-twinkle [animation-delay:800ms]" />
      </Sticker>
      <Sticker x={196} y={286} tilt={-6} delay={600}>
        <Sparkle size={16} color="#eb6834" className="lnd-twinkle [animation-delay:1200ms]" />
      </Sticker>
    </Board>
  );
}
