import Link from "next/link";
import type { ReactNode } from "react";
import { PendingSearchResumer } from "@/components/search/pending-search-resumer";
import { ActiveSearchDialog } from "./active-search-dialog";
import { Banners } from "./banners";
import { CommandPalette } from "./command-palette";
import { GatewayStatusPill } from "./gateway-status-pill";
import { BrandMark } from "./nav";
import { TopBar } from "./top-bar";

const FOOTER_LINKS = [
  { href: "/about#responsible-use", label: "Responsible use" },
  { href: "/about#architecture", label: "Architecture" },
  { href: "/modules", label: "Data sources" },
  { href: "/audit", label: "Activity log" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <div className="app-backdrop" aria-hidden />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar />
      <Banners />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 outline-none sm:px-6"
      >
        {children}
      </main>
      <footer data-print="hide" className="border-t border-border">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span className="flex items-center gap-2">
            <BrandMark className="h-4 w-4 text-muted-foreground" />
            Public data only, for self-checks and authorised investigations
          </span>
          <nav aria-label="Footer" className="sm:ml-auto">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {FOOTER_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="rounded-sm hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
      <CommandPalette />
      <ActiveSearchDialog />
      <PendingSearchResumer />
      <GatewayStatusPill />
    </div>
  );
}
