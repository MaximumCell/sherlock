"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewCorrelation } from "@/lib/api";
import type { Correlation } from "@/lib/api";

export default function ReviewQueue({
  correlations,
}: {
  correlations: Correlation[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(c: Correlation, decision: "approve" | "reject") {
    if (busy) return;
    setBusy(c.id);
    try {
      await reviewCorrelation(c.id, decision, notes[c.id] || undefined);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const sorted = [...correlations].sort((a, b) => b.priority - a.priority);

  return (
    <div>
      {sorted.map((c) => (
        <div className="card" key={c.id}>
          <div>
            <strong>{c.type}</strong>{" "}
            <span className="muted">
              conf={c.confidence.toFixed(2)} pri={c.priority.toFixed(2)}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {c.entities_involved.join(" • ")}
          </div>
          <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
            {c.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <input
            type="text"
            placeholder="optional review note"
            value={notes[c.id] || ""}
            onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="good"
              onClick={() => decide(c, "approve")}
              disabled={busy === c.id}
            >
              {busy === c.id ? "..." : "Approve"}
            </button>
            <button
              className="danger"
              onClick={() => decide(c, "reject")}
              disabled={busy === c.id}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
