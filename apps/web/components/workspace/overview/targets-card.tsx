"use client";

import { Play, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TargetIcon } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScan } from "@/lib/query/mutations";
import { TARGET_TYPES, type Case, type Entity, type Job, type TargetType } from "@/lib/types";
import { TARGET_TYPE_META, validateTarget } from "@/lib/validation";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function AddTargetForm({ caseId }: { caseId: string }) {
  const scan = useScan(caseId);
  const [type, setType] = useState<TargetType>("username");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateTarget(type, value);
    if (!result.ok) return setError(result.error);
    setError(null);
    scan.mutate({ type, value: result.value }, { onSuccess: () => setValue("") });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-1.5 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">Scan another identifier</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={type} onValueChange={(v) => setType(v as TargetType)}>
          <SelectTrigger className="sm:w-36" aria-label="Identifier type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TARGET_TYPE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Identifier value"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "add-target-error" : undefined}
          className="min-w-0 flex-1 font-mono"
          placeholder={TARGET_TYPE_META[type].placeholder}
          value={value}
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="secondary" disabled={scan.isPending}>
          <Plus aria-hidden />
          {scan.isPending ? "Queuing…" : "Scan"}
        </Button>
      </div>
      {error ? (
        <p id="add-target-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function TargetsCard({ c, jobs, entities }: { c: Case; jobs: Job[]; entities: Entity[] }) {
  const scan = useScan(c.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Targets</CardTitle>
        <CardDescription>The identifiers this case started from.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border">
          {c.identifiers.map((idf) => {
            const mine = jobs.filter((j) => same(j.target_value, idf.value));
            const running = mine.some((j) => j.status === "queued" || j.status === "running");
            const scanned =
              mine.length > 0 || entities.some((e) => e.scanned && same(e.value, idf.value));
            const pending = scan.isPending && scan.variables?.value === idf.value;
            return (
              <li key={`${idf.type}:${idf.value}`} className="flex items-center gap-3 py-2">
                <TargetIcon type={idf.type} className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm" title={idf.value}>
                    {idf.value}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {idf.type} · {running ? "scanning now" : scanned ? `${mine.length} job${mine.length === 1 ? "" : "s"} run` : "not scanned yet"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running || pending}
                  onClick={() => scan.mutate({ type: idf.type, value: idf.value })}
                  aria-label={`${scanned ? "Rescan" : "Scan"} ${idf.value}`}
                >
                  <Play aria-hidden />
                  {running ? "Scanning" : scanned ? "Rescan" : "Scan"}
                </Button>
              </li>
            );
          })}
        </ul>
        <AddTargetForm caseId={c.id} />
      </CardContent>
    </Card>
  );
}
