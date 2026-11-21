"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Read-only mode for the investigation page (the operator's abuse-review view). Components hide
 * every control that changes data when it is on; the data source behind it refuses writes too.
 */
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({ children }: { children: ReactNode }) {
  return <ReadOnlyContext.Provider value>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
