import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useOwnerFormGuard } from "./owner-form-guard";

type Entry = { value: unknown; initial: unknown; dirty: boolean };
function createDraftStore() {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    protectedWork: () => [...entries.values()].some((entry) => entry.dirty),
    ensure<T>(key: string, initial: () => T) {
      if (!entries.has(key)) {
        const value = initial();
        entries.set(key, {
          value,
          initial: structuredClone(value),
          dirty: false,
        });
      }
    },
    get<T>(key: string) {
      return entries.get(key)!.value as T;
    },
    set<T>(
      key: string,
      update: SetStateAction<T>,
      isDirty: (value: T) => boolean,
    ) {
      const entry = entries.get(key)!;
      const value =
        typeof update === "function"
          ? (update as (value: T) => T)(entry.value as T)
          : update;
      if (Object.is(value, entry.value)) return;
      entries.set(key, { ...entry, value, dirty: isDirty(value) });
      notify();
    },
    reconcile(paymentJobs: Set<string>, knownJobs: Set<string>) {
      let changed = false;
      for (const [key, entry] of entries) {
        const [kind, jobId] = key.split(":");
        const actionable =
          kind === "payment" ? paymentJobs.has(jobId) : knownJobs.has(jobId);
        if (!actionable && entry.dirty) {
          entries.set(key, {
            ...entry,
            value: structuredClone(entry.initial),
            dirty: false,
          });
          changed = true;
        }
      }
      if (changed) notify();
    },
  };
}
const OwnerDraftContext = createContext<ReturnType<
  typeof createDraftStore
> | null>(null);

/** Private draft memory lasts only as long as this authenticated owner view. */
export function OwnerDraftProvider({
  children,
  pendingWork,
  paymentJobIds,
  jobIds,
}: {
  children: ReactNode;
  pendingWork: boolean;
  paymentJobIds: string[];
  jobIds: string[];
}) {
  const store = useRef(createDraftStore()).current;
  const protectedWork = useSyncExternalStore(
    store.subscribe,
    store.protectedWork,
    store.protectedWork,
  );
  useOwnerFormGuard(protectedWork || pendingWork);
  const payments = JSON.stringify(paymentJobIds);
  const jobs = JSON.stringify(jobIds);
  useEffect(() => {
    store.reconcile(
      new Set<string>(JSON.parse(payments)),
      new Set<string>(JSON.parse(jobs)),
    );
  }, [store, payments, jobs]);
  return (
    <OwnerDraftContext.Provider value={store}>
      {children}
    </OwnerDraftContext.Provider>
  );
}

export function useOwnerDraft<T>(
  key: string,
  initial: () => T,
  isDirty: (value: T) => boolean,
): [T, (update: SetStateAction<T>) => void] {
  const store = useContext(OwnerDraftContext);
  if (!store) throw new Error("Owner draft scope is unavailable.");
  store.ensure(key, initial);
  const snapshot = useCallback(() => store.get<T>(key), [store, key]);
  const value = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const setValue = (update: SetStateAction<T>) =>
    store.set(key, update, isDirty);
  return [value, setValue];
}
