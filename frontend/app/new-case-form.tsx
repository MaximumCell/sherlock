"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCase, scanUsername, scanEmail } from "@/lib/api";
import type { IdentifierType } from "@/lib/api";
import { Icon } from "./_components/icon";

const TYPES: { value: IdentifierType; label: string; placeholder: string }[] = [
  { value: "username", label: "username", placeholder: "e.g. octocat" },
  { value: "email", label: "email", placeholder: "e.g. octocat@github.com" },
  { value: "domain", label: "domain", placeholder: "e.g. github.com" },
];

interface Props {
  initialValue?: string;
  initialType?: IdentifierType;
  /** When true, show a 'pivot' banner explaining where this identifier came from. */
  pivoting?: boolean;
}

export default function NewCaseForm({ initialValue = "", initialType = "username", pivoting = false }: Props) {
  const router = useRouter();
  const [type, setType] = useState<IdentifierType>(initialType);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const placeholder = TYPES.find((t) => t.value === type)?.placeholder ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const trimmed = value.trim();
      // 1) Create the case (returns synchronously, ~100ms).
      const c = await createCase([{ type, value: trimmed }]);
      // 2) Kick off an async scan for username/email so the user lands on a
      //    page that's already mid-investigation, not an empty one. Domains
      //    need a different collector pipeline (WHOIS, DNS, certs) which
      //    isn't wired up yet, so we just navigate without auto-scan.
      let jobId: string | null = null;
      if (type === "username") {
        try {
          const queued = await scanUsername(c.id, trimmed);
          jobId = queued.job_id;
        } catch {
          // Scan-queue is best-effort; user can retry from the case page.
        }
      } else if (type === "email") {
        try {
          const queued = await scanEmail(c.id, trimmed);
          jobId = queued.job_id;
        } catch {
          // same — case is created, scan can be retried manually.
        }
      }
      const url = jobId ? `/case/${c.id}?job=${encodeURIComponent(jobId)}` : `/case/${c.id}`;
      router.push(url);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: "16px 18px" }}>
      <label>Start a new case</label>
      {pivoting && initialValue && (
        <div className="hint" style={{ marginBottom: 10 }}>
          <Icon name="branch" size={12} />
          <span>
            Pivoting from a found account. Investigate <code style={{ fontSize: 12 }}>{initialValue}</code> as a new case to follow this lead.
          </span>
        </div>
      )}
      <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
        <div className="select-wrap" style={{ width: 140, flexShrink: 0 }}>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as IdentifierType)}
            aria-label="Identifier type"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} className="select-chevron" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label="Identifier value"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? <span className="spinner" /> : <Icon name="play" size={13} />}
          {busy ? "Starting..." : "Create case"}
        </button>
      </div>
      {err && (
        <p className="field-error" style={{ marginTop: 8 }}>{err}</p>
      )}
    </form>
  );
}
