import Link from "next/link";
import { getReport } from "@/lib/api";
import MarkdownView from "./markdown-view";
import { Icon } from "../../_components/icon";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let md = "";
  let err = "";
  try {
    md = await getReport(id);
  } catch (e) {
    err = String(e);
  }

  return (
    <div>
      <div className="card-row" style={{ marginBottom: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>Report</h1>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
            case <code style={{ background: "transparent", padding: 0 }}>{id.slice(0, 8)}</code>
          </div>
        </div>
        <Link href={`/case/${id}`} className="btn secondary">
          <Icon name="x" size={13} />
          Back to case
        </Link>
      </div>
      {err && (
        <div className="card" style={{ borderColor: "var(--status-error-border)" }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--status-error-text)" }}><Icon name="warning" size={16} /></span>
            <strong style={{ color: "var(--status-error-text)" }}>Failed to load report</strong>
          </div>
          <pre style={{ margin: 0, fontSize: 12 }}>{err}</pre>
        </div>
      )}
      {!err && <MarkdownView source={md} />}
    </div>
  );
}
