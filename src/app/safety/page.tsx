import Link from "next/link";
import { Point, Points } from "@/components/Points";
import { limits } from "@/server/settings";
import { STRIKE_HOURS, STRIKE_LIMIT } from "@/server/strikes";
import { REFUND_WINDOW_MIN } from "@/server/x402";
import { TEST_LABEL } from "@/server/delivery";

export const dynamic = "force-dynamic";

/** How a job decides and what stops it, in plain words: the same loop and limits the README documents. */
const LOOP: { who: "AI" | "Code" | "You" | "Arc"; title: string; text: string }[] = [
  { who: "AI", title: "Understands", text: "Looks things up for free and asks you at most one question. It can propose a job, but it can't pay, sign, order or pick who gets paid." },
  { who: "Code", title: "Checks the proposal", text: "The market exists and is open, the size fits your budget and limits, and prices and payees come from the sellers themselves. The card's words and numbers are written by code." },
  { who: "You", title: "Review and approve once", text: "What you asked for, what happens, what can go wrong and the most it can cost. Nothing is spent before this." },
  { who: "Arc", title: "Locks the money", text: "A vault holds only this job's money, with a fixed list of who can be paid and how much. The contract refuses anything else." },
  { who: "Code", title: "Pays step by step", text: "Before every payment: is it on the approved list, to the same seller, within the price? If not, it stops and asks you." },
  { who: "Code", title: "Checks what arrived", text: "Every paid answer is checked against what the seller promised. An empty or wrong answer is never used, and the money comes back." },
  { who: "Code", title: "Acts only if the checks pass", text: "Prices are read fresh right before the order. If any check fails or can't be read, nothing is bought." },
  { who: "Arc", title: "Closes", text: "The vault closes and every unspent cent goes back to you, with a receipt for each payment." },
];

const WHO: Record<(typeof LOOP)[number]["who"], string> = {
  AI: "bg-[#ece6ff] text-[#4b2fb3]",
  Code: "bg-[#e6f0ff] text-[#1d4fa8]",
  You: "bg-[#fff1d6] text-[#8a5a00]",
  Arc: "bg-[#e3f6ec] text-[#16663f]",
};

export default function SafetyPage() {
  const l = limits();
  const rows: [string, string][] = [
    ["One order", `at most $${l.maxOrderUsd}`],
    ["Data and services for one job", `at most ${l.maxJobUsdc} USDC`],
    ["A whole plan, every step together", `at most $${l.maxPlanUsd}`],
    ["A single purchase that needs a closer look", `over ${l.bigSpendUsdc} USDC`],
    ["One request to an outside seller", "at most 0.01 USDC"],
    ["A change the AI asks for mid-job", "asks you; no answer in 2 minutes means no"],
    ["A value one step passes to the next", "checked against the field it fills; a phone, link or wallet that doesn't fit stops that step"],
    ["A step that only runs if needed, or a tie-breaker", "priced up front, bought only if an answer calls for it or two sources disagree"],
    ["A service that sends, buys, books or calls", "never put in a plan: Agento only buys answers"],
  ];
  const back: [string, string][] = [
    ["Money set aside but not spent", "Comes back when the job ends or you stop it"],
    ["An answer that failed the check, from Agento's own seller", `Refunded on Arc (claims within ${REFUND_WINDOW_MIN} minutes, once per sale)`],
    ["An answer that failed the check, from an outside seller", "You aren't charged; the app covers it"],
    ["A good answer the agent then didn't use", "Stays paid: it was delivered"],
    ["A tie-breaker or a branch that wasn't needed", "Never bought, never charged"],
    ["A recipe an outside agent bought that couldn't deliver", "Refunded in full to the paying address"],
    ["An order that filled", "That's the trade you approved; an unfilled order can be cancelled any time"],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">How it stays safe</h1>
        <p className="mt-1 text-[15px] text-ink-2">The AI suggests, code checks, you approve, and the contract on Arc enforces it.</p>
      </header>

      <section aria-labelledby="loop">
        <h2 id="loop" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          What happens to every request
        </h2>
        <ol className="space-y-2" data-testid="safety-loop">
          {LOOP.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-xl border border-line bg-panel p-3.5">
              <span className="num mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line font-pixel text-[13px]">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${WHO[s.who]}`}>{s.who === "Arc" ? "Arc contract" : s.who}</span>
                </div>
                <p className="mt-0.5 text-[14px] text-ink-2">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[13px] text-ink-3">You can stop at any point: the vault closes and what's left comes back.</p>
      </section>

      <section aria-labelledby="limits">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="limits" className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            Your limits now
          </h2>
          <Link href="/settings" className="text-[13px] font-medium underline underline-offset-2">
            Change them
          </Link>
        </div>
        <dl className="divide-y divide-line rounded-xl border border-line bg-panel" data-testid="safety-limits">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 px-3.5 py-2.5 text-[14px]">
              <dt className="text-ink-2">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="checks">
        <h2 id="checks" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          The check on every paid answer
        </h2>
        <Points as="ul" min={260} data-testid="safety-checks">
          {Object.values(TEST_LABEL).map((t) => (
            <Point as="li" key={t} tone="good">
              {t}
            </Point>
          ))}
        </Points>
        <p className="mt-2 text-[13px] text-ink-3">
          Fair to sellers too: the rules are published before the sale, an empty result or "not found" counts as a real answer, a lost connection is nobody's fault, and a seller is only paused after {STRIKE_LIMIT} misses within {STRIKE_HOURS} hours. One good answer clears it.
        </p>
      </section>

      <section aria-labelledby="back">
        <h2 id="back" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          What comes back to you
        </h2>
        <dl className="divide-y divide-line rounded-xl border border-line bg-panel">
          {back.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-3.5 py-2.5 text-[14px] sm:grid-cols-2">
              <dt className="text-ink-2">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
