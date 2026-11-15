import type { AgentId } from "@/lib/types";
import { THEMES } from "@/lib/themes";
import { Mascot } from "./Mascot";

/**
 * The directory headshot: the agent in a tie and glasses on a soft studio backdrop,
 * with an "#OpenToJobs" ring in its colour. Dead serious, mostly.
 */
export function AgentPortrait({ agent, size = 120, ring = true }: { agent: AgentId; size?: number; ring?: boolean }) {
  const id = `ring-${agent}-${size}`;
  const r = size / 2 - 7;
  return (
    <span
      data-agent={agent}
      role="img"
      aria-label={`${THEMES[agent].name}'s profile picture: a headshot in a tie and glasses`}
      className="relative inline-flex shrink-0 items-center justify-center rounded-[50%]"
      style={{ width: size, height: size }}
    >
      {/* Studio backdrop: a soft grey-to-agent wash, like a portrait booth. */}
      <span
        aria-hidden
        className="absolute inset-[7px] overflow-hidden rounded-[50%] border-[3px] border-panel"
        style={{ background: "radial-gradient(circle at 50% 30%, #ffffff 0%, #e9e8e4 55%, color-mix(in oklab, var(--agent) 30%, #d9d8d2) 100%)" }}
      >
        <span className="absolute inset-x-0 bottom-0 flex justify-center" style={{ transform: `translateY(${size * 0.04}px)` }}>
          <Mascot agent={agent} outfit="finance" glasses framed={false} size={Math.round(size * 0.72)} />
        </span>
      </span>
      {ring && (
        <svg aria-hidden viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="absolute inset-0">
          <defs>
            <path id={id} d={`M ${size / 2} ${size / 2} m ${-r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0`} />
          </defs>
          {/* Half ring along the bottom, like the platform's open-to-work frame. */}
          <path d={`M ${size / 2 - r} ${size / 2} a ${r} ${r} 0 0 0 ${2 * r} 0`} fill="none" stroke="var(--agent)" strokeWidth={13} />
          <text fill="var(--agent-on)" fontSize={Math.max(8, size * 0.075)} fontWeight={700} letterSpacing="0.06em" fontFamily="var(--font-sans)">
            <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
              #OPENTOJOBS
            </textPath>
          </text>
        </svg>
      )}
    </span>
  );
}

/** Agent banner: the agent's colour under the app's grid paper. */
export function Banner({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`bg-agent ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(to right, rgb(255 255 255 / 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.14) 1px, transparent 1px), linear-gradient(135deg, transparent 40%, rgb(0 0 0 / 0.18))",
        backgroundSize: "16px 16px, 16px 16px, auto",
      }}
    />
  );
}
