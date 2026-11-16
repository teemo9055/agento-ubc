import type { AgentId, Plan, PlanStep, Proposal } from "@/lib/types";
import * as gemini from "./gemini";
import { addresses } from "./chain";
import { marketBase, tradingVenue } from "./exchange";
import { checkPlanShape, validateProposal } from "./tools";

/**
 * A ready-made workflow that only uses things that really execute today, and costs about six
 * cents: ten steps across the three agents, paid lookups from three sellers, an order that
 * spends an earlier sale's proceeds only if two price sources agree, and a trip.
 *
 * It is built from live data without the model, so it works the same every time. Every step
 * goes through the same checks as a move an agent proposed; one that can't be built right now
 * (a vendor is down, a market is closed) is left out and named.
 */
interface Draft {
  key: string;
  agent: AgentId;
  after: string[];
  gate?: "filled";
  useProceeds?: boolean;
  move: Record<string, unknown>;
}

const lookup = (tool: string, args: Record<string, string>, label: string, why: string) => ({ tool, args, label, why });
const info = (title: string, why: string, ask: string, research: unknown[]) => ({ title, why, ask, research, action: null, condition: null, budgetUsd: null });

export async function buildShowcase(id: string): Promise<{ plan: Plan } | { error: string }> {
  const venue = tradingVenue();
  const [spot, events] = await Promise.all([gemini.spotTicker("btcusd").catch(() => null), gemini.searchEvents("BTC", 6, marketBase(venue)).catch(() => [] as gemini.MarketEvent[])]);
  if (!spot) return { error: "Gemini's prices aren't answering right now, so the showcase can't be built. Try again in a minute." };

  // The BTC contract closest to a coin flip that stays open for at least two more hours.
  const open = events
    .flatMap((e) => e.contracts.filter((c) => c.open !== false && (c.ask ?? c.last) != null && (!c.expiry || Date.parse(c.expiry) - Date.now() > 2 * 3_600_000)).map((c) => ({ e, c })))
    .sort((a, b) => Math.abs((a.c.ask ?? a.c.last)! - 0.5) - Math.abs((b.c.ask ?? b.c.last)! - 0.5))[0];
  // A floor a little under today's price: the two-source check is real, and passes unless the market drops 3%.
  const floor = Math.floor((spot.last * 0.97) / 500) * 500;
  const sellAt = Number((spot.last * 0.995).toPrecision(5));

  const drafts: Draft[] = [
    {
      key: "prices",
      agent: "trado",
      after: [],
      move: info("Price check: BTC, ETH and gold", "An independent read of three prices from Chainlink, bought per request.", "Buy three Chainlink prices?", [
        lookup("oracle_price", { symbol: "btcusd" }, "Chainlink BTC", "the order later depends on it"),
        lookup("oracle_price", { symbol: "ethusd" }, "Chainlink ETH", "second coin"),
        lookup("oracle_price", { symbol: "xauusd" }, "Chainlink gold", "a non-crypto price"),
      ]),
    },
    {
      key: "network",
      agent: "trado",
      after: [],
      move: info("Network check: Ethereum, Base and Bitcoin", "What it costs to move money on three networks right now.", "Check gas on Ethereum and Base and how busy Bitcoin is?", [
        lookup("gas_price", { chain: "ethereum" }, "Ethereum gas", "cost to transact"),
        lookup("gas_price", { chain: "base" }, "Base gas", "cost to transact"),
        lookup("btc_network", {}, "Bitcoin fees and mempool", "how busy it is"),
      ]),
    },
    {
      key: "receipt",
      agent: "trado",
      after: [],
      move: info("Pay a second vendor: BotPay receipt", "Proves the agent can pay any marketplace seller by its own listing, not just one.", "Buy one paid receipt from BotPay?", [
        lookup("service", { url: "https://api.botpay.network/pay", input: JSON.stringify({ testRunId: `showcase-${id}` }), what: "Paid access receipt" }, "BotPay receipt", "a second seller on the marketplace"),
      ]),
    },
    {
      key: "sell",
      agent: "trado",
      after: [],
      move: { title: "Raise $5: sell a little BTC", why: "The money for the bet comes from this sale.", ask: `Sell $5 of BTC at $${sellAt.toLocaleString()} or better?`, research: [], action: { kind: "spot_order", symbol: "btcusd", side: "sell", limitPrice: sellAt, amountUsd: 5 }, condition: null, budgetUsd: null },
    },
    {
      key: "trip",
      agent: "travo",
      after: [],
      move: { title: "Weekend drive: Dallas to San Antonio via Austin", why: "A two-day route with places to stay each night.", ask: "Plan the two-day drive?", research: [lookup("drive_route", { stops: "Dallas, TX|Austin, TX|San Antonio, TX" }, "Driving route", "distance and hours per leg")], action: { kind: "itinerary", stops: ["Dallas, TX", "Austin, TX", "San Antonio, TX"], hoursPerDay: 4 }, condition: null, budgetUsd: null },
    },
    { key: "wallet", agent: "trado", after: ["network"], move: info("Wallet check: the agent's own USDC on Base", "A read of a real wallet on another chain.", "Read the agent wallet's balance on Base?", [lookup("wallet_balance", { chain: "base", address: addresses.agent ?? "" }, "Agent wallet on Base", "balance on another chain")]) },
    {
      key: "fx",
      agent: "travo",
      after: ["trip"],
      move: info("Trip budget: euro and pound rates", "Exchange rates for budgeting, from Chainlink.", "Check the euro and pound rates?", [lookup("oracle_price", { symbol: "eurusd" }, "Euro rate", "trip budget"), lookup("oracle_price", { symbol: "gbpusd" }, "Pound rate", "trip budget")]),
    },
  ];

  if (open) {
    const yes = (open.c.ask ?? open.c.last)!;
    const max = Math.min(0.99, Math.round((yes + 0.01) * 100) / 100);
    drafts.push(
      { key: "odds", agent: "inso", after: [], move: info("Read the market: how the BTC odds moved", "The recent path of the odds on the contract the order will buy.", "Buy the odds history?", [lookup("odds_history", { symbol: open.c.symbol, tf: "15m" }, "Odds history", "is it trending?")]) },
      {
        key: "bet",
        agent: "inso",
        after: ["prices", "odds", "sell"],
        gate: "filled",
        useProceeds: true,
        move: {
          title: `Bet the proceeds: YES on ${open.c.label}`.slice(0, 60),
          why: "Spends what the sale brought in, and only if Chainlink and Gemini both have BTC above the floor.",
          ask: `Buy YES at ${Math.round(max * 100)}¢ or less with the sale's proceeds, if both sources have BTC above $${floor.toLocaleString()}?`,
          research: [lookup("oracle_price", { symbol: "btcusd" }, "Chainlink BTC", "first source for the check")],
          action: { kind: "prediction_order", eventTicker: open.e.ticker, symbol: open.c.symbol, label: open.c.label.slice(0, 60), side: "yes", orderType: "limit", maxPrice: max, stopPrice: null, quantity: 2 },
          condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: floor },
          alsoRequire: [{ metric: "spot_price", symbol: "btcusd", op: ">=", value: floor }],
          budgetUsd: null,
        },
      },
      { key: "after", agent: "inso", after: ["bet"], move: info("Afterwards: where BTC stands", "A last independent price once the order is in.", "Buy one more Chainlink price?", [lookup("oracle_price", { symbol: "btcusd" }, "Chainlink BTC", "price after the order")]) },
    );
  }

  // Every step is checked like any other move. One that can't be built now is left out, with the reason.
  const built = await Promise.all(drafts.map((d) => (d.key === "wallet" && !addresses.agent ? Promise.resolve({ error: "No agent wallet is set up" }) : validateProposal(d.agent, d.move, `${id}-${d.key}`))));
  const kept = drafts.map((d, i) => ({ d, r: built[i] })).filter((x): x is { d: Draft; r: { proposal: Proposal } } => "proposal" in x.r);
  const dropped = drafts.map((d, i) => ({ d, r: built[i] })).filter((x) => "error" in x.r);
  if (kept.length < 3) return { error: `The showcase can't be built right now: ${("error" in built[0] ? built[0].error : "too few steps are available").slice(0, 160)}` };

  const ids = new Map(kept.map((x, i) => [x.d.key, `s${i + 1}`]));
  // The order they're listed in already has everything after what it waits for.
  const order = ["prices", "network", "odds", "receipt", "sell", "trip", "bet", "wallet", "fx", "after"];
  kept.sort((a, b) => order.indexOf(a.d.key) - order.indexOf(b.d.key));
  kept.forEach((x, i) => ids.set(x.d.key, `s${i + 1}`));
  const steps: PlanStep[] = kept.map((x) => {
    const after = x.d.after.map((k) => ids.get(k)).filter((v): v is string => Boolean(v));
    // If the sale isn't in the plan, the bet has nothing to wait to fill and nothing to spend.
    const sale = ids.has("sell") && x.d.after.includes("sell");
    return { id: ids.get(x.d.key)!, agent: x.d.agent, proposal: x.r.proposal, after, gate: x.d.gate && sale ? "filled" : "done", useProceeds: x.d.useProceeds && sale ? true : undefined, brief: x.r.proposal.title, status: "waiting" };
  });
  const wrong = checkPlanShape(steps);
  if (wrong) return { error: wrong };

  const unavailable = [
    ...dropped.map((x) => ({ what: String(x.d.move.title).slice(0, 80), why: ("error" in x.r ? x.r.error : "").split(". ")[0].slice(0, 160) })),
    ...(open ? [] : [{ what: "The BTC bet", why: "No BTC contract is open for long enough on the connected exchange right now" }]),
  ].slice(0, 4);
  return {
    plan: {
      id,
      title: "Showcase: real work for a few cents",
      why: "Three agents, three sellers, real payments. Lookups run side by side, the bet waits for the sale and two price sources, and the trip runs on its own.",
      steps,
      unavailable,
      status: "proposed",
    },
  };
}
