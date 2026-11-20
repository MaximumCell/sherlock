/**
 * Builds the entity graph model from case data. Pure and framework-free so it
 * can be unit-tested; `components/case/map` maps it onto React Flow.
 */
import { buildAccounts, isSameAccount, type CaseAccount } from "../accounts";
import { findingCategory, findingTitle } from "../findings";
import { accountPlatform } from "../profile";
import { describeRule } from "../rules";
import type { Case, Correlation, CorrelationStatus, Entity, Finding } from "../types";

export const GRAPH_KINDS = [
  "seed",
  "account",
  "email",
  "infra",
  "breach",
  "handle",
  "cluster",
] as const;
export type GraphNodeKind = (typeof GRAPH_KINDS)[number];

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel: string | null;
  /** Set for nodes that represent an account: its primary finding. */
  findingId: string | null;
  /** Cluster nodes: the findings folded into it. Account nodes: every finding of the account. */
  memberIds: string[];
  /** Account nodes: how many data sources reported the account (badge). */
  sources: number;
  avatarUrl: string | null;
  /** Account nodes: the platform, for its icon. */
  platform: string | null;
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

/** Plain words for "identifier -> result" edges. */
function foundLabel(f: Finding, kind: GraphNodeKind): string {
  if (kind === "breach") return "listed in";
  if (kind === "account" && f.identifier_type === "email") return "registered with";
  return "found on";
}

