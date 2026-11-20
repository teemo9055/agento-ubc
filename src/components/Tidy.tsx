import { tidy } from "@/lib/tidy";

/**
 * A generated paragraph, laid out to scan: the figures it mentions as big numbers, a one-line lead,
 * then the supporting points as short numbered lines.
 */
export function Tidy({ text, figures = true, size = "md" }: { text: string; figures?: boolean; size?: "sm" | "md" }) {
  const t = tidy(text);
  const sm = size === "sm";
  return (
    <div className="min-w-0" data-testid="tidy">
      {figures && t.figures.length > 0 && (
        <dl className="mb-2.5 flex flex-wrap gap-x-5 gap-y-2">
          {t.figures.map((f) => (
            <div key={f.value} className="min-w-0">
              <dd className="num text-[18px] font-semibold leading-none">{f.value}</dd>
              {f.label && <dt className="mt-1 max-w-[12rem] truncate text-[11.5px] text-ink-3">{f.label}</dt>}
            </div>
          ))}
        </dl>
      )}
      <p className={`${sm ? "text-[13.5px]" : "text-[14.5px]"} font-medium leading-snug text-ink`}>{t.lead}</p>
      {t.points.length > 0 && (
        <ol className="mt-2 grid gap-1.5">
          {t.points.map((p, i) => (
            <li key={p} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
              <span className="num mt-px inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-ink/25 text-[10.5px] font-semibold text-ink-3">{i + 1}</span>
              <span className="min-w-0">{p}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
