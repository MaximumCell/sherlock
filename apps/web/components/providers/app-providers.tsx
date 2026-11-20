"use client";

import type { ReactNode } from "react";
import { NewInvestigationProvider } from "@/components/cases/new-investigation-context";
import { usePlatformRegistry } from "@/lib/query/hooks";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionProvider } from "@/components/motion/motion-provider";
import { DataProvider } from "./data-provider";
import { useTheme } from "./theme-provider";

/** Installs the live platform registry (labels and icons) once the gateway answers. */
function PlatformRegistry() {
  usePlatformRegistry();
  return null;
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-center" closeButton />;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <MotionProvider>
        <TooltipProvider delayDuration={250}>
          <NewInvestigationProvider>{children}</NewInvestigationProvider>
          <ThemedToaster />
          <PlatformRegistry />
        </TooltipProvider>
      </MotionProvider>
    </DataProvider>
  );
}
