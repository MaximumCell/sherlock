import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = {
  title: "Operator panel demo",
  description: "The operator panel on bundled, invented data.",
  robots: { index: false, follow: false },
};

// Always backed by the fixture data source (see modeForPath): invented visitors and searches.
export default function Page() {
  return <AdminPage />;
}
