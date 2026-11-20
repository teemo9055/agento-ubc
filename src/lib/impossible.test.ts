import { describe, expect, it } from "vitest";
import { notPossible } from "./impossible";

describe("requests nothing here can do never become jobs", () => {
  it("refuses bookings, flights, web search, reviews, scam checks and forecasts", () => {
    for (const t of [
      "Find me a flight from San Francisco to New York next Friday",
      "Book a hotel in Denver for Dec 12",
      "Book a table for 4 at an Italian restaurant in Chicago tonight",
      "Get me an Uber from SFO to the Ferry Building",
      "Search the web for the latest news about Circle's Arc chain",
      "Look up reviews for Blue Bottle Coffee in Oakland",
      "Is this website safe to buy from: cheap-sneakers-outlet.shop",
      "Is this phone number a scam? +1 415 555 0134",
      "What's the weather risk for driving from Seattle to Portland tomorrow?",
    ])
      expect(notPossible(t), t).not.toBeNull();
    expect(notPossible("Book a hotel in Denver")?.what).toBe("Agento can't book or buy hotels, tables, rides or tickets.");
  });

  it("lets through everything that works, and requests where some part works", () => {
    for (const t of [
      "Plan a 3-day drive from Austin to Denver",
      "Plan a weekend trip from Vancouver to Whistler with a hotel",
      "Find places to stay near Bend, Oregon.",
      "Find EV chargers near Fresno, California",
      "What are BTC odds right now?",
      "Buy 5 YES contracts on Bitcoin above $61,000 if they cost 70 cents or less",
      "I bought a ticket to a game. Cover my ticket money if the match doesn't happen",
      "A cold snap would cost me $20 in rides tomorrow in NYC. Can I cover that?",
      "What are BTC odds right now, then plan a drive from Vancouver to Seattle, and book a hotel in Seattle",
    ])
      expect(notPossible(t), t).toBeNull();
  });
});
