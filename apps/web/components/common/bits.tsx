import {
  AtSign,
  Globe,
  Image as ImageIcon,
  Mail,
  Network,
  Phone,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TARGET_ICONS: Record<string, LucideIcon> = {
  username: AtSign,
  email: Mail,
  domain: Globe,
  ip: Network,
  image: ImageIcon,
  phone: Phone,
  wallet: Wallet,
  name: User,
};

export function TargetIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TARGET_ICONS[type] ?? Globe;
  return <Icon className={className} aria-hidden />;
}

/** Identifier chip: type icon + monospace value. */
export function TargetChip({
  type,
  value,
  className,
}: {
  type: string;
  value: string;
  className?: string;
}) {
  return (
    <span
      title={`${type}: ${value}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs",
        className,
      )}
    >
      <TargetIcon type={type} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="sr-only">{type}: </span>
      <span className="truncate">{value}</span>
    </span>
  );
}

const TONES = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted-foreground/50",
} as const;

export function ProgressBar({
  value,
  label,
  tone = "accent",
  indeterminate = false,
  className,
}: {
  value: number;
  label: string;
  tone?: keyof typeof TONES;
  indeterminate?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {indeterminate ? (
        <div className={cn("h-full w-1/3 animate-indeterminate rounded-full", TONES[tone])} />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", TONES[tone])}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
      {children}
    </kbd>
  );
}
