"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AtSign,
  Crosshair,
  Layers,
  Mail,
  Pin,
  Server,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";
import type { GraphNode, GraphNodeKind } from "@/lib/graph/build";
import { cn } from "@/lib/utils";

export type EntityFlowNode = Node<{ node: GraphNode }, "entity">;

export const KIND_META: Record<
  GraphNodeKind,
  { label: string; icon: LucideIcon; className: string }
> = {
  seed: {
    label: "What you searched",
    icon: Crosshair,
    className: "border-accent bg-accent/15 text-foreground",
  },
  account: { label: "Accounts", icon: UserRound, className: "border-border bg-card" },
  email: { label: "Emails", icon: Mail, className: "border-success/40 bg-success/10" },
  infra: { label: "Websites and IPs", icon: Server, className: "border-warning/40 bg-warning/10" },
  breach: { label: "Breaches", icon: ShieldAlert, className: "border-danger/50 bg-danger/10" },
  handle: { label: "Other identifiers", icon: AtSign, className: "border-border bg-muted" },
  cluster: {
    label: "Grouped accounts",
    icon: Layers,
    className: "border-dashed border-muted-foreground/50 bg-surface",
  },
};

const HANDLE =
  "!left-1/2 !top-1/2 !h-px !min-h-0 !w-px !min-w-0 !-translate-x-1/2 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0";

/** One compact pill per entity. Both handles sit at the centre so edges run centre to centre. */
export const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const { node } = data;
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "flex max-w-44 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 shadow-sm transition-shadow",
        meta.className,
        node.kind === "seed" && "max-w-56 px-3 py-2",
        selected && "ring-2 ring-ring",
      )}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Top} isConnectable={false} className={HANDLE} />
      {node.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party avatar hosts
        <img
          src={node.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-5 w-5 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-xs font-medium leading-tight",
            (node.kind === "seed" || node.kind === "email" || node.kind === "handle") &&
              "font-mono",
          )}
        >
          {node.label}
        </span>
        {node.sublabel ? (
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            {node.sublabel}
          </span>
        ) : null}
      </span>
      {node.curated ? (
        <Pin className="h-3 w-3 shrink-0 fill-current text-accent" aria-label="pinned" />
      ) : null}
    </div>
  );
});
