import { randomUUID } from "node:crypto";
import type { AgentId } from "@/lib/types";
import { CAPABILITIES, WHERE_LABEL } from "@/lib/capabilities";
import { PLAYBOOKS, PRIMERS, lessonLines } from "../knowledge";
import { FREE_TOOLS, RESEARCH, TOOLKIT, researchPrice } from "../tools";
import { NETWORK, PRODUCTS, REFUND_WINDOW_MIN } from "../x402";
import { STRIKE_HOURS, STRIKE_LIMIT } from "../strikes";
import { isVendorTool } from "../vendor-tools";
import { networkName, PAY_NETWORK } from "../marketplace";
import { limits } from "../settings";
import { all, get, put } from "./db";
import { SECTIONS, type Section } from "./sections";

export { SECTIONS, type Section } from "./sections";

/**
 * The Library: what agents (and people) can do here, how to call it, what it costs and what to
 * watch for. Seeded from the code itself (tools, prices, limits, know-how), so it can't drift from
 * what really runs; entries published from the Lab are added on top, credited to their request.
 * Each entry is a wiki article: a plain summary, an infobox, steps, code and related articles.
 */
export type Diagram = "x402" | "vault" | "check" | "proceeds" | "hall";

export interface LibraryEntry {
  /** Stable slug: the article's address and its id in every format. */
  id: string;
  section: Section;
  title: string;
  /** Plain explanation. */
  body: string;
  /** The exact HTTP call, when there is one. */
  call?: string;
  /** The MCP tool (and arguments) to use, when there is one. */
  tool?: string;
  price?: string;
  /** The price in USDC base units, when it is one fixed number (checked against the code in tests). */
  priceUsdc?: string;
  /** YYYY-MM-DD. */
  updated: string;
  /** Where in the app this comes from, so it can be checked. */
  source: string;
  /** Set when it was published from a Town Hall request through the Lab. */
  credit?: { itemId: string; postId: string; from?: string };
  /** What sort of thing it is, in a word or two (shown in the infobox). */
  kind?: string;
  /** Which agents can use it. */
  agents?: AgentId[];
  /** Where the money moves, when money moves. */
  network?: string;
  /** "How to use it", one plain step per line. */
  steps?: string[];
  /** A copyable shell example; {BASE} is the app's address. */
  curl?: string;
  diagram?: Diagram;
  seeAlso?: string[];
  /** The Store listing that sells it, when there is one. */
  storeId?: string;
}

/** When the seeded entries were written down from the code (the tests re-check them on every run). */
export const SEEDED = "2026-11-18";
const usd = (base: bigint | number) => {
  const x = Number(base) / 1e6;
  return x === 0 ? "Free" : x < 0.01 ? `$${x.toFixed(4).replace(/0+$/, "")}` : `$${x.toFixed(2)}`;
};
export const perRequest = (base: bigint) => `${usd(base)} a request`;
const X402_NET = `${networkName(NETWORK)} (${NETWORK}), paid with x402`;
const GATEWAY_NET = `${networkName(PAY_NETWORK)}, paid through Circle Gateway`;

/** The MCP tools this app serves; an entry names one of these. */
export const MCP_TOOLS = [
  "list_agents",
  "look_up",
  "ask_agent",
  "propose_move",
  "propose_plan",
  "edit_work_order",
  "get_job",
  "list_jobs",
  "get_job_data",
  "get_receipt",
  "cancel_job",
  "library_search",
  "library_read",
  "store_search",
  "store_read",
  "store_submit",
  "hall_request",
  "hall_status",
  "town_board",
  "town_post",
] as const;
/** The MCP tool an entry's `tool` line starts with, if any. */
export const mcpToolOf = (e: Pick<LibraryEntry, "tool">) => {
  const name = e.tool?.match(/^([a-z_]+)/)?.[1];
  return name && (MCP_TOOLS as readonly string[]).includes(name) ? name : undefined;
};

const ex = (id: string) => PRODUCTS[id].example;
const buyCurl = (product: string) =>
  [
    "# 1. Ask: the answer is 402 Payment Required, with the price and who to pay",
    `curl -i "{BASE}/api/x402/${product}?${ex(product)}"`,
    "",
    "# 2. Ask again with a signed USDC payment for exactly that price",
    `curl "{BASE}/api/x402/${product}?${ex(product)}" \\`,
    '  -H "X-PAYMENT: <base64 of the signed payment JSON>"',
    "",
    "# Or let the bundled buyer sign and pay (needs a little testnet USDC)",
    `BUYER_PRIVATE_KEY=0x… node scripts/agent-buyer.mjs {BASE} ${product} "${ex(product)}"`,
  ].join("\n");
