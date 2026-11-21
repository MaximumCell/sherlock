"use client";

import { ArrowLeft, Check, NotebookPen, Pencil, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TargetChip } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { useReadOnly } from "@/components/providers/read-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { caseDisplayTitle } from "@/lib/case-status";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useAdvanced } from "@/lib/preferences";
import { useUpdateCase } from "@/lib/query/mutations";
import type { Case } from "@/lib/types";
import { CaseMenu } from "./case-menu";
import { AddTargetDialog } from "./next/add-target-dialog";
import { NotesDrawer } from "./notes-drawer";
import { goToSection } from "./section-nav";
import { TagEditor } from "./tag-editor";

function TitleEditor({ c, onDone }: { c: Case; onDone: () => void }) {
  const update = useUpdateCase(c.id);
  const [title, setTitle] = useState(c.title ?? "");
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === (c.title ?? "")) return onDone();
    update.mutate({ title: title.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={save} className="flex w-full max-w-xl items-center gap-1.5">
      <Input
        autoFocus
        aria-label="Investigation title"
        maxLength={120}
        value={title}
        placeholder={caseDisplayTitle({ title: null, identifiers: c.identifiers })}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        className="h-12 font-display text-3xl"
      />
      <Button type="submit" size="icon" aria-label="Save title" disabled={update.isPending}>
        <Check aria-hidden />
      </Button>
      <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={onDone}>
        <X aria-hidden />
      </Button>
    </form>
  );
}

export function AdvancedSwitch() {
  const [advanced, setAdvanced] = useAdvanced();
  return (
    <div className="flex items-center gap-2" data-tour="advanced">
      <Switch id="advanced-switch" checked={advanced} onCheckedChange={setAdvanced} />
      <Label htmlFor="advanced-switch" className="text-sm font-normal text-muted-foreground">
        Advanced
      </Label>
    </div>
  );
}

/** Title, targets, tags and the secondary actions. The progress rail sits in the sticky bar below. */
export function CaseHeader({ c }: { c: Case }) {
  const pathname = usePathname();
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const inDemo = pathname?.startsWith("/demo") ?? false;
  const readOnly = useReadOnly();

  return (
    <header className="space-y-4">
      <Link
        href={readOnly ? (inDemo ? "/demo/admin" : "/admin") : "/"}
        data-print="hide"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {readOnly ? "Operator panel" : "All investigations"}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {editing ? (
            <TitleEditor c={c} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="min-w-0 break-words font-display text-4xl tracking-tight sm:text-5xl">
                {caseDisplayTitle(c)}
              </h1>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Rename"
                  onClick={() => setEditing(true)}
                  data-print="hide"
                >
                  <Pencil aria-hidden />
                </Button>
              )}
              {c.archived_at ? <Badge variant="muted">Archived</Badge> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {c.identifiers.map((idf) => (
              <TargetChip key={`${idf.type}:${idf.value}`} type={idf.type} value={idf.value} />
            ))}
            {c.tags.length > 0 ? (
              <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
            ) : null}
            {c.tags.map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
            {readOnly ? null : <TagEditor c={c} />}
          </div>
          <p className="font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground">
            <span title={formatDateTime(c.created_at)}>Started {timeAgo(c.created_at)}</span>
            {c.updated_at ? (
              <span title={formatDateTime(c.updated_at)}> · updated {timeAgo(c.updated_at)}</span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2" data-print="hide">
          <AdvancedSwitch />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNotesOpen(true)}
            hidden={readOnly && !c.notes.trim()}
          >
            <NotebookPen aria-hidden />
            Notes
            {c.notes.trim() ? (
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="has notes" />
            ) : null}
          </Button>
          {readOnly ? null : (
            <CaseMenu
              c={c}
              afterDeleteHref={inDemo ? "/demo" : "/"}
              onAddTarget={() => setAddOpen(true)}
              onRescan={() => goToSection("targets")}
            />
          )}
        </div>
      </div>
      <NotesDrawer c={c} open={notesOpen} onOpenChange={setNotesOpen} />
      {readOnly ? null : (
        <AddTargetDialog caseId={c.id} open={addOpen} onOpenChange={setAddOpen} />
      )}
    </header>
  );
}
