"use client";

import { ChevronRight, ExternalLink, Layers, Pin } from "lucide-react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { ProvenanceLabel } from "@/components/common/provenance-label";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { mergeExplanation, sourcesLine, type CaseAccount } from "@/lib/accounts";
import { parseFinding } from "@/lib/findings";
import { useCurate } from "@/lib/query/mutations";
import { sourceTitle } from "@/lib/sources";
import type { Correlation } from "@/lib/types";
import { accountPlatform, displayHandle } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { FindingDetail, ProfileSection, RelatedLinks } from "./finding-detail";
import { Section } from "./finding-sections";
import { sourceNames } from "./result-card";

const SEARCHED: Record<string, string> = {
  username: "username",
  email: "email",
  domain: "website",
  scraped_url: "page",
};

/**
 * Detail of an account several sources reported: the merged view first, then each
 * source with its own fields (collapsed), so nothing any source said is lost.
 */
export function AccountSheetBody({
  caseId,
  account,
  related,
  openId,
}: {
  caseId: string;
  account: CaseAccount;
  related: Correlation[];
  /** The finding the sheet was opened for: its source section starts open. */
  openId: string;
}) {
  const curate = useCurate(caseId);
  const { view } = account;
  const pinned = account.findings.some((f) => f.curated);
  const reason = account.merge
    ? mergeExplanation(account.merge.evidence, account.label, account.handle)
    : null;
  return (
    <>
      <SheetHeader className="-mx-5 -mt-5 border-b border-border bg-surface/70 px-5 pb-5 pt-7 pr-12 text-left">
        <div className="flex items-start gap-4">
          <ProfileAvatar
            src={view.avatarUrl}
            name={view.fullname ?? displayHandle(account)}
            platform={accountPlatform(account)}
            url={account.url}
            size="xl"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="break-words">{view.fullname ?? account.label}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-xs">{displayHandle(account)}</span> · {account.label}
            </p>
            <SheetDescription className="flex items-start gap-1.5 text-sm">
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <span>
                {sourcesLine(account)}: {sourceNames(account.sources)}
              </span>
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant={pinned ? "secondary" : "outline"}
            size="sm"
            aria-pressed={pinned}
            onClick={() =>
              (pinned ? account.findings.filter((f) => f.curated) : [account.primary]).forEach(
                (f) => curate.mutate({ findingId: f.id, curated: !pinned }),
              )
            }
          >
            <Pin className={cn(pinned && "fill-current text-accent")} aria-hidden />
            {pinned ? "Pinned" : "Pin"}
          </Button>
          {account.url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={account.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden />
                Open the page
              </a>
            </Button>
          ) : null}
        </div>
        {/* after the buttons, so the sheet does not open with its tooltip focused */}
        <ProvenanceLabel preview={view.preview} platform={accountPlatform(account)} />
      </SheetHeader>
      <div className="space-y-5">
        <ProfileSection view={view} title="Profile, all sources combined" />
        {reason ? (
          <Section title="Why this is one account">
            <p className="text-sm text-muted-foreground">{reason}</p>
            <p className="text-xs text-muted-foreground">
              Merged automatically. If this is wrong, split it under Possible links, Merged
              automatically.
            </p>
          </Section>
        ) : null}
        <RelatedLinks related={related} />
        <Section title={`What each source said (${account.findings.length})`}>
          <ul className="space-y-2">
            {account.findings.map((f) => (
              <li key={f.id}>
                <details
                  open={f.id === openId && f.id !== account.primary.id}
                  className="group rounded-lg border border-border bg-card open:bg-surface/60"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{sourceTitle(f.module ?? f.source_tool)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · searched {SEARCHED[f.identifier_type] ?? f.identifier_type}{" "}
                        <span className="font-mono text-xs">{f.identifier_value}</span>
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-border px-3 py-3">
                    <FindingDetail
                      finding={f}
                      view={parseFinding(f)}
                      related={[]}
                      profileTitle="What this source shows"
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