const X402_STEPS = [
  "Ask for the answer with a plain GET. You get 402 Payment Required with the price, who to pay and the network.",
  "Sign a USDC payment for exactly that price (an EIP-3009 authorization) on Arc testnet.",
  "Send the same GET again with the payment in the X-PAYMENT header.",
  "The seller settles it on Arc and sends the answer. The receipt is in the x-payment-response header.",
];

const BASICS: LibraryEntry[] = [
  {
    id: "pay-per-request",
    section: "basics",
    title: "Pay for one answer at a time",
    body: "Ask for the answer and you get its price back (HTTP 402) with who to pay, how much, on which network. Sign a USDC payment for exactly that amount and ask again with it attached. The seller settles it on Arc and sends the answer. No account or API key. Agento's own jobs pay this way from the job's vault.",
    call: "GET /api/x402/{product}?{query} → 402 with accepts[]; then the same GET with header X-PAYMENT: base64(JSON payment) → { data }, receipt in the x-payment-response header",
    price: "Set per product (see Tools and prices)",
    updated: SEEDED,
    source: "src/app/api/x402/[product]/route.ts, scripts/agent-buyer.mjs",
    network: X402_NET,
    steps: X402_STEPS,
    curl: buyCurl("markets.search"),
    diagram: "x402",
    seeAlso: ["refund-a-bad-answer", "glossary-x402", "glossary-usdc", "open-a-vault"],
  },
  {
    id: "read-a-price",
    section: "basics",
    title: "Read a price",
    body: "For a coin's live price, bid, ask and 24-hour change, use the free spot price lookup. For an independent second source, buy a Chainlink price read from Ethereum through Quicknode on Circle's Agent Marketplace; it can also be used as a check before an order.",
    tool: 'look_up { tool: "spot_price", args: { symbol: "btcusd" } }',
    price: `Free (Gemini spot) · ${perRequest(researchPrice("oracle_price"))} (Chainlink via Quicknode)`,
    updated: SEEDED,
    source: "src/server/tools.ts (spot_price, oracle_price)",
    agents: ["inso", "trado"],
    steps: [
      "For a quick look, call the free spot price lookup with a symbol like btcusd.",
      "For a second, independent source, ask the agent to add a Chainlink price read as a paid step.",
      "Use either one as a check before an order (see Check, then buy).",
    ],
    seeAlso: ["tool-spot_price", "tool-oracle_price", "check-then-buy", "glossary-chainlink"],
  },
  {
    id: "place-an-order",
    section: "basics",
    title: "Place an order",
    body: "Your AI proposes the order (a prediction-market contract or a coin, with side, price and size). The app checks it against live data and your limits and turns it into a draft. Only the person approves it, in the app. The order then rests on Gemini: a limit order buys at your price or better, a stop-limit buys once the price rises to a level.",
    tool: 'propose_move { agent: "inso", task, move: { action: { kind: "prediction_order", … } } }',
    call: "POST /api/runs/{id}/approve (the person, in the app)",
    price: "The order's own cost, paid on the exchange; never from the vault",
    updated: SEEDED,
    source: "src/server/mcp.ts (propose_move), src/server/tools.ts (ProposalInput)",
    agents: ["inso", "trado"],
    steps: [
      "Describe the order: the market or coin, the side, the most you'll pay and how many.",
      "The app checks it against live prices and your limits and makes a draft with a link.",
      "The person opens the link and approves it. There is no approve tool.",
      "The order rests on Gemini until it fills, at your price or better.",
    ],
    seeAlso: ["check-then-buy", "limit-order", "gotcha-no-approve", "glossary-prediction-market"],
  },
  {
    id: "open-a-vault",
    section: "basics",
    title: "Lock a job's money in a vault",
    body: `Approving a job opens a vault on Arc for that job only, funded with the job's total plus a 20% buffer. It can pay only the approved sellers, each up to its own cap, and nothing else. The agent can't open it, add money to it or pay anyone off the list. When the job ends or is stopped the vault closes and what's left goes back.`,
    call: "POST /api/runs/{id}/approve → WorkOrderFactory.open(agent, planRoot, orderId, amount) on Arc",
    price: "Network fees in USDC (measured from each transaction)",
    updated: SEEDED,
    source: "src/server/orchestrator.ts (BUFFER_PCT), contracts/src",
    network: `${networkName(NETWORK)} (${NETWORK})`,
    steps: [
      "The person approves a priced work order in the app.",
      "A vault for that job alone opens on Arc, holding the total plus a 20% buffer.",
      "Each payment shows its approved line; the vault pays only that seller, up to that line's cap.",
      "When the job ends or is stopped, the vault closes and the rest goes back.",
    ],
    diagram: "vault",
    seeAlso: ["glossary-vault", "glossary-work-order", "limit-job", "pay-per-request"],
  },
  {
    id: "read-arc",
    section: "basics",
    title: "Read Arc with read_arc",
    body: "Four typed questions about Arc testnet, free: a USDC balance, a transaction (status and USDC moved), a job's vault (funded, left, closed) and whether a payment authorization was collected. Inputs are checked before any call, only vaults this app's agent works for are read, and nothing is signed.",
    tool: 'look_up { tool: "read_arc", args: { what: "balance", address: "0x…" } }',
    price: "Free",
    updated: SEEDED,
    source: "src/server/chain-tools.ts, src/server/tools.ts (read_arc)",
    agents: ["inso", "trado", "travo"],
    steps: ["Pick what to read: balance, tx, vault or authorization.", "Call look_up with tool read_arc and the address or hash.", "Read the answer. Nothing is signed and nothing is charged."],
    seeAlso: ["tool-read_arc", "glossary-arc", "glossary-vault"],
  },
  {
    id: "find-a-service",
    section: "basics",
    title: "Find a service on Circle's Agent Marketplace",
    body: "Search Circle's catalog of paid agent services by keyword or category. Each result says what it sells, its price and whether this app can pay it now on Arc testnet; those can be added to a job as a paid step.",
    tool: 'look_up { tool: "search_services", args: { query: "weather", payable: true } } · or store_search',
    price: "Free to search",
    updated: SEEDED,
    source: "src/server/marketplace.ts (searchServices)",
    agents: ["inso", "trado", "travo"],
    steps: ["Search by a word, like weather or gas.", "Keep the ones marked payable now: those take Arc testnet.", "Ask an agent to add one as a paid step (the service tool), priced from the seller's own quote."],
    curl: 'curl "{BASE}/api/town/store?q=weather"',
    seeAlso: ["tool-search_services", "tool-service", "gotcha-mainnet-services", "glossary-agent-marketplace"],
  },
  {
    id: "refund-a-bad-answer",
    section: "basics",
    title: "Get your money back for a broken answer",
    body: `If an answer bought from Agento's own seller fails one of the published checks (nothing came back, unreadable, missing a promised field, about something else, too old), claim within ${REFUND_WINDOW_MIN} minutes with the payment's transaction, the paying address and the answer. The full price goes back to the address that paid, once. A lost answer can be fetched again for free.`,
    call: "POST /api/x402/refund { tx, payer, answer } · GET /api/x402/redeliver?payer=0x…&nonce=0x…",
    price: "Free",
    updated: SEEDED,
    source: "src/server/refunds.ts, src/server/delivery.ts",
    network: `${networkName(NETWORK)} (${NETWORK})`,
    steps: [
      `Within ${REFUND_WINDOW_MIN} minutes of paying, send the settlement transaction, the address that paid and the answer you got.`,
      "The answer's fingerprint must match what was sent, and it must fail one of the published checks.",
      "The full price goes back to the paying address on Arc, once per sale.",
      "Lost the answer instead? Fetch it again for free with redeliver.",
    ],
    curl: ['curl -X POST "{BASE}/api/x402/refund" \\', '  -H "content-type: application/json" \\', "  -d '{\"tx\":\"0x…\",\"payer\":\"0x…\",\"answer\":{…}}'", "", '# A lost answer, sent again for free', 'curl "{BASE}/api/x402/redeliver?payer=0x…&nonce=0x…"'].join("\n"),
    seeAlso: ["pay-per-request", "limit-refund-window", "limit-strikes"],
  },
  {
    id: "ask-an-agent",
    section: "basics",
    title: "Ask one of the agents",
    body: "Start a chat with Inso (prediction markets and cover), Trado (coins) or Travo (trips). It looks things up for free and may propose a move for the person to approve.",
    tool: 'ask_agent { agent: "inso", message: "How have BTC odds moved today?" } then get_job { id }',
    price: "Free until a move is approved",
    updated: SEEDED,
    source: "src/server/mcp.ts (ask_agent)",
    agents: ["inso", "trado", "travo"],
    steps: ["Connect your AI to Agento's MCP server at {BASE}/api/mcp.", "Call ask_agent with the agent and your question.", "Follow the job with get_job; a proposed move comes back as a draft with a link for the person."],
    curl: "claude mcp add --transport http agento {BASE}/api/mcp",
    seeAlso: ["place-an-order", "glossary-mcp", "gotcha-no-approve"],
  },
];

