import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobById } from "@/lib/jobs";
import { coerce } from "@/server/dataflow";
import { liveAllowed } from "@/server/access";
import { liveReady } from "@/server/chain";
import { liveCanTrade, tradingVenue, venueReady, withVenue } from "@/server/exchange";
import { askOf, buildChecked, realOnly, venueFor } from "@/server/jobs";
import { withNet } from "@/server/netContext";
import { createRun, discard, offerMove, offerPlan } from "@/server/orchestrator";
import { validateProposal } from "@/server/tools";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  id: z.string().max(40),
  /** What was picked on the card: a city, a team, a price line. */
  choice: z.string().max(80).optional(),
  /** What the person typed into the card: their link, business, phone or place. */
  inputs: z.record(z.string().max(40), z.string().max(600)).optional(),
  mode: z.enum(["demo", "live"]).default("demo"),
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  venue: z.enum(["paper", "gemini-sandbox", "gemini"]).optional(),
  accessCode: z.string().max(200).optional(),
});

/**
 * Opens a catalog job: the move is built by code from live data and checked like any other, then
 * shown in the job's chat as the agent's answer, ready to change or set up.
 */
export async function POST(req: NextRequest) {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  const card = jobById(b.data.id);
  if (!card) return NextResponse.json({ error: "That job isn't in the catalog" }, { status: 404 });
  // Checks paid in real USDC only run on Arc mainnet, so those jobs are real-money jobs.
  const real = card.money === "real";
  const mode = real ? "live" : b.data.mode;
  const network = real ? "mainnet" : b.data.network;
  if (real && !liveReady("mainnet")) return NextResponse.json({ error: "This check is paid in real USDC on Arc mainnet, which isn't set up on this server yet." }, { status: 503 });
  if (mode === "live" && !liveAllowed(b.data.accessCode)) return NextResponse.json({ error: "Real-money jobs need the access code. Add it in Settings." }, { status: 403 });
  // Each input is checked by its type before anything is built: a link must be a link, a phone a phone.
  const inputs: Record<string, string> = {};
  for (const f of card.inputs ?? []) {
    const raw = b.data.inputs?.[f.name]?.trim();
    if (!raw) continue;
    const v = coerce(f.type, raw);
    if (v == null || v === "") return NextResponse.json({ error: `That doesn't look like a ${f.label.toLowerCase()}: “${raw.slice(0, 60)}”` }, { status: 400 });
    inputs[f.name] = String(v);
  }
  const want: Venue = b.data.venue && venueReady(b.data.venue) ? b.data.venue : tradingVenue();
  const venue = venueFor(card, want);
  // Weather, sports and the Fed trade only on Gemini's live exchange: no stand-in order is made.
  if (realOnly(card) && venue === "gemini") {
    const live = await liveCanTrade();
    if (!live.ok) return NextResponse.json({ error: `Needs a verified Gemini account: this market trades only on Gemini's live exchange, and ${live.why}. Try a crypto or commodity card: those run on Gemini's test exchange.` }, { status: 409 });
  }
  try {
    // The request reads with the market it's built on ("I have tickets for Portland vs New York…").
    const ask = (await withVenue(venue, () => askOf(card.id, venue, b.data.choice, inputs)).catch(() => undefined)) ?? card.title;
    const run = await createRun({ agent: card.id === "trip-gas" ? "inso" : card.agent, task: ask, mode, network, venue }, { quiet: true });
    const built = await withNet(run.network, () => withVenue(run.venue, () => buildChecked(card.id, want, (input) => validateProposal(card.agent, input, `${run.id}-m`, { composed: true }), b.data.choice, inputs)));
    if ("error" in built) {
      discard(run.id);
      return NextResponse.json({ error: built.error }, { status: 503 });
    }
    if ("plan" in built) {
      const plan = await withNet(run.network, () => withVenue(run.venue, () => built.plan.plan(run.id)));
      if ("error" in plan) {
        discard(run.id);
        return NextResponse.json({ error: plan.error }, { status: 503 });
      }
      return NextResponse.json(offerPlan(run.id, plan, built.plan.intro));
    }
    return NextResponse.json(offerMove(run.id, built.proposal, built.intro));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
