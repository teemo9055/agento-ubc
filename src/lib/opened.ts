/**
 * When each job or project was last opened on this device, so the home grid can put the most
 * recently opened first (like a documents app). Kept in the browser only.
 */
const KEY = "agento:opened";

export function openedMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function markOpened(id: string) {
  if (typeof window === "undefined") return;
  const m = openedMap();
  m[id] = Date.now();
  // Keep the newest 300 so the record stays small.
  const kept = Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // storage full or blocked: ordering falls back to when the job was made
  }
}
