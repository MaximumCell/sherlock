"use client";

import { BookOpen, CircleHelp, Compass, Keyboard, PlayCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Kbd } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TOUR_HREF } from "@/components/tour/tour-steps";

const SHORTCUTS: [keys: string[], what: string][] = [
  [["⌘", "K"], "Jump to anything"],
  [["N"], "New search"],
  [["Y", "A"], "Yes, these belong together (possible links)"],
  [["N", "R"], "No, they do not (possible links)"],
  [["J", "K"], "Next or previous link"],
  [["U"], "Undo your last decision"],
  [["Esc"], "Close a panel or the tour"],
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work anywhere except while you are typing in a field. In the possible links
            section, N means No.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">{what}</dt>
              <dd className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export function HelpMenu() {
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <CircleHelp aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem asChild>
            <Link href={TOUR_HREF}>
              <Compass aria-hidden />
              Take the tour
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/demo">
              <PlayCircle aria-hidden />
              Try the demo
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/about">
              <BookOpen aria-hidden />
              How it works
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/about#responsible-use">
              <ShieldCheck aria-hidden />
              Responsible use
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcuts(true)}>
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}
