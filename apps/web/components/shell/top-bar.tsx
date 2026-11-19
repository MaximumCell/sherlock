"use client";

import { Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { useState } from "react";
import { useNewInvestigation } from "@/components/cases/new-investigation-context";
import { Kbd } from "@/components/common/bits";
import { useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./account-menu";
import { openCommandPalette } from "./command-palette";
import { Brand, NavLinks } from "./nav";

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

export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { open } = useNewInvestigation();
  return (
    <header
      data-print="hide"
      className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-6"
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMenuOpen(true)}
        aria-label="Open navigation"
      >
        <Menu aria-hidden />
      </Button>
      <div className="lg:hidden">
        <Brand />
      </div>
      <button
        type="button"
        onClick={openCommandPalette}
        className="ml-auto hidden h-9 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex lg:ml-0"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={openCommandPalette}
          aria-label="Open command palette"
        >
          <Search aria-hidden />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => open()} aria-label="New investigation">
              <Plus aria-hidden />
              <span className="hidden sm:inline">New</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New investigation <span className="ml-1 font-mono text-muted-foreground">N</span>
          </TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <AccountMenu />
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 sm:max-w-xs">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main sections of the app</SheetDescription>
            <Brand />
          </SheetHeader>
          <NavLinks onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
