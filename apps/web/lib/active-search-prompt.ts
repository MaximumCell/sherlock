/**
 * Lets a refused search ask the shell to open the "previous search is still running" dialog
 * (same pattern as `sign-in-prompt.ts`).
 */
import type { ActiveSearch } from "./data/gateway";

type Listener = (search: ActiveSearch) => void;
const listeners = new Set<Listener>();

export function requestActiveSearchDialog(search: ActiveSearch): void {
  listeners.forEach((l) => l(search));
}

export function onActiveSearchRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
