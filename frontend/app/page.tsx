import { listCases } from "@/lib/api";
import NewCaseForm from "./new-case-form";
import CaseActions from "./case-actions";
import Link from "next/link";

export default async function HomePage() {
  const cases = await listCases();

  return (
    <div>
      <h1>Cases</h1>
      <NewCaseForm />

      <h2>All cases ({cases.length})</h2>
      {cases.length === 0 ? (
        <p className="muted">No cases yet. Create one above.</p>
      ) : (
        cases.map((c) => (
          <div className="card" key={c.id}>
            <div className="card-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link href={`/case/${c.id}`} style={{ fontWeight: 500 }}>
                  {c.identifiers
                    .map((i) => `${i.type}:${i.value}`)
                    .join(", ")}
                </Link>
                <div className="muted mono" style={{ marginTop: 4, fontSize: 12 }}>
                  {c.id.slice(0, 8)} · {new Date(c.created_at).toLocaleString()} ·{" "}
                  <span className="badge">{c.status}</span>
                </div>
              </div>
              <CaseActions caseId={c.id} status={c.status} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
