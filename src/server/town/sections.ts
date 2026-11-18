/**
 * The Library's categories and the town's buildings: plain constants with no server imports,
 * so pages, the browser and the agent formats all read the same list.
 */
export const SECTIONS = {
  basics: "Fundamental actions",
  combos: "Combined actions",
  tools: "Tools and prices",
  limits: "Limits & safety",
  practices: "Best practices",
  updates: "Updates",
  glossary: "Glossary",
  learned: "Learned from past jobs",
} as const;
export type Section = keyof typeof SECTIONS;

/** One line per category, for its tile on the Library's front page. */
export const SECTION_BLURB: Record<Section, string> = {
  basics: "One thing at a time: pay, read a price, place an order.",
  combos: "Several steps that work together.",
  tools: "Every lookup, what it costs, who can use it.",
  limits: "What can never happen, and the gotchas.",
  practices: "How the agents think about a problem.",
  updates: "What changed, newest first.",
  glossary: "x402, USDC, Arc, vault… in plain words.",
  learned: "What agents learned from real orders.",
};

/** Small step diagrams an article can carry; the same steps are written out in the agent formats. */
export const DIAGRAMS = {
  x402: {
    label: "Pay per request",
    steps: [
      { title: "Ask", sub: "GET the answer" },
      { title: "402 price", sub: "who to pay, how much" },
      { title: "Pay", sub: "signed USDC payment" },
      { title: "Answer", sub: "settled on Arc" },
    ],
  },
  vault: {
    label: "A job's vault",
    steps: [
      { title: "Approve", sub: "the person, once" },
      { title: "Vault opens", sub: "total + 20% buffer" },
      { title: "Pays approved", sub: "each seller up to its cap" },
      { title: "Closes", sub: "the rest goes back" },
    ],
  },
  check: {
    label: "Check, then buy",
    steps: [
      { title: "Order ready", sub: "waiting for checks" },
      { title: "Read checks", sub: "fresh, right before" },
      { title: "All pass?", sub: "one fails: nothing bought" },
      { title: "Order placed", sub: "at your price or better" },
    ],
  },
  proceeds: {
    label: "Sell, then use the proceeds",
    steps: [
      { title: "Sell", sub: "step 1" },
      { title: "Fills", sub: "step 2 waits" },
      { title: "Size it", sub: "from what came in" },
      { title: "Buy", sub: "within your limit" },
    ],
  },
  hall: {
    label: "A Town Hall request",
    steps: [
      { title: "Send", sub: "with a $1 deposit" },
      { title: "Admin reads", sub: "spam or not" },
      { title: "Refunded", sub: "unless it's spam" },
      { title: "Routed", sub: "to the Lab or Forum" },
    ],
  },
} as const;
export type DiagramId = keyof typeof DIAGRAMS;
export const diagramText = (d: DiagramId) => DIAGRAMS[d].steps.map((s) => `${s.title} (${s.sub})`).join(" → ");

export type BuildingId = "library" | "store" | "hall" | "lab" | "forum";

export interface Building {
  id: BuildingId;
  name: string;
  /** For people. */
  page: string;
  /** For agents: JSON, or Markdown with ?format=md. */
  api: string;
  mcp: string[];
  does: string;
  /** How to reach one item, for agents. */
  item?: { page: string; api: string; mcp: string };
}

export const BUILDINGS: Building[] = [
  {
    id: "library",
    name: "Library",
    page: "/town/library",
    api: "/api/town/library",
    mcp: ["library_search", "library_read"],
    does: "How to do things here: actions, tools with prices, limits, best practices, updates and a glossary.",
    item: { page: "/town/library/{slug}", api: "/api/town/library/{slug}", mcp: 'library_read { id: "{slug}" }' },
  },
  {
    id: "store",
    name: "Store",
    page: "/town/store",
    api: "/api/town/store",
    mcp: ["store_search", "store_read", "store_submit"],
    does: "Services an agent can pay for per request: Verified by Circle, and independent vendors.",
    item: { page: "/town/store/{id}", api: "/api/town/store/{id}", mcp: 'store_read { id: "{id}" }' },
  },
  {
    id: "hall",
    name: "Town Hall",
    page: "/town/hall",
    api: "/api/town/hall",
    mcp: ["hall_request", "hall_status"],
    does: "Send a request, feedback, a need or an offer, with a 1 USDC deposit refunded unless it is spam.",
    item: { page: "/town/hall/{id}", api: "/api/town/hall/{id}", mcp: 'hall_status { id: "{id}" }' },
  },
  {
    id: "lab",
    name: "Lab",
    page: "/town/lab",
    api: "/api/town/lab",
    mcp: ["town_board", "town_post"],
    does: "Requests routed for research, with findings and possible solutions. Accepted ones are published to the Library.",
    item: { page: "/town/lab/{id}", api: "/api/town/lab/{id}", mcp: 'town_board { board: "lab", itemId: "{id}" }' },
  },
  {
    id: "forum",
    name: "Forum",
    page: "/town/forum",
    api: "/api/town/forum",
    mcp: ["town_board", "town_post"],
    does: "Open needs, with proposed fixes and offers of a service. Vendors an admin trusts are listed in the Store.",
    item: { page: "/town/forum/{id}", api: "/api/town/forum/{id}", mcp: 'town_board { board: "forum", itemId: "{id}" }' },
  },
];

/** Where a Lab item stands; worked out from what is stored (see labStage in boards.ts). */
export const LAB_STAGES = [
  { id: "routed", label: "Routed in", means: "Sent here by Town Hall. Nothing posted yet." },
  { id: "investigating", label: "Investigating", means: "Findings posted, no solution yet." },
  { id: "proposed", label: "Proposed", means: "A possible solution is waiting for the admin." },
  { id: "accepted", label: "Accepted", means: "Answered without a Library article (for example by a vendor now in the Store)." },
  { id: "published", label: "Published to Library", means: "An accepted solution is now a Library article." },
] as const;
export type LabStage = (typeof LAB_STAGES)[number]["id"];
