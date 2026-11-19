"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAdvanced } from "@/lib/preferences";
import { useExposure } from "@/lib/query/hooks";
import { prioritisedSteps } from "@/lib/remediation";
import type { Case, Entity, Finding, Job } from "@/lib/types";
import { CaseSection } from "../section";
import { RemediationList } from "../summary/remediation-list";
import { AddTargetDialog } from "./add-target-dialog";
import { SuggestedSearches } from "./suggested-searches";
import { TargetList } from "./target-list";

/** What to search next, what you already searched, and the rest of the "what to do" list. */
export function NextStepsSection({
  c,
  entities,
  findings,
  jobs,
  loading,
}: {
  c: Case;
  entities: Entity[];
  findings: Finding[];
  jobs: Job[];
  loading: boolean;
}) {
  const [advanced] = useAdvanced();
  const [addOpen, setAddOpen] = useState(false);
  const exposure = useExposure(c.id);
  const steps = useMemo(() => prioritisedSteps(exposure.data?.factors ?? []), [exposure.data]);

  return (
    <CaseSection
      id="next"
      title="Next steps"
      description="Searches worth running next, and the remaining things to fix."
      actions={
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus aria-hidden />
          Add another target
        </Button>
      }
    >
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Suggested next searches</h3>
        <SuggestedSearches
          caseId={c.id}
          entities={entities}
          findings={findings}
          jobs={jobs}
          loading={loading}
          advanced={advanced}
        />
      </div>
      <div id="targets" className="scroll-mt-36 space-y-3">
        <h3 className="text-lg font-semibold">What you searched</h3>
        <TargetList c={c} jobs={jobs} entities={entities} />
      </div>
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">More things to fix</h3>
        <RemediationList
          steps={steps}
          start={3}
          visible={5}
          emptyText={
            steps.length
              ? "The top steps are listed in the Summary. Nothing else to add."
              : "Nothing to fix yet. Steps appear once results raise the score."
          }
        />
      </div>
      <AddTargetDialog caseId={c.id} open={addOpen} onOpenChange={setAddOpen} />
    </CaseSection>
  );
}
