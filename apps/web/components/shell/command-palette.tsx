"use client";

import {
  Compass,
  CornerDownLeft,
  FolderSearch,
  Moon,
  Plus,
  SlidersHorizontal,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useNewInvestigation } from "@/components/cases/new-investigation-context";
import { Kbd, TargetIcon } from "@/components/common/bits";
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
import { caseStatusLine } from "@/lib/case-progress";
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

interface Entry {
  value: string;
  group: "Actions" | "Go to" | "Recent investigations";
  label: string;
  icon: LucideIcon | null;
  target?: string;
  /** What the preview pane says about it. */
  preview: string;
  shortcut?: string;
  run: () => void;
}

function Preview({ entry }: { entry: Entry | undefined }) {
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <div className="hidden w-56 shrink-0 flex-col gap-3 border-l border-border bg-surface/60 p-4 sm:flex">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        {Icon ? (
          <Icon className="h-5 w-5" aria-hidden />
        ) : (
          <TargetIcon type={entry.target ?? "username"} className="h-5 w-5" />
        )}
      </span>
      <div className="space-y-1">
        <p className="eyebrow">{entry.group}</p>
        <p className="text-sm font-medium">{entry.label}</p>
        <p className="text-sm text-muted-foreground">{entry.preview}</p>
      </div>
      <p className="mt-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Kbd>↵</Kbd> to run
        {entry.shortcut ? (
          <>
            <span aria-hidden>·</span> or press <Kbd>{entry.shortcut}</Kbd>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const router = useRouter();
  const { open: openNew } = useNewInvestigation();
  const { theme, toggle } = useTheme();
  const [advanced, setAdvanced] = useAdvanced();
  const cases = useCaseSummaries();

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

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => router.push(href);
    const actions: Entry[] = [
      {
        value: "new search investigation scan",
        group: "Actions",
        label: "New search",
        icon: Plus,
        preview: "Open the search box. Type anything; we work out what it is.",
        shortcut: "N",
        run: () => openNew(),
      },
      ...TARGET_TYPES.map<Entry>((type) => ({
        value: `new scan ${type} ${TARGET_TYPE_META[type].label}`,
        group: "Actions",
        label: `Search ${DETECTION_LABEL[type]}`,
        icon: null,
        target: type,
        preview: `Start a search with the type already set to ${TARGET_TYPE_META[type].label.toLowerCase()}.`,
        run: () => openNew({ type }),
      })),
      {
        value: "take the tour help walkthrough",
        group: "Actions",
        label: "Take the tour",
        icon: Compass,
        preview: "A five-step walk through the demo investigation.",
        run: go(TOUR_HREF),
      },
      {
        value: "advanced details technical toggle",
        group: "Actions",
        label: `${advanced ? "Hide" : "Show"} advanced details`,
        icon: SlidersHorizontal,
        preview: "Data-source ids, queues, attempts, rule ids and raw data on every screen.",
        run: () => setAdvanced(!advanced),
      },
      {
        value: "toggle theme dark light",
        group: "Actions",
        label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
        icon: theme === "dark" ? Sun : Moon,
        preview: "Remembered in this browser.",
        run: toggle,
      },
    ];
    const places: Entry[] = [...NAV_ITEMS, ...MORE_ITEMS].map((item) => ({
      value: `go ${item.label}`,
      group: "Go to",
      label: item.label,
      icon: item.icon,
      preview: `Open ${item.label.toLowerCase()}.`,
      run: go(item.href),
    }));
    const recent: Entry[] = (cases.data ?? []).slice(0, 6).map((s) => ({
      value: `case ${caseDisplayTitle(s.case)} ${s.case.identifiers.map((i) => i.value).join(" ")}`,
      group: "Recent investigations",
      label: caseDisplayTitle(s.case),
      icon: FolderSearch,
      preview: caseStatusLine({
        archived: Boolean(s.case.archived_at),
        jobs: s.jobs,
        pendingLinks: s.pendingReviews,
        foundCount: s.foundCount,
      }),
      run: go(`/case/${s.case.id}`),
    }));
    return [...actions, ...places, ...recent];
  }, [advanced, cases.data, openNew, router, setAdvanced, theme, toggle]);

  const run = (entry: Entry) => {
    setOpen(false);
    entry.run();
  };
  const groups = ["Actions", "Go to", "Recent investigations"] as const;
  const current = entries.find((e) => e.value.toLowerCase() === selected.toLowerCase());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[16%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Find an investigation, go somewhere, or start a search.
        </DialogDescription>
        <Command value={selected} onValueChange={setSelected}>
          <CommandInput placeholder="Type a command or find an investigation…" />
          <div className="flex min-h-0">
            <CommandList className="max-h-[min(60dvh,420px)] flex-1">
              <CommandEmpty>Nothing matches. Try another word.</CommandEmpty>
              {groups.map((group) => {
                const items = entries.filter((e) => e.group === group);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={group} heading={group}>
                    {items.map((entry) => (
                      <CommandItem key={entry.value} value={entry.value} onSelect={() => run(entry)}>
                        {entry.icon ? (
                          <entry.icon aria-hidden />
                        ) : (
                          <TargetIcon type={entry.target ?? "username"} />
                        )}
                        <span className="truncate">{entry.label}</span>
                        {entry.shortcut ? <CommandShortcut>{entry.shortcut}</CommandShortcut> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
            <Preview entry={current} />
          </div>
          <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" aria-hidden /> open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
