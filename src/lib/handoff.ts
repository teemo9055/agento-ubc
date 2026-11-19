/**
 * Steps you finish yourself. Some things need your own account in another app (a ride, a flight,
 * a hotel, a table). Agento doesn't pay for those or sign in for you: it gets everything ready and
 * hands you a link with the details filled in. Links are built here by code, never by the model,
 * and only point at a fixed list of well-known sites.
 */
export type HandoffKind = "ride" | "flight" | "hotel" | "table";

export interface HandoffAsk {
  kind: HandoffKind;
  /** Where from (ride, flight). */
  from?: string | null;
  /** Where to (ride, flight), or the place (hotel, table). */
  to?: string | null;
  /** Day, as YYYY-MM-DD, when known. */
  date?: string | null;
}

export interface Handoff {
  kind: HandoffKind;
  /** "Book the ride to Hotel Belmont" */
  label: string;
  /** The app or site you finish it in. */
  app: string;
  url: string;
}

const clean = (s?: string | null) => (s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
const day = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
const q = encodeURIComponent;

export const HANDOFF_APP: Record<HandoffKind, string> = { ride: "Uber", flight: "Google Flights", hotel: "Booking.com", table: "OpenTable" };

/** The link and label for one step you finish yourself, or null when the details are too thin. */
export function buildHandoff(a: HandoffAsk): Handoff | null {
  const from = clean(a.from);
  const to = clean(a.to);
  const when = day(a.date);
  const app = HANDOFF_APP[a.kind];
  switch (a.kind) {
    case "ride": {
      if (!to) return null;
      const pickup = from ? `&pickup[formatted_address]=${q(from)}` : "&pickup=my_location";
      return { kind: "ride", app, label: `Book the ride to ${to}`, url: `https://m.uber.com/ul/?action=setPickup${pickup}&dropoff[formatted_address]=${q(to)}` };
    }
    case "flight": {
      if (!from || !to) return null;
      return { kind: "flight", app, label: `Book the flight to ${to}`, url: `https://www.google.com/travel/flights?q=${q(`Flights from ${from} to ${to}${when ? ` on ${when}` : ""}`)}` };
    }
    case "hotel": {
      if (!to) return null;
      return { kind: "hotel", app, label: `Book a stay in ${to}`, url: `https://www.booking.com/searchresults.html?ss=${q(to)}${when ? `&checkin=${when}` : ""}` };
    }
    case "table": {
      if (!to) return null;
      return { kind: "table", app, label: `Book a table near ${to}`, url: `https://www.opentable.com/s?term=${q(to)}${when ? `&dateTime=${when}T19%3A00` : ""}` };
    }
  }
}

/** Only links to these hosts are ever shown as a step you finish. */
const HOSTS = new Set(["m.uber.com", "www.google.com", "www.booking.com", "www.opentable.com"]);
export const safeHandoffUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.has(u.host);
  } catch {
    return false;
  }
};