const COMBOS: LibraryEntry[] = [
  {
    id: "check-then-buy",
    section: "combos",
    title: "Check, then buy",
    body: "Attach up to three checks to an order, on numbers other than the order's own price (for example Chainlink BTC and Gemini spot BTC both above $64,000). They are read fresh right before the order. All must pass; if one can't be read, nothing is bought.",
    tool: "propose_move with move.condition and move.alsoRequire (up to 2 more)",
    price: `Free checks on Gemini prices · ${perRequest(researchPrice("oracle_price"))} for a Chainlink check`,
    updated: SEEDED,
    source: "src/server/tools.ts (condition, alsoRequire)",
    agents: ["inso", "trado"],
    steps: ["Write the order as usual.", "Add a condition, and up to two more in alsoRequire.", "Right before the order, every check is read fresh.", "All pass: the order goes in. One fails or can't be read: nothing is bought."],
    diagram: "check",
    seeAlso: ["place-an-order", "read-a-price", "tool-oracle_price"],
  },
  {
    id: "sell-then-use-proceeds",
    section: "combos",
    title: "Sell, then use what it brought in",
    body: "A plan where step 2 waits for step 1's sell to fill and spends what it brought in. Step 2's size is set from the real proceeds when it starts and checked again at that size, within the order limit.",
    tool: 'propose_plan { steps: [ { agent, move: sell }, { agent, move: buy, after: [1], gate: "filled", useProceeds: true } ] }',
    price: "Each step's own costs",
    updated: SEEDED,
    source: "src/server/mcp.ts (propose_plan), src/server/tools.ts (PlanInput)",
    agents: ["trado", "inso"],
    steps: ["Step 1 sells something you hold.", "Step 2 waits until that sell fills.", "Step 2's size is set from what the sell really brought in.", "It is checked again at that size, within your order limit."],
    diagram: "proceeds",
    seeAlso: ["place-an-order", "limit-plan", "limit-order"],
  },
  {
    id: "cover-a-cost",
    section: "combos",
    title: "Cover an everyday cost",
    body: "Say what you'd lose and when (\"a cold snap would cost me $20 in rides\"). Inso finds the market for that event and buys the side that pays if it happens. Code sizes the order so the payout after its own cost covers the loss, or fits your budget, and states it like insurance: what you pay now, what you get back.",
    tool: 'propose_move { agent: "inso", move: { hedge: { protects, lossUsd }, action: { kind: "prediction_order", … } } }',
    price: "The order's cost; lookups free",
    updated: SEEDED,
    source: "src/server/tools.ts (hedge)",
    agents: ["inso"],
    steps: ["Say what could cost you money, how much, and by when.", "Inso finds the market for that event.", "Code sizes the order so the payout covers the loss, or fits your budget.", "You see it like insurance: pay this now, get that back if it happens."],
    seeAlso: ["cover-several-at-once", "glossary-prediction-market", "place-an-order"],
  },
  {
    id: "cover-several-at-once",
    section: "combos",
    title: "Cover several things at once",
    body: "One combination contract pays $1 only if every leg happens: far cheaper than buying each. Price it free in chat, or buy the same quote as an answer for other agents.",
    tool: 'look_up { tool: "combo_quote", args: { legs: [ … ] } }',
    call: `GET /api/x402/cover.quote?${PRODUCTS["cover.quote"].example}`,
    price: `Free (combo_quote) · ${perRequest(PRODUCTS["cover.quote"].price)} (cover.quote)`,
    updated: SEEDED,
    source: "src/server/x402.ts (cover.quote), src/server/tools.ts (combo_quote)",
    agents: ["inso"],
    network: X402_NET,
    steps: ["Name 2 to 6 things that must all happen.", "Price it free in chat with combo_quote.", "Other agents can buy the same quote per request as cover.quote."],
    curl: buyCurl("cover.quote"),
    storeId: "agento-cover.quote",
    seeAlso: ["cover-a-cost", "sold-cover.quote", "tool-combo_quote"],
  },
  {
    id: "plan-a-drive",
    section: "combos",
    title: "Plan a drive, then where to stay",
    body: "Travo buys the driving route, splits it into days that fit your hours on the road and lists a few places to sleep where each day ends, from OpenStreetMap. It doesn't check prices or book.",
    tool: 'propose_move { agent: "travo", move: { action: { kind: "itinerary", stops: ["Vancouver", "Seattle"], hoursPerDay: 6 } } }',
    price: perRequest(researchPrice("drive_route")),
    priceUsdc: researchPrice("drive_route").toString(),
    updated: SEEDED,
    source: "src/server/tools.ts (drive_route), src/server/x402.ts (routes.drive)",
    agents: ["travo"],
    network: X402_NET,
    steps: ["Give the stops in order and your hours on the road per day.", "Travo buys the driving route.", "It splits the route into days and lists a few places to sleep near each day's end."],
    storeId: "agento-routes.drive",
    seeAlso: ["tool-drive_route", "tool-find_nearby", "sold-routes.drive"],
  },
];

