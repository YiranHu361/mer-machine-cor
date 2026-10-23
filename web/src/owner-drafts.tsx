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
type ActionKind = "handling" | "pickup" | "renewal" | "review" | "clear";
type ActionJob = {
  id: string;
  specVersion: number;
  spec: unknown;
  machineId?: string;
  attemptId?: string;
  artifact?: { id: string; sha256: string };
  approvedSpecHash?: string;
  productionState: string;
  fulfillmentState: string;
  evidence?: unknown;
  quote?: { collectionPoint: string };
  pickup?: { code?: string; expiresAt?: string; redeemedAt?: string };
  history?: Array<{ event: string }>;
};
const actionKinds: ActionKind[] = [
  "handling",
  "pickup",
  "renewal",
  "review",
  "clear",
];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
/** Explicit operator observations belong only to this exact execution/outcome. */
export function ownerActionDraftKey(kind: ActionKind, job: ActionJob) {
  const eligible =
    kind === "handling"
      ? job.productionState === "produced" &&
        job.fulfillmentState === "awaiting_owner"
      : kind === "pickup" || kind === "renewal"
        ? job.fulfillmentState === "ready_for_pickup"
        : kind === "review"
          ? job.productionState === "needs_review"
          : job.productionState === "failed" &&
            !job.history?.some((event) => event.event === "owner_recovery");
  const scope = eligible
    ? JSON.stringify(
        canonical({
          specVersion: job.specVersion,
          spec: job.spec,
          artifact: job.artifact && {
            id: job.artifact.id,
            sha256: job.artifact.sha256,
          },
          approvedSpecHash: job.approvedSpecHash,
          machineId: job.machineId,
          attemptId: job.attemptId,
          productionState: job.productionState,
          fulfillmentState: job.fulfillmentState,
          evidence: job.evidence,
          collectionPoint: job.quote?.collectionPoint,
          ...(kind === "pickup" || kind === "renewal"
            ? { pickup: job.pickup }
            : {}),
        }),
      )
    : "inactive";
  return `${kind}:${job.id}:${scope}`;
}
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
    reconcile(
      paymentJobs: Set<string>,
      knownJobs: Set<string>,
      actionScopes: Set<string>,
    ) {
      let changed = false;
      for (const [key, entry] of entries) {
        const [kind, jobId] = key.split(":");
        const actionable = actionKinds.includes(kind as ActionKind)
          ? actionScopes.has(key)
          : kind === "payment"
            ? paymentJobs.has(jobId)
            : knownJobs.has(jobId);
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
  actionJobs = [],
}: {
  children: ReactNode;
  pendingWork: boolean;
  paymentJobIds: string[];
  jobIds: string[];
  actionJobs?: ActionJob[];
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
  const actions = JSON.stringify(
    actionJobs.flatMap((job) =>
      actionKinds.map((kind) => ownerActionDraftKey(kind, job)),
    ),
  );
  useEffect(() => {
    store.reconcile(
      new Set<string>(JSON.parse(payments)),
      new Set<string>(JSON.parse(jobs)),
      new Set<string>(JSON.parse(actions)),
    );
  }, [store, payments, jobs, actions]);
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
