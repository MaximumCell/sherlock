"use client";

import { ArrowLeft, Check, NotebookPen, Pencil, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TargetChip } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { caseDisplayTitle } from "@/lib/case-status";
import { timeAgo } from "@/lib/format";
import { useUpdateCase } from "@/lib/query/mutations";
import type { Case } from "@/lib/types";
import { CaseMenu } from "./case-menu";
import { NotesDrawer } from "./notes-drawer";
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
        aria-label="Case title"
        maxLength={120}
        value={title}
        placeholder={caseDisplayTitle({ title: null, identifiers: c.identifiers })}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        className="h-9 text-lg font-semibold"
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

export function CaseHeader({ c }: { c: Case }) {
  const pathname = usePathname();
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const inDemo = pathname?.startsWith("/demo") ?? false;

  return (
    <header className="space-y-3">
      <Link
        href="/"
        data-print="hide"
        className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All cases
      </Link>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <TitleEditor c={c} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
                {caseDisplayTitle(c)}
              </h1>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit title"
                onClick={() => setEditing(true)}
                data-print="hide"
              >
                <Pencil aria-hidden />
              </Button>
              {c.archived_at ? <Badge variant="muted">Archived</Badge> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {c.identifiers.map((idf) => (
              <TargetChip key={`${idf.type}:${idf.value}`} type={idf.type} value={idf.value} />
            ))}
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
            {c.tags.map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
            <TagEditor c={c} />
          </div>
          <p className="text-xs text-muted-foreground">
            Created {timeAgo(c.created_at)}
            {c.updated_at ? ` · updated ${timeAgo(c.updated_at)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-print="hide">
          <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)}>
            <NotebookPen aria-hidden />
            Notes
            {c.notes.trim() ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="has notes" /> : null}
          </Button>
          <CaseMenu c={c} afterDeleteHref={inDemo ? "/demo" : "/"} />
        </div>
      </div>
      <NotesDrawer c={c} open={notesOpen} onOpenChange={setNotesOpen} />
    </header>
  );
}
