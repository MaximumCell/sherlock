import type { Metadata } from "next";
import { ModulesView } from "@/components/modules/modules-view";

export const metadata: Metadata = {
  title: "Data sources",
  description: "Every public data source Sherlock can check, grouped by what you search.",
};

export default function ModulesPage() {
  return <ModulesView />;
}
