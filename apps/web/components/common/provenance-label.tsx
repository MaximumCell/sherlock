"use client";

import { Globe, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PreviewInfo } from "@/lib/findings";
import { formatDate } from "@/lib/format";
import { provenanceLabel } from "@/lib/profile";
import { cn } from "@/lib/utils";

/** "From the public profile page" / "From search results", with the why in a tooltip. */
export function ProvenanceLabel({
  preview,
  platform,
  className,
}: {
  preview: PreviewInfo | null;
  platform?: string | null;
  className?: string;
}) {
  const p = provenanceLabel(preview, platform);
  if (!p || !preview) return null;
  const Icon = preview.source === "search-snippet" ? Search : Globe;
  const when = preview.fetchedAt ? ` Checked ${formatDate(preview.fetchedAt)}.` : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative z-10 inline-flex max-w-full items-center gap-1 rounded text-left text-2xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={`${p.label}. ${p.tooltip}${when}`}
        >
          <Icon className="h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0">{p.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {p.tooltip}
        {when}
      </TooltipContent>
    </Tooltip>
  );
}