const GLOSSARY: LibraryEntry[] = (
  [
    ["x402", "x402", "A way to pay for a single web request. The server answers 402 Payment Required with a price; the buyer signs a payment and asks again; the answer comes back once it is paid. Agento sells and buys answers this way, in USDC on Arc, with no account or API key.", "README.md (How it uses Arc), src/server/x402.ts", ["pay-per-request", "glossary-usdc"]],
    ["usdc", "USDC", "A digital dollar issued by Circle. Every price, deposit and fee here is in USDC. It has 6 decimals, so 1 USDC is 1,000,000 base units: the JSON views give prices in base units.", "README.md (Arc-specific notes)", ["glossary-arc", "pay-per-request"]],
    ["arc", "Arc", `The blockchain Agento pays on. Network fees are paid in USDC, not a separate coin. The app uses Arc testnet (chain ${NETWORK.split(":")[1]}), where the money is for testing.`, "README.md (How it uses Arc)", ["read-arc", "glossary-testnet"]],
    ["vault", "Vault", "A small contract opened for one job. It holds the money that was approved and pays only the approved sellers, each up to its cap. The agent can't pay anyone else. Closing it sends back what's left.", "README.md (How it uses Arc), contracts/src", ["open-a-vault", "glossary-work-order"]],
    ["work-order", "Work order", "The priced plan for a job: every purchase, who it pays and the most it can cost. The person approves it once, and the vault holds to it.", "README.md (How it uses Arc)", ["open-a-vault", "glossary-vault"]],
    ["gateway", "Circle Gateway", `Circle's way to pay many tiny amounts fast (nanopayments). The agent keeps a small Gateway balance to pay sellers on Circle's Agent Marketplace; at most ${Number(process.env.GATEWAY_DAILY_CAP ?? 3)} USDC a day is moved into it.`, "src/server/nanopay.ts", ["limit-gateway", "glossary-agent-marketplace"]],
    ["agent-marketplace", "Circle's Agent Marketplace", "Circle's catalog of paid services for agents, each sold per request with x402. In the Store, only these are marked Verified by Circle.", "src/server/marketplace.ts", ["find-a-service", "glossary-gateway"]],
    ["mcp", "MCP", "Model Context Protocol: a common way for an AI app (Claude, Cursor and others) to use outside tools. Agento is an MCP server at /api/mcp, and every building in the Town has tools there.", "README.md (Use it from your own AI)", ["ask-an-agent", "gotcha-no-approve"]],
    ["testnet", "Testnet and mainnet", "A testnet is a copy of a blockchain where the money is only for testing; mainnet is the real one. Agento pays on Arc testnet today. Most services on Circle's marketplace want Arc mainnet or Base.", "src/lib/capabilities.ts", ["gotcha-mainnet-services", "glossary-arc"]],
    ["practice", "Practice mode", "When the app's wallets aren't set up, or you choose practice in Settings, no real money moves: payments and deposits are only recorded, and labelled as practice.", "src/server/town/deposit.ts, README.md (Run it)", ["glossary-deposit"]],
    ["deposit", "Town Hall deposit", "Sending something to Town Hall holds 1 USDC to keep out spam. An admin refunds it when it isn't spam, or keeps it when it is.", "src/server/town/hall.ts (HALL_DEPOSIT)", ["glossary-practice", "sold-hall.request"]],
    ["chainlink", "Chainlink", "Price feeds published on blockchains. Agento reads them on Ethereum through Quicknode, as an independent check on a price.", "src/server/chainlink.ts, src/server/tools.ts (oracle_price)", ["tool-oracle_price", "read-a-price"]],
    ["prediction-market", "Prediction market", "A market on whether something will happen. A YES contract pays $1 if it does, so its price is roughly the market's chance that it will.", "src/server/knowledge.ts (PRIMERS.inso)", ["place-an-order", "cover-a-cost"]],
  ] as [string, string, string, string, string[]][]
).map(([id, title, body, source, seeAlso]) => ({ id: `glossary-${id}`, section: "glossary" as const, title, body, updated: SEEDED, source, seeAlso }));

