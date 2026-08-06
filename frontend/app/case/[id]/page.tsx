import { notFound } from "next/navigation";
import Link from "next/link";
import { getCase, listFindings, listCorrelations } from "@/lib/api";
import CaseActions from "../../case-actions";

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let c, findings: Awaited<ReturnType<typeof listFindings>>, corrs: Awaited<ReturnType<typeof listCorrelations>>;
  try {
    c = await getCase(id);
  } catch {
    notFound();
  }
  [findings, corrs] = await Promise.all([
    listFindings(id).catch(() => []),
    listCorrelations(id).catch(() => []),
  ]);

  const findingsByPlatform: Record<string, typeof findings> = {};
  for (const f of findings) {
    (findingsByPlatform[f.platform] ??= []).push(f);
  }

  const reviewed = corrs.filter((c) => c.reviewed);
  const unreviewed = corrs.filter((c) => !c.reviewed);
  const sortedCorrs = [...corrs].sort((a, b) => b.priority - a.priority);

  return (
    <div>
      <div className="card-row" style={{ marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0 }}>Case</h1>
          <div className="muted mono" style={{ marginTop: 4, fontSize: 12 }}>
            {c.id} · {new Date(c.created_at).toLocaleString()} ·{" "}
            <span className="badge">{c.status}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link href={`/review/${c.id}`} className="btn secondary">
            Review ({unreviewed.length})
          </Link>
          <Link href={`/report/${c.id}`} className="btn secondary">
            Report
          </Link>
          <CaseActions caseId={c.id} status={c.status} />
        </div>
      </div>

      <h2>Identifiers</h2>
      <div className="card">
        {c.identifiers.map((i, idx) => (
          <div key={idx} style={{ marginBottom: 4 }}>
            <span className="badge">{i.type}</span> <code>{i.value}</code>
          </div>
        ))}
      </div>

      <h2>
        Findings ({findings.length}) across {Object.keys(findingsByPlatform).length} platforms
      </h2>
      {findings.length === 0 && (
        <p className="muted">No findings yet. Click "Run" to collect.</p>
      )}
      {Object.entries(findingsByPlatform)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([platform, fs]) => (
          <div className="card" key={platform}>
            <h3 style={{ margin: 0 }}>{platform} ({fs.length})</h3>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>tool</th>
                  <th>status</th>
                  <th>identifier</th>
                  <th>meta</th>
                </tr>
              </thead>
              <tbody>
                {fs.map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{f.source_tool}</td>
                    <td>
                      <span
                        className={`badge ${
                          f.status === "found"
                            ? "good"
                            : f.status === "error"
                            ? "bad"
                            : "warn"
                        }`}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="mono">{f.identifier_value}</td>
                    <td
                      className="mono muted"
                      style={{
                        fontSize: 11,
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {JSON.stringify(f.extra_metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <h2>
        Correlations ({corrs.length}) — {reviewed.length} approved,{" "}
        {unreviewed.length} pending
      </h2>
      {corrs.length === 0 && (
        <p className="muted">No correlations. Run collectors to generate findings.</p>
      )}
      {sortedCorrs.map((corr) => (
        <div className="card" key={corr.id}>
          <div>
            <strong>{corr.type}</strong>{" "}
            <span className={`badge ${corr.reviewed ? "good" : "warn"}`}>
              {corr.reviewed ? "approved" : "pending"}
            </span>{" "}
            <span className="muted">
              conf={corr.confidence.toFixed(2)} pri={corr.priority.toFixed(2)}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {corr.entities_involved.join(" • ")}
          </div>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
            {corr.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {corr.review_note && (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              note: {corr.review_note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
