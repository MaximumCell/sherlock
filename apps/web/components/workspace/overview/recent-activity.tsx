"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { TimelineEvent } from "@/lib/timeline";
import { useCaseHref } from "@/lib/use-case-href";
import { TONE_DOT } from "../timeline/timeline-tab";

export function RecentActivity({
  caseId,
  events,
  loading,
}: {
  caseId: string;
  events: TimelineEvent[];
  loading: boolean;
}) {
  const caseHref = useCaseHref();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <Link
          href={caseHref(caseId, "timeline")}
          scroll={false}
          className="text-xs text-accent underline-offset-4 hover:underline"
        >
          Full timeline
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[event.tone]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="break-words">{event.title}</span>
                  {event.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">{event.detail}</span>
                  ) : null}
                </span>
                <time
                  dateTime={event.at}
                  title={formatDateTime(event.at)}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {timeAgo(event.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
