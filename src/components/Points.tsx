import type { ReactNode } from "react";

/**
 * Grouped points as boxes, never bullets or check marks: a card with a colored stripe, an optional
 * pixel-font label, an optional title and a line of text. Use Points around them for the grid.
 *
 *   <Points>
 *     <Point tone="good" label="Payments" title="You approve every one">Code builds and checks each payment.</Point>
 *   </Points>
 *
 * size "md" (default): a card with a stripe on top, for points that stand on their own.
 * size "sm": a compact box with a stripe on the left, for lists inside other cards.
 */
export type PointTone = "agent" | "good" | "warn" | "bad" | "muted" | "ink";

// Stripe colors name one side only (top for cards, left for compact boxes), so they never fight the
// plain border color of the other three sides.
const TONE: Record<PointTone, { top: string; left: string; label: string; soft: string }> = {
  agent: { top: "border-t-agent", left: "border-l-agent", label: "text-agent-ink", soft: "bg-agent-soft/50" },
  good: { top: "border-t-good", left: "border-l-good", label: "text-good", soft: "bg-good/5" },
  warn: { top: "border-t-warn", left: "border-l-warn", label: "text-warn-ink", soft: "bg-warn-soft" },
  bad: { top: "border-t-bad", left: "border-l-bad", label: "text-bad", soft: "bg-bad/5" },
  muted: { top: "border-t-ink-3/40", left: "border-l-ink-3/40", label: "text-ink-3", soft: "bg-surface" },
  ink: { top: "border-t-ink", left: "border-l-ink", label: "text-ink", soft: "bg-panel" },
};

type As = "div" | "li";

export function Point({
  tone = "agent",
  label,
  title,
  children,
  size = "md",
  soft = false,
  as: Tag = "div",
  className = "",
  ...rest
}: {
  tone?: PointTone;
  label?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  size?: "md" | "sm";
  /** Tint the box with the tone (for warnings and gaps), instead of a plain panel. */
  soft?: boolean;
  as?: As;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const t = TONE[tone];
  const box =
    size === "sm"
      ? `rounded-lg border border-line border-l-[3px] px-2.5 py-1.5 text-[13px] ${t.left}`
      : `rounded-xl border border-line border-t-[3px] px-3.5 pb-3 pt-2.5 text-[13.5px] ${t.top}`;
  return (
    <Tag {...rest} className={`flex min-w-0 flex-col gap-0.5 ${soft ? t.soft : "bg-panel"} ${box} ${className}`}>
      {/* The spaces between parts are for screen readers and copied text; the column layout ignores them. */}
      {label != null && <span className={`font-pixel text-[10.5px] uppercase leading-tight tracking-wide ${t.label}`}>{label}</span>}
      {label != null && (title != null || children != null) && " "}
      {title != null && <span className={`font-semibold leading-snug text-ink ${size === "sm" ? "text-[13px]" : "text-[14.5px]"}`}>{title}</span>}
      {title != null && children != null && " "}
      {children != null && <span className={`leading-snug ${title != null ? "text-ink-2" : "text-ink"}`}>{children}</span>}
    </Tag>
  );
}

/** The grid that holds Point boxes. "auto" fits as many columns as there is room for; "stack" is one column. */
export function Points({
  children,
  layout = "auto",
  as: Tag = "div",
  className = "",
  min = 200,
  ...rest
}: {
  children: ReactNode;
  layout?: "auto" | "stack";
  as?: "div" | "ul" | "ol";
  /** Narrowest a column may get, in px, for the "auto" layout. */
  min?: number;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const style = layout === "auto" ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` } : undefined;
  return (
    <Tag {...rest} style={{ ...style, ...rest.style }} className={`m-0 grid list-none gap-2 p-0 ${className}`}>
      {children}
    </Tag>
  );
}
