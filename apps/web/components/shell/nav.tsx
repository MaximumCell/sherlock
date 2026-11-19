"use client";

import { Blocks, FolderSearch, Info, PlayCircle, ScrollText, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Cases",
    icon: FolderSearch,
    match: (p) => p === "/" || p.startsWith("/case/"),
  },
  { href: "/modules", label: "Modules", icon: Blocks, match: (p) => p.startsWith("/modules") },
  { href: "/audit", label: "Audit log", icon: ScrollText, match: (p) => p.startsWith("/audit") },
  { href: "/demo", label: "Live demo", icon: PlayCircle, match: (p) => p.startsWith("/demo") },
  { href: "/about", label: "About", icon: Info, match: (p) => p.startsWith("/about") },
];

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-1" aria-label="Sherlock home">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" aria-hidden>
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10.5" cy="10.5" r="2" fill="currentColor" />
      </svg>
      <span className="text-lg font-semibold tracking-tight">Sherlock</span>
      <span className="rounded border border-border px-1 font-mono text-2xs text-muted-foreground">
        v2
      </span>
    </Link>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <item.icon className={cn("h-4 w-4", active && "text-accent")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
