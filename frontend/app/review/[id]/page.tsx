import { notFound } from "next/navigation";
import Link from "next/link";
import { getCase, listCorrelations } from "@/lib/api";
import ReviewQueue from "./review-queue";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let c;
  try {
    c = await getCase(id);
  } catch {
    notFound();
  }
  const corrs = await listCorrelations(id, false).catch(() => []);

  return (
    <div>
      <div className="card-row" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Review</h1>
        <Link href={`/case/${id}`} className="btn secondary">
          ← back to case
        </Link>
      </div>
      <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
        case {c.id} · {c.identifiers.map((i) => `${i.type}:${i.value}`).join(", ")}
      </div>

      <h2>Unreviewed correlations ({corrs.length})</h2>
      {corrs.length === 0 ? (
        <p className="muted">All clear. Nothing to review.</p>
      ) : (
        <ReviewQueue correlations={corrs} />
      )}
    </div>
  );
}
