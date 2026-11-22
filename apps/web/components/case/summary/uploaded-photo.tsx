"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageOff, Lock, MapPinned } from "lucide-react";
import { useMemo } from "react";
import { useData } from "@/components/providers/data-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { photoResults } from "@/lib/photo-results";
import type { Finding } from "@/lib/types";
import { formatBytes } from "@/lib/uploads";
import { EngineLinks, PhotoMatchList } from "./photo-matches";

/** Signed URLs last an hour; refresh well before that while the page stays open. */
const PHOTO_URL_STALE_MS = 30 * 60 * 1000;

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs leading-5">{value}</dd>
    </div>
  );
}

/**
 * The top of an uploaded-photo investigation: the photo itself (a short-lived signed URL, the
 * bucket is private), its details, a warning when it carries location data, the reverse image
 * matches and the search-engine links.
 */
export function UploadedPhoto({ value, findings }: { value: string; findings: Finding[] }) {
  const { ds, mode } = useData();
  const photo = useQuery({
    queryKey: [mode, "photo-url", value],
    queryFn: () => ds.photoUrl(value),
    staleTime: PHOTO_URL_STALE_MS,
    refetchInterval: PHOTO_URL_STALE_MS,
    retry: 1,
  });
  const r = useMemo(() => photoResults(findings, value), [findings, value]);
  const d = r.details;

  return (
    <section
      aria-labelledby="uploaded-photo-heading"
      className="panel grid gap-5 p-5 md:grid-cols-[minmax(0,15rem)_1fr]"
    >
      <div className="space-y-3">
        <h3 id="uploaded-photo-heading" className="eyebrow">
          Your uploaded photo
        </h3>
        {photo.isPending ? (
          <Skeleton className="aspect-square w-full rounded-lg" />
        ) : photo.data ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private object
          <img
            src={photo.data}
            alt="The photo this investigation searched"
            className="max-h-72 w-full rounded-lg border border-border bg-muted object-contain"
          />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <ImageOff className="h-5 w-5" aria-hidden />
            The photo cannot be shown here. It is private to the person who uploaded it, or it was
            deleted.
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Private to you. Deleted together with this investigation.
        </p>
      </div>

      <div className="min-w-0 space-y-5">
        {r.hasLocation ? (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
          >
            <MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-medium">{r.locationNote ?? "This photo contains location data"}</p>
              <p className="text-muted-foreground">
                Anyone with the original file can see roughly where it was taken. Remove location
                data before you share it. Sherlock only shows it rounded to about 1 km, under Where
                and when.
              </p>
            </div>
          </div>
        ) : null}
        {d ? (
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Fact label="Format" value={d.format ?? d.contentType} />
            <Fact
              label="Dimensions"
              value={d.width && d.height ? `${d.width} × ${d.height}` : null}
            />
            <Fact label="Size" value={d.sizeBytes ? formatBytes(d.sizeBytes) : null} />
            <Fact label="Camera" value={d.camera} />
            <Fact label="Taken" value={d.takenAt} />
            <Fact
              label="Location data"
              value={d.gpsPresent === null ? null : d.gpsPresent ? "yes" : "none"}
            />
          </dl>
        ) : r.detailsError ? (
          <p className="text-sm text-warning">The photo could not be read: {r.detailsError}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Reading the photo…</p>
        )}
        <PhotoMatchList matches={r.matches} searched={r.reverseSearched} />
        <EngineLinks links={r.links} note={r.linksNote} />
      </div>
    </section>
  );
}