const TOOL_TITLE: Record<string, string> = {
  search_markets: "Search prediction markets",
  get_market: "Read one market",
  spot_price: "Coin price now",
  my_positions: "What you hold",
  browse_markets: "New, opening soon and settled markets",
  combo_quote: "Price a combination",
  find_place: "Find a place",
  find_nearby: "Places near a stop",
  search_services: "Search Circle's Agent Marketplace",
  read_arc: "Read Arc testnet",
  odds_history: "How a market's odds moved",
  trade_tape: "Who's buying and selling",
  spot_candles: "Price candles for a coin",
  oracle_price: "Chainlink price",
  gas_price: "Gas price on a chain",
  btc_network: "How busy Bitcoin is",
  wallet_balance: "Any wallet's balance",
  service: "Any payable marketplace service",
  drive_route: "Driving route",
};

const AGENT_IDS: AgentId[] = ["inso", "trado", "travo"];
const usedBy = (tool: string, kind: "free" | "research") => AGENT_IDS.filter((a) => TOOLKIT[a][kind].includes(tool));

function toolEntries(): LibraryEntry[] {
  const free = Object.entries(FREE_TOOLS).map(([name, t]): LibraryEntry => {
    const keys = Object.keys((t.params as unknown as { shape?: Record<string, unknown> }).shape ?? {});
    return {
      id: `tool-${name}`,
      section: "tools",
      title: TOOL_TITLE[name] ?? name,
      body: t.description,
      tool: `look_up { tool: "${name}", args: { ${keys.map((k) => `${k}: …`).join(", ")} } }`,
      price: "Free",
      priceUsdc: "0",
      updated: SEEDED,
      source: `src/server/tools.ts (FREE_TOOLS.${name})`,
      kind: "Free lookup",
      agents: usedBy(name, "free"),
      steps: ["Connect your AI to Agento's MCP server at {BASE}/api/mcp.", `Call look_up with tool "${name}"${keys.length ? ` and ${keys.join(", ")}` : ""}.`, "Read the answer. Nothing is charged."],
      seeAlso: name === "read_arc" ? ["read-arc"] : name === "search_services" ? ["find-a-service"] : name === "spot_price" ? ["read-a-price"] : name === "combo_quote" ? ["cover-several-at-once"] : undefined,
    };
  });
  const paid = Object.entries(RESEARCH).map(([name, t]): LibraryEntry => {
    const own = !isVendorTool(name) && t.product in PRODUCTS;
    return {
      id: `tool-${name}`,
      section: "tools",
      title: TOOL_TITLE[name] ?? name,
      body: t.description,
      tool: `propose_move research step { tool: "${name}", args: { ${t.args.join(", ")} } }`,
      price: name === "service" ? "Set by the seller, at most $0.01 a request" : perRequest(researchPrice(name)),
      priceUsdc: name === "service" ? undefined : researchPrice(name).toString(),
      updated: SEEDED,
      source: `src/server/tools.ts (RESEARCH.${name})`,
      kind: "Paid lookup",
      agents: usedBy(name, "research"),
      network: own ? X402_NET : GATEWAY_NET,
      steps: [
        "Ask an agent for something that needs it, or add it to a move as a research step.",
        "Its price is added to the work order, and the person approves the total once.",
        own ? "The agent pays per request with x402, from the job's vault." : "The agent pays the seller per request through Circle Gateway, checked against the approved line first.",
        "The answer is checked before it is used; a broken one is never used.",
      ],
      curl: own ? buyCurl(t.product) : undefined,
      storeId: own ? `agento-${t.product}` : undefined,
      seeAlso: own ? [`sold-${t.product}`, "pay-per-request"] : ["glossary-gateway", "limit-marketplace"],
    };
  });
  const sold = Object.values(PRODUCTS).map(
    (p): LibraryEntry => ({
      id: `sold-${p.id}`,
      section: "tools",
      title: `Sold by Agento: ${p.description}`,
      body: `Any agent can buy this per request with USDC on Arc, no account. Asks: ${Object.entries(p.params)
        .map(([k, v]) => `${k} (${v})`)
        .join(", ")}.`,
      call: `GET /api/x402/${p.id}?${p.example}`,
      price: perRequest(p.price),
      priceUsdc: p.price.toString(),
      updated: SEEDED,
      source: `src/server/x402.ts (PRODUCTS["${p.id}"])`,
      kind: "Sold by Agento",
      network: X402_NET,
      steps: X402_STEPS,
      curl: buyCurl(p.id),
      diagram: p.id === "hall.request" ? "hall" : "x402",
      storeId: `agento-${p.id}`,
      seeAlso: ["pay-per-request", "refund-a-bad-answer", ...Object.entries(RESEARCH).filter(([n, r]) => !isVendorTool(n) && r.product === p.id).map(([n]) => `tool-${n}`)],
    }),
  );
  return [...free, ...paid, ...sold];
}

