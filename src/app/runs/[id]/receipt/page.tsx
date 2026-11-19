"use client";
import { use } from "react";
import Link from "next/link";
import { ReceiptView } from "@/components/ReceiptView";
import { NetProvider } from "@/components/NetContext";
import { Icon } from "@/components/Icon";
import { useAgentTheme, useRun } from "@/components/useRun";

/** The receipt on its own page: something to print, file or send. */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, missing } = useRun(id);
  useAgentTheme(run?.agent);
  if (missing) return <p className="pt-16 text-center text-sm text-ink-2">This job isn&apos;t on this server anymore.</p>;
  if (!run) return <div className="mx-auto h-96 max-w-3xl animate-pulse rounded-2xl bg-line/50 motion-reduce:animate-none" aria-busy="true" />;
  const finished = run.status === "done" || run.status === "cancelled";
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/runs/${id}`} className="no-print mb-3 inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink" data-testid="back-to-job">
        <Icon name="back" size={15} /> Back to the job
      </Link>
      {finished ? (
        <NetProvider net={run.network}>
          <ReceiptView run={run} />
        </NetProvider>
      ) : <p className="rounded-2xl border border-line bg-panel p-6 text-sm text-ink-2">The receipt is ready once the job finishes.</p>}
    </div>
  );
}
