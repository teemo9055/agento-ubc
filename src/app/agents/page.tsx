import { Mascot } from "@/components/Mascot";
import { OUTFIT_LABEL, type Mood, type Outfit } from "@/lib/outfit";
import { THEMES } from "@/lib/themes";
import type { AgentId } from "@/lib/types";

const OUTFITS: Outfit[] = ["none", "sports", "health", "crypto", "commodities", "weather", "politics", "travel", "finance"];
const MOODS: { mood: Mood; label: string }[] = [
  { mood: "idle", label: "Draft" },
  { mood: "working", label: "Running" },
  { mood: "alert", label: "Needs you" },
  { mood: "happy", label: "Done" },
  { mood: "sad", label: "Cancelled" },
];

export default function Agents() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Agents</h1>
        <p className="mt-1 text-[15px] text-ink-2">Three agents share one core. Each mascot changes its outfit to match the job&apos;s topic, and its face to match the job&apos;s status.</p>
      </header>
      {(Object.keys(THEMES) as AgentId[]).map((a) => (
        <section key={a} data-agent={a} className="rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-center gap-4">
            <Mascot agent={a} size={88} mood="idle" />
            <div>
              <h2 className="font-pixel text-xl text-agent-ink">{THEMES[a].name}</h2>
              <p className="text-sm text-ink-2">
                {THEMES[a].domain} · {THEMES[a].tagline}
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {OUTFITS.map((o) => (
              <figure key={o} className="flex flex-col items-center gap-1.5">
                <Mascot agent={a} outfit={o} size={56} />
                <figcaption className="text-center text-[12px] text-ink-3">{OUTFIT_LABEL[o] || "Plain"}</figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-4">
            {MOODS.map((m) => (
              <figure key={m.mood} className="flex items-center gap-2">
                <Mascot agent={a} mood={m.mood} size={40} />
                <figcaption className="text-[12px] text-ink-2">{m.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
