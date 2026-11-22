"use client";

import { Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UTC_OFFSETS,
  browserOffset,
  buildClaim,
  splitClaimTime,
  type PhotoClaim,
  type PlaceHit,
  type Point,
} from "@/lib/geo";
import { PLACE_SEARCH_DEBOUNCE_MS, PLACE_SEARCH_MIN_CHARS } from "@/lib/geo-search";

/**
 * Where and when the photo is said to be from. All optional: a place (search for a town, type a
 * landmark, or click the map), and a date and time with its UTC offset.
 */
export function ClaimForm({
  initial,
  picked,
  onPickedChange,
  onSubmit,
  pending,
  disabled,
}: {
  initial: PhotoClaim | null;
  /** The point picked on the map (owned by the section, so the map can show it). */
  picked: Point | null;
  onPickedChange: (p: Point | null) => void;
  onSubmit: (claim: PhotoClaim | null) => void;
  pending: boolean;
  disabled?: boolean;
}) {
  const { ds } = useData();
  const ids = useId();
  const time = splitClaimTime(initial?.taken_at);
  const [place, setPlace] = useState(initial?.place ?? "");
  const [local, setLocal] = useState(time?.local ?? "");
  const [offset, setOffset] = useState(time?.offset ?? browserOffset());
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);

  // debounced place search, only after the user typed (not for the pre-filled claim)
  useEffect(() => {
    const q = place.trim();
    if (!typed.current || q.length < PLACE_SEARCH_MIN_CHARS) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      ds.searchPlaces(q, ctl.signal)
        .then((r) => {
          setHits(r);
          setOpen(true);
          setActive(-1);
        })
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [place, ds]);

  function choose(h: PlaceHit) {
    typed.current = false;
    setPlace(h.detail ? `${h.label}, ${h.detail}` : h.label);
    onPickedChange({ lat: h.lat, lon: h.lon });
    setOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { claim, error: problem } = buildClaim({ place, point: picked, local, offset });
    setError(problem);
    if (!problem) onSubmit(claim);
  }

  const listId = `${ids}-places`;
  const showList = open && hits.length > 0;
  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? `${ids}-err` : undefined}>
      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-place`}>Place it is said to show</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            id={`${ids}-place`}
            value={place}
            maxLength={120}
            placeholder="A town, an area or a landmark"
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            className="pl-8 pr-8"
            onChange={(e) => {
              typed.current = true;
              setPlace(e.target.value);
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onFocus={() => hits.length && setOpen(true)}
            onKeyDown={(e) => {
              if (!showList) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && active >= 0 && hits[active]) {
                e.preventDefault();
                choose(hits[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {searching ? (
            <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching places" />
          ) : null}
          {showList ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching places"
              className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {hits.map((h, i) => (
                <li
                  key={h.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(h);
                  }}
                  className="cursor-pointer rounded px-2 py-1.5 text-sm aria-selected:bg-muted hover:bg-muted"
                >
                  {h.label}
                  {h.detail ? <span className="text-muted-foreground"> · {h.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" aria-hidden />
          {picked ? (
            <>
              Point on the map: {picked.lat.toFixed(2)}, {picked.lon.toFixed(2)} (about 1 km)
              <button
                type="button"
                onClick={() => onPickedChange(null)}
                className="inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                <X className="h-3 w-3" aria-hidden />
                remove
              </button>
            </>
          ) : (
            "Or click the map to pick the spot. A landmark you type is looked up when the check runs."
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-time`}>Date and time it is said to be from</Label>
          <Input
            id={`${ids}-time`}
            type="datetime-local"
            value={local}
            max="2100-01-01T00:00"
            onChange={(e) => {
              setLocal(e.target.value);
              if (e.target.value && !time) setOffset(browserOffset(e.target.value));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-offset`}>Time zone</Label>
          <select
            id={`${ids}-offset`}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {UTC_OFFSETS.map((o) => (
              <option key={o} value={o}>
                UTC{o}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Use the local time at the place, with the offset it had on that date (for example UTC+02:00
        for Paris in summer). A check tells you if the offset does not match.
      </p>

      {error ? (
        <p id={`${ids}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || disabled}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Check this claim
        </Button>
        {initial ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || disabled}
            onClick={() => {
              setPlace("");
              setLocal("");
              onPickedChange(null);
              setError(null);
              onSubmit(null);
            }}
          >
            Clear the claim
          </Button>
        ) : null}
      </div>
    </form>
  );
}
