/**
 * Lets any code path (a 403 from the gateway, a name-search button) ask the
 * account menu to open the sign-in dialog without prop drilling.
 */
type Listener = (reason: string | null) => void;
const listeners = new Set<Listener>();

export function requestSignIn(reason: string | null = null): void {
  listeners.forEach((l) => l(reason));
}

export function onSignInRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
