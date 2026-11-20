"use client";

import { useMemo, useState } from "react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { buildAccounts } from "@/lib/accounts";
import { groupOf } from "@/lib/finding-groups";
import { distinctFaces } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import type { Correlation, Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";

/**
 * "Faces of this identity": the distinct profile pictures found (the same image counts
 * once), each badged with its platform. Shown only when there are at least two.
 */
export function FacesStrip({
  findings,
  correlations,
}: {
  findings: Finding[];
  correlations: Correlation[];
}) {
  const { set } = useUrlState();
  // pictures whose host refused to serve them are dropped from the strip
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const all = useMemo(() => {
    const { accounts } = buildAccounts(findings, correlations);
    // real accounts before rows that only describe an image
    const ordered = [
      ...accounts.filter((a) => groupOf(a.primary) !== "images"),
      ...accounts.filter((a) => groupOf(a.primary) === "images"),
    ];
    return distinctFaces(ordered, 12);
  }, [findings, correlations]);
  const faces = all.filter((f) => !failed.has(f.url));
  if (faces.length < 2) return null;
  return (
    <section aria-labelledby="faces-heading" className="panel flex h-full flex-col gap-4 p-5">
      <div className="space-y-1">
        <h3 id="faces-heading" className="eyebrow">
          Faces of this identity
        </h3>
        <p className="text-sm text-muted-foreground">
          The {faces.length} different profile pictures found. The same image used on several sites
          is shown once. Open one to see its account.
        </p>
      </div>
      {/* stacked like a hand of cards; spreads out on hover or keyboard focus */}
      <ul
        className="group/faces mt-auto flex flex-wrap items-end gap-y-3 pl-3"
        aria-label="Distinct profile pictures"
      >
        {faces.map((face, i) => {
          const label = resolvePlatform(face.platform).label;
          return (
            <li
              key={face.url}
              className="-ml-3 transition-[margin,transform] duration-3 ease-out group-hover/faces:ml-1 group-focus-within/faces:ml-1"
              style={{ zIndex: faces.length - i }}
            >
              <button
                type="button"
                onClick={() => set({ finding: face.account.primary.id }, "push")}
                title={`${face.name} · ${label}`}
                aria-label={`Open ${label} account of ${face.name}`}
                className="group block rounded-xl transition-transform duration-2 ease-out hover:-translate-y-1 focus-visible:-translate-y-1"
              >
                <ProfileAvatar
                  src={face.url}
                  name={face.name}
                  platform={face.platform}
                  size="sm"
                  decorative
                  onImageError={(url) => setFailed((prev) => new Set(prev).add(url))}
                  className="[&>span:first-child]:ring-2 [&>span:first-child]:ring-card"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="truncate text-xs text-muted-foreground">
        {faces.map((f) => resolvePlatform(f.platform).label).join(" · ")}
      </p>
    </section>
  );
}