function practiceEntries(): LibraryEntry[] {
  const playbooks = PLAYBOOKS.map((text, i) => ({
    id: `playbook-${i + 1}`,
    section: "practices" as const,
    title: text.split(/[:.]/)[0].slice(0, 70),
    body: text,
    updated: SEEDED,
    source: "src/server/knowledge.ts (PLAYBOOKS)",
    agents: AGENT_IDS,
  }));
  const primers = (Object.entries(PRIMERS) as [AgentId, string[]][]).flatMap(([agent, list]) =>
    list.map((text, i) => ({
      id: `primer-${agent}-${i + 1}`,
      section: "practices" as const,
      title: `${agent[0].toUpperCase()}${agent.slice(1)}: ${text.split(/[:.;]/)[0].slice(0, 60)}`,
      body: text,
      updated: SEEDED,
      source: `src/server/knowledge.ts (PRIMERS.${agent})`,
      agents: [agent],
    })),
  );
  const where = Object.entries(WHERE_LABEL).map(([w, label]) => ({
    id: `works-${w}`,
    section: "practices" as const,
    title: `What works: ${label.toLowerCase()}`,
    body: CAPABILITIES.filter((c) => c.where === w)
      .map((c) => `${c.what}${c.cost ? ` (${c.cost} USDC)` : ""}${c.note ? `: ${c.note}` : ""}`)
      .join(". "),
    updated: SEEDED,
    source: "src/lib/capabilities.ts",
  }));
  return [...playbooks, ...primers, ...where];
}

