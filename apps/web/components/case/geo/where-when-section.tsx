"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudRain, CloudSun, ExternalLink, ImageOff, Loader2, Snowflake, Sun, Webcam as WebcamIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { InfoHint } from "@/components/common/info-hint";
import { useData } from "@/components/providers/data-provider";
import { useReadOnly } from "@/components/providers/read-only";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatClaimTime,
  geoView,
  verdictCounts,
  type PhotoClaim,
  type Point,
  type WeatherMoment,
} from "@/lib/geo";
import { useGeoCheck } from "@/lib/query/mutations";
import type { Finding, Job } from "@/lib/types";
import { CaseSection } from "../section";
import { CheckList } from "./check-list";
import { ClaimForm } from "./claim-form";
import { OsmMap, type MapMarker } from "./osm-map";
import { SunDial } from "./sun-dial";

const PHOTO_URL_STALE_MS = 30 * 60 * 1000;

function WeatherChip({ w }: { w: WeatherMoment }) {
  const Icon = w.kind === "wet" ? CloudRain : w.kind === "snow" ? Snowflake : w.kind === "clear" ? Sun : CloudSun;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{w.label === "camera" ? "Camera time" : "Claimed time"}:</span>
      <span>
        {w.summary}
        {w.temperatureC !== null ? `, ${Math.round(w.temperatureC)} °C` : ""}
        {w.precipitationMm ? `, ${w.precipitationMm} mm` : ""}
      </span>
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}

