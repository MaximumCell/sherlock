/** Builds the one plain-English sentence at the top of the case page. */

export interface SummaryInput {
  /** What was searched, e.g. "ada-fixture". */
  subject: string;
  /** Account and profile results. */
  accounts: number;
  /** All found results, of any kind. */
  results: number;
  /** Distinct sites and lookups checked (one data source can check many sites). */
  sources: number;
  breaches: number;
  pendingLinks: number;
  /** Set while a scan runs. */
  scanning?: { done: number; total: number } | null;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" */
export function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function buildSummarySentence(input: SummaryInput): string {
  const { subject, accounts, results, sources, breaches, pendingLinks, scanning } = input;
  const remaining = scanning ? scanning.total - scanning.done : 0;

  if (results === 0) {
    if (scanning) {
      return `We are asking ${count(scanning.total, "data source")} about ${subject}. Results appear here as each one finishes.`;
    }
    if (sources === 0)
      return `Nothing has been searched for ${subject} yet. Start a scan to see what is public.`;
    return `We checked ${count(sources, "site")} for ${subject} and found nothing public.`;
  }

  const lead = accounts > 0 ? count(accounts, "account") : count(results, "result");
  const extras: string[] = [];
  if (breaches > 0) extras.push(count(breaches, "breach listing"));
  if (pendingLinks > 0) extras.push(`${count(pendingLinks, "possible link")} for you to check`);

  const head = `We found ${lead} for ${subject} across ${count(sources, "site")}`;
  const sentence = extras.length ? `${head}, ${joinList(extras)}` : head;
  if (scanning && remaining > 0) {
    return `${sentence} so far. Still waiting on ${remaining} of ${scanning.total} data sources.`;
  }
  return `${sentence}.`;
}
