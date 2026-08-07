import Link from "next/link";
import { getCase, listCorrelations } from "@/lib/api";
import ReviewQueue from "./review-queue";
import { Icon } from "../../_components/icon";

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
    return null;
  }
  const corrs = await listCorrelations(id, false).catch(() => []);

  return (
    <div>
      <div className="card-row" style={{ marginBottom: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>Review</h1>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
            {c.identifiers
              .map((i) => <span key={i.type + i.value}><span className="badge muted" style={{ marginRight: 4 }}>{i.type}</span><span>{i.value}</span></span>)
              .reduce<React.ReactElement[]>((acc, el, i) => {
                if (i > 0) acc.push(<span key={`s${i}`} style={{ margin: "0 8px" }}>·</span>);
                acc.push(el);
                return acc;
              }, [])}
          </div>
        </div>
        <Link href={`/case/${id}`} className="btn secondary">
          <Icon name="x" size={13} />
          Back to case
        </Link>
      </div>

      <h2>Unreviewed ({corrs.length})</h2>
      {corrs.length === 0 ? (
        <div className="empty-state">
          <div className="icon"><Icon name="check" size={20} /></div>
          <h3>All clear</h3>
          <p>No correlations waiting for your review.</p>
        </div>
      ) : (
        <ReviewQueue correlations={corrs} />
      )}
    </div>
  );
}
