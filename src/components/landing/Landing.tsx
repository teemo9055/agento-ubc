"use client";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import type { AgentId } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { Strokes } from "./Stickers";
import { ApproveBoard, AskBoard, DoneBoard, MapBoard } from "./Boards";

const APP = "/home";

const PANELS: { agent: AgentId; lead: string; accent: string; sub: string; Board: ComponentType }[] = [
  { agent: "inso", lead: "Say what you", accent: "want done", sub: "Type it in plain words, like a message to a friend. An agent picks it up.", Board: AskBoard },
  { agent: "trado", lead: "See the work", accent: "on a map", sub: "Each job is drawn as steps, so you can see what happens, and in what order.", Board: MapBoard },
  { agent: "worko", lead: "Approve", accent: "once", sub: "Read what it will do, what could go wrong and the most it costs. Then say yes.", Board: ApproveBoard },
  { agent: "inso", lead: "Watch it", accent: "happen", sub: "Follow each step as it runs. You get the result, a receipt and your change back.", Board: DoneBoard },
];

function Brand() {
  return (
    <span className="flex items-center gap-2.5 text-[16px] font-bold tracking-tight">
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink font-pixel text-[14px] text-white">
        a
        <span className="absolute -right-[3px] -top-[3px] h-[9px] w-[9px] rounded-[2px] border-2 border-[#efeae2] bg-agent" />
      </span>
      agento
    </span>
  );
}

