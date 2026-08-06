import Link from "next/link";
import { getReport } from "@/lib/api";
import MarkdownView from "./markdown-view";

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
      <div className="card-row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Report</h1>
        <Link href={`/case/${id}`} className="btn secondary">
          ← back to case
        </Link>
      </div>
      <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
        case {id}
      </div>
      {err && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <strong style={{ color: "var(--bad)" }}>Failed to load report</strong>
          <pre style={{ marginTop: 8 }}>{err}</pre>
        </div>
      )}
      {!err && <MarkdownView source={md} />}
    </div>
  );
}
