"use client";

import { Check, Copy, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReport } from "@/lib/query/hooks";
import { CaseSection } from "../section";

/** Typography for rendered markdown, built from the same tokens as the rest of the app. */
const PROSE = [
  "max-w-3xl text-base leading-relaxed",
  "[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mb-1 [&_h3]:mt-5 [&_h3]:font-semibold",
  "[&_p]:my-2 [&_em]:text-muted-foreground",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left",
  "[&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground",
  "[&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5",
].join(" ");

/** Print only the report: the rest of the case page is hidden for the print job. */
function printReport() {
  document.body.dataset.printing = "report";
  const done = () => {
    delete document.body.dataset.printing;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

/** The rendered report, generated when this section first comes into view. */
export function ReportSection({ caseId, visible }: { caseId: string; visible: boolean }) {
  const report = useReport(caseId, visible);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!report.data) return;
    try {
      await navigator.clipboard.writeText(report.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", {
        description: "Clipboard access was blocked by the browser.",
      });
    }
  };

  return (
    <CaseSection
      id="report"
      title="Report"
      description="Written from your current results and the links you confirmed. Copy it or print it."
      actions={
        <div className="flex flex-wrap gap-2" data-print="hide">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void report.refetch()}
            disabled={report.isFetching}
          >
            <RefreshCw className={report.isFetching ? "animate-spin" : undefined} aria-hidden />
            Regenerate
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!report.data}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={printReport} disabled={!report.data}>
            <Printer aria-hidden />
            Print
          </Button>
        </div>
      }
    >
      {!visible && report.isPending ? (
        <p className="text-sm text-muted-foreground">
          The report is written when you reach this section.
        </p>
      ) : report.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Generating report">
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-40 w-full max-w-3xl" />
        </div>
      ) : report.isError ? (
        <ErrorState
          title="The report could not be written"
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <article className="rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-10 print:border-0 print:p-0 print:shadow-none">
          <div className={PROSE}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {report.data}
            </ReactMarkdown>
          </div>
        </article>
      )}
    </CaseSection>
  );
}