/** First-visit landing: four panels that explain Agento, then into the app. */
export function Landing() {
  const scroller = useRef<HTMLDivElement>(null);
  const panels = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const lock = useRef<{ to: number; until: number } | null>(null);

  const goTo = useCallback((i: number) => {
    const el = panels.current[i];
    const box = scroller.current;
    if (!el || !box) return;
    const n = Math.max(0, Math.min(PANELS.length - 1, i));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lock.current = { to: n, until: Date.now() + 700 };
    setActive(n);
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  }, []);

  // The panel nearest the middle is the current one (swipes and trackpads move it too).
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const mid = box.scrollLeft + box.clientWidth / 2;
      let best = 0;
      let dist = Infinity;
      panels.current.forEach((el, i) => {
        if (!el) return;
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      const l = lock.current;
      if (l && Date.now() < l.until && best !== l.to) return;
      lock.current = null;
      setActive(best);
    };
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(settle, 90);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      clearTimeout(t);
      box.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Keep the current panel centred when the window size changes.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const el = panels.current[active];
      if (el) box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2 });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable]")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(active - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goTo]);

  // The landing covers the app chrome; the page underneath shouldn't scroll.
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, []);

  return (
    <div className="lnd fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden overscroll-contain bg-[#fbf9f5] sm:bg-[#efeae2]">
      <div className="flex min-h-full flex-col">
        <header className="sr-only sm:not-sr-only sm:relative sm:px-6 sm:pt-6 lg:pt-7">
          <div className="sm:mb-3 lg:absolute lg:left-7 lg:top-7 lg:mb-0">
            <Brand />
          </div>
          <div className="mx-auto max-w-[700px] text-center">
            <h1 className="text-balance text-[20px] font-semibold leading-snug tracking-tight lg:text-[22px]">
              Agento lets anyone put an AI agent to work: say what you want, check the plan in plain words, approve once.
            </h1>
            <p className="mx-auto mt-1.5 max-w-[620px] text-balance text-[14px] leading-relaxed text-ink-2">
              <Icon name="shield" size={16} className="mr-1.5 inline-block -translate-y-px align-middle text-good" />
              <b className="font-semibold text-ink">Why it&rsquo;s safe:</b> it can only spend what you approved, held in a locked account for that one job. The rest comes back to you.
            </p>
          </div>
        </header>

        <section aria-roledescription="carousel" aria-label="How Agento works" className="relative flex-1 sm:flex-none">
          <div
            ref={scroller}
            aria-live="polite"
            className="lnd-scroller flex h-[100dvh] snap-x snap-mandatory overflow-x-auto overflow-y-hidden sm:h-auto sm:gap-7 sm:px-[calc(50%-196px)] sm:py-5"
          >
            {PANELS.map((p, i) => {
              const on = i === active;
              const last = i === PANELS.length - 1;
              return (
                <article
                  key={i}
                  ref={(el) => {
                    panels.current[i] = el;
                  }}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${PANELS.length}`}
                  data-agent={p.agent}
                  data-active={on}
                  onClick={on ? undefined : () => goTo(i)}
                  className={`lnd-slide relative h-full w-full shrink-0 snap-center bg-[#fbf9f5] sm:h-[var(--lnd-ph)] sm:w-[392px] sm:rounded-[30px] ${
                    on ? "sm:shadow-[0_30px_60px_-28px_rgb(60_45_20/0.45),0_2px_6px_rgb(60_45_20/0.08)]" : "cursor-pointer sm:scale-[0.88] sm:opacity-50 sm:shadow-[0_20px_40px_-26px_rgb(60_45_20/0.35)]"
                  }`}
                >
                  <div inert={!on} className="flex h-full flex-col px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] sm:px-7 sm:pb-6 sm:pt-5">
                    <div className="flex h-11 items-center justify-between">
                      <button
                        type="button"
                        onClick={() => goTo(i - 1)}
                        disabled={i === 0}
                        aria-label="Back"
                        className="-ml-2.5 inline-flex h-11 w-11 items-center justify-center rounded-[12px] text-ink transition-colors hover:bg-ink/5 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <Icon name="back" size={22} stroke={2} />
                      </button>
                      <Link href={APP} className="-mr-3 inline-flex h-11 items-center rounded-[10px] px-3 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink">
                        Skip
                      </Link>
                    </div>

                    <h2 className="lnd-title mt-2 text-[34px] font-bold leading-[1.06] tracking-[-0.02em] sm:text-[36px]">
                      <span className="block">{p.lead}</span>
                      <span className="whitespace-nowrap">
                        <span className="lnd-serif text-agent-ink">{p.accent}</span>
                        <Strokes className="ml-2 align-middle" />
                      </span>
                    </h2>
                    <p className="lnd-sub mt-2.5 text-[15px] leading-[1.45] text-ink-2">{p.sub}</p>

                    <div className="mt-4 flex min-h-0 flex-1 flex-col">
                      <p.Board />
                    </div>

                    <div className="mt-4 flex h-14 items-center justify-between gap-3">
                      <div className="-ml-2 flex items-center" role="group" aria-label="Choose a panel">
                        {PANELS.map((_, j) => (
                          <button
                            key={j}
                            type="button"
                            onClick={() => goTo(j)}
                            aria-label={`Go to panel ${j + 1}`}
                            aria-current={j === i ? "true" : undefined}
                            className="group inline-flex h-8 w-6 items-center justify-center rounded-[8px]"
                          >
                            <span className={`block h-2 rounded-[4px] transition-all duration-300 motion-reduce:transition-none ${j === i ? "w-5 bg-ink" : "w-2 bg-[#c9c6bd] group-hover:bg-ink-3"}`} />
                          </button>
                        ))}
                      </div>
                      {last ? (
                        <Link
                          href={APP}
                          className="lnd-press inline-flex h-14 items-center gap-2 rounded-[14px] border-[1.5px] border-ink bg-ink px-6 text-[16px] font-semibold text-white"
                        >
                          Open Agento
                          <Icon name="arrow" size={18} stroke={2.4} />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => goTo(i + 1)}
                          aria-label="Next"
                          className="lnd-press inline-flex h-14 w-14 items-center justify-center rounded-[50%] border-[1.5px] border-ink bg-ink text-white"
                        >
                          <Icon name="arrow" size={22} stroke={2.4} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <p className="hidden px-6 pb-6 pt-1 text-center text-[12px] text-ink-2 sm:block">
          Under the hood: each job gets its own vault on Arc, and the agent pays for data per request in USDC (x402).
        </p>
      </div>
    </div>
  );
}
