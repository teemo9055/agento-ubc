import type { AgentId } from "@/lib/types";

/** Small, friendly glyph per agent. Inherits the agent accent. */
export function AgentIcon({ agent, size = 40, className = "" }: { agent: AgentId; size?: number; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span
      data-agent={agent}
      className={`inline-flex shrink-0 items-center justify-center rounded-[30%] bg-agent-soft text-agent ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58}>
        {agent === "inso" && (
          <>
            <circle cx="12" cy="11" r="7" {...common} />
            <path d="M8.5 11.5c1-2 2.2-3 3.5-3s2.5 1 3.5 3" {...common} />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <path d="M8 20h8" {...common} />
            <path d="M18.5 4.5l.6-1.6M20 6.5l1.6-.4" {...common} />
          </>
        )}
        {agent === "trado" && (
          <>
            <path d="M6 4v16M12 7v12M18 3v12" {...common} />
            <rect x="4.5" y="8" width="3" height="7" rx="1" fill="currentColor" stroke="none" />
            <rect x="10.5" y="10" width="3" height="5" rx="1" {...common} />
            <rect x="16.5" y="5" width="3" height="6" rx="1" fill="currentColor" stroke="none" />
          </>
        )}
        {agent === "travo" && (
          <>
            <path d="M5 19c3-1 3-6 7-6s4-5 7-6" {...common} strokeDasharray="2 2.5" />
            <circle cx="5" cy="19" r="1.8" fill="currentColor" />
            <path d="M19 3.5a3 3 0 0 1 3 3c0 2.2-3 4.5-3 4.5s-3-2.3-3-4.5a3 3 0 0 1 3-3z" {...common} />
            <circle cx="19" cy="6.5" r="0.9" fill="currentColor" />
          </>
        )}
      </svg>
    </span>
  );
}
