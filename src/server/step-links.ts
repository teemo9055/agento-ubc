import type { Proposal } from "@/lib/types";
import { getCapability } from "./catalog/store";
import { bindRefs, parseRef } from "./dataflow";

/**
 * After a step is changed, every step that uses its answer must still find what it reads. A link
 * breaks when the step it reads from is gone, or when that step is a marketplace service whose
 * listed outputs no longer include the field. Broken links are named in plain words so the user can
 * fix them, instead of the job failing halfway through.
 */
export interface BrokenLink {
  /** The step that reads. */
  step: string;
  stepLabel: string;
  /** The step it reads from, and the field it wanted. */
  from: string;
  fromLabel?: string;
  field: string;
  why: "gone" | "not_returned";
}

const strip = (p: string) => p.replace(/\[\d+\]/g, "");

/** Whether a service's listed outputs include `path` (or something above or below it). */
function returns(url: string, path: string): boolean | undefined {
  const cap = getCapability(url);
  if (!cap || !cap.outputs.length) return undefined;
  if (!path) return true;
  const want = strip(path);
  return cap.outputs.some((o) => {
    const has = strip(o.path);
    return o.type === "any" || !has || has === want || want.startsWith(`${has}.`) || has.startsWith(`${want}.`);
  });
}

export function brokenLinks(p: Proposal): BrokenLink[] {
  const out: BrokenLink[] = [];
  for (const r of p.research) {
    const refs = [...Object.values(r.bind ?? {}).flatMap(bindRefs), ...(r.when ? [r.when.ref] : [])];
    for (const ref of refs) {
      const x = parseRef(ref);
      if (x?.kind !== "step") continue;
      const src = p.research.find((s) => s.id === x.id);
      const field = x.path.split(".").pop()?.replace(/_/g, " ") || "answer";
      if (!src) {
        out.push({ step: r.id, stepLabel: r.label, from: x.id, field, why: "gone" });
        continue;
      }
      if (src.tool === "service" && src.args.url && returns(src.args.url, x.path) === false) out.push({ step: r.id, stepLabel: r.label, from: src.id, fromLabel: src.label, field, why: "not_returned" });
    }
  }
  return out;
}

/** One plain sentence for the first broken link, and edits that would fix it. */
export function explainBroken(links: BrokenLink[]): { message: string; alternatives: string[] } {
  const b = links[0];
  const message =
    b.why === "gone"
      ? `“${b.stepLabel}” uses the ${b.field} this step finds, so it can't stay without it.`
      : `“${b.stepLabel}” needs the ${b.field} from this step, and the new version doesn't give one.`;
  return { message: message.slice(0, 160), alternatives: [`Also remove “${b.stepLabel}”`, `Also change “${b.stepLabel}” to match`] };
}
