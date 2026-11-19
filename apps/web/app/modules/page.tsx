import type { Metadata } from "next";
import { ModulesView } from "@/components/modules/modules-view";

export const metadata: Metadata = {
  title: "Modules",
  description: "The data sources Sherlock can query, loaded from the module registry.",
};

export default function ModulesPage() {
  return <ModulesView />;
}
