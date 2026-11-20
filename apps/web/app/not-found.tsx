import type { Metadata } from "next";
import { NotFoundView } from "@/components/common/not-found-view";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return <NotFoundView />;
}
