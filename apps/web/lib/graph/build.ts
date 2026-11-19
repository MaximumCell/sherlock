/**
 * Builds the entity graph model from case data. Pure and framework-free so it
 * can be unit-tested; `components/workspace/graph` maps it onto React Flow.
 */
import { findingCategory, findingTitle, safeImageUrl } from "../findings";
import type { Case, Correlation, CorrelationStatus, Entity, Finding } from "../types";

export const GRAPH_KINDS = ["seed", "account", "email", "infra", "breach", "handle", "cluster"] as const;
export type GraphNodeKind = (typeof GRAPH_KINDS)[number];

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel: string | null;
  /** Set for nodes that represent one finding. */
  findingId: string | null;
  /** Set for cluster nodes: the findings folded into it. */
  memberIds: string[];
  avatarUrl: string | null;
  curated: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "found_on" | "mentions" | "correlation";
  label: string | null;
  status: CorrelationStatus | null;
  confidence: number | null;
  correlationId: string | null;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Account nodes folded into cluster nodes. */
  clustered: number;
}

export interface GraphOptions {
  /** Node kinds to show. Seeds are always shown. */
  kinds?: ReadonlySet<GraphNodeKind>;
  /** 0..1; correlation edges below this are dropped. */
  minConfidence?: number;
  showRejected?: boolean;
  /** Above this many account nodes per identifier, low-value ones are clustered by category. */
  maxAccountsPerIdentifier?: number;
}

export interface GraphInput {
  case: Pick<Case, "identifiers">;
  findings: readonly Finding[];
  correlations: readonly Correlation[];
  entities: readonly Entity[];
}

const norm = (value: string) => value.trim().toLowerCase();
export const identifierNodeId = (type: string, value: string) => `id:${type}:${norm(value)}`;
export const findingNodeId = (id: string) => `f:${id}`;

function kindForType(type: string): GraphNodeKind {
  if (type === "email") return "email";
  if (type === "domain" || type === "ip") return "infra";
  return "handle";
}

function findingKind(f: Finding): GraphNodeKind {
  if (f.platform === "breach") return "breach";
  if (f.identifier_type === "domain" || f.identifier_type === "ip") return "infra";
  return "account";
}

function findingSublabel(f: Finding): string {
  const sub = f.extra_metadata.subdomain;
  if (typeof sub === "string" && sub) return sub;
  const date = f.extra_metadata.breach_date;
  if (f.platform === "breach" && typeof date === "string") return date;
  return f.identifier_value;
}

const shortRule = (type: string) => type.replace(/_/g, " ");

