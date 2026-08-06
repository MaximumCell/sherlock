import { listAudit } from "@/lib/api";

export default async function AuditPage() {
  const entries = await listAudit().catch(() => []);

  return (
    <div>
      <h1>Audit Log</h1>
      <p className="muted">
        Last {entries.length} entries (newest first). Add{" "}
        <code>?case_id=&lt;uuid&gt;</code> to filter.
      </p>
      {entries.length === 0 ? (
        <p className="muted">No audit entries yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>time</th>
              <th>case</th>
              <th>action</th>
              <th>actor</th>
              <th>detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {new Date(e.created_at).toLocaleString()}
                </td>
                <td className="mono">
                  {e.case_id ? (
                    <a href={`/case/${e.case_id}`}>{e.case_id.slice(0, 8)}</a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{e.action}</td>
                <td>{e.actor}</td>
                <td
                  className="mono muted"
                  style={{
                    fontSize: 11,
                    maxWidth: 480,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {JSON.stringify(e.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
