import { Icon } from "./icon";

interface StatusBadgeProps {
  status: string;
  /** Optional: pass a different status key (e.g. correlation.reviewed) */
  variant?: "case" | "finding" | "review";
}

const CASE_STATUS_STYLES: Record<string, { variant: "found" | "error" | "warn" | "info" | "muted"; label?: string }> = {
  new: { variant: "info" },
  running: { variant: "warn", label: "running" },
  done: { variant: "found" },
  error: { variant: "error" },
};

const FINDING_STATUS_STYLES: Record<string, { variant: "found" | "error" | "warn" | "info" | "muted"; label?: string }> = {
  found: { variant: "found" },
  not_found: { variant: "muted", label: "not found" },
  error: { variant: "error" },
};

const REVIEW_STATUS_STYLES = {
  approved: { variant: "found" as const, label: "approved" },
  pending: { variant: "warn" as const, label: "pending" },
  rejected: { variant: "error" as const, label: "rejected" },
};

export function StatusBadge({ status, variant = "case" }: StatusBadgeProps) {
  let cfg: { variant: "found" | "error" | "warn" | "info" | "muted"; label?: string };

  if (variant === "finding") {
    cfg = FINDING_STATUS_STYLES[status] ?? { variant: "muted" };
  } else if (variant === "review") {
    cfg = REVIEW_STATUS_STYLES[status as keyof typeof REVIEW_STATUS_STYLES] ?? { variant: "muted" };
  } else {
    cfg = CASE_STATUS_STYLES[status] ?? { variant: "muted" };
  }

  const label = cfg.label ?? status;

  return (
    <span className={`badge ${cfg.variant}`}>
      <span className="dot" />
      {label}
    </span>
  );
}
