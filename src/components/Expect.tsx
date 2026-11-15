import type { Run } from "@/lib/types";
import { KITS } from "@/lib/agentKit";
import { fmt } from "@/lib/money";
import { actionText, conditionLabel } from "./Chat";
import { Icon, type IconName } from "./Icon";

/** The plan in five plain lines: what you get, the most it costs, what it does, what it never does, what comes back. */
export function Expect({ run }: { run: Run }) {
  const kit = KITS[run.agent];
  const p = run.proposal;
  const deliverable = run.cards.find((c) => c.kind === "deliverable")?.title;
  const order = p?.action && p.action.kind !== "itinerary" ? (p.action.kind === "prediction_order" ? p.action.maxPrice * p.action.quantity : p.action.amountUsd) : 0;
  const venue = p?.venue === "paper" ? "simulated, no real order" : p?.venue === "gemini" ? "real money on Gemini" : "Gemini test exchange";

  const rows: { icon: IconName; k: string; v: React.ReactNode }[] = [
    { icon: "receipt", k: "You get", v: deliverable ? `${deliverable}. ${kit.result}.` : `${kit.result}.` },
    {
      icon: "vault",
      k: "Most it can cost",
      v: (
        <>
          <b className="num font-semibold text-ink">{fmt(run.cap)} USDC</b> for data, held in a vault
          {order > 0 && (
            <>
              {" "}
              + an order of at most <b className="num font-semibold text-ink">${order.toFixed(2)}</b> ({venue})
            </>
          )}
        </>
      ),
    },
    {
      icon: "bolt",
      k: "Then it",
      v: p?.action ? (
        <>
          {p.condition ? (
            <>
              checks <b className="font-semibold text-ink">{conditionLabel(p.condition)}</b> on a fresh price, and only if true:{" "}
            </>
          ) : null}
          {actionText(p.action)}
        </>
      ) : (
        kit.acts
      ),
    },
    { icon: "shield", k: "It never", v: `${kit.never}. The vault only pays the ${run.lines.length} lines below.` },
    { icon: "refund", k: "Comes back", v: "Whatever the data doesn't use, as soon as the job closes." },
  ];

  return (
    <section aria-label="What to expect" className="overflow-hidden rounded-2xl border-[1.5px] border-ink bg-panel">
      <h2 className="flex items-center gap-2 border-b border-line bg-agent-soft px-4 py-2.5 text-[14px] font-semibold">
        <span aria-hidden className="h-2 w-2 rounded-[2px] bg-agent" /> What to expect
      </h2>
      <dl className="divide-y divide-[#f1f0ec]">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[22px_120px_minmax(0,1fr)] items-start gap-x-3 px-4 py-2.5 text-[13.5px] max-sm:grid-cols-[22px_minmax(0,1fr)]">
            <Icon name={r.icon} size={17} className="mt-0.5 text-agent-ink" />
            <dt className="font-semibold">{r.k}</dt>
            <dd className="text-ink-2 max-sm:col-start-2">{r.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
