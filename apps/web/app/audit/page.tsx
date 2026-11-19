import { listAudit } from "@/lib/api";
import { Icon } from "../_components/icon";

// Live data from the FastAPI backend — never prerender.
export const dynamic = "force-dynamic";

const ACTION_VARIANT: Record<string, "found" | "error" | "warn" | "info" | "muted"> = {
  collector_run: "info",
  correlation: "info",
  correlation_review: "found",
  report: "info",
  case_deleted: "error",
  pipeline: "error",
  variations_generated: "warn",
  variation_scan: "info",
  agent_chat: "found",
  agent_tool: "info",
};

export default async function AuditPage() {
  const entries = await listAudit().catch(() => []);

  return (
    <div>
      <h1>Audit Log</h1>
      <p className="muted" style={{ margin: "4px 0 16px", fontSize: 13 }}>
        Every collector run, correlation, agent call, and report write is recorded here.
        Append <code>?case_id=&lt;uuid&gt;</code> to filter by case.
      </p>
      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="icon"><Icon name="list" size={20} /></div>
          <h3>No audit entries yet</h3>
          <p>Run a case to start generating audit events.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 180 }}>Time</th>
                <th style={{ width: 80 }}>Case</th>
                <th style={{ width: 160 }}>Action</th>
                <th style={{ width: 100 }}>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const variant = ACTION_VARIANT[e.action] ?? "muted";
                return (
                  <tr key={e.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11 }}>
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {e.case_id ? (
                        <a href={`/case/${e.case_id}`}>{e.case_id.slice(0, 8)}</a>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${variant}`}>{e.action}</span>
                    </td>
                    <td className="muted mono" style={{ fontSize: 11 }}>{e.actor}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
