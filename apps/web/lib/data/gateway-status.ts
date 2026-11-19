/**
 * Tiny external store tracking in-flight gateway commands, so the shell can show
 * "Waking the scan service…" when a command is slow (the gateway host sleeps when idle).
 */
export interface GatewayActivity {
  /** Commands currently in flight. */
  pending: number;
  /** At least one command has been pending longer than the wake threshold, or is retrying. */
  waking: boolean;
  /** Retry attempt of the slowest command (0 = first try). */
  attempt: number;
}

export const WAKE_NOTICE_MS = 3000;

type Listener = () => void;

interface Entry {
  slow: boolean;
  attempt: number;
  timer: ReturnType<typeof setTimeout>;
}

const IDLE: GatewayActivity = { pending: 0, waking: false, attempt: 0 };

export function createGatewayStatus(noticeMs: number = WAKE_NOTICE_MS) {
  const entries = new Map<number, Entry>();
  const listeners = new Set<Listener>();
  let nextId = 1;
  let snapshot: GatewayActivity = IDLE;

  const publish = () => {
    const list = [...entries.values()];
    const next: GatewayActivity =
      list.length === 0
        ? IDLE
        : {
            pending: list.length,
            waking: list.some((e) => e.slow),
            attempt: list.reduce((max, e) => Math.max(max, e.attempt), 0),
          };
    if (
      next.pending === snapshot.pending &&
      next.waking === snapshot.waking &&
      next.attempt === snapshot.attempt
    ) {
      return;
    }
    snapshot = next;
    listeners.forEach((l) => l());
  };

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): GatewayActivity => snapshot,
    getServerSnapshot: (): GatewayActivity => IDLE,
    /** Register a command. Returns handlers to report retries and completion. */
    begin() {
      const id = nextId++;
      const entry: Entry = {
        slow: false,
        attempt: 0,
        timer: setTimeout(() => {
          entry.slow = true;
          publish();
        }, noticeMs),
      };
      entries.set(id, entry);
      publish();
      return {
        retry(attempt: number) {
          entry.attempt = attempt;
          entry.slow = true;
          publish();
        },
        end() {
          clearTimeout(entry.timer);
          entries.delete(id);
          publish();
        },
      };
    },
  };
}

export type GatewayStatusStore = ReturnType<typeof createGatewayStatus>;

export const gatewayStatus: GatewayStatusStore = createGatewayStatus();