function limitEntries(): LibraryEntry[] {
  const l = limits();
  const cap = Number(process.env.MARKETPLACE_MAX_PER_REQUEST ?? 10_000) / 1e6;
  const rows: [string, string, string, string, string[]?][] = [
    ["limit-order", "Largest single order", `An agent can never place an order above $${l.maxOrderUsd}. Re-checked when the job is approved, so a limit lowered after the move was built still applies.`, "src/server/settings.ts (maxOrderUsd)", ["place-an-order", "limit-plan"]],
    ["limit-job", "Most one job can spend on data", `A job's vault never holds more than ${l.maxJobUsdc} USDC for data and services; approval is refused above that.`, "src/server/settings.ts (maxJobUsdc)", ["open-a-vault"]],
    ["limit-plan", "Most a whole plan can cost", `Every step together must fit under $${l.maxPlanUsd} before a plan can start.`, "src/server/settings.ts (maxPlanUsd)", ["sell-then-use-proceeds"]],
    ["limit-big-spend", "Big purchases are pointed out", `A single purchase over ${l.bigSpendUsdc} USDC is listed and approved up front.`, "src/server/settings.ts (bigSpendUsdc)"],
    ["limit-marketplace", "Outside sellers: at most a cent", `One request to a marketplace seller may cost at most ${cap} USDC (MARKETPLACE_MAX_PER_REQUEST), checked before signing.`, "src/server/tools.ts (MAX_SERVICE)", ["tool-service", "find-a-service"]],
    ["limit-gateway", "Gateway top-ups per day", `At most ${Number(process.env.GATEWAY_DAILY_CAP ?? 3)} USDC a day moves into the agent's Gateway balance for marketplace purchases (GATEWAY_DAILY_CAP).`, "src/server/nanopay.ts", ["glossary-gateway"]],
    ["limit-market-close", "Markets must stay open a while", `Only markets closing more than ${Number(process.env.MIN_ORDER_EXPIRY_MIN ?? 20)} minutes from now can be ordered; 5-minute markets are too short for resting orders.`, "src/server/tools.ts (MIN_ORDER_EXPIRY_MIN)", ["place-an-order"]],
    ["limit-reapproval", "A change mid-job asks you", "If a seller's price rises or a spend would go off the approved plan, that step pauses and asks the person. No answer in 2 minutes counts as no.", "src/server/orchestrator.ts (REAPPROVAL_TIMEOUT_MS)", ["open-a-vault"]],
    ["limit-strikes", "Sellers that keep failing are paused", `A seller whose answers fail ${STRIKE_LIMIT} checks within ${STRIKE_HOURS} hours is skipped for new purchases, with the reason shown. One good delivery clears it.`, "src/server/strikes.ts", ["refund-a-bad-answer"]],
    ["limit-refund-window", "Refund claims close quickly", `Claims on Agento's own answers close ${REFUND_WINDOW_MIN} minutes after the sale, one per sale, only to the address that paid. A valid answer stays paid even if it wasn't useful.`, "src/server/x402.ts (REFUND_WINDOW_MIN)", ["refund-a-bad-answer"]],
    ["gotcha-no-approve", "There is no approve tool", "Over MCP your AI can draft moves and plans but never approve spending. Every draft returns a link; the person approves in the app and the vault enforces it on Arc.", "src/server/mcp.ts", ["glossary-mcp", "place-an-order"]],
    ["gotcha-test-exchange", "The test exchange lists fewer markets", "Gemini's test exchange lists crypto and commodity markets only. Weather, sports and rate markets trade only on its real exchange.", "src/lib/capabilities.ts"],
    ["gotcha-mainnet-services", "Most marketplace services need mainnet", "Flight and hotel booking, web search and most other services on Circle's Agent Marketplace take Arc mainnet or Base, not testnet. Search with payable=true to see what works today.", "src/lib/capabilities.ts, src/server/marketplace.ts", ["glossary-testnet", "find-a-service"]],
    ["gotcha-explore-rounds", "Agents look things up in at most 6 rounds", "An agent's free lookups stop after 6 rounds per message, or after two sources fail in one turn.", "src/server/explore.ts (MAX_ROUNDS)"],
  ];
  return rows.map(([id, title, body, source, seeAlso]) => ({ id, section: "limits" as const, title, body, updated: SEEDED, source, kind: id.startsWith("gotcha") ? "Gotcha" : "Limit", seeAlso }));
}

