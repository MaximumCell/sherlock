import { CalendarDays, Link2, Mail, MapPin, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { safeUrl, type FindingView } from "@/lib/findings";
import { compactNumber, formatDate, formatDateTime, percent } from "@/lib/format";
import { describeRule } from "@/lib/rules";
import type { Correlation, Finding } from "@/lib/types";
import { ActivityHeatmap } from "./activity-heatmap";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof Mail; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function ExternalLinkText({ href }: { href: string }) {
  const safe = safeUrl(href);
  if (!safe) return <span className="break-all font-mono text-xs">{href}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all font-mono text-xs text-accent underline-offset-4 hover:underline"
    >
      {href}
    </a>
  );
}

function ProfileSection({ view }: { view: FindingView }) {
  const hasFacts =
    view.location || view.emails.length || view.createdAt || view.followers !== null || view.links.length;
  if (!view.fullname && !view.bio && !hasFacts) return null;
  return (
    <Section title="Profile">
      {view.fullname ? <p className="font-medium">{view.fullname}</p> : null}
      {view.bio ? <p className="whitespace-pre-line text-sm text-muted-foreground">{view.bio}</p> : null}
      <ul className="space-y-1.5">
        {view.location ? <Fact icon={MapPin}>{view.location}</Fact> : null}
        {view.emails.map((email) => (
          <Fact key={email} icon={Mail}>
            <span className="font-mono text-xs">{email}</span>
          </Fact>
        ))}
        {view.createdAt ? (
          <Fact icon={CalendarDays}>Account created {formatDate(view.createdAt)}</Fact>
        ) : null}
        {view.followers !== null || view.following !== null ? (
          <Fact icon={Users}>
            {view.followers !== null ? `${compactNumber(view.followers)} followers` : ""}
            {view.followers !== null && view.following !== null ? " · " : ""}
            {view.following !== null ? `${compactNumber(view.following)} following` : ""}
          </Fact>
        ) : null}
        {view.links.map((link) => (
          <Fact key={link} icon={Link2}>
            <ExternalLinkText href={link} />
          </Fact>
        ))}
      </ul>
    </Section>
  );
}

function InfraSection({ view }: { view: FindingView }) {
  if (!view.dns && view.ports.length === 0) return null;
  return (
    <>
      {view.dns ? (
        <Section title="DNS records">
          <dl className="overflow-hidden rounded-md border border-border text-sm">
            {Object.entries(view.dns).map(([type, values]) => (
              <div key={type} className="flex gap-3 border-b border-border px-3 py-1.5 last:border-0">
                <dt className="w-12 shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {type}
                </dt>
                <dd className="min-w-0 space-y-0.5 break-all font-mono text-xs">
                  {values.map((value) => (
                    <p key={value}>{value}</p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
      {view.ports.length > 0 ? (
        <Section title="Open ports">
          <ul className="flex flex-wrap gap-1.5">
            {view.ports.map((port) => (
              <li key={port}>
                <Badge variant="outline" className="font-mono">
                  {port}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            From a passive scan index. Sherlock did not probe this host.
          </p>
        </Section>
      ) : null}
    </>
  );
}

export function FindingDetail({
  finding,
  view,
  related,
}: {
  finding: Finding;
  view: FindingView;
  related: Correlation[];
}) {
  return (
    <div className="space-y-5">
      {view.error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {view.error}
        </p>
      ) : null}
      {view.breach ? (
        <Section title="Breach exposure">
          <p className="font-medium">
            {view.breach.name}
            {view.breach.date ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {formatDate(view.breach.date)}
              </span>
            ) : null}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Exposed data classes">
            {view.breach.dataClasses.map((dataClass) => (
              <li key={dataClass}>
                <Badge variant="danger">{dataClass}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Exposure metadata only. Sherlock never stores or shows leaked records.
          </p>
        </Section>
      ) : null}
      <ProfileSection view={view} />
      <InfraSection view={view} />
      {view.activity ? (
        <Section title="Public activity by weekday and hour (UTC)">
          <ActivityHeatmap matrix={view.activity} />
        </Section>
      ) : null}
      {view.other.length > 0 ? (
        <Section title="Other fields">
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
            {view.other.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="break-words text-muted-foreground">{key}</dt>
                <dd className="break-all font-mono text-xs leading-5">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
      {related.length > 0 ? (
        <Section title="Correlations">
          <ul className="space-y-1.5">
            {related.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">{describeRule(c.type).title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{percent(c.confidence)}</span>
                  <Badge
                    variant={
                      c.status === "approved" ? "success" : c.status === "rejected" ? "muted" : "warning"
                    }
                  >
                    {c.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Provenance">
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Module</dt>
          <dd className="font-mono text-xs leading-5">{finding.module ?? finding.source_tool}</dd>
          <dt className="text-muted-foreground">Collected</dt>
          <dd className="text-xs leading-5">{formatDateTime(finding.collected_at)}</dd>
          <dt className="text-muted-foreground">Finding ID</dt>
          <dd className="break-all font-mono text-xs leading-5">{finding.id}</dd>
        </dl>
      </Section>
    </div>
  );
}
