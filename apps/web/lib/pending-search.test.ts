import { describe, expect, it } from "vitest";
import {
  PENDING_MAX_AGE_MS,
  PENDING_SEARCH_KEY,
  loadPendingSearch,
  savePendingSearch,
  takePendingSearch,
  toPendingSearch,
} from "./pending-search";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const search = {
  type: "username" as const,
  value: "octocat",
  hints: {},
  title: "",
  tags: "",
  excluded: ["whatsmyname"],
};

describe("pending search", () => {
  it("round-trips through storage", () => {
    const s = memory();
    expect(savePendingSearch(search, 1000, s)).toBe(true);
    expect(loadPendingSearch(2000, s)).toEqual({ ...search, savedAt: 1000 });
  });

  it("resumes only once the session may search, and only once", () => {
    const s = memory();
    savePendingSearch({ ...search, caseId: "case-1" }, 1000, s);
    expect(takePendingSearch({ anonymous: true }, true, 2000, s)).toBeNull();
    expect(s.data.has(PENDING_SEARCH_KEY)).toBe(true);
    expect(takePendingSearch(null, true, 2000, s)).toBeNull();
    expect(takePendingSearch({ anonymous: false }, true, 2000, s)).toMatchObject({
      value: "octocat",
      caseId: "case-1",
    });
    expect(takePendingSearch({ anonymous: false }, true, 2000, s)).toBeNull();
  });

  it("lets an anonymous session resume when no account is needed", () => {
    const s = memory();
    savePendingSearch(search, 1000, s);
    expect(takePendingSearch({ anonymous: true }, false, 2000, s)?.value).toBe("octocat");
  });

  it("drops stale or malformed entries", () => {
    const s = memory();
    savePendingSearch(search, 0, s);
    expect(loadPendingSearch(PENDING_MAX_AGE_MS + 1, s)).toBeNull();
    s.setItem(PENDING_SEARCH_KEY, "{not json");
    expect(loadPendingSearch(1, s)).toBeNull();
    expect(toPendingSearch({ ...search, type: "ssn", savedAt: 1 }, 2)).toBeNull();
    expect(toPendingSearch({ ...search, value: " ", savedAt: 1 }, 2)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    expect(savePendingSearch(search, 1, broken)).toBe(false);
    expect(loadPendingSearch(1, broken)).toBeNull();
    expect(takePendingSearch({ anonymous: false }, true, 1, broken)).toBeNull();
  });
});
