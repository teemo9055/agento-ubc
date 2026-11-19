import { describe, expect, it } from "vitest";
import { scanTone, toneByRules, toneFor, wordTone } from "./tone";
import { noteFor } from "./notes";
import type { CapabilityOutput } from "./types";

const cap = (outputs: CapabilityOutput[]) => ({ outputs, description: "" });

describe("how a finding reads, by rule", () => {
  it.each([
    ["high", "bad"],
    ["VoIP", "bad"],
    [true, "bad"],
    ["medium", "warn"],
    ["low", "good"],
    ["mobile", "good"],
    [false, "good"],
    [0.82, "bad"],
    [55, "warn"],
    [0.1, "good"],
  ] as const)("risk %s → %s", (v, want) => expect(wordTone(v)).toBe(want));

  it("risk signals take the worst of what the answer says", () => {
    const c = cap([
      { path: "line_type", type: "risk_signal", label: "line type" },
      { path: "fraud_score", type: "risk_signal", label: "fraud score" },
    ]);
    expect(toneByRules(c, { line_type: "mobile", fraud_score: 12 })).toBe("good");
    expect(toneByRules(c, { line_type: "voip", fraud_score: 12 })).toBe("bad");
    expect(toneByRules(c, { line_type: "mobile", fraud_score: 50 })).toBe("warn");
  });

  it("reviews below 3 stars are a warning; 4 and up reassure", () => {
    const c = cap([{ path: "rating", type: "reviews", label: "average rating" }]);
    expect(toneByRules(c, { rating: 2.4 })).toBe("warn");
    expect(toneByRules(c, { rating: 4.6 })).toBe("good");
  });

  it("a listing photo found elsewhere online is a red flag", () => {
    const c = cap([{ path: "matches", type: "web_results", label: "where it appears online" }]);
    expect(toneByRules(c, { matches: [{ url: "https://other.test" }] })).toBe("bad");
    expect(toneByRules(c, { matches: [] })).toBe("good");
  });

  it("empty answers are neutral, and anything no rule speaks to stays neutral with AI off", async () => {
    expect(toneByRules(cap([]), {})).toBe("neutral");
    expect(toneByRules(cap([{ path: "x", type: "news", label: "news" }]), { x: "something" })).toBeUndefined();
    process.env.AI_DISABLED = "true";
    expect(await toneFor(cap([{ path: "x", type: "news", label: "news" }]), { x: "something" })).toBe("neutral");
  });
});

describe("answers with no schema", () => {
  it("read the usual signals from the fields themselves", () => {
    expect(scanTone({ data: { line_type: "VoIP", carrier: "Twilio" } })).toBe("bad");
    expect(scanTone({ valid: true, line_type: "mobile" })).toBe("good");
    expect(scanTone({ result: { fraud_score: 55 } })).toBe("warn");
    expect(scanTone({ business: { rating: 2.1 } })).toBe("warn");
    expect(scanTone({ name: "Sam", city: "Vancouver" })).toBeUndefined();
    expect(toneByRules({ outputs: [{ path: "", type: "risk_signal", label: "risk" }] }, { is_disposable: true })).toBe("bad");
  });
});

describe("what a finding says", () => {
  it("reads tagged outputs, at most 48 characters, masking personal data", () => {
    const c = cap([
      { path: "carrier.type", type: "risk_signal", label: "line type" },
      { path: "carrier.name", type: "any", label: "carrier" },
    ]);
    expect(noteFor(c, { carrier: { type: "voip", name: "Twilio" } })).toBe("Line type: voip · Carrier: Twilio");
    expect(noteFor(cap([{ path: "owner", type: "email", label: "owner" }]), { owner: "jane@gmail.com" })).toBe("Owner: j•••@gmail.com");
    expect(noteFor(cap([]), [])).toBe("Nothing found");
    expect(noteFor(cap([{ path: "t", type: "any", label: "t" }]), { t: "x".repeat(80) }).length).toBe(48);
  });
});
