/**
 * Wires a move the chat proposed into a chain, by fixed rules: a lookup that needs something an
 * earlier lookup finds, and wasn't given it, reads it from that lookup. "Read this listing, then
 * check store prices and the photo" works without the model writing references itself.
 */
type Step = { id?: string; tool: string; args: Record<string, string>; label: string; why: string; bind?: Record<string, string> };

/** For each lookup that finds things: which later input it can fill, and from which field. */
const FEEDS: Record<string, Record<string, Record<string, string>>> = {
  read_listing: { shopping_prices: { product: "searchTitle" }, image_check: { imageUrl: "photo" }, web_search: { query: "seller" } },
  place_reviews: { phone_check: { phone: "found.phone" }, read_page: { url: "found.website" }, company_record: { site: "found.website" } },
  web_search: {
    read_page: { url: "results[0].link" },
    company_record: { site: "results[0].link" },
    headcount_history: { site: "results[0].link" },
    funding_events: { site: "results[0].link" },
    company_events: { site: "results[0].link" },
  },
  // The staff history pins the company to one domain: every later company lookup uses that domain.
  headcount_history: { funding_events: { site: "domain" }, company_events: { site: "domain" }, company_record: { site: "domain" } },
  // Events after the last round: what changed since the money came in.
  funding_events: { company_events: { since: "lastRoundDate" }, deep_search: { since: "lastRoundDate" } },
  // Read the article behind the newest event or the top result.
  company_events: { read_article: { url: "events[0].source" } },
  deep_search: { read_article: { url: "results[0].url" } },
  news_search: { read_article: { url: "results[0].link" } },
};

export function autoChain<T extends { research?: unknown }>(move: T): { move: T; chained: boolean } {
  const research = (Array.isArray(move.research) ? move.research : []) as Step[];
  if (research.length < 2) return { move, chained: false };
  let chained = false;
  const steps = research.map((r, i) => ({ ...r, id: r.id ?? `s${i + 1}`, args: { ...(r.args ?? {}) } }));
  for (const [i, step] of steps.entries()) {
    for (const source of steps.slice(0, i).reverse()) {
      const fills = FEEDS[source.tool]?.[step.tool];
      if (!fills) continue;
      for (const [field, path] of Object.entries(fills)) {
        if (step.args[field]?.trim() || step.bind?.[field]) continue;
        step.bind = { ...(step.bind ?? {}), [field]: `$${source.id}.${path}` };
        delete step.args[field];
        chained = true;
      }
    }
  }
  return { move: chained ? ({ ...move, research: steps } as T) : move, chained };
}