const MENTION_LABEL: Record<string, string> = {
  email: "shows this email",
  domain: "links to this site",
  username: "names this account",
};

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
    addNode({
      id,
      kind,
      label,
      sublabel,
      findingId: null,
      memberIds: [],
      sources: 0,
      avatarUrl: null,
      platform: null,
      curated: false,
    });
  const edgeIds = new Set<string>();
  const addEdge = (edge: GraphEdge) => {
    if (edgeIds.has(edge.id) || edge.source === edge.target) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  };

  // 1. seed targets
  for (const idf of input.case.identifiers) {
    plain(identifierNodeId(idf.type, idf.value), "seed", idf.value, idf.type);
  }

  // 2. correlations that survive the filters (automatic same_account merges are not edges:
  //    they decide which findings are one account node)
  const found = input.findings.filter((f) => f.status === "found");
  const index = buildAccounts(found, input.correlations);
  const correlations = input.correlations.filter(
    (c) =>
      !isSameAccount(c) &&
      c.confidence >= minConfidence &&
      (showRejected || c.status !== "rejected"),
  );
  const important = new Set<string>();
  for (const c of correlations) c.entities_involved.forEach((id) => important.add(id));
  for (const e of input.entities) if (e.source_finding_id) important.add(e.source_finding_id);
  for (const f of found) if (f.curated) important.add(f.id);
  const isImportant = (acc: CaseAccount) => acc.findings.some((f) => important.has(f.id));
  const accountNodeId = (acc: CaseAccount) => findingNodeId(acc.primary.id);

  // 3. one node per ACCOUNT, clustered per identifier when there are many low-value ones
  const byIdentifier = new Map<string, CaseAccount[]>();
  for (const acc of index.accounts) {
    for (const f of acc.findings) {
      const key = identifierNodeId(f.identifier_type, f.identifier_value);
      // an image URL that is not a seed adds nothing next to its own finding node
      const standalone = f.identifier_type === "image" && !nodes.has(key);
      if (!standalone && !nodes.has(key)) {
        plain(key, kindForType(f.identifier_type), f.identifier_value, f.identifier_type);
      }
    }
    const home = identifierNodeId(acc.primary.identifier_type, acc.primary.identifier_value);
    byIdentifier.set(home, [...(byIdentifier.get(home) ?? []), acc]);
  }

  let clustered = 0;
  const folded = new Set<string>();
  for (const [identifierId, list] of byIdentifier) {
    const accounts = list.filter((a) => findingKind(a.primary) === "account");
    const foldable = accounts.length > maxAccounts ? accounts.filter((a) => !isImportant(a)) : [];
    const groups = new Map<string, CaseAccount[]>();
    for (const a of foldable) {
      const category = findingCategory(a.primary);
      groups.set(category, [...(groups.get(category) ?? []), a]);
    }
    for (const [category, members] of groups) {
      if (members.length < 2) continue;
      members.forEach((m) => folded.add(m.key));
      clustered += members.length;
      const id = `cluster:${identifierId}:${category}`;
      addNode({
        id,
        kind: "cluster",
        label: `+${members.length} more on ${category}`,
        sublabel: members
          .slice(0, 3)
          .map((m) => m.label)
          .join(", "),
        findingId: null,
        memberIds: members.flatMap((m) => m.findings.map((f) => f.id)),
        sources: 0,
        avatarUrl: null,
        platform: null,
        curated: false,
      });
      addEdge({
        id: `e:${identifierId}>${id}`,
        source: identifierId,
        target: id,
        kind: "found_on",
        label: "found on",
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }
  for (const acc of index.accounts) {
    if (folded.has(acc.key)) continue;
    const id = accountNodeId(acc);
    const kind = findingKind(acc.primary);
    addNode({
      id,
      kind,
      label: acc.findings.length > 1 ? acc.label : findingTitle(acc.primary),
      sublabel: acc.handle ?? findingSublabel(acc.primary),
      findingId: acc.primary.id,
      memberIds: acc.findings.map((f) => f.id),
      sources: acc.sources.length,
      avatarUrl: acc.view.avatarUrl,
      platform: kind === "account" ? accountPlatform(acc) : null,
      curated: acc.findings.some((f) => f.curated),
    });
    // every identifier that found this account points at its ONE node
    for (const f of acc.findings) {
      const identifierId = identifierNodeId(f.identifier_type, f.identifier_value);
      if (!nodes.has(identifierId)) continue;
      addEdge({
        id: `e:${identifierId}>${id}`,
        source: identifierId,
        target: id,
        kind: "found_on",
        label: foundLabel(f, kind),
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }
  const nodeOfFinding = (findingId: string): string | null => {
    const acc = index.byFinding.get(findingId);
    if (!acc) return null;
    const id = accountNodeId(acc);
    return nodes.has(id) ? id : null;
  };

  // 4. discovered entities (emails, domains, IPs, handles) and where they were shown
  for (const e of input.entities) {
    if (e.is_seed || e.kind === "url" || e.kind === "image") continue;
    const id = identifierNodeId(e.kind, e.value);
    if (!nodes.has(id))
      plain(id, kindForType(e.kind), e.value, e.scanned ? e.kind : `${e.kind} · not scanned`);
    const source = e.source_finding_id ? nodeOfFinding(e.source_finding_id) : null;
    if (source) {
      addEdge({
        id: `m:${source}>${id}`,
        source,
        target: id,
        kind: "mentions",
        label: MENTION_LABEL[e.kind] ?? "mentions",
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }
  // an account that publishes an email that is itself on the map (searched or suggested)
  for (const acc of index.accounts) {
    const source = nodes.has(accountNodeId(acc)) ? accountNodeId(acc) : null;
    if (!source) continue;
    for (const email of acc.view.emails) {
      const id = identifierNodeId("email", email);
      if (!nodes.has(id)) continue;
      addEdge({
        id: `m:${source}>${id}`,
        source,
        target: id,
        kind: "mentions",
        label: "shows this email",
        status: null,
        confidence: null,
        correlationId: null,
      });
    }
  }

  // 5. links between ACCOUNTS: star from the first account involved
  for (const c of correlations) {
    const members = [
      ...new Set(c.entities_involved.map(nodeOfFinding).filter((id): id is string => id !== null)),
    ];
    const [hub, ...rest] = members;
    if (!hub) continue;
    for (const target of rest) {
      addEdge({
        id: `c:${c.id}:${target}`,
        source: hub,
        target,
        kind: "correlation",
        label: `${describeRule(c.type).title} ${Math.round(c.confidence * 100)}%`,
        status: c.status,
        confidence: c.confidence,
        correlationId: c.id,
      });
    }
  }

  // 6. kind filter
  const kinds = options.kinds;
  const visible = [...nodes.values()].filter(
    (n) => n.kind === "seed" || !kinds || kinds.has(n.kind),
  );
  const visibleIds = new Set(visible.map((n) => n.id));
  return {
    nodes: visible,
    edges: edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    clustered,
  };
}