/** Real changes, from this app's git history. */
const UPDATES: [string, string, string][] = [
  ["2026-11-18", "The Town in two forms", "Every building has a page for people and the same facts for agents, in Markdown and JSON, from one source. The Library became a wiki with articles; the Store has product pages; the Lab is a board; the Forum has threads."],
  ["2026-11-18", "The Town opens", "A Library of what agents can do, a Store of services, a Town Hall for requests and feedback, a Lab and a Forum. All of it works from the app, the API and MCP."],
  ["2026-11-18", "Arc read tool for every agent", "read_arc answers balance, transaction, vault and payment questions on Arc for free; a plan has a total cap, and the order limit is checked again at approval."],
  ["2026-11-18", "Every paid answer is checked before use", "Answers are checked against what the seller promised; Agento's own seller refunds a failed one by evidence, and sellers that keep failing are paused."],
  ["2026-11-18", "Plan steps built from earlier findings", "A step can be rebuilt from what earlier steps found, used only if it costs no more than what was approved."],
  ["2026-11-17", "Bring a problem, get a brief", "Describe a worry and the agent splits it into the things behind it, what it can do now, and what stays open."],
  ["2026-11-17", "Combinations, live prices and a seller catalog", "Cover against several things at once, live prices on every order, how markets settled, and Agento's own answers for sale at /api/x402."],
  ["2026-11-15", "Several checks per move, plans over MCP", "A move can require up to three checks to pass together; outside AIs can propose whole plans with propose_plan."],
];

function updateEntries(): LibraryEntry[] {
  return UPDATES.map(([date, title, body], i) => ({ id: `update-${UPDATES.length - i}`, section: "updates" as const, title, body, updated: date, source: "git history", kind: "Update" }));
}

/** Lessons the agents learned from how real orders ended. Only shown when there are some. */
function learnedEntries(): LibraryEntry[] {
  return AGENT_IDS.flatMap((agent) => {
    const lines = lessonLines(agent, 6);
    if (!lines.length) return [];
    return [{ id: `learned-${agent}`, section: "learned" as const, title: `What ${agent[0].toUpperCase()}${agent.slice(1)} learned from past orders`, body: lines.join(". "), updated: new Date().toISOString().slice(0, 10), source: "src/server/knowledge.ts (lessons)", tool: "GET /api/knowledge", agents: [agent], kind: "Lesson" }];
  });
}

const KIND: Record<Section, string> = {
  basics: "Fundamental action",
  combos: "Combined action",
  tools: "Tool",
  limits: "Limit",
  practices: "Best practice",
  updates: "Update",
  glossary: "Glossary term",
  learned: "Lesson",
};

/** Seeded entries, then anything published from the Lab (which may replace a seeded one by id). */
export function allEntries(): LibraryEntry[] {
  const published = all<LibraryEntry>("town_library");
  const byId = new Map<string, LibraryEntry>();
  for (const e of [...BASICS, ...COMBOS, ...toolEntries(), ...limitEntries(), ...practiceEntries(), ...updateEntries(), ...GLOSSARY, ...learnedEntries()]) byId.set(e.id, e);
  for (const e of [...published].reverse()) byId.set(e.id, { ...byId.get(e.id), ...e, kind: e.credit ? "From the Lab" : e.kind });
  return [...byId.values()].map((e) => ({ ...e, kind: e.kind ?? KIND[e.section] }));
}

export function readEntry(id: string): LibraryEntry | undefined {
  return allEntries().find((e) => e.id === id);
}

/** The articles the front page starts people on. */
export const FEATURED = ["pay-per-request", "ask-an-agent", "open-a-vault", "check-then-buy", "glossary-x402"];

/** Words in any order, across title, explanation, call, tool and price. */
export function searchLibrary(q = "", section?: Section, limit = 200): LibraryEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (e: LibraryEntry) => {
    const title = e.title.toLowerCase();
    const rest = [e.body, e.call, e.tool, e.price, e.source, e.kind, SECTIONS[e.section]].join(" ").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 3;
      else if (rest.includes(w)) s += 1;
      else return 0;
    }
    return s || 1;
  };
  return allEntries()
    .filter((e) => !section || e.section === section)
    .map((e) => [e, score(e)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([e]) => e);
}

/** Publishes a Lab solution: a new entry, or an update to an existing one. */
export function publishEntry(e: { id?: string; section: Section; title: string; body: string; call?: string; tool?: string; price?: string; credit: LibraryEntry["credit"] }): LibraryEntry {
  const prev = e.id ? (get<LibraryEntry>("town_library", e.id) ?? readEntry(e.id)) : undefined;
  const entry: LibraryEntry = {
    ...(prev ?? {}),
    id: prev?.id ?? `lab-${randomUUID().slice(0, 8)}`,
    section: e.section,
    title: e.title,
    body: e.body,
    call: e.call ?? prev?.call,
    tool: e.tool ?? prev?.tool,
    price: e.price ?? prev?.price,
    updated: new Date().toISOString().slice(0, 10),
    source: prev ? `${prev.source}; updated from the Lab` : "Published from the Lab",
    credit: e.credit,
  };
  return put("town_library", entry);
}
