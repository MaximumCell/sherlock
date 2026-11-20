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
    <section aria-labelledby="faces-heading" className="space-y-2">
      <div>
        <h3 id="faces-heading" className="text-lg font-semibold">
          Faces of this identity
        </h3>
        <p className="text-sm text-muted-foreground">
          The {faces.length} different profile pictures found. The same image used on several
          sites is shown once. Open one to see its account.
        </p>
      </div>
      <ul className="flex flex-wrap gap-3" aria-label="Distinct profile pictures">
        {faces.map((face) => {
          const label = resolvePlatform(face.platform).label;
          return (
            <li key={face.url}>
              <button
                type="button"
                onClick={() => set({ finding: face.account.primary.id }, "push")}
                title={`${face.name} · ${label}`}
                aria-label={`Open ${label} account of ${face.name}`}
                className="group flex w-20 flex-col items-center gap-1.5 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ProfileAvatar
                  src={face.url}
                  name={face.name}
                  platform={face.platform}
                  size="md"
                  decorative
                  onImageError={(url) => setFailed((prev) => new Set(prev).add(url))}
                  className="transition-transform motion-safe:group-hover:-translate-y-0.5"
                />
                <span className="w-full truncate text-center text-2xs text-muted-foreground">
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
