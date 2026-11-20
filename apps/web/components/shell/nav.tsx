"use client";

import {
  BookOpen,
  Blocks,
  FolderSearch,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useData } from "@/components/providers/data-provider";
import { useAdminMe } from "@/lib/admin/hooks";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

/** The three top-level places. Everything else is reached from a menu or the palette. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Investigations",
    icon: FolderSearch,
    match: (p) => p === "/" || p.startsWith("/case/") || p.startsWith("/demo"),
  },
  { href: "/modules", label: "Data sources", icon: Blocks, match: (p) => p.startsWith("/modules") },
  { href: "/about", label: "How it works", icon: BookOpen, match: (p) => p.startsWith("/about") },
];

/** Secondary destinations, listed in the palette and the mobile menu. */
export const MORE_ITEMS: NavItem[] = [
  { href: "/demo", label: "Try the demo", icon: PlayCircle, match: (p) => p.startsWith("/demo") },
  { href: "/audit", label: "Activity log", icon: ScrollText, match: (p) => p.startsWith("/audit") },
];

/** The mark: a lens holding three connected nodes. The investigation motif, in one glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-6 w-6", className)} aria-hidden>
      <circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.6 15.6 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7.6 12.4 10.2 7.8 13.4 11.6Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="7.6" cy="12.4" r="1.25" fill="currentColor" />
      <circle cx="13.4" cy="11.6" r="1.25" fill="currentColor" />
      <circle cx="10.2" cy="7.8" r="1.6" className="fill-accent" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="group flex shrink-0 items-center gap-2 rounded-md px-1 py-1"
      aria-label="Sherlock, start a new search"
    >
      <BrandMark className="text-foreground transition-transform duration-3 ease-out group-hover:-rotate-6" />
      {compact ? null : (
        <span className="font-display text-[1.375rem] leading-none tracking-tight">Sherlock</span>
      )}
    </Link>
  );
}

export function NavLinks({
  items = NAV_ITEMS,
  orientation = "horizontal",
  onNavigate,
}: {
  items?: NavItem[];
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const vertical = orientation === "vertical";
  return (
    <ul className={cn("flex", vertical ? "flex-col gap-0.5" : "items-center gap-1")}>
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2 rounded-md text-sm font-medium transition-colors duration-1",
                vertical ? "px-3 py-2.5" : "px-3 py-1.5",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                active && vertical && "bg-muted",
              )}
            >
              {vertical ? <item.icon className="h-4 w-4" aria-hidden /> : null}
              {item.label}
              {active && !vertical ? (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-[11px] h-px bg-foreground"
                />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const ADMIN_ITEM: NavItem = {
  href: "/admin",
  label: "Admin",
  icon: ShieldCheck,
  match: (p) => p.startsWith("/admin"),
};

/**
 * The operator panel link. Rendered only for a signed-in session the gateway confirms as
 * an operator; guests and other accounts never see it (and the demo's made-up operator
 * does not count).
 */
export function AdminNavLink({
  orientation = "horizontal",
  onNavigate,
}: {
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
}) {
  const { ds } = useData();
  const operator = useAdminMe({ quiet: true }).data;
  const pathname = usePathname() ?? "/";
  if (!operator || ds.admin.demo) return null;
  const active = ADMIN_ITEM.match(pathname);
  const vertical = orientation === "vertical";
  return (
    <Link
      href={ADMIN_ITEM.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md text-sm font-medium transition-colors",
        vertical ? "px-3 py-2.5" : "px-3 py-1.5",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
      {ADMIN_ITEM.label}
    </Link>
  );
}
