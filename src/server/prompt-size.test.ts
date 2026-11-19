import { expect, it } from "vitest";
import { __promptForTest, compact } from "./explore";

// Every chat turn sends the whole prompt; keep it lean so replies stay fast and cheap.
it("system prompt plus tool specs stay under budget", () => {
  for (const a of ["inso", "trado", "worko"] as const) {
    const p = __promptForTest(a);
    const chars = p.system.length + JSON.stringify(p.tools).length;
    console.log(a, "system", p.system.length, "tools", JSON.stringify(p.tools).length);
    // Raised from 28k when the solution brief (problem → drivers → steps) and its know-how notes were added.
    expect(chars).toBeLessThan(31_900);
  }
});

it("tool results drop empty fields and noise", () => {
  expect(compact({ a: null, b: 0.123456789, c: "2026-11-30T22:00:00.000Z", d: [], e: [{ x: undefined, y: 1 }] })).toEqual({ b: 0.123457, c: "2026-11-30T22:00Z", e: [{ y: 1 }] });
});