function exifTime(v: string | null): string | null {
  const m = v ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} (local)` : v;
}

/**
 * "Where and when": could this photo have been taken where and when it is said to be? Camera data,
 * the claim, the sun, the weather and Google Lens titles, each check on its own. Places and
 * conditions only; no face recognition, nothing about who is in the picture.
 */
export function WhereWhenSection({
  caseId,
  value,
  findings,
  jobs,
}: {
  caseId: string;
  value: string;
  findings: Finding[];
  jobs: Job[];
}) {
  const { ds, mode } = useData();
  const readOnly = useReadOnly();
  const view = useMemo(() => geoView(findings, value), [findings, value]);
  const geo = useGeoCheck(caseId);
  const [picked, setPicked] = useState<Point | null>(null);
  const running = jobs.some(
    (j) => j.module === "geo_context" && j.target_value === value && (j.status === "queued" || j.status === "running"),
  );
  const photo = useQuery({
    queryKey: [mode, "photo-url", value],
    queryFn: async () => (await ds.photoUrl(value)) ?? (/^https?:\/\//i.test(value) ? value : null),
    staleTime: PHOTO_URL_STALE_MS,
    retry: 1,
  });

  const markers: MapMarker[] = [];
  if (view.cameraPoint) markers.push({ key: "camera", point: view.cameraPoint, label: "Camera GPS", tone: "camera" });
  if (view.claimPoint) markers.push({ key: "claim", point: view.claimPoint, label: "Claimed place", tone: "claim" });
  if (!view.cameraPoint && !view.claimPoint && view.location)
    markers.push({ key: "loc", point: view.location, label: "Location", tone: "camera" });
  if (picked && !(view.claimPoint && picked.lat === view.claimPoint.lat && picked.lon === view.claimPoint.lon))
    markers.push({ key: "pick", point: picked, label: "Your pick", tone: "pick" });

  const counts = verdictCounts(view.checks);
  const submit = (claim: PhotoClaim | null) => geo.mutate({ claim, value });
  const firstSun = view.sun[0];

  return (
    <CaseSection
      id="where"
      title="Where and when"
      description="Could this photo have been taken where and when it is said to be? Each check below compares the camera's own data, the claim, the sun and the weather, and says what to look at in the picture."
      hint={
        <InfoHint label="How the location check works" title="How the location check works">
          The sun is computed from the place and time; weather comes from Open-Meteo, place names
          from OpenStreetMap. Coordinates are rounded to about 1 km. EXIF data is easy to strip or
          fake and camera clocks are often wrong, so these checks support your judgement: none of
          them proves anything. Sherlock never looks at who is in the photo.
        </InfoHint>
      }
    >
      {running ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking the place and time…
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="panel space-y-4 p-4">
          <h3 className="eyebrow">The photo</h3>
          {photo.isPending ? (
            <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          ) : photo.data ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, the user's own image URL, or the demo drawing
            <img
              src={photo.data}
              alt="The photo being checked"
              referrerPolicy="no-referrer"
              className="max-h-64 w-full rounded-lg border border-border bg-muted object-contain"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              <ImageOff className="h-5 w-5" aria-hidden />
              The photo cannot be shown here.
            </div>
          )}
          <dl className="space-y-1.5">
            <Fact label="Camera place" value={view.cameraPoint ? view.placeLabel ?? "Recorded" : view.ran ? "None in the file" : null} />
            <Fact label="Camera time" value={exifTime(view.cameraTime) ?? (view.ran ? "None in the file" : null)} />
            <Fact label="Camera" value={view.camera} />
            <Fact label="Time zone" value={view.timezone} />
            <Fact label="Claimed place" value={view.claim?.place ?? view.claimPlaceLabel ?? (view.claimPoint ? `${view.claimPoint.lat.toFixed(2)}, ${view.claimPoint.lon.toFixed(2)}` : null)} />
            <Fact label="Claimed time" value={formatClaimTime(view.claim?.taken_at)} />
          </dl>
          {view.weather.length ? (
            <div className="flex flex-wrap gap-2" aria-label="Weather that hour">
              {view.weather.map((w) => (
                <WeatherChip key={w.label} w={w} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel flex min-w-0 flex-col gap-2 p-3">
          <OsmMap
            markers={markers}
            onPick={readOnly ? undefined : (p) => setPicked(p)}
            label="Map of the camera location and the claimed place"
            className="h-72 sm:h-80 lg:h-full lg:min-h-[22rem]"
          />
          <p className="text-xs text-muted-foreground">
            {view.claimDistanceKm !== null
              ? `The camera location is ${view.claimDistanceKm} km from the claimed place. `
              : ""}
            Both points are rounded to about 1 km.{readOnly ? "" : " Click the map to pick a claimed place."}
          </p>
        </div>
      </div>

      {view.notes.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {view.notes.map((n) => (
            <li key={n.facet} className={n.error ? "text-warning" : undefined}>
              <span className="font-medium">{n.facet}:</span> {n.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="panel space-y-3 p-4">
          <h3 className="eyebrow">Sun and shadows</h3>
          {firstSun ? (
            <SunDial moments={view.sun} />
          ) : (
            <p className="text-sm text-muted-foreground">
              The sun needs a place and a time: from the camera, or from the claim below.
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="eyebrow">Checks</h3>
            {view.checks.length ? (
              <p className="text-sm text-muted-foreground">
                {counts.consistent} consistent · {counts.inconsistent} inconsistent · {counts.cant_tell} to look at
              </p>
            ) : null}
          </div>
          {view.ran || !running ? <CheckList checks={view.checks} /> : <Skeleton className="h-40 rounded-lg" />}
          {view.lensState === "pending" ? (
            <p className="text-xs text-muted-foreground">
              Google Lens results were still coming in. Check the claim again once they are in to
              compare their titles.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            There is no overall score on purpose. Camera data is easy to strip or fake, and clocks are
            often wrong: these checks help you look, they do not prove anything.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel space-y-3 p-4">
          <h3 className="eyebrow">See the spot yourself</h3>
          {view.streetImages.length ? (
            <ul className="grid grid-cols-3 gap-2" aria-label="Street-level images nearby">
              {view.streetImages.slice(0, 6).map((i) => (
                <li key={i.id}>
                  <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="block">
                    {i.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail
                      <img src={i.thumbnail} alt={`Street-level image${i.capturedOn ? ` from ${i.capturedOn}` : ""}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded border border-border object-cover" />
                    ) : null}
                    <span className="block truncate text-2xs text-muted-foreground">{i.capturedOn ?? "Mapillary"}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {view.streetLinks.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Open the spot on public maps">
              {view.streetLinks.map((l) => (
                <li key={l.key}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm transition-colors duration-1 hover:bg-muted">
                    {l.label}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Links appear once there is a place to open.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Compare buildings, signs, the skyline and the terrain with the photo.
          </p>
        </div>
        <div className="panel space-y-3 p-4">
          <h3 className="eyebrow flex items-center gap-1.5">
            <WebcamIcon className="h-3.5 w-3.5" aria-hidden /> Public webcams nearby
          </h3>
          {view.webcams.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {view.webcams.map((w) => (
                <li key={w.id}>
                  <a href={w.url ?? view.webcamsDirectory ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3 p-2.5 hover:bg-muted/50">
                    {w.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- operator-published webcam still
                      <img src={w.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-14 shrink-0 rounded border border-border object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{w.title}</span>
                      {w.distanceKm !== null ? <span className="block text-xs text-muted-foreground">{w.distanceKm} km away</span> : null}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {view.webcamsNote ?? "Webcams appear once there is a place to look around."}{" "}
              {view.webcamsDirectory ? (
                <a href={view.webcamsDirectory} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                  Browse webcams on the map
                </a>
              ) : null}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Public, operator-published webcams only. Their archives can show the light and weather
            at that hour.
          </p>
        </div>
      </div>

      {readOnly ? null : (
        <div className="panel space-y-4 p-4 sm:p-5">
          <div className="space-y-1">
            <h3 className="font-display text-xl">{view.claim ? "Change the claim" : "Add the claim to check"}</h3>
            <p className="text-sm text-muted-foreground">
              Where and when is this photo said to be from? Only the location checks run again.
            </p>
          </div>
          <ClaimForm
            key={JSON.stringify(view.claim)}
            initial={view.claim}
            picked={picked}
            onPickedChange={setPicked}
            onSubmit={submit}
            pending={geo.isPending}
          />
        </div>
      )}

      {view.attributions.length ? (
        <p className="text-2xs text-muted-foreground">{view.attributions.join(" · ")}</p>
      ) : null}
    </CaseSection>
  );
}
