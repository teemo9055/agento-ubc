const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "GEMI-BTC2611272200-HI63500" → "BTC · Nov 27 · $63,500 or above". Falls back to the symbol. */
export function contractName(symbol: string): string {
  const m = /^GEMI-([A-Z]+?)(?:\d+M)?(\d{2})(\d{2})(\d{2})\d{4}-(HI|LO)?([\d.]+|UP|DOWN)?/.exec(symbol);
  if (!m) return symbol;
  const [, asset, , mm, dd, dir, level] = m;
  const when = `${MONTHS[Number(mm) - 1] ?? mm} ${Number(dd)}`;
  if (level === "UP" || level === "DOWN") return `${asset} · ${when} · ${level === "UP" ? "Up" : "Down"}`;
  const n = Number(level);
  return `${asset} · ${when}${Number.isFinite(n) ? ` · $${n.toLocaleString("en-US")} or ${dir === "LO" ? "below" : "above"}` : ""}`;
}
