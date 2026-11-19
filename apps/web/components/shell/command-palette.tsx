"use client";

import { Compass, FolderSearch, Moon, Plus, SlidersHorizontal, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useNewInvestigation } from "@/components/cases/new-investigation-context";
import { useTheme } from "@/components/providers/theme-provider";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TOUR_HREF } from "@/components/tour/tour-steps";
import { caseDisplayTitle } from "@/lib/case-status";
import { DETECTION_LABEL } from "@/lib/detect-target";
import { useAdvanced } from "@/lib/preferences";
import { useCaseSummaries } from "@/lib/query/hooks";
import { isTypingTarget } from "@/lib/storage";
import { TARGET_TYPES } from "@/lib/types";
import { TARGET_TYPE_META } from "@/lib/validation";
import { MORE_ITEMS, NAV_ITEMS } from "./nav";

const OPEN_EVENT = "sherlock:open-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function RecentCases({ onSelect }: { onSelect: (href: string) => void }) {
  const cases = useCaseSummaries();
  const recent = (cases.data ?? []).slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <CommandGroup heading="Recent investigations">
      {recent.map(({ case: c }) => (
        <CommandItem
          key={c.id}
          value={`case ${caseDisplayTitle(c)} ${c.identifiers.map((i) => i.value).join(" ")}`}
          onSelect={() => onSelect(`/case/${c.id}`)}
        >
          <FolderSearch aria-hidden />
          {caseDisplayTitle(c)}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { open: openNew } = useNewInvestigation();
  const { theme, toggle } = useTheme();
  const [advanced, setAdvanced] = useAdvanced();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      const dialogOpen = document.querySelector('[role="dialog"]') !== null;
      if (plain && event.key === "n" && !isTypingTarget(event.target) && !dialogOpen) {
        event.preventDefault();
        openNew();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [openNew]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Find an investigation, go somewhere, or start a search.
        </DialogDescription>
        <Command>
          <CommandInput placeholder="Type a command or find an investigation…" />
          <CommandList className="max-h-[min(60dvh,420px)]">
            <CommandEmpty>Nothing matches. Try another word.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem value="new search investigation scan" onSelect={() => run(() => openNew())}>
                <Plus aria-hidden />
                New search
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              {TARGET_TYPES.map((type) => (
                <CommandItem
                  key={type}
                  value={`new scan ${type} ${TARGET_TYPE_META[type].label}`}
                  onSelect={() => run(() => openNew({ type }))}
                >
                  <Plus aria-hidden />
                  Search {DETECTION_LABEL[type]}
                </CommandItem>
              ))}
              <CommandItem value="take the tour help walkthrough" onSelect={() => run(() => router.push(TOUR_HREF))}>
                <Compass aria-hidden />
                Take the tour
              </CommandItem>
              <CommandItem
                value="advanced details technical toggle"
                onSelect={() => run(() => setAdvanced(!advanced))}
              >
                <SlidersHorizontal aria-hidden />
                {advanced ? "Hide" : "Show"} advanced details
              </CommandItem>
              <CommandItem value="toggle theme dark light" onSelect={() => run(toggle)}>
                {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
                Switch to {theme === "dark" ? "light" : "dark"} theme
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Go to">
              {[...NAV_ITEMS, ...MORE_ITEMS].map((item) => (
                <CommandItem
                  key={item.href}
                  value={`go ${item.label}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <item.icon aria-hidden />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {open ? <RecentCases onSelect={(href) => run(() => router.push(href))} /> : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
