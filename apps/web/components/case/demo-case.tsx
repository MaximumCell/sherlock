"use client";

import { useSearchParams } from "next/navigation";
import { TourHost } from "@/components/tour/tour-host";
import { DEMO_CASE_ID } from "@/lib/data/fixtures/demo-case";
import { CasePage } from "./case-page";

/** `/demo` shows the bundled case; `/demo?case=<id>` shows any other case of the sandbox. */
export function DemoCase() {
  const params = useSearchParams();
  const caseId = params.get("case") ?? DEMO_CASE_ID;
  return (
    <>
      <CasePage caseId={caseId} />
      {caseId === DEMO_CASE_ID ? <TourHost /> : null}
    </>
  );
}
