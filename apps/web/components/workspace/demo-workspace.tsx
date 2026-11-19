"use client";

import { useSearchParams } from "next/navigation";
import { DEMO_CASE_ID } from "@/lib/data/fixtures/demo-case";
import { Workspace } from "./workspace";

/** `/demo` shows the bundled case; `/demo?case=<id>` shows any other case of the sandbox. */
export function DemoWorkspace() {
  const params = useSearchParams();
  return <Workspace caseId={params.get("case") ?? DEMO_CASE_ID} />;
}
