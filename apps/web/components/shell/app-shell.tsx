import Link from "next/link";
import type { ReactNode } from "react";
import { SystemThemeSync } from "@/components/providers/theme-provider";
import { Banners } from "./banners";
import { CommandPalette } from "./command-palette";
import { GatewayStatusPill } from "./gateway-status-pill";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar />
      <Banners />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 outline-none sm:px-6">
        {children}
      </main>
      <footer data-print="hide" className="border-t border-border">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>Sherlock · public data only, for self-checks and authorised investigations</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link href="/about#responsible-use" className="hover:text-foreground hover:underline">
              Responsible use
            </Link>
            <Link href="/about#architecture" className="hover:text-foreground hover:underline">
              Architecture
            </Link>
            <Link href="/modules" className="hover:text-foreground hover:underline">
              Data sources
            </Link>
            <Link href="/audit" className="hover:text-foreground hover:underline">
              Activity log
            </Link>
          </span>
        </div>
      </footer>
      <CommandPalette />
      <GatewayStatusPill />
      <SystemThemeSync />
    </div>
  );
}
