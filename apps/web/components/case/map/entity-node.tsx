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
import { PlatformIcon } from "@/components/common/platform-icon";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import type { GraphNode, GraphNodeKind } from "@/lib/graph/build";
import { cn } from "@/lib/utils";

export type EntityFlowNode = Node<{ node: GraphNode }, "entity">;

/** Kind of thing on the map: its name in the filters, its icon, and the ring colour. */
export const KIND_META: Record<
  GraphNodeKind,
  { label: string; icon: LucideIcon; ring: string; dot: string }
> = {
  seed: {
    label: "What you searched",
    icon: Crosshair,
    ring: "border-accent shadow-glow",
    dot: "bg-accent",
  },
  account: { label: "Accounts", icon: UserRound, ring: "border-input", dot: "bg-muted-foreground" },
  email: { label: "Emails", icon: Mail, ring: "border-success/70", dot: "bg-success" },
  infra: { label: "Websites and IPs", icon: Server, ring: "border-warning/70", dot: "bg-warning" },
  breach: { label: "Breaches", icon: ShieldAlert, ring: "border-danger/70", dot: "bg-danger" },
  handle: { label: "Other identifiers", icon: AtSign, ring: "border-input", dot: "bg-muted-foreground" },
  cluster: {
    label: "Grouped accounts",
    icon: Layers,
    ring: "border-dashed border-muted-foreground/60",
    dot: "bg-muted-foreground/60",
  },
};

const HANDLE =
  "!left-1/2 !top-1/2 !h-px !min-h-0 !w-px !min-w-0 !-translate-x-1/2 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0";

/**
 * One entity as a round node: a picture or icon in a ring coloured by kind, the label
 * underneath. Both handles sit at the centre so edges run centre to centre.
 */
export const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const { node } = data;
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const seed = node.kind === "seed";
  const mono = seed || node.kind === "email" || node.kind === "handle";
  return (
    <div className="group flex w-32 cursor-pointer flex-col items-center gap-1.5">
      <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Top} isConnectable={false} className={HANDLE} />
      <span
        className={cn(
          "relative flex items-center justify-center rounded-full border-2 bg-card transition-[box-shadow,transform] duration-2 ease-out group-hover:scale-105",
          seed ? "h-14 w-14" : "h-11 w-11",
          meta.ring,
          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
      >
        {node.kind === "account" && node.avatarUrl ? (
          <ProfileAvatar
            src={node.avatarUrl}
            name={node.sublabel ?? node.label}
            platform={node.platform}
            size="sm"
            decorative
            className="[&>span:first-child]:rounded-full [&>span:first-child]:border-0"
          />
        ) : node.kind === "account" && node.platform ? (
          <PlatformIcon platform={node.platform} size="md" className="rounded-full" />
        ) : (
          <Icon className={cn("shrink-0", seed ? "h-6 w-6 text-accent" : "h-4 w-4 text-muted-foreground")} aria-hidden />
        )}
        {node.sources > 1 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-success px-1 font-mono text-[9px] font-medium text-background"
            title={`One account, confirmed by ${node.sources} sources`}
            aria-label={`${node.sources} sources`}
          >
            {node.sources}
          </span>
        ) : null}
        {node.curated ? (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-popover">
            <Pin className="h-2.5 w-2.5 fill-current text-accent" aria-label="pinned" />
          </span>
        ) : null}
      </span>
      <span className="max-w-full rounded bg-background/80 px-1 text-center leading-tight">
        <span
          className={cn(
            "block truncate text-[11px] font-medium",
            mono && "font-mono",
            seed && "text-xs text-foreground",
          )}
        >
          {node.label}
        </span>
        {node.sublabel ? (
          <span className="block truncate text-[10px] text-muted-foreground">{node.sublabel}</span>
        ) : null}
      </span>
    </div>
  );
});
