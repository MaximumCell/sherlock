import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = {
  title: "Operator panel",
  robots: { index: false, follow: false },
};

// Not in the public navigation. The gateway decides who is an operator (ADMIN_EMAILS).
export default function Page() {
  return <AdminPage />;
}
