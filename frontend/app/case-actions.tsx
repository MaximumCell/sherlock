"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { runCase, deleteCase } from "@/lib/api";

export default function CaseActions({
  caseId,
}: {
  caseId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"run" | "delete" | null>(null);
  const [err, setErr] = useState("");

  async function doRun() {
    if (busy) return;
    setBusy("run");
    setErr("");
    try {
      await runCase(caseId);
      router.refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function doDelete() {
    if (busy) return;
    if (!confirm("Delete this case and all its findings/correlations?")) return;
    setBusy("delete");
    setErr("");
    try {
      await deleteCase(caseId);
      router.refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="row" style={{ gap: 6 }}>
      {err && (
        <span style={{ color: "var(--bad)", fontSize: 12 }}>{err}</span>
      )}
      <button className="secondary" onClick={doRun} disabled={busy !== null}>
        {busy === "run" ? "Running..." : "Run"}
      </button>
      <button className="secondary" onClick={doDelete} disabled={busy !== null}>
        {busy === "delete" ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
