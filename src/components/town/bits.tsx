import type { ReactNode } from "react";

/** Small shared pieces for the town's pages. */
export function Panel({ title, sub, children, id, right, className = "" }: { title: string; sub?: string; children: ReactNode; id: string; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel ${className}`} aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f1f0ec] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id={id} className="text-[16px] font-semibold">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-[13.5px] text-ink-2">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export const usd = (x: number | null | undefined) => (x == null ? "Price not given" : x === 0 ? "Free" : x < 0.01 ? `$${x.toFixed(4).replace(/0+$/, "")}` : `$${x.toFixed(2)}`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 18, 2026", the same on the server and in the browser. */
export const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_STYLE: Record<string, string> = {
  received: "bg-[#f1f0ec] text-ink",
  refunded: "bg-[#e3f6ec] text-[#16663f]",
  "kept as spam": "bg-bad/10 text-bad",
  routed: "bg-[#e6effb] text-[#1d4fa8]",
  answered: "bg-[#efedfc] text-[#4b2fb3]",
  abandoned: "bg-[#f1f0ec] text-ink-2",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex h-6 items-center rounded-md px-2 text-[12px] font-semibold ${STATUS_STYLE[status] ?? STATUS_STYLE.received}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

export const KIND_LABEL: Record<string, string> = { request: "Request", feedback: "Feedback", need: "Need", offer: "Feature offer" };

export const inputCls = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-[14px] outline-none focus:border-ink/50";

/** For developers and agents: the API and MCP way in. Kept out of the main text. */
export function DevNote({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-xl border border-dashed border-[#d5d4ce] px-4 py-3 text-[13px] text-ink-2">
      <summary className="cursor-pointer font-medium text-ink">For developers and agents</summary>
      <div className="mt-2 space-y-1.5 [&_code]:rounded [&_code]:bg-[#f1f0ec] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px]">{children}</div>
    </details>
  );
}
