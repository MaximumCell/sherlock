"use client";

import { Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { useState } from "react";
import { useNewInvestigation } from "@/components/cases/new-investigation-context";
import { Kbd } from "@/components/common/bits";
import { useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./account-menu";
import { openCommandPalette } from "./command-palette";
import { HelpMenu } from "./help-menu";
import { Brand, MORE_ITEMS, NAV_ITEMS, NavLinks } from "./nav";
import { ScanIndicator } from "./scan-indicator";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${next} theme`}>
          {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Switch to {next} theme</TooltipContent>
    </Tooltip>
  );
}

/** Slim top bar: logo, the three places, a compact search entry, and the personal menus. */
export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { open } = useNewInvestigation();
  return (
    <header
      data-print="hide"
      className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
    >
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-2 px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 md:hidden"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
        >
          <Menu aria-hidden />
        </Button>
        <Brand />
        <nav aria-label="Main" className="ml-4 hidden md:block">
          <NavLinks />
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ScanIndicator />
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 w-56 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground shadow-soft transition-colors hover:border-input hover:text-foreground lg:flex"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">Jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={openCommandPalette}
            aria-label="Open command palette"
          >
            <Search aria-hidden />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" className="ml-1" onClick={() => open()} aria-label="New search">
                <Plus aria-hidden />
                <span className="hidden sm:inline">New search</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              New search <span className="ml-1 font-mono text-muted-foreground">N</span>
            </TooltipContent>
          </Tooltip>
          <div className="hidden items-center sm:flex">
            <HelpMenu />
            <ThemeToggle />
          </div>
          <AccountMenu />
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 sm:max-w-xs">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main places in the app</SheetDescription>
            <Brand />
          </SheetHeader>
          <nav aria-label="Main" className="space-y-4">
            <NavLinks
              items={NAV_ITEMS}
              orientation="vertical"
              onNavigate={() => setMenuOpen(false)}
            />
            <div className="border-t border-border pt-4">
              <NavLinks
                items={MORE_ITEMS}
                orientation="vertical"
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground">
              <span>Theme</span>
              <ThemeToggle />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
