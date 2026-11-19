import Link from "next/link";
import type { ReactNode } from "react";
import { Banners } from "./banners";
import { CommandPalette } from "./command-palette";
import { GatewayStatusPill } from "./gateway-status-pill";
import { Brand, NavLinks } from "./nav";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside
        data-print="hide"
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 border-r border-border bg-surface px-3 py-4 lg:flex"
      >
        <Brand />
        <NavLinks />
        <p className="mt-auto px-2.5 text-2xs leading-relaxed text-muted-foreground">
          Public data only. For self-exposure checks and authorised investigations.{" "}
          <Link href="/about#responsible-use" className="underline underline-offset-2 hover:text-foreground">
            Responsible use
          </Link>
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <Banners />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
        <footer
          data-print="hide"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6"
        >
          <span>Sherlock v2 · OSINT on public data</span>
          <Link href="/about#responsible-use" className="hover:text-foreground hover:underline">
            Responsible use
          </Link>
          <Link href="/about#architecture" className="hover:text-foreground hover:underline">
            Architecture
          </Link>
          <Link href="/modules" className="hover:text-foreground hover:underline">
            Data sources
          </Link>
        </footer>
      </div>
      <CommandPalette />
      <GatewayStatusPill />
    </div>
  );
}
