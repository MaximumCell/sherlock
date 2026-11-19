"use client";

import { FlaskConical, TriangleAlert } from "lucide-react";
import { useData } from "@/components/providers/data-provider";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

function Banner({
  tone,
  children,
}: {
  tone: "warning" | "info";
  children: React.ReactNode;
}) {
  const Icon = tone === "warning" ? TriangleAlert : FlaskConical;
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      data-print="hide"
      className={cn(
        "flex items-start justify-center gap-2 border-b px-4 py-2 text-sm sm:px-6",
        tone === "warning"
          ? "border-warning/30 bg-warning/10 text-foreground"
          : "border-border bg-surface text-muted-foreground",
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-warning" : "text-accent")}
        aria-hidden
      />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

/** Tells the visitor which data they are looking at. Never silent about fixture mode. */
export function Banners() {
  const { mode } = useData();
  if (env.fallback) {
    return (
      <Banner tone="warning">
        <strong className="font-semibold">Supabase is not configured.</strong>{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are missing, so the
        app is running on built-in made-up demo data
        {env.isDevelopment ? " (automatic fallback in development)" : ""}. Nothing is saved.
      </Banner>
    );
  }
  if (mode === "fixtures") {
    return (
      <Banner tone="info">
        <strong className="font-medium text-foreground">Demo.</strong> Every person, handle and
        address here is made up. Your changes stay in this tab and no real search is run.
      </Banner>
    );
  }
  return null;
}
