import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = {
  title: "Case review",
  robots: { index: false, follow: false },
};

// Operator only (the gateway decides); read-only, and every opening is logged on the case.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminPage caseId={id} />;
}
