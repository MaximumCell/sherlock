/**
 * A `DataSource` over one case snapshot, for the operator's read-only view
 * (`/admin/cases/[id]`). Reads come from the snapshot; every command is refused, so nothing in
 * the reused investigation components can change the visitor's data (the gateway would refuse
 * too: the operator does not own the case). Report and score are computed in the browser from
 * the snapshot, because the visitor-facing routes only serve a case's owner.
 */
import type { AdminCaseView } from "../admin/types";
import { scoreFixtureCase } from "./fixtures/exposure";
import { renderFixtureReport } from "./fixtures/report";
import { GatewayError } from "./gateway";
import type { DataSource } from "./types";

export const READ_ONLY_DETAIL = "This is a read-only operator view. Nothing can be changed here.";

const refuse = (): Promise<never> => Promise.reject(new GatewayError(403, READ_ONLY_DETAIL));
const noop = () => () => undefined;

export function createReadOnlyDataSource(base: DataSource, view: AdminCaseView): DataSource {
  const id = view.case.id;
  const forCase = <T>(caseId: string, rows: T[]): Promise<T[]> =>
    Promise.resolve(caseId === id ? structuredClone(rows) : []);
  return {
    mode: base.mode,
    searchNeedsAccount: base.searchNeedsAccount,
    admin: base.admin,
    getSession: () => base.getSession(),
    onSessionChange: (cb) => base.onSessionChange(cb),
    signInWithGitHub: () => refuse(),
    signInWithGoogle: () => refuse(),
    signInWithEmail: () => refuse(),
    signOut: () => refuse(),

    listCaseSummaries: () => Promise.resolve([]),
    getCase: (caseId) => Promise.resolve(caseId === id ? structuredClone(view.case) : null),
    listFindings: (caseId) => forCase(caseId, view.findings),
    listCorrelations: (caseId) => forCase(caseId, view.correlations),
    listJobs: (caseId) => forCase(caseId, view.jobs),
    listEntities: (caseId) => forCase(caseId, view.entities),
    listAudit: (caseId) => forCase(caseId ?? id, view.audit),

    subscribeCase: noop,
    subscribeCaseList: noop,

    listModules: () => base.listModules(),
    listPlatforms: () => base.listPlatforms(),
    createCase: () => refuse(),
    updateCase: () => refuse(),
    deleteCase: () => refuse(),
    scan: () => refuse(),
    cancelJob: () => refuse(),
    cancelBatch: () => refuse(),
    queueStatus: () => Promise.resolve(null),
    wake: () => Promise.resolve(),
    curateFinding: () => refuse(),
    reviewCorrelation: () => refuse(),
    getReport: (caseId) =>
      caseId === id
        ? Promise.resolve(renderFixtureReport(view.case, view.findings, view.correlations))
        : refuse(),
    getExposure: (caseId) =>
      caseId === id
        ? Promise.resolve(scoreFixtureCase(view.findings, view.correlations))
        : refuse(),
    listCandidates: () => Promise.resolve(null),
    confirmCandidate: () => refuse(),
  };
}
