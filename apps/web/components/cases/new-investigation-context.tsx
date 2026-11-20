"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { TargetType } from "@/lib/types";
import { NewInvestigationDialog } from "./new-investigation-dialog";

interface NewInvestigationContextValue {
  open: (preset?: { type?: TargetType }) => void;
}

const Context = createContext<NewInvestigationContextValue>({ open: () => {} });

export const useNewInvestigation = () => useContext(Context);

/** Mounts the dialog once so any button, shortcut or the command palette can open it. */
export function NewInvestigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; type: TargetType | null; nonce: number }>({
    open: false,
    type: null,
    nonce: 0,
  });
  const open = useCallback((preset?: { type?: TargetType }) => {
    setState((s) => ({ open: true, type: preset?.type ?? null, nonce: s.nonce + 1 }));
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Context.Provider value={value}>
      {children}
      <NewInvestigationDialog
        key={state.nonce}
        open={state.open}
        initialType={state.type}
        onOpenChange={(next) => setState((s) => ({ ...s, open: next }))}
      />
    </Context.Provider>
  );
}