export function buildGraph(input: GraphInput, options: GraphOptions = {}): GraphModel {
  const minConfidence = options.minConfidence ?? 0;
  const showRejected = options.showRejected ?? false;
  const maxAccounts = options.maxAccountsPerIdentifier ?? 12;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const plain = (id: string, kind: GraphNodeKind, label: string, sublabel: string | null) =>
    addNode({ id, kind, label, sublabel, findingId: null, memberIds: [], avatarUrl: null, curated: false });

  // 1. seed targets
  for (const idf of input.case.identifiers) {
    plain(identifierNodeId(idf.type, idf.value), "seed", idf.value, idf.type);
  }

  // 2. correlations that survive the filters
  const found = input.findings.filter((f) => f.status === "found");
  const foundIds = new Set(found.map((f) => f.id));
  const correlations = input.correlations.filter(
    (c) => c.confidence >= minConfidence && (showRejected || c.status !== "rejected"),
  );
  const important = new Set<string>();
  for (const c of correlations) c.entities_involved.forEach((id) => important.add(id));
  for (const e of input.entities) if (e.source_finding_id) important.add(e.source_finding_id);
  for (const f of found) if (f.curated) important.add(f.id);

  // 3. findings, clustered per identifier when there are many low-value accounts
  const byIdentifier = new Map<string, Finding[]>();
  for (const f of found) {
    const key = identifierNodeId(f.identifier_type, f.identifier_value);
    // an image URL that is not a seed adds nothing next to its own finding node
    const standalone = f.identifier_type === "image" && !nodes.has(key);
    if (!standalone && !nodes.has(key)) {
      plain(key, kindForType(f.identifier_type), f.identifier_value, f.identifier_type);
    }
    const list = byIdentifier.get(key) ?? [];
    list.push(f);
    byIdentifier.set(key, list);
  }

  let clustered = 0;
  for (const [identifierId, list] of byIdentifier) {
    const accounts = list.filter((f) => findingKind(f) === "account");
    const foldable =
      accounts.length > maxAccounts ? accounts.filter((f) => !important.has(f.id)) : [];
    const groups = new Map<string, Finding[]>();
    for (const f of foldable) {
      const category = findingCategory(f);
      groups.set(category, [...(groups.get(category) ?? []), f]);
    }
    const folded = new Set<string>();
    for (const [category, members] of groups) {
      if (members.length < 2) continue;
      members.forEach((m) => folded.add(m.id));
      clustered += members.length;
      const id = `cluster:${identifierId}:${category}`;
      addNode({
        id,
        kind: "cluster",
        label: `+${members.length} more on ${category}`,
        sublabel: members
          .slice(0, 3)
          .map((m) => m.platform)
          .join(", "),
        findingId: null,
        memberIds: members.map((m) => m.id),
        avatarUrl: null,
        curated: false,
      });
      edges.push({
        id: `e:${identifierId}>${id}`,
        source: identifierId,
        target: id,
        kind: "found_on",
        label: null,
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
    for (const f of list) {
      if (folded.has(f.id)) continue;
      const id = findingNodeId(f.id);
      const avatar = f.extra_metadata.extra?.avatar_url;
      addNode({
        id,
        kind: findingKind(f),
        label: findingTitle(f),
        sublabel: findingSublabel(f),
        findingId: f.id,
        memberIds: [],
        avatarUrl: safeImageUrl(typeof avatar === "string" ? avatar : null),
        curated: f.curated,
      });
      if (!nodes.has(identifierId)) continue;
      edges.push({
        id: `e:${identifierId}>${id}`,
        source: identifierId,
        target: id,
        kind: "found_on",
        label: null,
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }

  // 4. discovered entities (emails, domains, IPs, handles) and where they were mentioned
  for (const e of input.entities) {
    if (e.is_seed || e.kind === "url" || e.kind === "image") continue;
    const id = identifierNodeId(e.kind, e.value);
    if (!nodes.has(id)) plain(id, kindForType(e.kind), e.value, e.scanned ? e.kind : `${e.kind} · not scanned`);
    const source = e.source_finding_id ? findingNodeId(e.source_finding_id) : null;
    if (source && nodes.has(source)) {
      edges.push({
        id: `m:${source}>${id}`,
        source,
        target: id,
        kind: "mentions",
        label: "mentions",
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }

  // 5. correlation edges: star from the first involved finding
  for (const c of correlations) {
    const members = c.entities_involved
      .filter((id) => foundIds.has(id))
      .map(findingNodeId)
      .filter((id) => nodes.has(id));
    const [hub, ...rest] = members;
    if (!hub) continue;
    for (const target of rest) {
      edges.push({
        id: `c:${c.id}:${target}`,
        source: hub,
        target,
        kind: "correlation",
        label: `${shortRule(c.type)} ${Math.round(c.confidence * 100)}%`,
        status: c.status,
        confidence: c.confidence,
        correlationId: c.id,
      });
    }
  }

  // 6. kind filter
  const kinds = options.kinds;
  const visible = [...nodes.values()].filter((n) => n.kind === "seed" || !kinds || kinds.has(n.kind));
  const visibleIds = new Set(visible.map((n) => n.id));
  return {
    nodes: visible,
    edges: edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    clustered,
  };
}
