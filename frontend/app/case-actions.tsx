"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { runCase, deleteCase, runWithVariations } from "@/lib/api";
import { Icon } from "./_components/icon";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

export default function CaseActions({
  caseId,
  status,
  compact = false,
}: {
  caseId: string;
  status: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"run" | "variations" | "delete" | null>(null);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVariations, setConfirmVariations] = useState(false);

  async function doRun(e?: React.MouseEvent) {
    e?.stopPropagation();
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

  async function doVariations(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (busy) return;
    setBusy("variations");
    setErr("");
    try {
      await runWithVariations(caseId, 5);
      router.refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      setConfirmVariations(false);
    }
  }

  async function doDelete(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (busy) return;
    setBusy("delete");
    setErr("");
    try {
      await deleteCase(caseId);
      // After delete, push user back to home (the card they were looking at is gone)
      router.push("/");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  // Belt-and-suspenders: the action row is now a sibling of the <Link> in
  // case-card.tsx, so clicks here can't physically reach the Link. Keep a
  // plain stopPropagation anyway in case this component is ever embedded
  // back inside something navigable.
  function stopBubble(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  const pad = compact ? "5px" : "7px 14px";
  const fontSize = compact ? 11 : 13;

  return (
    <div
      className="row"
      style={{ gap: 6 }}
      onClick={stopBubble}
      onMouseDown={stopBubble}
    >
      {err && <span className="field-error">{err}</span>}
      <button
        type="button"
        className="secondary"
        onClick={doRun}
        disabled={busy !== null}
        title="Run all collectors on the existing identifiers"
        style={{ padding: pad, fontSize }}
      >
        {busy === "run" ? <span className="spinner" /> : <Icon name="play" size={compact ? 11 : 13} />}
        {!compact && " Run"}
      </button>
      {!compact && (
        <button
          type="button"
          onClick={(e) => {
            stopBubble(e);
            setConfirmVariations(true);
          }}
          disabled={busy !== null}
          title="Generate 5 LLM variations and scan each"
          style={{ padding: pad, fontSize }}
        >
          {busy === "variations" ? <span className="spinner" /> : <Icon name="search" size={13} />}
          + variations
        </button>
      )}
      <button
        type="button"
        className="secondary"
        onClick={(e) => {
          stopBubble(e);
          setConfirmDelete(true);
        }}
        disabled={busy !== null}
        title="Delete case"
        style={{ padding: pad, fontSize, color: "var(--color-destructive)" }}
      >
        {busy === "delete" ? <span className="spinner" /> : <Icon name="trash" size={compact ? 11 : 13} />}
      </button>

      {/* Delete confirmation — replaces window.confirm() */}
      <DeleteConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        itemName="this case"
        itemDetail={`case ${caseId.slice(0, 8)}`}
        consequences={[
          "All findings collected for this subject",
          "All correlations between those findings",
          "The audit history for the case",
        ]}
        busy={busy === "delete"}
        onConfirm={doDelete}
      />

      {/* Variations confirmation — also a long-running destructive-ish action */}
      <DeleteConfirmDialog
        open={confirmVariations}
        onOpenChange={setConfirmVariations}
        title="Run LLM-driven variations?"
        itemName="5 generated username/email variations"
        itemDetail={`case ${caseId.slice(0, 8)}`}
        consequences={[
          "The LLM will invent 5 plausible variations of the subject's identifier",
          "Each variation is scanned across 200+ platforms (this can take several minutes)",
          "All resulting findings are merged into this case",
        ]}
        confirmLabel="Run variations"
        busy={busy === "variations"}
        onConfirm={doVariations}
      />
    </div>
  );
}
