"use client";
import { use } from "react";
import Link from "next/link";
import { Report } from "@/components/Report";
import { NetProvider } from "@/components/NetContext";
import { Icon } from "@/components/Icon";
import { useAgentTheme, useRun } from "@/components/useRun";

/** The report on its own page: something to print or send. */
export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing } = useRun(id);
  useAgentTheme(run?.agent);
  if (missing) return <p className="pt-16 text-center text-sm text-ink-2">This job isn&apos;t on this server anymore.</p>;
  if (!run) return <div className="mx-auto h-96 max-w-3xl animate-pulse rounded-2xl bg-line/50 motion-reduce:animate-none" aria-busy="true" />;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="no-print flex items-center justify-between gap-2">
        <Link href={`/runs/${id}`} className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink" data-testid="back-to-job">
          <Icon name="back" size={15} /> Back to the job
        </Link>
        {run.report && (
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            Print
          </button>
        )}
      </div>
      {run.report ? (
        <NetProvider net={run.network}>
          <Report run={run} id="report" />
        </NetProvider>
      ) : (
        <p className="rounded-2xl border border-line bg-panel p-6 text-sm text-ink-2">{run.status === "done" ? "This job has no report." : "The report is ready once the job finishes."}</p>
      )}
    </div>
  );
}
