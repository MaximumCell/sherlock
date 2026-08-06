"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCase } from "@/lib/api";
import type { IdentifierType } from "@/lib/api";

export default function NewCaseForm() {
  const router = useRouter();
  const [type, setType] = useState<IdentifierType>("username");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const c = await createCase([{ type, value: value.trim() }]);
      router.push(`/case/${c.id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <label>Start a new case</label>
      <div className="row" style={{ gap: 8 }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as IdentifierType)}
        >
          <option value="username">username</option>
          <option value="email">email</option>
          <option value="domain">domain</option>
        </select>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. octocat or octocat@github.com"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? "Creating..." : "Create case"}
        </button>
      </div>
      {err && (
        <p style={{ color: "var(--bad)", marginTop: 8, fontSize: 12 }}>{err}</p>
      )}
    </form>
  );
}
