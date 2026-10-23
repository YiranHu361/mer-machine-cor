import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useId,
  useSyncExternalStore,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  PaymentReferenceForm,
  TrialEconomicsForm,
  type TrialEconomics,
} from "./OwnerRecords";
import { useOwnerFormGuard } from "./owner-form-guard";
import { settingsSnapshot } from "./machine-settings";
import { ResultImage, retryImageSource, useImageAttempt } from "./ResultImage";
import {
  OwnerDraftProvider,
  ownerActionDraftKey,
  useOwnerDraft,
} from "./owner-drafts";
import { api, ApiError } from "./api";
import {
  readStoredValue,
  writeStoredValue,
  removeStoredValue,
  getCheckoutKey,
  getStorageStatus,
  subscribeStorageStatus,
} from "./storage";

type Output = "sticker" | "instax" | "3d";
type Asset = {
  id: string;
  url: string;
  sha256: string;
  width?: number;
  height?: number;
  previewUrl?: string;
};
type Price = {
  consumables: number;
  machine: number;
  handling: number;
  platform: number;
};
type Machine = {
  id: string;
  name: string;
  model: string;
  outputType: Output;
  adapterVersion: string;
  mode: string;
  paired: boolean;
  configured: boolean;
  calibrated: boolean;
  listed: boolean;
  ready: boolean;
  paused: boolean;
  reason?: string;
  mediaRemaining: number;
  material: string;
  priceCard: Price;
  hours: { start: number; end: number };
  maxJobSeconds: number;
  collectionPoint: string;
  activeJobId?: string;
  policy?: { authorizedArtwork: boolean; maxQuantity: number };
  ownerAddress?: string;
  settingsFingerprint?: string;
  policyReconciliationRequired?: boolean;
  calibrationAt?: string;
  reservation?: { jobId: string; expiresAt: string };
};
type Spec = {
  assetIds: string[];
  intent: string;
  outputType: Output;
  widthMm: number;
  heightMm: number;
  quantity: number;
  material: string;
  permission: "authorized" | "unclear";
  crop: "contain" | "cover";
  budgetMandate?: { enabled: true; capCents: number };
  preparedModelId?: string;
  depthMm?: number;
  color?: string;
  estimatedSeconds?: number;
};
type Quote = {
  id: string;
  version: number;
  expiresAt: string;
  items: { label: string; cents: number }[];
  totalCents: number;
  ownerCents: number;
  platformCents: number;
  currency: string;
  paymentMode: string;
  collectionPoint: string;
  accepted?: boolean;
};
type Job = {
  id: string;
  checkoutKey?: string;
  machineId?: string;
  specVersion: number;
  spec: Spec;
  artifact?: Asset;
  approvedSpecHash?: string;
  productionState: string;
  paymentState: string;
  fulfillmentState: string;
  quote?: Quote;
  attemptId?: string;
  abortStatus?: string;
  economics?: TrialEconomics;
  evidence?: {
    url: string;
    capturedAt: string;
    machineId: string;
    jobId: string;
    result: string;
    reason: string;
    source: string;
    completionCredible: boolean;
  };
  pickup?: { code?: string; expiresAt?: string; redeemedAt?: string };
  history: { at: string; event: string; reason?: string }[];
  createdAt: string;
  updatedAt: string;
  version: number;
};
type Health = {
  mode: string;
  paymentMode: string;
  store: string;
  integrations?: Record<string, unknown>;
};
type Session = { role: "requester" | "owner"; id: string };
type Ledger = {
  id?: string;
  jobId?: string;
  kind?: string;
  state?: string;
  amountCents?: number;
  cents?: number;
  transactionRef?: string;
  mode?: string;
  [key: string]: unknown;
};
type CatalogItem = {
  id: string;
  name: string;
  description?: string;
  url?: string;
  widthMm?: number;
  heightMm?: number;
  material?: string;
  depthMm?: number;
  color?: string;
  estimatedSeconds?: number;
  artifactId: string;
  previewUrl?: string;
  artifact?: Asset;
};
type IntakeDraft = {
  outputType: Output | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number | null;
  material: string | null;
  crop: "contain" | "cover";
  questions: string[];
  contentReview: "clear" | "review";
  reason: string;
  provider: string;
  model: string;
};
const outputLabels: Record<Output, string> = {
  sticker: "Thermal sticker",
  instax: "Instant photo",
  "3d": "Prepared 3D print",
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
const human = (v: string) => v.replaceAll("_", " ").replaceAll("-", " ");
const shortId = (v: string) => v.slice(0, 8);
const date = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const available = (m: Machine) =>
  m.ready &&
  m.listed &&
  !m.paused &&
  m.calibrated &&
  m.configured &&
  m.paired &&
  m.mediaRemaining > 0 &&
  !m.activeJobId;
const terminal = (s: string) =>
  ["produced", "failed", "needs_review", "cancelled"].includes(s);
const needsOwnerReview = (job: Job) =>
  job.productionState === "needs_review" ||
  (job.productionState === "failed" &&
    !job.history?.some((event) => event.event === "owner_recovery"));
const needsOwnerAction = (job: Job) =>
  needsOwnerReview(job) ||
  job.fulfillmentState === "ready_for_pickup" ||
  (job.productionState === "produced" &&
    job.fulfillmentState === "awaiting_owner") ||
  ["collection_pending", "release_pending", "refund_pending"].includes(
    job.paymentState,
  );

type SnapshotGate = {
  issued: number;
  applied: number;
  revision: number;
  floor: number;
};
const snapshotGate = (): SnapshotGate => ({
  issued: 0,
  applied: 0,
  revision: -1,
  floor: 0,
});
function invalidateSnapshots(gate: SnapshotGate) {
  gate.floor = ++gate.issued;
}
function acceptSnapshot(
  gate: SnapshotGate,
  request: number,
  revision?: number,
) {
  if (request < gate.floor) return false;
  const authoritative = Number.isSafeInteger(revision) && revision! >= 0;
  if (authoritative) {
    if (
      revision! < gate.revision ||
      (revision === gate.revision && request < gate.applied)
    )
      return false;
    gate.revision = revision!;
  } else if (gate.revision >= 0 || request < gate.applied) return false;
  gate.applied = Math.max(gate.applied, request);
  return true;
}
const currentSnapshotError = (gate: SnapshotGate, request: number) =>
  request >= gate.floor && request >= gate.applied;

function Notice({
  children,
  kind = "info",
  focusOnShow = false,
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
  focusOnShow?: boolean;
}) {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnShow && notice.current) {
      notice.current.focus({ preventScroll: true });
      notice.current.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [focusOnShow, children]);
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
      ref={notice}
      tabIndex={focusOnShow ? -1 : undefined}
    >
      {children}
    </div>
  );
}
function Button({
  children,
  busy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" /> {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {isValidElement(children)
        ? cloneElement(
            children as React.ReactElement<{
              id: string;
              "aria-describedby"?: string;
            }>,
            {
              id: fieldId,
              "aria-describedby": hint ? `${fieldId}-hint` : undefined,
            },
          )
        : children}
      {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function DeviceArt({ type }: { type: Output }) {
  return (
    <svg viewBox="0 0 140 100" fill="none" aria-hidden="true">
      {type === "sticker" ? (
        <>
          <rect
            x="20"
            y="30"
            width="100"
            height="58"
            rx="17"
            fill="currentColor"
            opacity=".12"
          />
          <path
            d="M30 55V36c0-9 7-15 15-15h50c8 0 15 6 15 15v19M32 65h76M45 69v25l7-3 8 3 9-3 9 3 8-3 9 3V69"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="M56 79h26M56 85h17" stroke="currentColor" strokeWidth="2" />
          <circle cx="99" cy="44" r="3" fill="currentColor" />
        </>
      ) : type === "instax" ? (
        <>
          <rect
            x="28"
            y="17"
            width="84"
            height="77"
            rx="15"
            fill="currentColor"
            opacity=".12"
          />
          <path
            d="M40 48V27c0-7 5-12 12-12h37c7 0 12 5 12 12v21M44 52h53M50 51V5h40v46M48 59v34h45V59"
            stroke="currentColor"
            strokeWidth="3"
          />
          <rect
            x="55"
            y="64"
            width="31"
            height="21"
            fill="currentColor"
            opacity=".2"
          />
          <circle cx="91" cy="34" r="3" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d="M29 88V15h80v73M22 90h96M36 78h66M69 16v22M58 39h21v12H58zM69 52v6M37 26h63M48 76l21-16 21 16"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="M48 76h42v10H48z" fill="currentColor" opacity=".2" />
        </>
      )}
    </svg>
  );
}
function App() {
  const storage = useSyncExternalStore(
    subscribeStorageStatus,
    getStorageStatus,
    getStorageStatus,
  );
  const isOwner = location.pathname.startsWith("/owner");
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [boot, setBoot] = useState(true);
  const [bootError, setBootError] = useState("");
  const [live, setLive] = useState(true);
  const bootApp = useCallback(async () => {
    setBoot(true);
    setBootError("");
    try {
      const [h, s] = await Promise.all([
        api<Health>("/health"),
        api<Session | { role: null }>("/session"),
      ]);
      if (
        !s ||
        (s.role !== null &&
          !(
            (s.role === "requester" || s.role === "owner") &&
            typeof s.id === "string" &&
            s.id.length > 0
          ))
      )
        throw new Error(
          "The saved session could not be checked. Try again to keep access to your existing orders.",
        );
      setHealth(h);
      if (s.role === null && !isOwner)
        setSession(await api<Session>("/session", { role: "requester" }));
      else setSession(s.role ? s : null);
    } catch (e) {
      setBootError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }, [isOwner]);
  useEffect(() => {
    void bootApp();
  }, [bootApp]);
  useEffect(() => {
    const timer = setInterval(() => {
      api<Health>("/health")
        .then((h) => {
          setHealth(h);
          setLive(true);
        })
        .catch(() => setLive(false));
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Fabrary home">
          <span className="brand-mark">f</span>fabrary
          <span className="brand-note">the local making counter</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/" aria-current={!isOwner ? "page" : undefined}>
            Make something
          </a>
          <a href="/owner" aria-current={isOwner ? "page" : undefined}>
            Owner workshop
          </a>
        </nav>
      </header>
      <div className="modebar">
        <span className="mode-dot" />
        <strong>
          {!health
            ? "Connecting to workshop"
            : health.mode === "hardware"
              ? "Hardware mode"
              : "Simulation mode"}
        </strong>
        <span>
          {!health
            ? "Checking payment mode"
            : health.paymentMode === "testnet"
              ? "Base Sepolia test payments"
              : "Mock payments · no money moves"}
        </span>
        <span className="mode-detail">
          {!health
            ? "Checking storage"
            : health.store === "spacetimedb"
              ? "SpacetimeDB connected"
              : "Local development storage"}
        </span>
        {!live && (
          <strong className="connection-alert">
            Connection lost · retrying
          </strong>
        )}
      </div>
      <main id="main" tabIndex={-1}>
        {(storage.local === "unavailable" ||
          storage.session === "unavailable") && (
          <div className="storage-note">
            <Notice>
              Browser storage is unavailable. Your order selection can only be
              kept in this tab.
              {storage.session === "unavailable" &&
                " Wallet payments and physical calibration wait until retry details can be saved. You can still review existing orders."}
            </Notice>
          </div>
        )}
        {boot ? (
          <div className="loading-shell">
            <span className="spinner" /> Opening the workshop…
          </div>
        ) : bootError ? (
          <div className="error-shell">
            <h1>The workshop is offline.</h1>
            <p role="alert">{bootError}</p>
            <Button onClick={bootApp}>Try again</Button>
          </div>
        ) : isOwner ? (
          <OwnerApp
            key={
              session ? `${session.role}:${session.id}` : "owner-session-ended"
            }
            session={session}
            setSession={(next) =>
              setSession((active) => (active === session ? next : active))
            }
            health={health}
          />
        ) : (
          <RequesterApp
            key={
              session
                ? `${session.role}:${session.id}`
                : "requester-session-ended"
            }
            session={session}
            setSession={(next) =>
              setSession((active) => (active === session ? next : active))
            }
            health={health}
          />
        )}
      </main>
      <footer className="site-footer">
        <span>Made locally. Handled by a person.</span>
        <span>
          Three device paths. Hardware acceptance remains unverified until
          recorded.
        </span>
        <a href="/owner">Open owner workshop</a>
      </footer>
    </>
  );
}

function RequesterApp({
  session,
  setSession,
  health,
}: {
  session: Session | null;
  setSession: (s: Session | null) => void;
  health: Health | null;
}) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [current, setCurrent] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [unresolvedCreation, setUnresolvedCreation] = useState(false);
  const [editingBaseline, setEditingBaseline] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const recoveryContext = useRef(0);
  const recoveryInteraction = useRef(0);
  const ordersSection = useRef<HTMLElement>(null);
  // Keep empty and incomplete native number input text until submission.
  // Converting every keystroke turns a cleared field (or "5e") into zero.
  type SpecDraft = Omit<Spec, "widthMm" | "heightMm" | "quantity"> & {
    widthMm: number | string;
    heightMm: number | string;
    quantity: number | string;
  };
  const [spec, setSpec] = useState<SpecDraft>({
    assetIds: [],
    intent: "",
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "authorized",
    crop: "contain",
  });
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [budget, setBudget] = useState("3.00");
  const numericSpec: Spec = {
    ...spec,
    widthMm: Number(spec.widthMm),
    heightMm: Number(spec.heightMm),
    quantity: Number(spec.quantity),
  };
  const pristineDraft = useRef(spec);
  const draftSignature = (value: SpecDraft) =>
    JSON.stringify([
      value.assetIds,
      value.intent,
      value.outputType,
      value.widthMm === "" ? "" : Number(value.widthMm),
      value.heightMm === "" ? "" : Number(value.heightMm),
      value.quantity === "" ? "" : Number(value.quantity),
      value.material,
      value.permission,
      value.crop,
      value.budgetMandate?.enabled === true,
      value.budgetMandate?.capCents ?? null,
      value.preparedModelId ?? null,
      value.depthMm ?? null,
      value.color ?? null,
      value.estimatedSeconds ?? null,
    ]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [editing, setEditing] = useState(false);
  const unsavedDraft =
    (!current || editing) &&
    draftSignature({
      ...spec,
      budgetMandate: budgetEnabled
        ? { enabled: true, capCents: Math.round(Number(budget) * 100) }
        : undefined,
    }) !==
      draftSignature(editing && current ? current.spec : pristineDraft.current);
  const confirmLeaving = Boolean(busy) || unsavedDraft;
  useEffect(() => {
    if (!confirmLeaving || session?.role !== "requester") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [confirmLeaving, session?.role]);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [intakeError, setIntakeError] = useState("");
  const [loadedPreview, setLoadedPreview] = useState<string | null>(null);
  const [previewVisit, setPreviewVisit] = useState(0);
  const previewContext = current?.artifact
    ? JSON.stringify([
        current.id,
        current.artifact.id,
        current.artifact.sha256,
        current.artifact.previewUrl || current.artifact.url,
        previewVisit,
      ])
    : null;
  const previewReady = Boolean(
    current?.artifact?.sha256 && loadedPreview === previewContext,
  );
  const selectedId = useRef<string | null>(
    readStoredValue("local", "fabrary-current-job"),
  );
  const jobsGate = useRef(snapshotGate());
  const machinesGate = useRef(snapshotGate());
  const [refreshing, setRefreshing] = useState(true);
  const [connected, setConnected] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateSnapshots(jobsGate.current);
      invalidateSnapshots(machinesGate.current);
    };
  }, []);
  const productionHeading = useRef<HTMLHeadingElement>(null);
  const focusProduction = () => {
    const initiatingElement = document.activeElement;
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      const activeElement = document.activeElement;
      if (
        activeElement !== initiatingElement &&
        activeElement !== document.body
      )
        return;
      productionHeading.current?.focus();
    });
  };
  const refresh = useCallback(async () => {
    if (!mounted.current || session?.role !== "requester") return false;
    const request = ++jobsGate.current.issued;
    machinesGate.current.issued = Math.max(
      machinesGate.current.issued,
      request,
    );
    try {
      const [m, j] = await Promise.all([
        api<{ machines: Machine[]; revision?: number }>("/machines"),
        api<{ jobs: Job[]; revision?: number }>("/jobs"),
      ]);
      if (!mounted.current) return false;
      const freshMachines = acceptSnapshot(
        machinesGate.current,
        request,
        m.revision,
      );
      const freshJobs = acceptSnapshot(jobsGate.current, request, j.revision);
      if (!freshMachines && !freshJobs) return true;
      if (freshMachines) setMachines(m.machines);
      if (freshJobs) setJobs(j.jobs);
      setConnected(true);
      if (freshJobs && selectedId.current) {
        const found = j.jobs.find((x) => x.id === selectedId.current);
        if (found)
          setCurrent((old) =>
            old?.id === found.id && old.version > found.version ? old : found,
          );
      }
      return true;
    } catch (error) {
      if (!mounted.current || !currentSnapshotError(jobsGate.current, request))
        return false;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        selectedId.current = null;
        removeStoredValue("local", "fabrary-current-job");
        setCurrent(null);
        setJobs([]);
        setSession(null);
        setError(
          "Your requester session expired. Open a requester session to continue.",
        );
      }
      setConnected(false);
      return false;
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (session?.role !== "requester") return;
    const events = new EventSource("/api/events");
    events.addEventListener("refresh", () => {
      void refresh();
    });
    events.onmessage = () => {
      void refresh();
    };
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [refresh, session?.role]);
  useEffect(() => {
    api<{ models?: CatalogItem[]; items?: CatalogItem[] }>("/catalog")
      .then((x) => setCatalog(x.models || x.items || []))
      .catch(() => {});
  }, []);
  const select = (job: Job) => {
    if (!mounted.current) return;
    recoveryContext.current++;
    setEditingBaseline(null);
    setEditConflict(false);
    setPreviewVisit((visit) => visit + 1);
    invalidateSnapshots(jobsGate.current);
    selectedId.current = job.id;
    writeStoredValue("local", "fabrary-current-job", job.id);
    setCurrent((old) =>
      old?.id === job.id && old.version > job.version ? old : job,
    );
    setJobs((old) =>
      old.some((item) => item.id === job.id)
        ? old.map((item) =>
            item.id === job.id && item.version < job.version ? job : item,
          )
        : [job, ...old],
    );
    // Uploaded replacements and model suggestions belong to the editing
    // context that produced them, never another selected or saved order.
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setEditing(false);
    setError("");
    setUnresolvedCreation(false);
  };
  const checkSavedOrders = async () => {
    const initiatingElement = document.activeElement;
    const context = recoveryContext.current;
    const interaction = recoveryInteraction.current;
    if (!(await refresh())) return;
    requestAnimationFrame(() => {
      if (
        !mounted.current ||
        context !== recoveryContext.current ||
        interaction !== recoveryInteraction.current
      )
        return;
      const activeElement = document.activeElement;
      if (
        activeElement !== initiatingElement &&
        activeElement !== document.body
      )
        return;
      const target =
        ordersSection.current?.querySelector<HTMLElement>(
          ".order-row:not(:disabled)",
        ) || ordersSection.current?.querySelector<HTMLElement>("h2");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  };
  const act = async (name: string, fn: () => Promise<void>) => {
    invalidateSnapshots(jobsGate.current);
    invalidateSnapshots(machinesGate.current);
    setBusy(name);
    setError("");
    try {
      await fn();
      if (mounted.current) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const jobAction = (action: string, body: unknown = {}) => {
    if (!current) return;
    void act(action, async () => {
      if (action === "checkout")
        body = { ...(body as object), idempotencyKey: checkoutKey(current) };
      const { job } =
        action === "checkout" && current.quote?.paymentMode === "testnet"
          ? await (
              await import("./wallet")
            ).checkoutWithWallet<{ job: Job }>({
              jobId: current.id,
              quote: current.quote,
              idempotencyKey: checkoutKey(current),
            })
          : await api<{ job: Job }>(`/jobs/${current.id}/${action}`, body);
      select(job);
    });
  };
  const changeOutput = (type: Output) => {
    setIntakeDraft(null);
    setIntakeError("");
    setSpec((s) => ({
      ...s,
      outputType: type,
      quantity:
        type === "3d"
          ? 1
          : Number.isInteger(Number(s.quantity)) && Number(s.quantity) > 0
            ? Math.min(Number(s.quantity), type === "instax" ? 3 : 10)
            : 1,
      widthMm: type === "instax" ? 54 : 53,
      heightMm: type === "instax" ? 86 : 50,
      material:
        type === "instax"
          ? "photo-film"
          : type === "3d"
            ? "pla"
            : "thermal-paper",
      preparedModelId: undefined,
      depthMm: undefined,
      color: undefined,
      estimatedSeconds: undefined,
      assetIds:
        type === "3d"
          ? []
          : s.outputType !== "3d"
            ? s.assetIds
            : assets.length
              ? assets.map((asset) => asset.id)
              : current?.spec.outputType !== "3d"
                ? current?.spec.assetIds || []
                : [],
    }));
    setError("");
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length > 4) {
      setError("Choose up to four images for one order.");
      return;
    }
    const list = Array.from(files);
    if (
      list.some(
        (f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      setError(
        "Choose PNG, JPEG, or WebP images. Other files cannot be printed through this upload.",
      );
      return;
    }
    await act("upload", async () => {
      const form = new FormData();
      list.forEach((file) => form.append("images", file));
      const result = await api<{ assets: Asset[] }>("/uploads", form);
      setAssets(result.assets);
      setIntakeDraft(null);
      setIntakeError("");
      setSpec((s) => ({ ...s, assetIds: result.assets.map((a) => a.id) }));
    });
  };
  const suggestSpecification = async () => {
    setBusy("intake");
    setIntakeError("");
    setError("");
    try {
      const { draft } = await api<{ draft: IntakeDraft }>("/intake", {
        assetIds: spec.assetIds,
        intent: spec.intent,
      });
      setIntakeDraft(draft);
      if (draft.outputType === "3d") {
        setIntakeError(
          "Images cannot be converted into a 3D print here. Choose an owner-inspected prepared model separately, or keep entering an image output specification below.",
        );
        if (draft.contentReview === "review")
          setSpec((current) => ({ ...current, permission: "unclear" }));
        return;
      }
      setSpec((current) => {
        const outputType = draft.outputType || current.outputType;
        const changed = outputType !== current.outputType;
        const defaults = changed
          ? {
              widthMm: outputType === "instax" ? 54 : 53,
              heightMm: outputType === "instax" ? 86 : 50,
              material:
                outputType === "instax" ? "photo-film" : "thermal-paper",
            }
          : {};
        const base = { ...current, ...defaults, outputType };
        return {
          ...base,
          widthMm: draft.widthMm ?? base.widthMm,
          heightMm: draft.heightMm ?? base.heightMm,
          quantity: draft.quantity ?? base.quantity,
          material: draft.material ?? base.material,
          crop: draft.crop,
          permission:
            draft.contentReview === "review" ? "unclear" : current.permission,
        };
      });
    } catch (error) {
      setIntakeError(
        (error as ApiError).status === 503
          ? "Specification suggestions are unavailable in this workshop. Enter the fields manually below; production preview and checkout still work."
          : (error as Error).message,
      );
    } finally {
      setBusy("");
    }
  };
  const validSavedJob = (value: unknown): value is Job => {
    const returned = value as Job | null | undefined;
    return !(
      !returned ||
      typeof returned.id !== "string" ||
      !returned.id ||
      !Number.isSafeInteger(returned.version) ||
      returned.version < 1 ||
      !Number.isSafeInteger(returned.specVersion) ||
      returned.specVersion < 1 ||
      !returned.artifact ||
      ![
        returned.artifact.id,
        returned.artifact.url,
        returned.artifact.sha256,
      ].every(
        (field) => typeof field === "string" && field.trim().length > 0,
      ) ||
      (returned.artifact.previewUrl !== undefined &&
        typeof returned.artifact.previewUrl !== "string") ||
      !Array.isArray(returned.history) ||
      !returned.history.every(
        (event) =>
          event &&
          typeof event === "object" &&
          [event.at, event.event].every((field) => typeof field === "string") &&
          (event.reason === undefined || typeof event.reason === "string"),
      ) ||
      !returned.spec ||
      !Array.isArray(returned.spec.assetIds) ||
      !returned.spec.assetIds.every((id) => typeof id === "string") ||
      typeof returned.spec.intent !== "string" ||
      typeof returned.spec.material !== "string" ||
      !["contain", "cover"].includes(returned.spec.crop) ||
      !["authorized", "unclear"].includes(returned.spec.permission) ||
      !Object.hasOwn(outputLabels, returned.spec.outputType) ||
      ![
        returned.spec.widthMm,
        returned.spec.heightMm,
        returned.spec.quantity,
      ].every((value) => Number.isFinite(value) && value > 0) ||
      ![
        returned.productionState,
        returned.paymentState,
        returned.fulfillmentState,
        returned.createdAt,
        returned.updatedAt,
      ].every((value) => typeof value === "string")
    );
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unresolvedCreation || editConflict) return;
    if (spec.outputType !== "3d" && !spec.assetIds.length) {
      setError("Add at least one image before making a production preview.");
      return;
    }
    if (spec.outputType === "3d" && !spec.preparedModelId) {
      setError(
        "Choose an owner-prepared model. Photo-to-3D is planned and is not available.",
      );
      return;
    }
    if (spec.outputType === "3d" && !completePreparedModel(numericSpec)) {
      setError(
        "This prepared model needs inspected overall dimensions, a single color and an estimated machine time before it can be approved.",
      );
      return;
    }
    if (
      [numericSpec.widthMm, numericSpec.heightMm, numericSpec.quantity].some(
        (value) => !Number.isInteger(value) || value <= 0,
      )
    ) {
      setError("Enter positive whole numbers for width, height and quantity.");
      return;
    }
    if (
      budgetEnabled &&
      (!Number.isFinite(Number(budget)) || Number(budget) <= 0)
    ) {
      setError("Set a positive budget cap in dollars.");
      return;
    }
    const value: Spec = {
      ...numericSpec,
      budgetMandate: budgetEnabled
        ? { enabled: true as const, capCents: Math.round(Number(budget) * 100) }
        : undefined,
    };
    await act("create", async () => {
      let result: { job: Job };
      try {
        result = await api<{ job: Job }>(
          editing && current ? `/jobs/${current.id}/spec` : "/jobs",
          value,
          editing ? "PATCH" : undefined,
          editing && current && editingBaseline?.id === current.id
            ? { headers: { "If-Match": `"${editingBaseline.version}"` } }
            : undefined,
        );
        if (!validSavedJob(result?.job))
          throw new ApiError(
            "The order response could not be read. Its result is unknown; check saved orders before trying again.",
            "invalid_response",
            0,
            true,
          );
      } catch (error) {
        if (
          editing &&
          error instanceof ApiError &&
          error.code === "STALE_SPECIFICATION"
        ) {
          setEditConflict(true);
          void refresh();
        }
        if (!editing && error instanceof ApiError && error.outcomeUnknown) {
          setUnresolvedCreation(true);
          void refresh();
        }
        throw error;
      }
      select(result.job);
      setEditing(false);
      focusProduction();
    });
  };
  const newOrder = () => {
    recoveryContext.current++;
    setEditingBaseline(null);
    setEditConflict(false);
    setUnresolvedCreation(false);
    selectedId.current = null;
    removeStoredValue("local", "fabrary-current-job");
    setCurrent(null);
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setSpec({
      assetIds: [],
      intent: "",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    });
    setBudgetEnabled(false);
    setEditing(false);
    setError("");
    focusProduction();
  };
  const cancelEdit = () => {
    recoveryContext.current++;
    setEditingBaseline(null);
    setEditConflict(false);
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    if (current) setSpec(current.spec);
    setEditing(false);
    setError("");
  };
  const beginEdit = (job: Job) => {
    if (!mounted.current) return;
    recoveryContext.current++;
    setEditingBaseline({ id: job.id, version: job.version });
    setEditConflict(false);
    setPreviewVisit((visit) => visit + 1);
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setSpec(job.spec);
    setBudgetEnabled(Boolean(job.spec.budgetMandate?.enabled));
    setBudget(String((job.spec.budgetMandate?.capCents || 300) / 100));
    setEditing(true);
    setError("");
    focusProduction();
  };
  const edit = () => {
    if (current) beginEdit(current);
  };
  const useSavedSpecification = () => {
    if (!current) return;
    void act("load-specification", async () => {
      const { job } = await api<{ job: Job }>(`/jobs/${current.id}`);
      if (!validSavedJob(job) || job.id !== current.id)
        throw new Error(
          "The saved specification could not be confirmed. Your draft is kept; refresh before adopting it.",
        );
      select(job);
      beginEdit(job);
    });
  };
  const readyCount = machines.filter(available).length;
  if (session?.role !== "requester")
    return (
      <div className="error-shell">
        <h1>Make something here.</h1>
        <p>
          {session?.role === "owner"
            ? "Your current session is an owner session. Open a requester session to create and view your own orders."
            : "Your requester session ended. Open a requester session to prepare artwork and place an order."}
        </p>
        <Button
          onClick={() =>
            act("session", async () => {
              const next = await api<Session>("/session", {
                role: "requester",
              });
              if (mounted.current) setSession(next);
            })
          }
          busy={busy === "session"}
        >
          Open requester session
        </Button>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    );
  return (
    <div
      className="requester"
      onFocusCapture={() => {
        recoveryInteraction.current++;
      }}
      onInputCapture={() => {
        recoveryInteraction.current++;
      }}
    >
      <section className="intro">
        <div>
          <p className="quiet">
            Your artwork, a nearby machine, a real handoff.
          </p>
          <h1>
            Small things.
            <br />
            Made here.
          </h1>
          <p className="intro-description">
            Turn an image into a monochrome sticker or an instant photo. Check
            the production preview before you pay, then collect it from the
            workshop.
          </p>
        </div>
        <div className="counter-note">
          <span className="counter-number">
            {refreshing ? "…" : readyCount}
          </span>
          <div>
            machines available
            <span>
              {health?.mode === "hardware"
                ? "Connected hardware"
                : "Simulated workshop"}
              <br />
              Pickup at the owner’s collection point
            </span>
          </div>
          <span className="note-pin" />
        </div>
      </section>
      {!connected && (
        <Notice kind="error">
          Live updates are disconnected. The last saved status is shown.{" "}
          <button className="text-button" onClick={refresh}>
            Refresh now
          </button>
        </Notice>
      )}
      {error && (
        <Notice kind="error" focusOnShow>
          {error}
        </Notice>
      )}
      {editConflict && (
        <Notice>
          A newer version of this order is saved. Your draft is kept here. Load
          the saved specification, then reapply the changes you want.
          <button
            type="button"
            className="text-button"
            disabled={Boolean(busy)}
            onClick={useSavedSpecification}
          >
            Use saved specification
          </button>
        </Notice>
      )}
      {unresolvedCreation && (
        <Notice>
          The earlier order request may still finish. Check your saved orders
          below and open the existing order before continuing. This draft will
          not be submitted again automatically.
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void checkSavedOrders();
              }}
            >
              Check saved orders
            </button>
            <button type="button" className="text-button" onClick={newOrder}>
              Discard interrupted draft
            </button>
          </div>
        </Notice>
      )}
      <div className="workbench">
        <section className="intake-panel">
          <div className="panel-heading">
            <h2 ref={productionHeading} tabIndex={-1}>
              {current && !editing
                ? "Your production file"
                : editing
                  ? "Revise your order"
                  : "What are we making?"}
            </h2>
            {current && (
              <button
                className="text-button"
                onClick={newOrder}
                disabled={Boolean(busy)}
              >
                New order
              </button>
            )}
          </div>
          {current && !editing ? (
            <>
              <ProductionPreview
                key={previewContext}
                job={current}
                onReady={(ready) =>
                  setLoadedPreview(ready ? previewContext : null)
                }
              />
              {current.spec.outputType === "3d" && (
                <PreparedModelFacts details={current.spec} />
              )}
              <div className="spec-strip">
                <span>{outputLabels[current.spec.outputType]}</span>
                <span>
                  {current.spec.widthMm} × {current.spec.heightMm}
                  {current.spec.outputType === "3d"
                    ? ` × ${current.spec.depthMm}`
                    : ""}{" "}
                  mm
                </span>
                <span>Qty {current.spec.quantity}</span>
                <span>{human(current.spec.material)}</span>
              </div>
              <p className="order-intent">{current.spec.intent}</p>
              {["specified", "approved", "quoted"].includes(
                current.productionState,
              ) &&
                current.paymentState === "unpaid" && (
                  <button
                    className="secondary"
                    onClick={edit}
                    disabled={Boolean(busy)}
                  >
                    Edit artwork or specifications
                  </button>
                )}
              <small className="hash-note">
                Production file fingerprint{" "}
                {current.artifact?.sha256?.slice(0, 16) || "unavailable"} ·
                specification v{current.specVersion}
              </small>
            </>
          ) : (
            <form onSubmit={submit} aria-busy={Boolean(busy)}>
              <fieldset disabled={Boolean(busy)} className="intake-fields">
                <fieldset className="output-picker">
                  <legend className="sr-only">Choose an output</legend>
                  {(["sticker", "instax", "3d"] as Output[]).map((type) => (
                    <label
                      className={`output-choice ${spec.outputType === type ? "selected" : ""}`}
                      key={type}
                    >
                      <input
                        type="radio"
                        name="output"
                        value={type}
                        checked={spec.outputType === type}
                        onChange={() => changeOutput(type)}
                      />
                      <DeviceArt type={type} />
                      <strong>{outputLabels[type]}</strong>
                      <span>
                        {type === "sticker"
                          ? "Phomemo M02Pro"
                          : type === "instax"
                            ? "Instax Mini Link 3"
                            : "Bambu A1 mini"}
                      </span>
                    </label>
                  ))}
                </fieldset>
                {spec.outputType === "3d" ? (
                  <div className="prepared-model">
                    <Notice>
                      Prepared decorative files only. Photo-to-3D and functional
                      parts are not supported. This hardware path is unverified.
                    </Notice>
                    {spec.preparedModelId && (
                      <PreparedModelFacts details={numericSpec} />
                    )}
                    {catalog.length ? (
                      <Field label="Owner-prepared model">
                        <select
                          required
                          value={spec.preparedModelId || ""}
                          onChange={(e) => {
                            const item = catalog.find(
                              (x) => x.id === e.target.value,
                            );
                            setSpec((s) => ({
                              ...s,
                              preparedModelId: item?.id,
                              assetIds: item ? [item.artifactId] : [],
                              widthMm: item?.widthMm || 0,
                              heightMm: item?.heightMm || 0,
                              depthMm: item?.depthMm,
                              color: item?.color,
                              estimatedSeconds: item?.estimatedSeconds,
                              material: item?.material || "pla",
                            }));
                          }}
                        >
                          <option value="">Choose a prepared model</option>
                          {catalog.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : (
                      <p>
                        No prepared models are configured. Ask the owner to add
                        a tested model before ordering a 3D print.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <label
                      className={`upload-zone ${busy === "upload" ? "uploading" : ""}`}
                    >
                      <input
                        aria-label="Upload artwork"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={(e) => {
                          void upload(e.target.files);
                          e.target.value = "";
                        }}
                        disabled={Boolean(busy)}
                      />
                      <span className="upload-symbol">＋</span>
                      <strong>
                        {busy === "upload"
                          ? "Uploading artwork…"
                          : assets.length
                            ? "Replace artwork"
                            : "Add your artwork"}
                      </strong>
                      <span>PNG, JPEG or WebP · up to 4 images</span>
                    </label>
                    {(assets.length > 0 || editing) && (
                      <div className="originals">
                        {assets.map((a) => (
                          <figure key={a.id}>
                            <img src={a.url} alt="Uploaded original artwork" />
                            <figcaption>
                              Original · {a.width} × {a.height} px
                            </figcaption>
                          </figure>
                        ))}
                        {editing && !assets.length && (
                          <p>
                            The existing artwork stays selected. Upload images
                            to replace it.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="context-note">
                      {spec.outputType === "sticker"
                        ? "Thermal paper prints in black and white. The next step shows the exact prepared file."
                        : "Instax uses fixed 54 × 86 mm film. Hardware compatibility and film development remain unverified."}
                    </p>
                  </>
                )}
                <Field label="What is it for?">
                  <textarea
                    required
                    rows={2}
                    maxLength={600}
                    value={spec.intent}
                    onChange={(e) => {
                      const intent = e.currentTarget.value;
                      setIntakeDraft(null);
                      setSpec((s) => ({ ...s, intent }));
                    }}
                    placeholder="A club sticker for our next tabling event"
                  />
                </Field>
                {spec.outputType !== "3d" && (
                  <section
                    className="intake-suggestion"
                    aria-label="Specification suggestions"
                  >
                    <div className="suggestion-action">
                      <Button
                        className="secondary"
                        type="button"
                        busy={busy === "intake"}
                        disabled={
                          Boolean(busy) ||
                          !spec.assetIds.length ||
                          spec.intent.trim().length < 3
                        }
                        onClick={() => {
                          void suggestSpecification();
                        }}
                      >
                        Suggest specification
                      </Button>
                      <small>
                        Upload artwork and describe it first. You can also enter
                        every field manually.
                      </small>
                    </div>
                    {intakeError && <Notice>{intakeError}</Notice>}
                    {intakeDraft && (
                      <div className="suggested-draft">
                        <h3>Suggested specification</h3>
                        <p>{intakeDraft.reason}</p>
                        {intakeDraft.questions.length > 0 && (
                          <>
                            <h4>Clarify these together</h4>
                            <ul>
                              {intakeDraft.questions.map((question, index) => (
                                <li key={index}>{question}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        <small>
                          Review the suggested values below. Suggestions do not
                          authorize artwork or approve a production file;
                          machine validation still applies.
                        </small>
                      </div>
                    )}
                  </section>
                )}
                <div className="form-grid">
                  <Field label="Width (mm)">
                    <input
                      type="number"
                      required
                      min="1"
                      max="300"
                      disabled={spec.outputType !== "sticker"}
                      value={spec.widthMm}
                      onChange={(e) => {
                        const widthMm = e.currentTarget.value;
                        setSpec((s) => ({
                          ...s,
                          widthMm,
                        }));
                      }}
                    />
                  </Field>
                  <Field label="Height (mm)">
                    <input
                      type="number"
                      required
                      min="1"
                      max="300"
                      disabled={spec.outputType !== "sticker"}
                      value={spec.heightMm}
                      onChange={(e) => {
                        const heightMm = e.currentTarget.value;
                        setSpec((s) => ({
                          ...s,
                          heightMm,
                        }));
                      }}
                    />
                  </Field>
                  <Field label="Quantity">
                    <input
                      type="number"
                      required
                      min="1"
                      max={
                        spec.outputType === "instax"
                          ? 3
                          : spec.outputType === "3d"
                            ? 1
                            : 10
                      }
                      step="1"
                      value={spec.quantity}
                      onChange={(e) => {
                        const quantity = e.currentTarget.value;
                        setSpec((s) => ({
                          ...s,
                          quantity,
                        }));
                      }}
                    />
                  </Field>
                  <Field label="Image placement">
                    <select
                      value={spec.crop}
                      onChange={(e) => {
                        const crop = e.currentTarget.value as Spec["crop"];
                        setSpec((s) => ({
                          ...s,
                          crop,
                        }));
                      }}
                      disabled={spec.outputType === "3d"}
                    >
                      <option value="contain">Fit whole image</option>
                      <option value="cover">Fill and crop edges</option>
                    </select>
                  </Field>
                </div>
                <Field label="Material">
                  <select
                    value={spec.material}
                    onChange={(e) => {
                      const material = e.currentTarget.value;
                      setSpec((s) => ({ ...s, material }));
                    }}
                  >
                    <option
                      value={
                        spec.outputType === "sticker"
                          ? "thermal-paper"
                          : spec.outputType === "instax"
                            ? "photo-film"
                            : "pla"
                      }
                    >
                      {spec.outputType === "sticker"
                        ? "Thermal adhesive paper"
                        : spec.outputType === "instax"
                          ? "Instax mini photo film"
                          : "PLA · prepared decorative print"}
                    </option>
                  </select>
                </Field>
                <Field label="Artwork permission">
                  <select
                    value={spec.permission}
                    onChange={(e) => {
                      const permission = e.currentTarget
                        .value as Spec["permission"];
                      setSpec((s) => ({
                        ...s,
                        permission,
                      }));
                    }}
                  >
                    <option value="authorized">
                      I own this artwork or have permission to print it
                    </option>
                    <option value="unclear">
                      I need the owner to review permission
                    </option>
                  </select>
                </Field>
                <div className="budget-option">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={budgetEnabled}
                      onChange={(e) => setBudgetEnabled(e.target.checked)}
                    />
                    <span>Automatically accept a quote within my budget</span>
                  </label>
                  {budgetEnabled && (
                    <Field
                      label="Budget cap (USD)"
                      hint="Applies only after you approve this specification. Payment still requires checkout."
                    >
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
                <Button
                  className="primary full"
                  type="submit"
                  busy={busy === "create"}
                  disabled={
                    Boolean(busy) ||
                    unresolvedCreation ||
                    editConflict ||
                    (spec.outputType === "3d" && !catalog.length)
                  }
                >
                  {editing
                    ? "Save changes & rebuild preview"
                    : "Make production preview"}
                </Button>
                {editing && (
                  <button
                    className="text-button cancel-edit"
                    type="button"
                    onClick={cancelEdit}
                  >
                    Keep existing specification
                  </button>
                )}
              </fieldset>
            </form>
          )}
        </section>
        <aside className="order-panel" aria-label="Order details">
          {current ? (
            <OrderDetail
              key={current.id}
              job={current}
              busy={editing ? "editing" : busy}
              action={jobAction}
              health={health}
              previewReady={previewReady}
            />
          ) : (
            <>
              <div className="ticket-top">
                <span className="ticket-icon">✳</span>
                <h2>A little more tangible.</h2>
                <p>
                  Start with your artwork. We’ll prepare a file for the selected
                  machine and show you exactly what it will make.
                </p>
              </div>
              <ol className="steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Check your production file</strong>
                    <p>Confirm size, crop and material.</p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Approve the quote</strong>
                    <p>See every cost and a collection point.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Collect your finished item</strong>
                    <p>The owner prepares it for pickup.</p>
                  </div>
                </li>
              </ol>
              <div className="ticket-bottom">
                {health?.mode === "hardware"
                  ? "Physical output requires an owner-ready device."
                  : "This is a simulation. No physical item is produced."}
              </div>
            </>
          )}
        </aside>
      </div>
      <section className="machines-section">
        <div className="section-heading">
          <h2>At the workshop</h2>
          <p>Availability follows calibration, media and owner readiness.</p>
        </div>
        {refreshing ? (
          <p>Loading machines…</p>
        ) : machines.length ? (
          <div className="public-machines">
            {machines.map((machine) => (
              <div className="public-machine" key={machine.id}>
                <DeviceArt type={machine.outputType} />
                <div>
                  <h3>{machine.name}</h3>
                  <span className="machine-model">{machine.model}</span>
                  <p>
                    {available(machine)
                      ? "Ready for an order"
                      : !machine.listed
                        ? "The owner has not listed this machine."
                        : machine.reason ||
                          (machine.paused
                            ? "Owner inspection needed"
                            : "Not ready for orders")}
                  </p>
                  <div className="badge-row">
                    <Badge tone={available(machine) ? "green" : "amber"}>
                      {available(machine) ? "Available" : "Unavailable"}
                    </Badge>
                    <Badge>
                      {machine.mode === "simulation"
                        ? "Simulated device"
                        : "Hardware · unverified"}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>No machines are listed.</h3>
            <p>
              The owner needs to register and calibrate a supported device. You
              can still prepare artwork.
            </p>
          </div>
        )}
      </section>
      <section className="orders-section" ref={ordersSection}>
        <div className="section-heading">
          <h2 tabIndex={-1}>Your orders</h2>
          <span>
            {jobs.length} {jobs.length === 1 ? "order" : "orders"}
          </span>
        </div>
        {jobs.length ? (
          <div className="order-list">
            {[...jobs]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((job) => (
                <button
                  className={`order-row ${current?.id === job.id ? "active" : ""}`}
                  key={job.id}
                  aria-pressed={current?.id === job.id}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    select(job);
                    focusProduction();
                  }}
                >
                  <span>
                    {job.artifact?.url ? (
                      <img
                        src={job.artifact.previewUrl || job.artifact.url}
                        alt=""
                      />
                    ) : (
                      <DeviceArt type={job.spec.outputType} />
                    )}
                  </span>
                  <span>
                    <strong>{outputLabels[job.spec.outputType]}</strong>
                    <small>
                      {shortId(job.id)} · {date(job.createdAt)}
                    </small>
                  </span>
                  <span>
                    <Badge
                      tone={
                        job.productionState === "produced"
                          ? "green"
                          : job.productionState === "failed"
                            ? "red"
                            : "neutral"
                      }
                    >
                      {human(job.productionState)}
                    </Badge>
                    <small>{human(job.fulfillmentState)}</small>
                  </span>
                  <span className="order-cost">
                    {job.quote ? money(job.quote.totalCents) : "No quote"}
                  </span>
                </button>
              ))}
          </div>
        ) : (
          <div className="empty">
            <h3>Your first order starts here.</h3>
            <p>Upload an image above and make a production preview.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type PreparedDetails = {
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  color?: string;
  estimatedSeconds?: number;
  material?: string;
};
function completePreparedModel(details: PreparedDetails) {
  return (
    [
      details.widthMm,
      details.heightMm,
      details.depthMm,
      details.estimatedSeconds,
    ].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    ) && Boolean(details.color?.trim())
  );
}
function PreparedModelFacts({ details }: { details: PreparedDetails }) {
  const size = completePreparedModel(details)
    ? `${details.widthMm} × ${details.heightMm} × ${details.depthMm} mm`
    : "Catalog details incomplete";
  const seconds = details.estimatedSeconds;
  const estimate =
    typeof seconds === "number" && seconds > 0
      ? seconds < 60
        ? `${seconds} seconds`
        : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${Math.round(seconds % 60)} sec` : ""}`
      : "Not configured";
  return (
    <div className="prepared-facts">
      <dl>
        <div>
          <dt>Overall width × height × depth</dt>
          <dd>{size}</dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd>{details.material?.toUpperCase() || "Not configured"}</dd>
        </div>
        <div>
          <dt>Single color</dt>
          <dd>{details.color || "Not configured"}</dd>
        </div>
        <div>
          <dt>Estimated machine time</dt>
          <dd>{estimate}</dd>
        </div>
      </dl>
      <p>
        Fixed to this owner-inspected prepared file. Resizing and recoloring are
        unavailable.
      </p>
    </div>
  );
}
function ProductionPreview({
  job,
  onReady,
}: {
  job: Job;
  onReady: (ready: boolean) => void;
}) {
  const source = job.artifact?.previewUrl || job.artifact?.url;
  const {
    status,
    attempt,
    retryKey,
    loaded,
    failed: failImage,
    retry,
  } = useImageAttempt({
    enabled: Boolean(source),
    onTimeout: () => onReady(false),
  });
  const retryButton = useRef<HTMLButtonElement>(null);
  const previewImage = useRef<HTMLImageElement>(null);
  const failed = status === "failed" || status === "timed-out";
  const loading = Boolean(source && status === "loading");
  return (
    <div
      className={`preview-surface output-${job.spec.outputType}`}
      aria-busy={loading}
    >
      <div className="preview-ruler">{job.spec.widthMm} mm</div>
      {source && !failed && (
        <div className="production-paper">
          <img
            ref={previewImage}
            tabIndex={-1}
            key={`${source}-${attempt}`}
            src={retryImageSource(source, retryKey)}
            alt={`Actual production preview: ${outputLabels[job.spec.outputType]}, ${job.spec.widthMm} by ${job.spec.heightMm} millimeters`}
            onLoad={() => {
              if (!loaded()) return;
              const restoreFocus =
                document.activeElement === retryButton.current;
              onReady(true);
              if (restoreFocus) previewImage.current?.focus();
            }}
            onError={() => {
              if (failImage()) onReady(false);
            }}
          />
        </div>
      )}
      {(!source || failed || (loading && attempt > 0)) && (
        <Notice kind={!source || failed ? "error" : "info"}>
          {!source || failed
            ? status === "timed-out"
              ? "The production preview did not finish loading. Retry the image before approving."
              : "The production preview is unavailable. Load it before approving."
            : "Retrying the production preview. Approval waits for the image to load."}
          {source && (
            <button
              ref={retryButton}
              className="text-button"
              type="button"
              aria-disabled={loading}
              onClick={retry}
            >
              Retry production preview
            </button>
          )}
        </Notice>
      )}
      {loading && (
        <p className="preview-loading" role="status">
          <span className="spinner" aria-hidden="true" /> Loading production
          preview…
        </p>
      )}
      <div className="preview-caption">
        <strong>
          {job.spec.outputType === "sticker"
            ? "Prepared monochrome output"
            : job.spec.outputType === "3d"
              ? "Owner-prepared model preview"
              : "Prepared photo output"}
        </strong>
        <span>
          {job.spec.outputType === "3d"
            ? "Review this fixed prepared model and its overall dimensions, single color and time estimate."
            : "Review the whole image before approval."}
        </span>
      </div>
    </div>
  );
}
function OrderDetail({
  job,
  busy,
  action,
  health,
  previewReady,
}: {
  job: Job;
  busy: string;
  action: (name: string, body?: unknown) => void;
  health: Health | null;
  previewReady: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [receipt, setReceipt] = useState<{
    ledger: Ledger[];
    mode: string;
  } | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  useEffect(() => {
    setCancelConfirm(false);
    setReceipt(null);
    setReceiptError("");
  }, [job.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const q = job.quote;
  const remaining = q ? Math.max(0, new Date(q.expiresAt).getTime() - now) : 0;
  const expired = Boolean(q && remaining === 0);
  const active = ["dispatched", "running", "verifying"].includes(
    job.productionState,
  );
  const canCancel =
    !active &&
    !terminal(job.productionState) &&
    ["unpaid", "held", "collection_pending"].includes(job.paymentState);
  const phase =
    job.productionState === "specified"
      ? 0
      : job.productionState === "approved"
        ? 1
        : job.productionState === "quoted"
          ? 2
          : job.productionState === "payment_confirmed"
            ? 3
            : active
              ? 4
              : job.productionState === "produced"
                ? 5
                : 0;
  const statusText: Record<string, string> = {
    specified: "Check your production file",
    approved: "Production file approved",
    quoted: "Your quote is ready",
    payment_confirmed: "Payment confirmed",
    dispatched: "Sent to the machine",
    running: "Your item is being made",
    verifying: "Checking the result",
    produced: "Production is complete",
    failed: "Production needs attention",
    needs_review: "An owner review is needed",
    cancelled: "This order was cancelled",
  };
  return (
    <>
      <div className="ticket-heading">
        <span>Order {shortId(job.id)}</span>
        <Badge
          tone={
            job.productionState === "produced"
              ? "green"
              : ["failed", "needs_review"].includes(job.productionState)
                ? "amber"
                : "neutral"
          }
        >
          {human(job.productionState)}
        </Badge>
      </div>
      <h2 className="ticket-title">
        {statusText[job.productionState] || human(job.productionState)}
      </h2>
      <div
        className="phase-line"
        aria-label={`Production step ${Math.min(phase + 1, 6)} of 6`}
      >
        {["File", "Approve", "Quote", "Pay", "Make", "Result"].map((s, i) => (
          <span className={i <= phase ? "reached" : ""} key={s}>
            {s}
          </span>
        ))}
      </div>
      <dl className="state-facts">
        <div>
          <dt>Production</dt>
          <dd>{human(job.productionState)}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>{human(job.paymentState)}</dd>
        </div>
        <div>
          <dt>Collection</dt>
          <dd>{human(job.fulfillmentState)}</dd>
        </div>
      </dl>
      {job.productionState === "specified" && (
        <div className="ticket-action">
          {job.spec.outputType === "3d" && (
            <PreparedModelFacts details={job.spec} />
          )}
          <p>
            {job.spec.outputType === "3d"
              ? "Confirm the prepared model, overall dimensions, material, single color and estimated machine time below. Approval binds this fixed production file to these specifications."
              : "Does the preview show the size, crop and artwork you want? Approval binds this production file to your specification."}
          </p>
          <Button
            className="primary full"
            busy={busy === "approve"}
            disabled={Boolean(busy) || !job.artifact?.sha256 || !previewReady}
            onClick={() =>
              action("approve", {
                artifactSha256: job.artifact?.sha256,
                specVersion: job.specVersion,
              })
            }
          >
            Approve production file
          </Button>
        </div>
      )}
      {job.productionState === "approved" && (
        <div className="ticket-action">
          <p>
            The next step reserves a ready machine and gives you an itemized
            quote.
          </p>
          <Button
            className="primary full"
            busy={busy === "quote"}
            disabled={Boolean(busy)}
            onClick={() =>
              action("quote", {
                autoAccept: Boolean(job.spec.budgetMandate?.enabled),
              })
            }
          >
            Get a quote
          </Button>
        </div>
      )}
      {q && (
        <div className="quote">
          <div className="quote-head">
            <h3>Order quote</h3>
            <Badge>
              {q.paymentMode === "testnet" ? "Testnet" : "Mock payment"}
            </Badge>
          </div>
          {q.items.map((item, index) => (
            <div className="price-line" key={index}>
              <span>{item.label}</span>
              <span>{money(item.cents)}</span>
            </div>
          ))}
          <div className="price-line total">
            <strong>Total</strong>
            <strong>{money(q.totalCents)}</strong>
          </div>
          <div className="quote-allocation">
            <span>Owner receives {money(q.ownerCents)}</span>
            <span>Platform {money(q.platformCents)}</span>
          </div>
          {q.accepted && job.spec.budgetMandate?.enabled && (
            <p className="mandate-confirmation">
              Accepted within your explicit budget of{" "}
              {money(job.spec.budgetMandate.capCents)}. Checkout still requires
              your confirmation.
            </p>
          )}
          <p className="collection-line">
            Collect at <strong>{q.collectionPoint}</strong>
          </p>
          {job.productionState === "quoted" &&
            job.paymentState === "unpaid" && (
              <>
                {expired ? (
                  <Notice kind="error">
                    This quote expired. Request a new quote to check
                    availability and pricing again.
                  </Notice>
                ) : (
                  <p className="expiry">
                    Reserved for {Math.floor(remaining / 60000)}:
                    {String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}
                  </p>
                )}
                <Button
                  className="primary full"
                  disabled={Boolean(busy)}
                  busy={busy === (expired ? "quote" : "checkout")}
                  onClick={() =>
                    expired
                      ? action("quote", { autoAccept: false })
                      : action("checkout")
                  }
                >
                  {expired
                    ? "Refresh expired quote"
                    : q.paymentMode === "testnet"
                      ? `Pay ${money(q.totalCents)} on testnet`
                      : `Confirm mock payment · ${money(q.totalCents)}`}
                </Button>
                <p className="fine-print">
                  {q.paymentMode === "testnet"
                    ? "Connect your browser wallet on Base Sepolia and sign a test USDC authorization. The platform-managed test hold starts only after settlement is confirmed."
                    : "Simulation checkout records a mock hold. No money moves."}
                </p>
              </>
            )}
        </div>
      )}
      {job.productionState === "payment_confirmed" && (
        <div className="ticket-action">
          <p>Your payment is held. Start production when you are ready.</p>
          <Button
            className="primary full"
            busy={busy === "dispatch"}
            disabled={Boolean(busy)}
            onClick={() => action("dispatch")}
          >
            Start production
          </Button>
        </div>
      )}
      {active && (
        <Notice>
          <span className="spinner" />{" "}
          {job.productionState === "verifying"
            ? "Waiting for fresh result evidence."
            : "The machine is working. Status updates automatically."}{" "}
          Production cannot be cancelled here after dispatch.
        </Notice>
      )}
      {job.paymentState === "collection_pending" && (
        <Notice>
          Payment collection is pending. A wallet signature is not a confirmed
          payment. Production waits for settlement; status updates
          automatically.
        </Notice>
      )}
      {job.paymentState === "refund_pending" && (
        <Notice>
          Your refund is pending. It is complete only after the payment adapter
          confirms the transaction.
        </Notice>
      )}
      {job.paymentState === "refunded" && (
        <Notice kind="success">
          {health?.paymentMode === "mock"
            ? "Mock refund recorded. No money moved."
            : "Refund confirmed."}
        </Notice>
      )}
      {job.paymentState === "release_pending" && (
        <Notice>The owner payout is pending confirmation.</Notice>
      )}
      {job.productionState === "needs_review" && (
        <Notice>
          {job.spec.permission === "unclear" && !job.attemptId
            ? "The owner needs to review artwork permission. After review, approve the production file before checkout."
            : "An uncertain completion or ambiguous result needs owner review. A new print will not start automatically."}
        </Notice>
      )}
      {job.productionState === "failed" && (
        <Notice kind="error">
          This output did not pass verification. The owner can inspect the
          recorded reason and handle recovery.
        </Notice>
      )}
      {job.evidence && (
        <div className="evidence">
          <div className="quote-head">
            <h3>Result evidence</h3>
            <Badge
              tone={
                job.evidence.result === "pass"
                  ? "green"
                  : job.evidence.result === "fail"
                    ? "red"
                    : "amber"
              }
            >
              {human(job.evidence.result)}
            </Badge>
          </div>
          {job.evidence.url ? (
            <ResultImage
              src={job.evidence.url}
              frameKey={JSON.stringify([
                job.id,
                job.attemptId,
                job.evidence.jobId,
                job.evidence.machineId,
                job.evidence.capturedAt,
                job.evidence.source,
              ])}
              alt={`Result evidence for order ${shortId(job.id)}`}
            />
          ) : (
            <Notice>
              No usable result frame was recorded. The owner must inspect this
              outcome.
            </Notice>
          )}
          <p>{job.evidence.reason}</p>
          <small>
            {job.evidence.source === "simulation"
              ? "Simulated evidence"
              : "Camera frame"}{" "}
            · {date(job.evidence.capturedAt)}
            <br />
            Machine {job.evidence.machineId} · completion{" "}
            {job.evidence.completionCredible ? "credible" : "unconfirmed"}
          </small>
          <p className="fine-print">
            Visible output check only. This does not certify dimensions or
            material properties.
          </p>
        </div>
      )}
      {job.productionState === "produced" &&
        job.fulfillmentState === "awaiting_owner" && (
          <Notice>
            Your item passed the output check. The owner still needs to remove,
            label and store it before pickup.
          </Notice>
        )}
      {job.fulfillmentState === "ready_for_pickup" && (
        <div className="pickup">
          <h3>Ready for pickup</h3>
          <p>
            {q?.collectionPoint || "See the owner at the collection point."}
          </p>
          {job.pickup?.code ? (
            <>
              <span className="pickup-code">{job.pickup.code}</span>
              <p>
                Show this single-use code to the owner when they hand over your
                item.
              </p>
            </>
          ) : (
            <p>
              Your pickup code will appear when the owner confirms preparation.
            </p>
          )}
          {job.pickup?.expiresAt && (
            <small>
              {new Date(job.pickup.expiresAt).getTime() < now
                ? "Code expired. Contact the owner."
                : `Expires ${date(job.pickup.expiresAt)}`}
            </small>
          )}
        </div>
      )}
      {job.fulfillmentState === "collected" && (
        <Notice kind="success">
          Collected. The owner redeemed your pickup code and recorded handoff.
        </Notice>
      )}
      {canCancel && (
        <div className="cancel-area">
          {cancelConfirm ? (
            <>
              <p>
                {job.paymentState === "held"
                  ? "Cancelling starts a refund. It stays pending until confirmed."
                  : "Cancel this order before production starts?"}
              </p>
              <div className="button-row">
                <Button
                  className="danger"
                  busy={busy === "cancel"}
                  onClick={() => action("cancel")}
                >
                  Cancel order
                </Button>
                <button
                  className="text-button"
                  onClick={() => setCancelConfirm(false)}
                >
                  Keep order
                </button>
              </div>
            </>
          ) : (
            <button
              className="text-button subdued"
              onClick={() => setCancelConfirm(true)}
            >
              Cancel order
            </button>
          )}
        </div>
      )}
      <details className="history">
        <summary>Order history</summary>
        <ol>
          {job.history?.length ? (
            job.history.map((event, index) => (
              <li key={index}>
                <strong>{human(event.event)}</strong>
                <time dateTime={event.at}>{date(event.at)}</time>
                {event.reason && <p>{event.reason}</p>}
              </li>
            ))
          ) : (
            <li>No history recorded.</li>
          )}
        </ol>
      </details>
      {q && (
        <div className="receipt-area">
          <button
            className="text-button"
            onClick={() => {
              setReceiptError("");
              api<{ ledger: Ledger[]; mode: string }>(`/jobs/${job.id}/receipt`)
                .then(setReceipt)
                .catch((e) => setReceiptError(e.message));
            }}
          >
            View receipt & payment records
          </button>
          {receiptError && <Notice kind="error">{receiptError}</Notice>}
          {receipt && (
            <div className="receipt">
              <strong>
                {receipt.mode === "testnet"
                  ? "Testnet receipt"
                  : "Mock receipt"}
              </strong>
              <p>
                Order {shortId(job.id)} · {money(q.totalCents)}
              </p>
              <LedgerList ledger={receipt.ledger} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
function checkoutKey(job: Job) {
  return getCheckoutKey(job);
}

function OwnerApp({
  session,
  setSession,
  health,
}: {
  session: Session | null;
  setSession: (s: Session | null) => void;
  health: Health | null;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [dashboard, setDashboard] = useState<{
    revision?: number;
    machines: Machine[];
    jobs: Job[];
    ledger: Ledger[];
  } | null>(null);
  const [model, setModel] = useState("phomemo-m02pro");
  const [mode, setMode] = useState("simulation");
  const [nodeUrl, setNodeUrl] = useState("");
  const [tab, setTab] = useState("queue");
  const [visitedTabs, setVisitedTabs] = useState(["queue"]);
  const selectTab = (id: string) => {
    setVisitedTabs((visited) =>
      visited.includes(id) ? visited : [...visited, id],
    );
    setTab(id);
  };
  const [orderFilter, setOrderFilter] = useState("action");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [retainedOrderId, setRetainedOrderId] = useState<string | null>(null);
  const focusedOrder = useRef<{ id: string; target: HTMLElement } | null>(null);
  const queueStart = useRef<HTMLDivElement>(null);
  const queueHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => setOrderPage(1), [orderFilter, orderSearch]);
  useEffect(() => {
    const previous = focusedOrder.current;
    if (!previous || previous.target.isConnected) return;
    focusedOrder.current = null;
    if (
      tab !== "queue" ||
      (document.activeElement && document.activeElement !== document.body)
    )
      return;
    const next = queueStart.current || queueHeading.current;
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [dashboard, tab, orderFilter, orderSearch, orderPage]);
  const [connected, setConnected] = useState(true);
  const dashboardGate = useRef(snapshotGate());
  const ownerMounted = useRef(true);
  useEffect(() => {
    ownerMounted.current = true;
    return () => {
      ownerMounted.current = false;
      invalidateSnapshots(dashboardGate.current);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!ownerMounted.current || session?.role !== "owner") return false;
    const request = ++dashboardGate.current.issued;
    try {
      const next = await api<NonNullable<typeof dashboard>>("/owner/dashboard");
      if (!ownerMounted.current) return false;
      if (!acceptSnapshot(dashboardGate.current, request, next.revision))
        return true;
      setDashboard(next);
      setConnected(true);
      return true;
    } catch (error) {
      if (!ownerMounted.current) return false;
      if (!currentSnapshotError(dashboardGate.current, request)) return true;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        setDashboard(null);
        setSession(null);
        setError(
          "Your owner session expired. Enter your access code to reopen the workshop.",
        );
      }
      setConnected(false);
      return false;
    }
  }, [session]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (session?.role !== "owner") return;
    const e = new EventSource("/api/events");
    e.addEventListener("refresh", () => {
      void refresh();
    });
    e.onmessage = () => {
      void refresh();
    };
    e.onopen = () => setConnected(true);
    e.onerror = () => setConnected(false);
    return () => e.close();
  }, [session?.role, refresh]);
  const act = async (name: string, fn: () => Promise<void>) => {
    invalidateSnapshots(dashboardGate.current);
    setBusy(name);
    setError("");
    setMessage("");
    try {
      await fn();
      const refreshed = await refresh();
      if (!refreshed && ownerMounted.current)
        setMessage(
          "The change was accepted, but the latest workshop state could not be loaded. Your entered values are kept; use Refresh before making another change.",
        );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  const request = async (path: string, body: unknown, method?: string) => {
    await api(path, body, method);
    setMessage("The saved workshop state is shown below.");
  };
  const login = (e: FormEvent) => {
    e.preventDefault();
    void act("login", async () => {
      setSession(await api<Session>("/session", { role: "owner", accessCode }));
      setAccessCode("");
    });
  };
  const machines = dashboard?.machines || [];
  const jobs = dashboard?.jobs || [];
  const handling = jobs.filter(
    (j) =>
      j.fulfillmentState === "awaiting_owner" &&
      j.productionState === "produced",
  );
  const attention = jobs.filter(needsOwnerReview);
  const active = jobs.filter((j) =>
    ["payment_confirmed", "dispatched", "running", "verifying"].includes(
      j.productionState,
    ),
  );
  const matchingJobs = [...jobs]
    .filter((job) => {
      if (orderFilter === "action" && !needsOwnerAction(job)) return false;
      if (
        orderFilter === "pickup" &&
        job.fulfillmentState !== "ready_for_pickup"
      )
        return false;
      if (
        orderFilter === "production" &&
        !active.some((item) => item.id === job.id)
      )
        return false;
      if (
        orderFilter === "completed" &&
        !["collected", "cancelled"].includes(job.fulfillmentState) &&
        job.productionState !== "cancelled"
      )
        return false;
      const query = orderSearch.trim().toLowerCase();
      return (
        !query ||
        [
          job.id,
          job.spec.intent,
          job.machineId || "",
          outputLabels[job.spec.outputType],
        ].some((value) => value.toLowerCase().includes(query))
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(matchingJobs.length / pageSize));
  const currentPage = Math.min(orderPage, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageJobs = matchingJobs.slice(pageStart, pageStart + pageSize);
  const retainedOrder =
    retainedOrderId && !pageJobs.some((job) => job.id === retainedOrderId)
      ? matchingJobs.find((job) => job.id === retainedOrderId)
      : undefined;
  const visibleJobs = retainedOrder
    ? [...pageJobs.slice(0, pageSize - 1), retainedOrder]
    : pageJobs;
  const visibleOrderIds = visibleJobs.map((job) => job.id).join(",");
  useEffect(() => {
    const target = focusedOrder.current?.target;
    if (!retainedOrder || !target || document.activeElement !== target) return;
    const bounds = target.getBoundingClientRect();
    if (bounds.top < 24 || bounds.bottom > window.innerHeight - 24)
      target.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [retainedOrder?.id, visibleOrderIds]);
  useEffect(() => {
    setOrderPage((page) => Math.min(page, pageCount));
  }, [pageCount]);
  const retainedMatches = matchingJobs.some(
    (job) => job.id === retainedOrderId,
  );
  useEffect(() => {
    if (retainedOrderId && !retainedMatches) setRetainedOrderId(null);
  }, [retainedOrderId, retainedMatches]);
  const moveOrderPage = (page: number) => {
    const initiatingElement = document.activeElement;
    focusedOrder.current = null;
    setRetainedOrderId(null);
    setOrderPage(page);
    requestAnimationFrame(() => {
      if (!ownerMounted.current) return;
      const activeElement = document.activeElement;
      if (
        activeElement !== initiatingElement &&
        activeElement !== document.body
      )
        return;
      queueStart.current?.focus();
    });
  };
  const resetOrderFilters = () => {
    setRetainedOrderId(null);
    setOrderFilter("all");
    setOrderSearch("");
  };
  if (session?.role !== "owner")
    return (
      <div className="owner-login">
        <div className="login-intro">
          <span className="workshop-symbol">✳</span>
          <h1>
            The other side
            <br />
            of the counter.
          </h1>
          <p>
            Keep devices ready, check results and prepare each item for
            collection.
          </p>
          <a href="/">Back to making</a>
        </div>
        <form onSubmit={login}>
          <h2>Open your workshop</h2>
          <p>
            Use the owner access code from your local setup. Requester sessions
            cannot access machine controls or other people’s orders.
          </p>
          <Field label="Owner access code">
            <input
              required
              autoComplete="current-password"
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
            />
          </Field>
          <Button
            className="primary full"
            type="submit"
            busy={busy === "login"}
          >
            Open owner workshop
          </Button>
          {error && (
            <Notice kind="error" focusOnShow>
              {error}
            </Notice>
          )}
          <small>The access code stays out of the requester interface.</small>
        </form>
      </div>
    );
  return (
    <OwnerDraftProvider
      pendingWork={Boolean(busy)}
      actionJobs={jobs}
      jobIds={jobs
        .filter(
          (job) =>
            job.quote && ["produced", "failed"].includes(job.productionState),
        )
        .map((job) => job.id)}
      paymentJobIds={jobs
        .filter(
          (job) =>
            [
              "collection_pending",
              "release_pending",
              "refund_pending",
            ].includes(job.paymentState) &&
            dashboard?.ledger.some(
              (record) =>
                record.jobId === job.id &&
                record.mode === "testnet" &&
                String(record.status || record.state) === "pending" &&
                Boolean(record.receipt) &&
                Boolean(record.id),
            ),
        )
        .map((job) => job.id)}
    >
      <div
        className="owner-workshop"
        onFocusCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const order = target.closest<HTMLElement>("[data-owner-order]");
          if (order?.dataset.ownerOrder) {
            focusedOrder.current = { id: order.dataset.ownerOrder, target };
            setRetainedOrderId(order.dataset.ownerOrder);
          } else focusedOrder.current = null;
        }}
      >
        <section className="owner-intro">
          <div>
            <p className="quiet">Owner workshop</p>
            <h1>Keep the counter moving.</h1>
            <p>Clear a machine after handling. Pickup can happen later.</p>
          </div>
          <div className="owner-stats">
            <div>
              <strong>
                {machines.filter((m) => m.ready && !m.paused).length}
              </strong>
              <span>ready machines</span>
            </div>
            <div>
              <strong>{handling.length}</strong>
              <span>to prepare</span>
            </div>
            <div>
              <strong>{attention.length}</strong>
              <span>need review</span>
            </div>
          </div>
        </section>
        {!connected && (
          <Notice kind="error">
            Workshop updates are disconnected. Confirm the service connection
            before taking an action.{" "}
            <button className="text-button" onClick={refresh}>
              Refresh
            </button>
          </Notice>
        )}
        {error && (
          <Notice kind="error" focusOnShow>
            {error}
          </Notice>
        )}
        {message && <Notice kind="success">{message}</Notice>}
        <div className="owner-tabs" role="tablist" aria-label="Workshop views">
          {[
            ["queue", "Orders & handling"],
            ["machines", "Machines & policy"],
            ["payments", "Payment records"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`owner-${id}`}
              id={`tab-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={(e) => {
                if (
                  ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const list = ["queue", "machines", "payments"];
                  const next =
                    e.key === "Home"
                      ? list[0]
                      : e.key === "End"
                        ? list[2]
                        : list[
                            (list.indexOf(tab) +
                              (e.key === "ArrowRight" ? 1 : 2)) %
                              3
                          ];
                  selectTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!dashboard ? (
          <div className="loading-shell">Loading workshop records…</div>
        ) : (
          <>
            <div
              role="tabpanel"
              id="owner-queue"
              aria-labelledby="tab-queue"
              hidden={tab !== "queue"}
            >
              {visitedTabs.includes("queue") && (
                <>
                  <div className="queue-summary">
                    <h2 ref={queueHeading} tabIndex={-1}>
                      {active.length
                        ? "Production in progress"
                        : handling.length
                          ? "Items need preparation"
                          : attention.length
                            ? "Orders need review"
                            : jobs.some((job) =>
                                  [
                                    "collection_pending",
                                    "release_pending",
                                    "refund_pending",
                                  ].includes(job.paymentState),
                                )
                              ? "Payments need follow-up"
                              : jobs.some(
                                    (job) =>
                                      job.fulfillmentState ===
                                      "ready_for_pickup",
                                  )
                                ? "Items await collection"
                                : "The counter is clear."}
                    </h2>
                    <p>
                      {jobs.length
                        ? "Orders below retain separate production, payment and collection states."
                        : "New requester orders will appear here. Register and calibrate a device to start."}
                    </p>
                  </div>
                  {jobs.length ? (
                    <>
                      <div
                        className="queue-tools"
                        role="search"
                        aria-label="Find workshop orders"
                        ref={queueStart}
                        tabIndex={-1}
                      >
                        <Field label="Find an order">
                          <input
                            type="search"
                            value={orderSearch}
                            onChange={(event) => {
                              setRetainedOrderId(null);
                              setOrderSearch(event.target.value);
                            }}
                            placeholder="Order, artwork or machine"
                          />
                        </Field>
                        <Field label="Show orders">
                          <select
                            value={orderFilter}
                            onChange={(event) => {
                              setRetainedOrderId(null);
                              setOrderFilter(event.target.value);
                            }}
                          >
                            <option value="all">
                              All orders ({jobs.length})
                            </option>
                            <option value="action">
                              Need owner action (
                              {jobs.filter(needsOwnerAction).length})
                            </option>
                            <option value="pickup">
                              Ready for pickup (
                              {
                                jobs.filter(
                                  (job) =>
                                    job.fulfillmentState === "ready_for_pickup",
                                ).length
                              }
                              )
                            </option>
                            <option value="production">
                              In production ({active.length})
                            </option>
                            <option value="completed">
                              Collected or cancelled (
                              {
                                jobs.filter(
                                  (job) =>
                                    ["collected", "cancelled"].includes(
                                      job.fulfillmentState,
                                    ) || job.productionState === "cancelled",
                                ).length
                              }
                              )
                            </option>
                          </select>
                        </Field>
                        <p className="queue-count" role="status">
                          {retainedOrder
                            ? `${visibleJobs.length} of ${matchingJobs.length} matching orders shown. Your selected order stays on this page.`
                            : matchingJobs.length > pageSize
                              ? `${pageStart + 1}–${pageStart + visibleJobs.length} of ${matchingJobs.length} matching`
                              : `${matchingJobs.length} of ${jobs.length}`}{" "}
                          {!retainedOrder &&
                            `${jobs.length === 1 ? "order" : "orders"} shown`}
                        </p>
                      </div>
                      {matchingJobs.length ? (
                        <div className="owner-job-list">
                          {visibleJobs.map((job) => (
                            <div key={job.id} data-owner-order={job.id}>
                              <OwnerJob
                                job={job}
                                ledger={dashboard.ledger}
                                busy={busy}
                                health={health}
                                action={(action, body) =>
                                  act(`${job.id}-${action}`, () =>
                                    request(
                                      `/owner/jobs/${job.id}/${action}`,
                                      body || {},
                                    ),
                                  )
                                }
                                simulation={(outcome) =>
                                  act(`${job.id}-simulation`, () =>
                                    request(
                                      `/owner/simulation/${job.machineId}`,
                                      {
                                        outcome,
                                      },
                                    ),
                                  )
                                }
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty queue-empty">
                          <h3>
                            {orderFilter === "action" && !orderSearch.trim()
                              ? "No orders need owner action."
                              : "No orders match."}
                          </h3>
                          <p>
                            {orderFilter === "action" && !orderSearch.trim()
                              ? "The counter is clear. Open all orders to check production or revisit a past order."
                              : "Try another order number, artwork description or view."}
                          </p>
                          <button
                            className="secondary"
                            onClick={resetOrderFilters}
                          >
                            Show all orders
                          </button>
                        </div>
                      )}
                      {pageCount > 1 && (
                        <nav
                          className="queue-pagination"
                          aria-label="Order pages"
                        >
                          <button
                            className="secondary"
                            disabled={currentPage === 1}
                            onClick={() => moveOrderPage(currentPage - 1)}
                          >
                            Previous orders
                          </button>
                          <span>
                            Page {currentPage} of {pageCount}
                          </span>
                          <button
                            className="secondary"
                            disabled={currentPage === pageCount}
                            onClick={() => moveOrderPage(currentPage + 1)}
                          >
                            Next orders
                          </button>
                        </nav>
                      )}
                    </>
                  ) : (
                    <div className="empty">
                      <h3>No orders yet.</h3>
                      <p>
                        Open the requester counter in another browser session to
                        create an order.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div
              role="tabpanel"
              id="owner-machines"
              aria-labelledby="tab-machines"
              hidden={tab !== "machines"}
            >
              {visitedTabs.includes("machines") && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Your machines</h2>
                      <p>
                        Pairing, configuration, calibration, listing and
                        readiness are distinct facts.
                      </p>
                    </div>
                  </div>
                  <div className="owner-machine-list">
                    {machines.map((machine) => (
                      <OwnerMachine
                        key={machine.id}
                        machine={machine}
                        busy={busy}
                        action={(action, body, options) =>
                          act(`${machine.id}-${action}`, async () => {
                            try {
                              const result = await api<{ machine?: Machine }>(
                                `/owner/machines/${machine.id}${action === "calibrate" ? "/calibrate" : ""}`,
                                body,
                                action === "calibrate" ? undefined : "PATCH",
                                {
                                  headers: options?.fingerprint
                                    ? { "If-Match": `"${options.fingerprint}"` }
                                    : undefined,
                                },
                              );
                              if (result.machine)
                                options?.onAccepted?.(result.machine);
                              setMessage(
                                "The saved workshop state is shown below.",
                              );
                            } catch (error) {
                              if (
                                error instanceof ApiError &&
                                [
                                  "STALE_MACHINE_SETTINGS",
                                  "MACHINE_POLICY_RECONCILIATION",
                                ].includes(error.code)
                              ) {
                                options?.onConflict?.();
                                await refresh();
                              }
                              throw error;
                            }
                          })
                        }
                      />
                    ))}
                  </div>
                  <form
                    className="register-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("register", async () => {
                        await request("/owner/machines", {
                          model,
                          mode,
                          ...(nodeUrl ? { nodeUrl } : {}),
                        });
                        setNodeUrl("");
                      });
                    }}
                  >
                    <div>
                      <h2>Add a supported machine</h2>
                      <p>
                        Known-model adapters only. Unfamiliar-machine onboarding
                        is planned.
                      </p>
                    </div>
                    <div className="form-grid">
                      <Field label="Supported model">
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        >
                          <option value="phomemo-m02pro">Phomemo M02Pro</option>
                          <option value="instax-mini-link-3">
                            Instax Mini Link 3
                          </option>
                          <option value="bambu-a1-mini">
                            Bambu Lab A1 mini
                          </option>
                        </select>
                      </Field>
                      <Field label="Device mode">
                        <select
                          value={mode}
                          onChange={(e) => setMode(e.target.value)}
                        >
                          <option value="simulation">
                            Simulation · no physical job
                          </option>
                          <option value="hardware">
                            Hardware · requires configured node
                          </option>
                        </select>
                      </Field>
                    </div>
                    {mode === "hardware" && (
                      <Field
                        label="Configured node URL"
                        hint="The server must have the node credential in its local environment. Registration does not establish calibration."
                      >
                        <input
                          type="url"
                          value={nodeUrl}
                          onChange={(e) => setNodeUrl(e.target.value)}
                          placeholder="http://127.0.0.1:4319"
                          required
                        />
                      </Field>
                    )}
                    <Button
                      className="primary"
                      type="submit"
                      busy={busy === "register"}
                    >
                      Register supported device
                    </Button>
                  </form>
                </>
              )}
            </div>
            <div
              role="tabpanel"
              id="owner-payments"
              aria-labelledby="tab-payments"
              hidden={tab !== "payments"}
            >
              <section className="payment-records">
                <h2>Platform-managed test hold</h2>
                <p>
                  Quote allocation, submitted transfers and confirmed outcomes
                  remain separate.{" "}
                  {health?.paymentMode === "mock"
                    ? "These are mock records; no funds moved."
                    : "These records use Base Sepolia test funds."}
                </p>
                <LedgerList ledger={dashboard.ledger} />
              </section>
            </div>
          </>
        )}
      </div>
    </OwnerDraftProvider>
  );
}
function OwnerMachine({
  machine: m,
  busy,
  action,
}: {
  machine: Machine;
  busy: string;
  action: (
    name: string,
    body: unknown,
    options?: {
      fingerprint?: string;
      onAccepted?: (machine: Machine) => void;
      onConflict?: () => void;
    },
  ) => Promise<boolean>;
}) {
  const [saved, setSaved] = useState(() => settingsSnapshot(m));
  const [base, setBase] = useState(saved);
  const [settings, setSettings] = useState(saved.settings);
  const [inspected, setInspected] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rejectedSave, setRejectedSave] = useState(false);
  const dirtyRef = useRef(false);
  const rejectedRef = useRef(false);
  const hasNewerSaved = saved.identity !== base.identity;
  const conflict = rejectedSave || (dirty && hasNewerSaved);
  const canAdoptSaved =
    hasNewerSaved || (rejectedSave && saved.reconciliationRequired);
  useOwnerFormGuard(dirty || busy === `${m.id}-settings`);
  useEffect(() => {
    const next = settingsSnapshot(m);
    setSaved(next);
    if (!dirtyRef.current && !rejectedRef.current) {
      setSettings(next.settings);
      setBase(next);
    }
  }, [m]);
  const inspectionContext = JSON.stringify([
    m.id,
    m.adapterVersion,
    m.mode,
    m.outputType,
    m.material,
    m.paired,
    m.configured,
    m.calibrated,
    m.calibrationAt,
    m.activeJobId,
    m.reservation?.jobId,
    m.reservation?.expiresAt,
    m.paused,
    m.ready,
    m.policyReconciliationRequired,
  ]);
  useEffect(() => {
    setInspected(false);
  }, [inspectionContext]);
  const update = (value: Partial<typeof settings>) => {
    dirtyRef.current = true;
    setDirty(true);
    setSettings((s) => ({ ...s, ...value }));
  };
  const adopt = (next: typeof saved) => {
    setSettings(next.settings);
    setBase(next);
    dirtyRef.current = false;
    rejectedRef.current = false;
    setDirty(false);
    setRejectedSave(false);
  };
  const checkedAction = async (name: string, body: unknown) => {
    const accepted = await action(name, body);
    if (accepted) setInspected(false);
    return accepted;
  };
  return (
    <article className="owner-machine">
      <div className="machine-card-head">
        <DeviceArt type={m.outputType} />
        <div>
          <h3>{m.name}</h3>
          <p>
            {m.model} · adapter {m.adapterVersion || "unknown"}
          </p>
          <div className="badge-row">
            <Badge>
              {m.mode === "simulation"
                ? "Simulated device"
                : "Hardware · acceptance unverified"}
            </Badge>
            <Badge tone={m.ready && !m.paused ? "green" : "amber"}>
              {m.ready && !m.paused
                ? "Ready"
                : m.paused
                  ? "Paused"
                  : "Not ready"}
            </Badge>
          </div>
        </div>
        <button
          className={m.paused ? "secondary" : "danger-outline"}
          disabled={
            Boolean(busy) ||
            (m.paused && (!inspected || m.policyReconciliationRequired))
          }
          onClick={() => {
            void checkedAction("settings", {
              paused: !m.paused,
              ...(m.paused ? { inspected, cleared: inspected } : {}),
            });
          }}
        >
          {m.paused ? "Resume machine" : "Pause machine"}
        </button>
      </div>
      <div className="readiness-facts">
        {[
          ["Paired", m.paired],
          ["Configured", m.configured],
          ["Calibrated", m.calibrated],
          ["Listed", m.listed],
          ["Ready", m.ready],
        ].map(([name, value]) => (
          <span key={String(name)}>
            <i className={value ? "yes" : "no"}>{value ? "✓" : "–"}</i>
            {name}
          </span>
        ))}
      </div>
      {m.reason && <p className="machine-reason">{m.reason}</p>}
      {m.activeJobId && (
        <Notice>
          Active execution: {shortId(m.activeJobId)}. An outstanding pickup does
          not occupy this execution slot.
        </Notice>
      )}
      <div className="calibration-row">
        <label className="check">
          <input
            type="checkbox"
            checked={inspected}
            onChange={(e) => setInspected(e.target.checked)}
          />
          <span>
            I inspected the output area, loaded media and cleared the machine.
          </span>
        </label>
        {m.mode === "simulation" && (
          <Button
            className="secondary"
            busy={busy === `${m.id}-calibrate`}
            disabled={!inspected || Boolean(busy)}
            onClick={() => {
              void checkedAction("calibrate", { inspected: true });
            }}
          >
            Run simulation calibration
          </Button>
        )}
      </div>
      {m.mode === "hardware" && (
        <PhysicalCalibration
          machine={m}
          finalize={(body) => checkedAction("calibrate", body)}
        />
      )}
      <details className="machine-settings">
        <summary>Media, prices, hours & policy</summary>
        <form
          aria-busy={Boolean(busy)}
          onSubmit={async (e) => {
            e.preventDefault();
            if (conflict) return;
            if (
              await action(
                "settings",
                {
                  ...settings,
                  mediaRemaining: Number(settings.mediaRemaining),
                  maxJobSeconds: Number(settings.maxJobSeconds),
                  policy: {
                    ...settings.policy,
                    maxQuantity: Number(settings.policy.maxQuantity),
                  },
                  priceCard: {
                    consumables: Number(settings.priceCard.consumables),
                    machine: Number(settings.priceCard.machine),
                    handling: Number(settings.priceCard.handling),
                    platform: Number(settings.priceCard.platform),
                  },
                  ownerAddress: settings.ownerAddress || null,
                },
                {
                  fingerprint: base.fingerprint,
                  onAccepted: (machine) => {
                    const next = settingsSnapshot(machine);
                    setSaved(next);
                    adopt(next);
                  },
                  onConflict: () => {
                    rejectedRef.current = true;
                    setRejectedSave(true);
                  },
                },
              )
            ) {
              dirtyRef.current = false;
              setDirty(false);
            }
          }}
        >
          <fieldset disabled={Boolean(busy)}>
            {conflict && (
              <Notice kind="error">
                {saved.reconciliationRequired
                  ? "The machine policy needs synchronization. Your draft is kept."
                  : "Saved machine settings changed while you were editing. Your draft is kept."}
                {hasNewerSaved
                  ? " Load the newer saved settings before saving again. This discards your unsaved machine edits."
                  : canAdoptSaved
                    ? " Load the saved settings before synchronizing the machine. This discards your unsaved machine edits."
                    : " Refresh the workshop to load the newer settings before saving again."}
              </Notice>
            )}
            <div className="form-grid">
              <Field label="Media remaining (estimated)">
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={settings.mediaRemaining}
                  onChange={(e) => update({ mediaRemaining: e.target.value })}
                />
              </Field>
              <Field label="Loaded material">
                <input
                  required
                  value={settings.material}
                  onChange={(e) => update({ material: e.target.value })}
                />
              </Field>
              <Field label="Open from (UTC)">
                <select
                  value={settings.hours.start}
                  onChange={(e) =>
                    update({
                      hours: {
                        ...settings.hours,
                        start: Number(e.target.value),
                      },
                    })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Open until (UTC)">
                <select
                  value={settings.hours.end}
                  onChange={(e) =>
                    update({
                      hours: { ...settings.hours, end: Number(e.target.value) },
                    })
                  }
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Maximum job time (seconds)">
                <input
                  type="number"
                  min="1"
                  required
                  value={settings.maxJobSeconds}
                  onChange={(e) => update({ maxJobSeconds: e.target.value })}
                />
              </Field>
              <Field label="Collection point">
                <input
                  required
                  value={settings.collectionPoint}
                  onChange={(e) => update({ collectionPoint: e.target.value })}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Maximum quantity per job">
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  required
                  value={settings.policy.maxQuantity}
                  onChange={(e) =>
                    update({
                      policy: {
                        ...settings.policy,
                        maxQuantity: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field
                label="Owner test payout address"
                hint="Public Base Sepolia address only. Leave blank to remove a configured address. Keep wallet keys in the server environment."
              >
                <input
                  value={settings.ownerAddress}
                  pattern="0x[0-9a-fA-F]{40}"
                  placeholder="0x…"
                  onChange={(e) => update({ ownerAddress: e.target.value })}
                />
              </Field>
            </div>
            <label className="check policy-check">
              <input
                type="checkbox"
                checked={settings.policy.authorizedArtwork}
                onChange={(e) =>
                  update({
                    policy: {
                      ...settings.policy,
                      authorizedArtwork: e.target.checked,
                    },
                  })
                }
              />
              <span>
                Require confirmed artwork permission for unattended production
              </span>
            </label>
            <h4>Price card · USD cents</h4>
            <div className="form-grid price-grid">
              {(
                [
                  "consumables",
                  "machine",
                  "handling",
                  "platform",
                ] as (keyof Price)[]
              ).map((key) => (
                <Field
                  label={key.charAt(0).toUpperCase() + key.slice(1)}
                  key={key}
                >
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={settings.priceCard[key]}
                    onChange={(e) =>
                      update({
                        priceCard: {
                          ...settings.priceCard,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.listed}
                onChange={(e) => update({ listed: e.target.checked })}
              />
              <span>List this machine for requester discovery</span>
            </label>
            <p className="fine-print">
              Only supported materials and low-risk outputs are accepted.
              Unclear artwork permission requires owner review. Local limits
              still apply at the node.
            </p>
            <Button
              className="primary"
              busy={busy === `${m.id}-settings`}
              disabled={Boolean(busy) || conflict}
              type="submit"
            >
              Save machine settings
            </Button>
            {(dirty || conflict) && (
              <button
                className="secondary"
                type="button"
                disabled={Boolean(busy) || (conflict && !canAdoptSaved)}
                onClick={() => adopt(saved)}
              >
                {conflict
                  ? hasNewerSaved
                    ? "Load newer saved settings"
                    : "Load saved settings for synchronization"
                  : "Discard machine edits"}
              </button>
            )}
          </fieldset>
        </form>
      </details>
    </article>
  );
}

type Calibration = {
  id: string;
  attemptId: string;
  productionState?: string;
  reason?: string;
  evidence?: {
    url?: string;
    capturedAt: string;
    machineId: string;
    jobId: string;
  };
};
function PhysicalCalibration({
  machine: m,
  finalize,
}: {
  machine: Machine;
  finalize: (body: unknown) => Promise<boolean>;
}) {
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [nodeState, setNodeState] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modelId, setModelId] = useState("");
  const [width, setWidth] = useState(m.outputType === "instax" ? "54" : "53");
  const [height, setHeight] = useState(m.outputType === "instax" ? "86" : "50");
  const [ownerReady, setOwnerReady] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("completed");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lookupKnown, setLookupKnown] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const recoveryControl = useRef<HTMLElement | null>(null);
  const pendingRecoveryFocus = useRef<{
    initiator: HTMLButtonElement;
    recovered: boolean;
    generation: number;
  } | null>(null);
  const [recoverySequence, setRecoverySequence] = useState(0);
  const mounted = useRef(true);
  const readGate = useRef<{
    generation: number;
    inFlight: Promise<boolean> | null;
    queued: {
      promise: Promise<boolean>;
      resolve: (value: boolean) => void;
    } | null;
  }>({ generation: 0, inFlight: null, queued: null });
  const inspectionContext = JSON.stringify([
    m.id,
    m.mode,
    m.outputType,
    m.adapterVersion,
    m.material,
    m.paired,
    m.configured,
    calibration?.id,
    calibration?.attemptId,
    calibration?.productionState,
    calibration?.evidence?.url,
    calibration?.evidence?.capturedAt,
    calibration?.evidence?.machineId,
    calibration?.evidence?.jobId,
  ]);
  useEffect(() => {
    // An inspection is a fresh confirmation of this exact attempt and frame.
    // A newer saved attempt must not inherit an earlier checked confirmation.
    setInspected(false);
    setOwnerReady(false);
    setReason("");
    setResolution("completed");
  }, [inspectionContext]);
  const key = useRef(
    readStoredValue("session", `fabrary-calibration-${m.id}`) ||
      crypto.randomUUID(),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGate.current.generation++;
      readGate.current.queued?.resolve(false);
      readGate.current.queued = null;
    };
  }, []);
  const refresh = useCallback((): Promise<boolean> => {
    if (!mounted.current) return Promise.resolve(false);
    const gate = readGate.current;
    const read = (): Promise<boolean> => {
      const generation = gate.generation;
      setLookupBusy(true);
      const current = (async () => {
        try {
          const value = await api<{
            calibration: Calibration | null;
            status?: {
              execution_status?: string;
              state?: string;
              reason?: string;
            };
          }>(`/owner/machines/${m.id}/calibration`);
          if (!mounted.current || generation !== gate.generation) return false;
          const saved = value.calibration;
          const status = value.status;
          if (
            !Object.prototype.hasOwnProperty.call(value, "calibration") ||
            (saved !== null &&
              (!saved ||
                typeof saved !== "object" ||
                ![saved.id, saved.attemptId, saved.productionState].every(
                  (field) =>
                    typeof field === "string" && field.trim().length > 0,
                ))) ||
            (status != null &&
              (typeof status !== "object" ||
                Array.isArray(status) ||
                [status.execution_status, status.state].some(
                  (field) =>
                    field !== undefined &&
                    (typeof field !== "string" || field.trim().length === 0),
                ) ||
                (status.reason !== undefined &&
                  typeof status.reason !== "string")))
          )
            throw new Error(
              "The saved calibration response could not be confirmed. Refresh its status before starting or confirming a physical job.",
            );
          setCalibration(saved);
          setNodeState(
            value.status?.execution_status ||
              value.status?.state ||
              saved?.productionState ||
              "unknown",
          );
          setLookupKnown(true);
          setError("");
          return true;
        } catch (e) {
          if (mounted.current && generation === gate.generation) {
            setLookupKnown(false);
            setError((e as Error).message);
          }
          return false;
        }
      })();
      gate.inFlight = current;
      void current.then(() => {
        if (gate.inFlight !== current) return;
        gate.inFlight = null;
        const queued = gate.queued;
        gate.queued = null;
        if (queued && mounted.current) void read().then(queued.resolve);
        else {
          queued?.resolve(false);
          if (mounted.current) setLookupBusy(false);
        }
      });
      return current;
    };
    if (gate.inFlight) {
      if (!gate.queued) {
        let resolve!: (value: boolean) => void;
        const promise = new Promise<boolean>((done) => {
          resolve = done;
        });
        gate.queued = { promise, resolve };
      }
      return gate.queued.promise;
    }
    return read();
  }, [m.id]);
  const deviceContext = JSON.stringify([
    m.id,
    m.mode,
    m.outputType,
    m.adapterVersion,
    m.material,
    m.paired,
    m.configured,
  ]);
  useEffect(() => {
    const generation = ++readGate.current.generation;
    setLookupKnown(false);
    void refresh();
    if (m.outputType === "3d")
      api<{ models: CatalogItem[] }>("/catalog")
        .then((x) => {
          if (mounted.current && generation === readGate.current.generation)
            setCatalog(x.models);
        })
        .catch((e) => {
          if (mounted.current && generation === readGate.current.generation)
            setError(e.message);
        });
  }, [refresh, deviceContext]);
  useEffect(() => {
    if (
      !calibration ||
      ["produced", "failed", "needs_review"].includes(
        calibration.productionState || "",
      )
    )
      return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [calibration?.id, calibration?.productionState, refresh]);
  const run = async (
    name: string,
    fn: (isCurrent: () => boolean) => Promise<unknown>,
  ) => {
    if (!mounted.current) return;
    if (["start", "finalize", "resolve"].includes(name)) {
      readGate.current.generation++;
      setLookupKnown(false);
    }
    const generation = readGate.current.generation;
    const isCurrent = () =>
      mounted.current && generation === readGate.current.generation;
    setBusy(name);
    setError("");
    try {
      await fn(isCurrent);
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  };
  const recoverLookup = (initiator: HTMLButtonElement) => {
    void run("refresh", async (isCurrent) => {
      const recovered = await refresh();
      if (!isCurrent()) return;
      pendingRecoveryFocus.current = {
        initiator,
        recovered,
        generation: readGate.current.generation,
      };
      setRecoverySequence((value) => value + 1);
    });
  };
  useEffect(() => {
    const request = pendingRecoveryFocus.current;
    if (!request || busy) return;
    const target = request.recovered
      ? recoveryControl.current
      : request.initiator;
    if (target?.matches(":disabled")) return;
    pendingRecoveryFocus.current = null;
    // Focus after the pending controls have re-enabled in the committed DOM.
    requestAnimationFrame(() => {
      if (
        !mounted.current ||
        request.generation !== readGate.current.generation
      )
        return;
      const active = document.activeElement;
      if (active !== request.initiator && active !== document.body) return;
      if (
        !target?.isConnected ||
        !target.getClientRects().length ||
        target.matches(":disabled")
      )
        return;
      target.focus({ preventScroll: true });
      (target.closest(".field, .check") || target).scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    });
  }, [recoverySequence, busy, lookupBusy]);
  return (
    <details className="physical-calibration">
      <summary>Physical calibration job & inspection</summary>
      <Notice>
        This starts one real job on the configured device and uses loaded media.
        Check the adapter, output area and camera first. Installing an adapter
        does not establish a calibration pass.
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {!calibration && !lookupKnown && (
        <Notice>
          {busy
            ? "The calibration request is in progress. Wait for its saved result."
            : lookupBusy
              ? "Checking the saved calibration record…"
              : "The saved calibration has not been confirmed. Check it before starting a physical job."}
          <button
            className="text-button"
            type="button"
            disabled={lookupBusy || Boolean(busy)}
            onClick={(event) => {
              recoverLookup(event.currentTarget);
            }}
          >
            Refresh saved calibration status
          </button>
        </Notice>
      )}
      {(lookupKnown || calibration) &&
        (!calibration ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("start", async (isCurrent) => {
                const model = catalog.find((x) => x.id === modelId);
                if (model && !completePreparedModel(model))
                  throw new Error(
                    "The prepared model is missing inspected dimensions, color or an estimated time. Ask the owner to complete its catalog record.",
                  );
                const selectedIds = model
                  ? [model.artifactId]
                  : assets.map((a) => a.id);
                if (!selectedIds.length)
                  throw new Error(
                    m.outputType === "3d"
                      ? "Choose an inspected prepared model."
                      : "Upload calibration artwork before starting.",
                  );
                if (
                  !writeStoredValue(
                    "session",
                    `fabrary-calibration-${m.id}`,
                    key.current,
                  )
                )
                  throw new Error(
                    "Browser storage is unavailable, so calibration retry details cannot be saved. Allow session storage before starting physical calibration. No job was started.",
                  );
                const result = await api<{ calibration: Calibration }>(
                  `/owner/machines/${m.id}/calibration/start`,
                  {
                    spec: {
                      assetIds: selectedIds,
                      intent: `Owner-supervised ${m.model} calibration`,
                      outputType: m.outputType,
                      widthMm: Number(model?.widthMm ?? width),
                      heightMm: Number(model?.heightMm ?? height),
                      quantity: 1,
                      material: m.material,
                      permission: "authorized",
                      crop: "contain",
                      ...(model
                        ? {
                            preparedModelId: model.id,
                            depthMm: model.depthMm,
                            color: model.color,
                            estimatedSeconds: model.estimatedSeconds,
                          }
                        : {}),
                    },
                    ownerReady: true,
                    idempotencyKey: key.current,
                  },
                );
                if (!isCurrent()) return;
                setCalibration(result.calibration);
                setLookupKnown(true);
                await refresh();
              });
            }}
          >
            {m.outputType === "3d" ? (
              <>
                {modelId && (
                  <PreparedModelFacts
                    details={
                      catalog.find((model) => model.id === modelId) || {}
                    }
                  />
                )}
                <Field label="Calibration prepared model">
                  <select
                    ref={(node) => {
                      recoveryControl.current = node;
                    }}
                    required
                    disabled={Boolean(busy)}
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                  >
                    <option value="">Choose an inspected model</option>
                    {catalog.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <Field
                label="Calibration artwork"
                hint="One PNG, JPEG or WebP. Use artwork whose output you can inspect."
              >
                <input
                  ref={(node) => {
                    recoveryControl.current = node;
                  }}
                  required={!assets.length}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run("upload", async (isCurrent) => {
                        const form = new FormData();
                        form.append("images", file);
                        const result = await api<{ assets: Asset[] }>(
                          "/uploads",
                          form,
                        );
                        if (isCurrent()) setAssets(result.assets);
                      });
                  }}
                />
              </Field>
            )}
            {assets.length > 0 && (
              <img
                className="calibration-original"
                src={assets[0].url}
                alt="Calibration original artwork"
              />
            )}
            {m.outputType !== "3d" && (
              <div className="form-grid">
                <Field label="Calibration width (mm)">
                  <input
                    required
                    type="number"
                    min="1"
                    disabled={Boolean(busy) || m.outputType === "instax"}
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </Field>
                <Field label="Calibration height (mm)">
                  <input
                    required
                    type="number"
                    min="1"
                    disabled={Boolean(busy) || m.outputType === "instax"}
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <label className="check">
              <input
                required
                type="checkbox"
                disabled={Boolean(busy) || lookupBusy || !lookupKnown}
                checked={ownerReady}
                onChange={(e) => setOwnerReady(e.target.checked)}
              />
              <span>
                The device is supervised, the output area is clear and I am
                ready to start this physical calibration.
              </span>
            </label>
            <Button
              className="primary"
              type="submit"
              busy={busy === "start"}
              disabled={
                Boolean(busy) ||
                lookupBusy ||
                !lookupKnown ||
                !ownerReady ||
                !m.paired ||
                !m.configured ||
                (m.outputType === "3d" ? !modelId : !assets.length)
              }
            >
              Start physical calibration
            </Button>
          </form>
        ) : (
          <>
            <div className="calibration-status">
              <Badge>
                {human(nodeState || calibration.productionState || "unknown")}
              </Badge>
              <p>
                Attempt {calibration.attemptId}. Reconciliation checks this
                saved attempt and never silently starts another calibration job.
              </p>
              <button
                className="text-button"
                onClick={() => {
                  void run("refresh", refresh);
                }}
                disabled={Boolean(busy)}
              >
                Refresh calibration status
              </button>
            </div>
            {calibration.evidence?.url && (
              <figure className="calibration-evidence">
                <ResultImage
                  src={calibration.evidence.url}
                  frameKey={JSON.stringify([
                    m.id,
                    m.adapterVersion,
                    calibration.id,
                    calibration.attemptId,
                    calibration.evidence.jobId,
                    calibration.evidence.machineId,
                    calibration.evidence.capturedAt,
                  ])}
                  alt={`Fresh calibration evidence for ${m.name}`}
                  owner
                />
                <figcaption>
                  Calibration evidence · {date(calibration.evidence.capturedAt)}{" "}
                  · {calibration.evidence.machineId}
                </figcaption>
              </figure>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("finalize", async (isCurrent) => {
                  if (
                    await finalize({
                      inspected: true,
                      attemptId: calibration.attemptId,
                      reason,
                    })
                  ) {
                    if (!isCurrent()) return;
                    setInspected(false);
                    setReason("");
                    setResolution("completed");
                    await refresh();
                  }
                });
              }}
            >
              <label className="check">
                <input
                  ref={(node) => {
                    recoveryControl.current = node;
                  }}
                  required
                  type="checkbox"
                  disabled={Boolean(busy) || !lookupKnown}
                  checked={inspected}
                  onChange={(e) => setInspected(e.target.checked)}
                />
                <span>
                  I inspected the physical output and fresh result evidence
                  after this attempt completed.
                </span>
              </label>
              <Field label="Calibration inspection reason">
                <input
                  required
                  minLength={10}
                  disabled={Boolean(busy) || !lookupKnown}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the observed output and inspection"
                />
              </Field>
              <Button
                className="secondary"
                type="submit"
                busy={busy === "finalize"}
                disabled={
                  Boolean(busy) || lookupBusy || !lookupKnown || !inspected
                }
              >
                Confirm inspected calibration
              </Button>
            </form>
            <details className="calibration-resolution">
              <summary>Resolve an uncertain calibration attempt</summary>
              <p>
                Record an observed outcome only after inspecting the device.
                This does not rerun the physical job.
              </p>
              <Field label="Observed calibration outcome">
                <select
                  disabled={Boolean(busy) || !lookupKnown}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                >
                  <option value="completed">Completed · output observed</option>
                  <option value="failed">
                    Failed · output missing or unusable
                  </option>
                </select>
              </Field>
              <Button
                className="secondary"
                disabled={
                  Boolean(busy) ||
                  lookupBusy ||
                  !lookupKnown ||
                  !inspected ||
                  reason.trim().length < 10
                }
                busy={busy === "resolve"}
                onClick={() => {
                  void run("resolve", async (isCurrent) => {
                    await api(`/owner/machines/${m.id}/calibration/resolve`, {
                      attemptId: calibration.attemptId,
                      result: resolution,
                      inspected: true,
                      reason,
                    });
                    if (!isCurrent()) return;
                    setInspected(false);
                    setReason("");
                    setResolution("completed");
                    await refresh();
                  });
                }}
              >
                Record observed outcome
              </Button>
            </details>
          </>
        ))}
    </details>
  );
}

function OwnerJob({
  job: j,
  busy,
  health,
  action,
  simulation,
  ledger,
}: {
  job: Job;
  ledger: Ledger[];
  busy: string;
  health: Health | null;
  action: (name: string, body?: unknown) => Promise<boolean>;
  simulation: (outcome: string) => Promise<boolean>;
}) {
  const emptyPreparation = () => ({
    removed: false,
    labeled: false,
    stored: false,
    cleared: false,
  });
  const [prepared, setPrepared] = useOwnerDraft(
    ownerActionDraftKey("handling", j),
    emptyPreparation,
    (value) => Object.values(value).some(Boolean),
  );
  const [code, setCode] = useOwnerDraft(
    ownerActionDraftKey("pickup", j),
    () => "",
    Boolean,
  );
  const [reviewDraft, setReviewDraft] = useOwnerDraft(
    ownerActionDraftKey("review", j),
    () => ({ result: "pass", reason: "" }),
    (value) => value.result !== "pass" || Boolean(value.reason),
  );
  const { result: review, reason } = reviewDraft;
  const setReview = (result: string) =>
    setReviewDraft((current) => ({ ...current, result }));
  const setReason = (reason: string) =>
    setReviewDraft((current) => ({ ...current, reason }));
  const [outcome, setOutcome] = useState("pass");
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [clearDraft, setClearDraft] = useOwnerDraft(
    ownerActionDraftKey("clear", j),
    () => ({ inspected: false, reason: "" }),
    (value) => value.inspected || Boolean(value.reason),
  );
  const { inspected: clearInspected, reason: clearReason } = clearDraft;
  const setClearInspected = (inspected: boolean) =>
    setClearDraft((current) => ({ ...current, inspected }));
  const setClearReason = (reason: string) =>
    setClearDraft((current) => ({ ...current, reason }));
  const needsHandling =
    j.productionState === "produced" && j.fulfillmentState === "awaiting_owner";
  const needsReview = ["needs_review", "failed"].includes(j.productionState);
  return (
    <article
      className={`owner-job ${needsHandling || needsReview ? "attention" : ""}`}
    >
      <div className="owner-job-head">
        <div className="job-thumb">
          {j.artifact?.url ? (
            <img
              src={j.artifact.previewUrl || j.artifact.url}
              alt="Production file"
            />
          ) : (
            <DeviceArt type={j.spec.outputType} />
          )}
        </div>
        <div>
          <h3>
            {outputLabels[j.spec.outputType]} <span>#{shortId(j.id)}</span>
          </h3>
          <p>{j.spec.intent}</p>
          <small>
            {j.machineId || "Machine not reserved"} · {j.spec.quantity} ×{" "}
            {j.spec.widthMm} × {j.spec.heightMm}
            {j.spec.outputType === "3d"
              ? ` × ${j.spec.depthMm} mm · ${j.spec.color} · estimated ${j.spec.estimatedSeconds} seconds`
              : " mm"}
          </small>
        </div>
        <div className="job-states">
          <Badge
            tone={
              needsReview
                ? "amber"
                : j.productionState === "produced"
                  ? "green"
                  : "neutral"
            }
          >
            {human(j.productionState)}
          </Badge>
          <span>Payment: {human(j.paymentState)}</span>
          <span>Collection: {human(j.fulfillmentState)}</span>
        </div>
      </div>
      {needsHandling && (
        <form
          className="preparation"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action("prepare", prepared))
              setPrepared(emptyPreparation());
          }}
        >
          <h4>Prepare this item for collection</h4>
          <p>
            Remove the item, label it with the order, store it at the collection
            point, and clear the machine. Readiness can resume before
            collection.
          </p>
          <div className="preparation-checks">
            {(
              [
                ["removed", "Output removed"],
                ["labeled", "Order label attached"],
                ["stored", "Item stored safely"],
                ["cleared", "Machine cleared"],
              ] as const
            ).map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  required
                  disabled={Boolean(busy)}
                  checked={prepared[key]}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setPrepared((s) => ({ ...s, [key]: checked }));
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="button-row">
            <Button
              className="primary"
              busy={busy === `${j.id}-prepare`}
              disabled={
                Boolean(busy) || !Object.values(prepared).every(Boolean)
              }
              type="submit"
            >
              Mark ready for pickup
            </Button>
            {Object.values(prepared).some(Boolean) && (
              <Button
                className="secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setPrepared(emptyPreparation())}
              >
                Reset preparation checks
              </Button>
            )}
          </div>
        </form>
      )}
      {j.fulfillmentState === "ready_for_pickup" && (
        <form
          className="redeem-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action("redeem", { code })) setCode("");
          }}
        >
          <div>
            <h4>Confirm handoff</h4>
            <p>
              Enter the requester’s pickup code when you hand over this item.
              Codes expire and work once.
            </p>
          </div>
          <Field label="Pickup code">
            <input
              required
              disabled={Boolean(busy)}
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Requester’s code"
            />
          </Field>
          <div className="button-row">
            <Button
              className="primary"
              busy={busy === `${j.id}-redeem`}
              disabled={Boolean(busy)}
              type="submit"
            >
              Redeem & record collection
            </Button>
            {code && (
              <Button
                className="secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setCode("")}
              >
                Discard pickup code
              </Button>
            )}
          </div>
        </form>
      )}
      {j.evidence && (
        <details className="owner-evidence" open={needsReview}>
          <summary>
            Result evidence · {j.evidence.result} ·{" "}
            {j.evidence.source === "simulation" ? "simulated" : "camera"}
          </summary>
          <div className="evidence-review">
            {j.evidence.url ? (
              <ResultImage
                src={j.evidence.url}
                frameKey={JSON.stringify([
                  j.id,
                  j.attemptId,
                  j.evidence.jobId,
                  j.evidence.machineId,
                  j.evidence.capturedAt,
                  j.evidence.source,
                ])}
                alt={`Evidence for order ${shortId(j.id)}`}
                owner
              />
            ) : (
              <Notice>
                No usable result frame was recorded. Inspect the physical
                machine before resolving the outcome.
              </Notice>
            )}
            <div>
              <p>{j.evidence.reason}</p>
              <small>
                Captured {date(j.evidence.capturedAt)}
                <br />
                Machine {j.evidence.machineId}
                <br />
                Completion:{" "}
                {j.evidence.completionCredible ? "credible" : "unconfirmed"}
              </small>
              <p className="fine-print">
                This check establishes visible output, not exact dimensions or
                material properties.
              </p>
            </div>
          </div>
        </details>
      )}
      {j.productionState === "needs_review" && (
        <form
          className="review-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action("review", { result: review, reason }))
              setReviewDraft({ result: "pass", reason: "" });
          }}
        >
          <h4>
            {j.spec.permission === "unclear" && !j.attemptId
              ? "Review artwork permission"
              : "Record an operator decision"}
          </h4>
          <p>
            {j.spec.permission === "unclear" && !j.attemptId
              ? "Confirm the requester’s permission to print this artwork. Allowed artwork returns to requester approval; declined artwork cancels this unpaid order."
              : "Inspect the evidence and machine before overriding the result. Your reason stays in the order history."}
          </p>
          <div className="form-grid">
            <Field label="Reviewed result">
              <select
                disabled={Boolean(busy)}
                value={review}
                onChange={(e) => setReview(e.target.value)}
              >
                <option value="pass">
                  {j.spec.permission === "unclear" && !j.attemptId
                    ? "Allow artwork · permission confirmed"
                    : "Pass · output visibly present"}
                </option>
                <option value="fail">
                  {j.spec.permission === "unclear" && !j.attemptId
                    ? "Decline artwork · permission unconfirmed"
                    : "Fail · output missing or unusable"}
                </option>
              </select>
            </Field>
            <Field label="Reason for decision">
              <input
                required
                disabled={Boolean(busy)}
                minLength={8}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe what you inspected"
              />
            </Field>
          </div>
          <div className="button-row">
            <Button
              className="primary"
              type="submit"
              busy={busy === `${j.id}-review`}
              disabled={Boolean(busy)}
            >
              Record reviewed result
            </Button>
            {(review !== "pass" || reason) && (
              <Button
                className="secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setReviewDraft({ result: "pass", reason: "" })}
              >
                Discard review draft
              </Button>
            )}
          </div>
        </form>
      )}
      {j.productionState === "failed" &&
        !j.history?.some((event) => event.event === "owner_recovery") && (
          <form
            className="review-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action("clear", {
                  inspected: true,
                  cleared: true,
                  reason: clearReason,
                })
              )
                setClearDraft({ inspected: false, reason: "" });
            }}
          >
            <h4>Clear the failed execution</h4>
            <p>
              Inspect the physical machine before clearing its saved execution
              slot. This keeps the machine paused; resume is a separate owner
              action.
            </p>
            <label className="check">
              <input
                type="checkbox"
                required
                disabled={Boolean(busy)}
                checked={clearInspected}
                onChange={(e) => setClearInspected(e.target.checked)}
              />
              <span>I inspected and cleared the output area.</span>
            </label>
            <Field label="Clearance reason">
              <input
                required
                disabled={Boolean(busy)}
                minLength={8}
                value={clearReason}
                onChange={(e) => setClearReason(e.target.value)}
                placeholder="Describe the inspection and clearance"
              />
            </Field>
            <div className="button-row">
              <Button
                className="secondary"
                type="submit"
                busy={busy === `${j.id}-clear`}
                disabled={Boolean(busy) || !clearInspected}
              >
                Clear execution & keep paused
              </Button>
              {(clearInspected || clearReason) && (
                <Button
                  className="secondary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    setClearDraft({ inspected: false, reason: "" })
                  }
                >
                  Discard clearance draft
                </Button>
              )}
            </div>
          </form>
        )}
      <PaymentReferenceForm
        jobId={j.id}
        paymentState={j.paymentState}
        records={ledger}
        busy={Boolean(busy)}
        onSubmit={(values) => action("payment-reference", values)}
      />
      {j.quote && ["produced", "failed"].includes(j.productionState) && (
        <TrialEconomicsForm
          jobId={j.id}
          economics={j.economics}
          simulation={health?.mode !== "hardware"}
          busy={Boolean(busy)}
          onSubmit={(values) => action("economics", values)}
        />
      )}
      {j.abortStatus && (
        <Notice>
          Machine stop status: <strong>{human(j.abortStatus)}</strong>.{" "}
          {j.abortStatus === "stopped"
            ? "The device confirmed that this attempt stopped."
            : "A stop is not confirmed. Inspect and reconcile the machine before any new execution."}
        </Notice>
      )}
      <details className="recovery">
        <summary>Recovery & order history</summary>
        <div className="button-row">
          <Button
            className="secondary"
            busy={busy === `${j.id}-reconcile`}
            disabled={Boolean(busy)}
            onClick={() => {
              void action("reconcile");
            }}
          >
            Reconcile saved outcome
          </Button>
          {j.attemptId && (
            <Button
              className="secondary"
              busy={busy === `${j.id}-verify`}
              disabled={Boolean(busy)}
              onClick={() => {
                void action("verify");
              }}
            >
              Capture fresh evidence
            </Button>
          )}
          {["dispatched", "running", "verifying"].includes(
            j.productionState,
          ) && (
            <button
              className="danger-outline"
              onClick={() => setAbortConfirm(!abortConfirm)}
            >
              Request machine stop
            </button>
          )}
        </div>
        {abortConfirm && (
          <Notice>
            This requests a stop. It does not prove physical stoppage.{" "}
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => {
                void action("abort");
                setAbortConfirm(false);
              }}
            >
              Confirm stop request
            </button>
          </Notice>
        )}
        <p className="fine-print">
          Reconciliation checks the existing execution and payment records. It
          must not silently start a second physical print.
        </p>
        <ol className="owner-history">
          {j.history?.map((event, index) => (
            <li key={index}>
              <time dateTime={event.at}>{date(event.at)}</time>
              <strong>{human(event.event)}</strong>
              {event.reason && <span>{event.reason}</span>}
            </li>
          ))}
        </ol>
      </details>
      {health?.mode === "simulation" && (
        <details className="simulation-controls">
          <summary>Owner simulation controls</summary>
          <p>
            Applies to the machine’s next simulated job. This does not validate
            hardware.
          </p>
          <div className="button-row">
            <select
              aria-label="Next simulation outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="pass">Visible output · pass</option>
              <option value="fail">Missing output · fail</option>
              <option value="review">Ambiguous evidence · review</option>
              <option value="lost_ack">Lost acknowledgment · uncertain</option>
            </select>
            <Button
              className="secondary"
              disabled={Boolean(busy) || !j.machineId}
              busy={busy === `${j.id}-simulation`}
              onClick={() => {
                void simulation(outcome);
              }}
            >
              Set next simulated outcome
            </Button>
          </div>
        </details>
      )}
    </article>
  );
}
function LedgerList({ ledger }: { ledger: Ledger[] }) {
  return ledger?.length ? (
    <div className="ledger-list">
      {ledger.map((item, index) => (
        <div className="ledger-entry" key={item.id || index}>
          <div>
            <strong>
              {human(String(item.kind || item.type || "Payment record"))}
            </strong>
            <small>{item.jobId ? `Order ${shortId(item.jobId)}` : ""}</small>
          </div>
          <Badge>
            {human(String(item.state || item.status || "recorded"))}
          </Badge>
          <strong>{money(Number(item.amountCents ?? item.cents ?? 0))}</strong>
          {Boolean(
            item.transactionRef || item.transactionHash || item.reference,
          ) && (
            <code className="transaction-ref">
              {String(
                item.transactionRef || item.transactionHash || item.reference,
              )}
            </code>
          )}
        </div>
      ))}
    </div>
  ) : (
    <div className="empty compact">
      <p>
        No payment records yet. Confirmed holds, release and refund outcomes
        appear here.
      </p>
    </div>
  );
}
export default App;
