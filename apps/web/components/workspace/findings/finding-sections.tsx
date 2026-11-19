import { CheckCircle2, MapPinned, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { ActivityInfo, DnsInfo, ImageInfo, NetworkInfo, WalletInfo } from "@/lib/finding-extras";
import { compactNumber, formatDate, formatDateTime } from "@/lib/format";
import { ActivityHeatmap, ActivityStrips } from "./activity-heatmap";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Two-column definition list used by the structured renderers. */
export function Facts({ rows }: { rows: [label: string, value: ReactNode | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-mono text-xs leading-5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={ok ? "inline-flex items-center gap-1 text-success" : "inline-flex items-center gap-1 text-danger"}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label} {ok ? "present" : "missing"}
    </span>
  );
}

export function DnsSection({ dns }: { dns: DnsInfo }) {
  return (
    <Section title="DNS records">
      <dl className="overflow-hidden rounded-md border border-border text-sm">
        {Object.entries(dns.records).map(([type, values]) => (
          <div key={type} className="flex gap-3 border-b border-border px-3 py-1.5 last:border-0">
            <dt className="w-12 shrink-0 font-mono text-xs font-semibold text-muted-foreground">{type}</dt>
            <dd className="min-w-0 space-y-0.5 break-all font-mono text-xs">
              {values.map((value) => (
                <p key={value}>{value}</p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {dns.spf !== null || dns.dmarc !== null ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Check ok={dns.spf} label="SPF" />
          <Check ok={dns.dmarc} label="DMARC" />
        </p>
      ) : null}
      {dns.dmarcRecord ? <p className="break-all font-mono text-2xs text-muted-foreground">{dns.dmarcRecord}</p> : null}
    </Section>
  );
}

export function NetworkSection({ network }: { network: NetworkInfo }) {
  return (
    <Section title="Exposed services">
      {network.ports.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Open ports">
          {network.ports.map((port) => (
            <li key={port}>
              <Badge variant="outline" className="font-mono">
                {port}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No open ports listed.</p>
      )}
      {network.vulns.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Known vulnerabilities ({network.vulns.length})</p>
          <ul className="flex flex-wrap gap-1.5">
            {network.vulns.map((v) => (
              <li key={v}>
                <Badge variant="danger" className="font-mono">
                  {v}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Facts
        rows={[
          ["Hostnames", network.hostnames.join(", ")],
          ["Software (CPE)", network.cpes.join(", ")],
          ["Tags", network.tags.join(", ")],
        ]}
      />
      <p className="text-xs text-muted-foreground">From a passive scan index. Sherlock did not probe this host.</p>
    </Section>
  );
}

export function WalletSection({ wallet }: { wallet: WalletInfo }) {
  return (
    <Section title={`Wallet summary · ${wallet.chain}`}>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="text-2xs uppercase tracking-wider text-muted-foreground">Balance</p>
        <p className="font-mono text-xl font-semibold tabular-nums">
          {wallet.balance ?? "unknown"} <span className="text-sm text-muted-foreground">{wallet.unit}</span>
        </p>
      </div>
      <Facts
        rows={[
          ["Address", wallet.address],
          ["ENS name", wallet.ens],
          ["Transactions", wallet.txCount !== null ? compactNumber(wallet.txCount) : null],
          ["Total received", wallet.received ? `${wallet.received} ${wallet.unit}` : null],
          ["First seen", wallet.firstSeen ? formatDate(wallet.firstSeen) : null],
          ["Last seen", wallet.lastSeen ? formatDate(wallet.lastSeen) : null],
          ["Contract", wallet.isContract === null ? null : wallet.isContract ? "yes" : "no"],
        ]}
      />
      {wallet.note ? <p className="text-xs text-muted-foreground">{wallet.note}</p> : null}
    </Section>
  );
}

export function ImageSection({ image }: { image: ImageInfo }) {
  return (
    <Section title="Image metadata">
      {image.gpsPresent ? (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-sm text-warning">
          <MapPinned className="h-4 w-4 shrink-0" aria-hidden />
          This image carries GPS coordinates. Sherlock does not display them.
        </p>
      ) : image.gpsPresent === false ? (
        <p className="text-xs text-success">No GPS coordinates in the file.</p>
      ) : null}
      <Facts
        rows={[
          ["Camera", image.camera],
          ["Software", image.software],
          ["Taken", image.takenAt],
          ["Dimensions", image.width && image.height ? `${image.width} × ${image.height}` : null],
          ["Format", image.format ?? image.contentType],
          ["Size", image.sizeBytes !== null ? `${compactNumber(image.sizeBytes)} B` : null],
          ["Perceptual hash", image.phash],
          ["SHA-256", image.sha256],
        ]}
      />
    </Section>
  );
}

export function ActivitySection({ activity }: { activity: ActivityInfo }) {
  return (
    <Section title="Public activity by time (UTC)">
      {activity.matrix ? (
        <ActivityHeatmap matrix={activity.matrix} />
      ) : activity.hours || activity.weekdays ? (
        <ActivityStrips hours={activity.hours} weekdays={activity.weekdays} />
      ) : null}
      <Facts
        rows={[
          ["Likely time zone", activity.offsetLabel ? `${activity.offsetLabel}${activity.confidence ? ` (${activity.confidence} confidence)` : ""}` : null],
          ["Events sampled", activity.sampleSize !== null ? String(activity.sampleSize) : null],
          ["Window", activity.first && activity.last ? `${formatDateTime(activity.first)} to ${formatDateTime(activity.last)}` : null],
          ["Sources", activity.sources.join(", ")],
        ]}
      />
    </Section>
  );
}
