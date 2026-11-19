"use client";

import { Avatar } from "@/components/common/bits";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { findingTitle, parseFinding } from "@/lib/findings";
import { findingNodeId, type GraphModel, type GraphNode } from "@/lib/graph/build";
import type { Finding } from "@/lib/types";
import { KIND_META } from "./entity-node";

/** Findings behind a non-finding node: cluster members, or everything attached to an identifier. */
export function findingsForNode(node: GraphNode, model: GraphModel, findings: readonly Finding[]): Finding[] {
  const ids = new Set(node.memberIds);
  for (const edge of model.edges) {
    const other = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
    if (!other) continue;
    const linked = model.nodes.find((n) => n.id === other);
    if (linked?.findingId) ids.add(linked.findingId);
    linked?.memberIds.forEach((id) => ids.add(id));
  }
  return findings.filter((f) => ids.has(f.id) || findingNodeId(f.id) === node.id);
}

export function NodeSheet({
  node,
  model,
  findings,
  onClose,
  onOpenFinding,
}: {
  node: GraphNode | null;
  model: GraphModel;
  findings: readonly Finding[];
  onClose: () => void;
  onOpenFinding: (id: string) => void;
}) {
  const related = node ? findingsForNode(node, model, findings) : [];
  return (
    <Sheet open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {node ? (
          <>
            <SheetHeader className="pr-8 text-left">
              <SheetTitle className="break-all font-mono text-base">{node.label}</SheetTitle>
              <SheetDescription>
                {KIND_META[node.kind].label}
                {node.sublabel ? ` · ${node.sublabel}` : ""}
              </SheetDescription>
            </SheetHeader>
            <section className="space-y-2">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {node.kind === "cluster" ? "Accounts in this group" : "Connected results"} (
                {related.length})
              </h3>
              {related.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing is connected to this yet. If it is a suggested search, run it from Next steps.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {related.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onOpenFinding(f.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted"
                      >
                        <Avatar
                          src={parseFinding(f).avatarUrl}
                          name={findingTitle(f)}
                          className="h-7 w-7"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{findingTitle(f)}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {f.identifier_value}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
