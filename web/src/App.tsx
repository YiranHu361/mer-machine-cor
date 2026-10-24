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
import { MakeApp } from "./MakeApp";
import { ReliefApp } from "./ReliefApp";
import { LivePage, liveEnabled } from "./live";
import { prepareLabelPhoto } from "./label-photo";
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
  registrationId?: string;
  calibrationConfirmationId?: string;
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
  /** Set when the machine prints through the producer side's hub. */
  producerHub?: { machineId: string; since: string };
  policyReconciliationRequired?: boolean;
  calibrationAt?: string;
  reservation?: { jobId: string; expiresAt: string };
  connectorId?: string;
};
type ConnectorCheckView = {
  id: string;
  label: string;
  status: "pending" | "running" | "waiting" | "done" | "failed";
  detail?: string;
  consent?: string;
};
type ConnectorView = {
  id: string;
  machineId: string;
  mode: "simulation" | "hardware";
  hostLabel: string;
  online: boolean;
  lastSeenAt?: string;
  ready: boolean;
  registeredAt?: string;
  checks: ConnectorCheckView[];
};
type SetupCodeView = {
  id: string;
  machineId: string;
  mode: string;
  expiresAt: string;
};
type IssuedSetupCode = SetupCodeView & {
  code: string;
  command: string;
  platformUrl: string;
};
type MachineIdentification = {
  status: "supported" | "unsupported" | "unclear";
  model?: string;
  modelName?: string;
  seen: string | null;
  source: "description" | "photo";
  provider: "claude" | "local";
  message: string;
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
  recommendedMachineId?: string;
};
type Recommendation = {
  status: "recommended" | "unavailable" | "needs_clarification";
  provider: "claude" | "local_analysis";
  reason: string;
  questions: string[];
  spec: Spec | null;
  machine: Machine | null;
  notice?: string;
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
  creationRequestId?: string;
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
  pickupRenewals?: {
    key: string;
    expectedVersion: number;
    expectedExpiresAt: string;
    renewedAt: string;
  }[];
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
const sentence = (v: string) => {
  const text = human(v).trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
};
// Saved records keep their machine vocabulary; people read these phrases.
const productionLabels: Record<string, string> = {
  requested: "Request received",
  specified: "Preview ready",
  approved: "Preview approved",
  quoted: "Price ready",
  payment_confirmed: "Paid · ready to start",
  dispatched: "Sent to the machine",
  running: "Being made",
  verifying: "Checking the result",
  produced: "Made",
  failed: "Didn’t pass the check",
  needs_review: "Needs a review",
  cancelled: "Cancelled",
};
const paymentLabels: Record<string, string> = {
  unpaid: "Not paid",
  collection_pending: "Payment confirming",
  held: "Paid · held",
  release_pending: "Payout confirming",
  released: "Paid out",
  refund_pending: "Refund confirming",
  refunded: "Refunded",
};
const fulfillmentLabels: Record<string, string> = {
  unprepared: "Not made yet",
  awaiting_owner: "Being prepared",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  cancelled: "Cancelled",
};
const eventLabels: Record<string, string> = {
  specified: "Preview prepared",
  specification_approved: "Preview approved",
  approval_invalidated: "Approval reset after a change",
  quoted: "Price quoted",
  mandate_accepted: "Price accepted within budget",
  collection_pending: "Payment started",
  payment_pending: "Payment confirming",
  payment_failed: "Payment failed",
  late_payment: "Payment arrived after the price expired",
  dispatch_authorized: "Production started",
  execution_progress: "Machine progress",
  execution_uncertain: "Machine result uncertain",
  execution_cancellation_requested: "Cancellation requested",
  device_completed: "Machine finished",
  device_failed: "Machine reported a failure",
  completion_review: "Result sent for review",
  content_review: "Artwork sent for review",
  operator_override: "Owner decision recorded",
  owner_recovery: "Owner cleared the machine",
  ready_for_pickup: "Ready for pickup",
  pickup_code_renewed: "Pickup code renewed",
  collected: "Collected",
  cancelled: "Cancelled",
  abort: "Stop requested",
  trial_economics: "Trial costs recorded",
};
const describe = (labels: Record<string, string>, value: string) =>
  labels[value] || sentence(value);
const materialLabel = (value: string) =>
  value === "thermal-paper"
    ? "Thermal sticker paper"
    : value === "photo-film"
      ? "Instax mini film"
      : value.length <= 4
        ? value.toUpperCase()
        : sentence(value);
function requesterStatus(job: Job) {
  if (job.productionState === "cancelled") return "Cancelled";
  if (job.fulfillmentState === "collected") return "Collected";
  if (job.fulfillmentState === "ready_for_pickup") return "Ready for pickup";
  if (
    job.productionState === "produced" &&
    job.fulfillmentState === "awaiting_owner"
  )
    return "Being prepared";
  return describe(productionLabels, job.productionState);
}
const statusTone = (job: Job) =>
  job.productionState === "cancelled"
    ? "neutral"
    : ["failed", "needs_review"].includes(job.productionState)
      ? "amber"
      : job.productionState === "produced"
        ? "green"
        : ["specified", "approved", "quoted", "payment_confirmed"].includes(
              job.productionState,
            )
          ? "blue"
          : "neutral";
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

function validSavedJob(value: unknown): value is Job {
  const returned = value as Job | null | undefined;
  const quote = returned?.quote;
  const validQuote =
    quote !== null &&
    typeof quote === "object" &&
    typeof quote.id === "string" &&
    quote.id.trim().length > 0 &&
    Number.isSafeInteger(quote.version) &&
    quote.version > 0 &&
    typeof quote.expiresAt === "string" &&
    Number.isFinite(Date.parse(quote.expiresAt)) &&
    Array.isArray(quote.items) &&
    quote.items.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.label === "string" &&
        Number.isSafeInteger(item.cents) &&
        item.cents >= 0,
    ) &&
    [quote.totalCents, quote.ownerCents, quote.platformCents].every(
      (amount) => Number.isSafeInteger(amount) && amount >= 0,
    ) &&
    quote.ownerCents + quote.platformCents === quote.totalCents &&
    quote.currency === "USD" &&
    ["mock", "testnet"].includes(quote.paymentMode) &&
    typeof quote.collectionPoint === "string" &&
    (quote.accepted === undefined || typeof quote.accepted === "boolean");
  return !(
    !returned ||
    (quote !== undefined && !validQuote) ||
    (returned.productionState === "quoted" && !quote) ||
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
    ].every((field) => typeof field === "string" && field.trim().length > 0) ||
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
}

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
  const isRelief = location.pathname.startsWith("/relief");
  const isMake = location.pathname.startsWith("/make");
  const isLive = liveEnabled && location.pathname.startsWith("/live");
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
      if (s.role === null && !isOwner && !isRelief)
        setSession(await api<Session>("/session", { role: "requester" }));
      else setSession(s.role ? s : null);
    } catch (e) {
      setBootError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }, [isOwner, isRelief]);
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
          fabrary
        </a>
        <nav aria-label="Main navigation">
          {isOwner || isRelief ? (
            <>
              <a href="/">Make something</a>
              <a href={isRelief ? "/owner" : "/relief"}>
                {isRelief ? "Owner workshop" : "Relief"}
              </a>
            </>
          ) : (
            <>
              <a href={isMake ? "/" : "/make"}>
                {isMake ? "Choose a machine myself" : "Just ask"}
              </a>
              <a href="/owner">Owner workshop</a>
              {liveEnabled && <a href="/live">Live</a>}
            </>
          )}
        </nav>
      </header>
      {!live && (
        <p className="connection-alert" role="status">
          Connection lost · retrying
        </p>
      )}
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
        {isLive ? (
          <LivePage />
        ) : boot ? (
          <div className="loading-shell" role="status">
            <span className="spinner" /> Opening the workshop…
          </div>
        ) : bootError ? (
          <div className="error-shell">
            <h1>The workshop is offline.</h1>
            <p role="alert">{bootError}</p>
            <p className="fine-print">
              Saved orders stay saved. Trying again only reconnects; it never
              repeats a payment or a machine run.
            </p>
            <Button className="primary" onClick={bootApp}>
              Try again
            </Button>
          </div>
        ) : isRelief ? (
          <ReliefApp session={session} />
        ) : isMake && session ? (
          <MakeApp key={`${session.role}:${session.id}`} />
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
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [manualSettings, setManualSettings] = useState(false);
  const [requiresRecommendation, setRequiresRecommendation] = useState(false);
  const [requiresFreshRecommendation, setRequiresFreshRecommendation] =
    useState(false);
  const [permissionReviewRequested, setPermissionReviewRequested] =
    useState(false);
  const analysisSequence = useRef(0);
  const recommendationSection = useRef<HTMLElement>(null);
  const analysisNotice = useRef<HTMLDivElement>(null);
  const pictureContext = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (
      !analyzing &&
      (analysisError ||
        recommendation?.status === "needs_clarification" ||
        recommendation?.status === "unavailable")
    ) {
      if (pictureContext.current) pictureContext.current.open = true;
    }
  }, [analyzing, analysisError, recommendation?.status]);
  const [editingBaseline, setEditingBaseline] = useState<{
    id: string;
    version: number;
    signature: string;
  } | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const recoveryContext = useRef(0);
  const recoveryInteraction = useRef(0);
  const ordersSection = useRef<HTMLElement>(null);
  const draftsHeading = useRef<HTMLHeadingElement>(null);
  // Keep empty and incomplete native number input text until submission.
  // Converting every keystroke turns a cleared field (or "5e") into zero.
  type SpecDraft = Omit<Spec, "widthMm" | "heightMm" | "quantity"> & {
    widthMm: number | string;
    heightMm: number | string;
    quantity: number | string;
  };
  type RequesterDraft = {
    spec: SpecDraft;
    assets: Asset[];
    budgetEnabled: boolean;
    budget: string;
    intakeDraft: IntakeDraft | null;
    intakeError: string;
    baseline: typeof editingBaseline;
    conflict: boolean;
    job: Job | null;
    recommendation: Recommendation | null;
    analysisError: string;
    manualSettings: boolean;
    requiresRecommendation: boolean;
    requiresFreshRecommendation: boolean;
    permissionReviewRequested: boolean;
  };
  const cachedDrafts = useRef(new Map<string, RequesterDraft>());
  const [, setDraftRevision] = useState(0);
  const [pendingCreation, setPendingCreation] = useState<{
    id: string;
    submittedSpec: Spec;
    signature: string;
  } | null>(null);
  const unresolvedCreation = pendingCreation !== null;
  const [recoveryReadyFor, setRecoveryReadyFor] = useState<string | null>(null);
  useEffect(() => {
    // Announce the completed error before exposing its recovery action. An
    // immediately activated control must not lose focus to a later Notice effect.
    setRecoveryReadyFor(unresolvedCreation && !busy ? error : null);
  }, [unresolvedCreation, busy, error]);
  const [spec, setSpec] = useState<SpecDraft>({
    assetIds: [],
    intent: "",
    outputType: "sticker",
    widthMm: 53,
    heightMm: 50,
    quantity: 1,
    material: "thermal-paper",
    permission: "unclear",
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
      value.recommendedMachineId ?? null,
    ]);
  const [editing, setEditing] = useState(false);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [intakeError, setIntakeError] = useState("");
  const formSignature = (
    value: SpecDraft,
    enabled: boolean,
    cap: string,
    originals: Asset[] = [],
    intake: IntakeDraft | null = null,
    reviewRequested = false,
  ) =>
    JSON.stringify([
      draftSignature(value),
      enabled,
      cap === "" ? "" : Number(cap),
      originals,
      intake,
      reviewRequested,
    ]);
  const activeDraftKey = !current ? "new" : editing ? current.id : null;
  const activeSignature = formSignature(
    spec,
    budgetEnabled,
    budget,
    assets,
    intakeDraft,
    permissionReviewRequested,
  );
  const unsavedDraft =
    activeDraftKey !== null &&
    activeSignature !==
      (editingBaseline?.signature ||
        formSignature(pristineDraft.current, false, "3.00"));
  const hiddenDrafts = [...cachedDrafts.current.entries()].filter(
    ([key]) => key !== activeDraftKey,
  );
  const confirmLeaving =
    Boolean(busy) ||
    requiresFreshRecommendation ||
    unsavedDraft ||
    hiddenDrafts.length > 0 ||
    unresolvedCreation;
  useEffect(() => {
    if (!confirmLeaving || session?.role !== "requester") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [confirmLeaving, session?.role]);
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
      analysisSequence.current++;
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
  const focusDrafts = () => {
    const initiatingElement = document.activeElement;
    const interaction = recoveryInteraction.current;
    requestAnimationFrame(() => {
      if (
        !mounted.current ||
        interaction !== recoveryInteraction.current ||
        (document.activeElement !== initiatingElement &&
          document.activeElement !== document.body)
      )
        return;
      draftsHeading.current?.focus({ preventScroll: true });
      draftsHeading.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
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
      if (!Array.isArray(j.jobs) || !j.jobs.every(validSavedJob))
        throw new ApiError(
          "Saved orders could not be confirmed. Your last saved view is kept; refresh to recover.",
          "invalid_response",
          0,
        );
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
  const cacheChanged = () => setDraftRevision((revision) => revision + 1);
  const stashActiveDraft = () => {
    if (activeDraftKey === null) return;
    if (
      unsavedDraft ||
      requiresFreshRecommendation ||
      (activeDraftKey === "new" && unresolvedCreation)
    ) {
      cachedDrafts.current.set(activeDraftKey, {
        spec,
        assets,
        budgetEnabled,
        budget,
        intakeDraft,
        intakeError,
        baseline: editingBaseline,
        conflict: editConflict,
        job: editing ? current : null,
        recommendation,
        analysisError,
        manualSettings,
        requiresRecommendation,
        requiresFreshRecommendation,
        permissionReviewRequested,
      });
      cacheChanged();
    } else if (cachedDrafts.current.delete(activeDraftKey)) cacheChanged();
  };
  const forgetDraft = (key: string) => {
    if (cachedDrafts.current.delete(key)) cacheChanged();
  };
  const restoreDraft = (draft: RequesterDraft) => {
    setSpec(draft.spec);
    setAssets(draft.assets);
    setBudgetEnabled(draft.budgetEnabled);
    setBudget(draft.budget);
    setIntakeDraft(draft.intakeDraft);
    setIntakeError(draft.intakeError);
    setEditingBaseline(draft.baseline);
    setEditConflict(draft.conflict);
    setRecommendation(draft.recommendation);
    setAnalysisError(draft.analysisError);
    setManualSettings(draft.manualSettings);
    setRequiresRecommendation(
      Boolean(
        draft.requiresRecommendation ||
        draft.spec.recommendedMachineId ||
        draft.recommendation,
      ),
    );
    setRequiresFreshRecommendation(Boolean(draft.requiresFreshRecommendation));
    setPermissionReviewRequested(draft.permissionReviewRequested);
    setEditing(draft.job !== null);
    setError("");
  };
  const select = (job: Job, preserveDraft = true) => {
    if (!mounted.current) return;
    if (preserveDraft) stashActiveDraft();
    // A similar specification cannot identify an interrupted creation: another
    // tab may have submitted it too. Only its server-bound request id can.
    if (pendingCreation && job.creationRequestId === pendingCreation.id) {
      const newerDraft = cachedDrafts.current.get("new");
      if (
        newerDraft &&
        formSignature(
          newerDraft.spec,
          newerDraft.budgetEnabled,
          newerDraft.budget,
          newerDraft.assets,
          newerDraft.intakeDraft,
          newerDraft.permissionReviewRequested,
        ) === pendingCreation.signature
      )
        forgetDraft("new");
      setPendingCreation(null);
    }
    recoveryContext.current++;
    resetAnalysis();
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
    // Cached replacements remain private to their original draft. A saved
    // order always displays its own sources until that draft is resumed.
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setEditing(false);
    setError("");
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
    const requestedJobId = current.id;
    const requestedMachineId = current.spec.recommendedMachineId ?? null;
    const requestedSpecVersion = current.specVersion;
    const requestedArtifactSha256 = current.artifact?.sha256;
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
      if (
        !validSavedJob(job) ||
        job.id !== requestedJobId ||
        (job.spec.recommendedMachineId ?? null) !== requestedMachineId ||
        (action === "approve-and-quote" &&
          (job.specVersion !== requestedSpecVersion ||
            job.artifact?.sha256 !== requestedArtifactSha256 ||
            job.productionState !== "quoted" ||
            !job.quote ||
            (requestedMachineId !== null &&
              job.machineId !== requestedMachineId)))
      )
        throw new ApiError(
          "The order update could not be matched to this saved order and machine. Its result is unknown; refresh saved orders before another action.",
          "invalid_response",
          0,
          true,
        );
      select(job);
    });
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
    const context = recoveryContext.current;
    const shouldAnalyze =
      !editing ||
      !manualSettings ||
      requiresRecommendation ||
      Boolean(spec.recommendedMachineId) ||
      spec.outputType === "3d";
    const sequence = ++analysisSequence.current;
    setAnalyzing(false);
    setRecommendation(null);
    setAnalysisError("");
    let uploaded: Asset[] | null = null;
    await act("upload", async () => {
      const form = new FormData();
      list.forEach((file) => form.append("images", file));
      const result = await api<{ assets: Asset[] }>("/uploads", form);
      if (
        !mounted.current ||
        sequence !== analysisSequence.current ||
        context !== recoveryContext.current
      )
        return;
      setAssets(result.assets);
      setIntakeDraft(null);
      setIntakeError("");
      setManualSettings(shouldAnalyze ? false : manualSettings);
      setRequiresRecommendation(shouldAnalyze);
      setRequiresFreshRecommendation(shouldAnalyze);
      setPermissionReviewRequested(false);
      setSpec((s) => ({
        ...s,
        assetIds: result.assets.map((a) => a.id),
        permission: "unclear",
        recommendedMachineId: undefined,
      }));
      uploaded = result.assets;
    });
    if (
      shouldAnalyze &&
      uploaded &&
      mounted.current &&
      context === recoveryContext.current &&
      sequence === analysisSequence.current
    )
      void analyzePictures(uploaded, spec.intent);
  };
  const resetAnalysis = () => {
    analysisSequence.current++;
    setAnalyzing(false);
    setRecommendation(null);
    setAnalysisError("");
    setManualSettings(false);
    setRequiresRecommendation(false);
    setRequiresFreshRecommendation(false);
    setPermissionReviewRequested(false);
  };
  const useManualSettings = () => {
    analysisSequence.current++;
    setAnalyzing(false);
    setAnalysisError("");
    setManualSettings(true);
  };
  const analyzePictures = async (originals: Asset[], intent: string) => {
    if (!originals.length) return;
    const sequence = ++analysisSequence.current;
    const context = recoveryContext.current;
    const initiatingElement = document.activeElement;
    const interaction = recoveryInteraction.current;
    const assetIds = originals.map((asset) => asset.id);
    setAnalyzing(true);
    setRequiresRecommendation(true);
    setRequiresFreshRecommendation(true);
    setAnalysisError("");
    setRecommendation(null);
    setManualSettings(false);
    try {
      const result = await api<Recommendation>("/recommendations", {
        assetIds,
        intent,
      });
      if (
        !mounted.current ||
        sequence !== analysisSequence.current ||
        context !== recoveryContext.current
      )
        return;
      const shapeValid =
        result &&
        ["recommended", "unavailable", "needs_clarification"].includes(
          result.status,
        ) &&
        ["claude", "local_analysis"].includes(result.provider) &&
        typeof result.reason === "string" &&
        result.reason.trim() &&
        Array.isArray(result.questions) &&
        result.questions.every((question) => typeof question === "string") &&
        (result.notice === undefined || typeof result.notice === "string");
      const saved = result?.spec;
      const machine = result?.machine;
      const imageSpecValid =
        saved &&
        ["sticker", "instax"].includes(saved.outputType) &&
        JSON.stringify(saved.assetIds) === JSON.stringify(assetIds) &&
        typeof saved.intent === "string" &&
        saved.intent.trim().length >= 3 &&
        saved.intent.length <= 2000 &&
        saved.quantity === 1 &&
        saved.permission === "unclear" &&
        [saved.widthMm, saved.heightMm].every(
          (value) => Number.isSafeInteger(value) && value > 0 && value <= 300,
        ) &&
        ["contain", "cover"].includes(saved.crop) &&
        saved.material ===
          (saved.outputType === "instax" ? "photo-film" : "thermal-paper");
      const recommendationValid =
        result?.status !== "recommended"
          ? result?.machine === null &&
            (result?.status === "unavailable"
              ? result?.spec === null || imageSpecValid
              : result?.spec === null)
          : imageSpecValid &&
            saved &&
            machine &&
            machine.outputType === saved.outputType &&
            typeof machine.id === "string" &&
            machine.id &&
            typeof machine.name === "string" &&
            typeof machine.model === "string" &&
            saved.recommendedMachineId === machine.id;
      if (!shapeValid || !recommendationValid)
        throw new Error(
          "The recommendation could not be confirmed. Your pictures are kept. Try the analysis again.",
        );
      setRecommendation(result);
      if (result.status === "recommended" && saved) {
        setRequiresFreshRecommendation(false);
        setSpec((previous) => ({
          assetIds,
          intent: saved.intent,
          outputType: saved.outputType,
          widthMm: saved.widthMm,
          heightMm: saved.heightMm,
          quantity: 1,
          material: saved.material,
          crop: saved.crop,
          permission: previous.permission,
          recommendedMachineId: saved.recommendedMachineId,
        }));
        setIntakeDraft((previous) =>
          previous?.contentReview === "review" ? previous : null,
        );
        setIntakeError("");
      }
      requestAnimationFrame(() => {
        if (
          !mounted.current ||
          sequence !== analysisSequence.current ||
          context !== recoveryContext.current ||
          interaction !== recoveryInteraction.current ||
          (document.activeElement !== initiatingElement &&
            document.activeElement !== document.body)
        )
          return;
        recommendationSection.current?.focus({ preventScroll: true });
        recommendationSection.current?.scrollIntoView({
          block: "nearest",
          behavior: "instant",
        });
      });
    } catch (error) {
      if (
        mounted.current &&
        sequence === analysisSequence.current &&
        context === recoveryContext.current
      ) {
        setAnalysisError((error as Error).message);
        requestAnimationFrame(() => {
          if (
            !mounted.current ||
            sequence !== analysisSequence.current ||
            context !== recoveryContext.current ||
            interaction !== recoveryInteraction.current ||
            (document.activeElement !== initiatingElement &&
              document.activeElement !== document.body)
          )
            return;
          analysisNotice.current?.focus({ preventScroll: true });
          analysisNotice.current?.scrollIntoView({
            block: "nearest",
            behavior: "instant",
          });
        });
      }
    } finally {
      if (
        mounted.current &&
        sequence === analysisSequence.current &&
        context === recoveryContext.current
      )
        setAnalyzing(false);
    }
  };
  const suggestSpecification = async () => {
    useManualSettings();
    setBusy("intake");
    setIntakeError("");
    setError("");
    try {
      const { draft } = await api<{ draft: IntakeDraft }>("/intake", {
        assetIds: spec.assetIds,
        intent: spec.intent,
      });
      const reviewRequired =
        intakeDraft?.contentReview === "review" ||
        draft.contentReview === "review";
      setIntakeDraft((previous) =>
        previous?.contentReview === "review"
          ? { ...draft, contentReview: "review", reason: previous.reason }
          : draft,
      );
      if (draft.outputType && draft.outputType !== spec.outputType) {
        analysisSequence.current++;
        setRequiresRecommendation(true);
        setRequiresFreshRecommendation(true);
        setManualSettings(false);
        setRecommendation(null);
        setIntakeError(
          draft.outputType === "3d"
            ? "Pictures cannot be converted into a 3D print here. Ask the agent to find a supported image output instead."
            : "This suggestion needs a different output. Ask the agent to find a suitable machine before making a new production preview. The previous machine choice is kept until a new recommendation is confirmed.",
        );
        if (reviewRequired)
          setSpec((current) => ({ ...current, permission: "unclear" }));
        return;
      }
      setSpec((current) => {
        return {
          ...current,
          widthMm: draft.widthMm ?? current.widthMm,
          heightMm: draft.heightMm ?? current.heightMm,
          quantity: draft.quantity ?? current.quantity,
          crop: draft.crop,
          permission: reviewRequired ? "unclear" : current.permission,
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
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((!editing && unresolvedCreation) || editConflict) return;
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
      requiresFreshRecommendation ||
      (!manualSettings && recommendation?.status !== "recommended") ||
      ((!editing || requiresRecommendation) && !spec.recommendedMachineId)
    ) {
      setError(
        "Find a suitable machine for these pictures before making the production preview.",
      );
      return;
    }
    if (
      spec.permission !== "authorized" &&
      !(manualSettings && permissionReviewRequested)
    ) {
      setError(
        "Confirm that you own these pictures or have permission to print them before continuing.",
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
      intent:
        numericSpec.intent.trim().length < 3
          ? numericSpec.outputType === "3d"
            ? "Owner-prepared workshop model"
            : "Picture for a workshop print"
          : numericSpec.intent,
      budgetMandate: budgetEnabled
        ? { enabled: true as const, capCents: Math.round(Number(budget) * 100) }
        : undefined,
    };
    const submittedKey = activeDraftKey;
    const submittedJobId = editing ? current?.id : null;
    const submittedSignature = activeSignature;
    const creationRequestId = editing ? null : crypto.randomUUID();
    await act("create", async () => {
      let result: { job: Job };
      try {
        result = await api<{ job: Job }>(
          editing && current ? `/jobs/${current.id}/spec` : "/jobs",
          value,
          editing ? "PATCH" : undefined,
          editing && current && editingBaseline?.id === current.id
            ? { headers: { "If-Match": `"${editingBaseline.version}"` } }
            : creationRequestId
              ? { headers: { "Idempotency-Key": creationRequestId } }
              : undefined,
        );
        if (
          !validSavedJob(result?.job) ||
          (editing
            ? result.job.id !== submittedJobId
            : result.job.creationRequestId !== creationRequestId) ||
          (result.job.spec.recommendedMachineId ?? null) !==
            (value.recommendedMachineId ?? null)
        )
          throw new ApiError(
            "The order response could not be matched to this request. Its result is unknown; check saved orders before trying again.",
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
          setPendingCreation({
            id: creationRequestId!,
            submittedSpec: value,
            signature: submittedSignature,
          });
          void refresh();
        }
        throw error;
      }
      if (submittedKey !== null) forgetDraft(submittedKey);
      select(result.job, false);
      setEditing(false);
      focusProduction();
    });
  };
  const newOrder = () => {
    stashActiveDraft();
    recoveryContext.current++;
    resetAnalysis();
    setEditingBaseline(null);
    setEditConflict(false);
    selectedId.current = null;
    removeStoredValue("local", "fabrary-current-job");
    setCurrent(null);
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setSpec(pristineDraft.current);
    setBudgetEnabled(false);
    setBudget("3.00");
    setEditing(false);
    setError("");
    const cached = cachedDrafts.current.get("new");
    if (cached) restoreDraft(cached);
    focusProduction();
  };
  const discardDraft = (key: string) => {
    if (busy) return;
    const initiatingElement = document.activeElement;
    forgetDraft(key);
    if (key === "new") {
      setPendingCreation(null);
      if (activeDraftKey === "new") {
        recoveryContext.current++;
        resetAnalysis();
        setSpec(pristineDraft.current);
        setAssets([]);
        setBudgetEnabled(false);
        setBudget("3.00");
        setIntakeDraft(null);
        setIntakeError("");
        setError("");
      }
    }
    requestAnimationFrame(() => {
      if (
        mounted.current &&
        (document.activeElement === initiatingElement ||
          document.activeElement === document.body)
      ) {
        const target =
          document.querySelector<HTMLButtonElement>(
            ".requester-drafts button:not(:disabled)",
          ) || productionHeading.current;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    });
  };
  const cancelEdit = () => {
    if (current) forgetDraft(current.id);
    recoveryContext.current++;
    resetAnalysis();
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
    resetAnalysis();
    setManualSettings(true);
    setRequiresRecommendation(Boolean(job.spec.recommendedMachineId));
    const initialBudget = String(
      (job.spec.budgetMandate?.capCents || 300) / 100,
    );
    setEditingBaseline({
      id: job.id,
      version: job.version,
      signature: formSignature(
        job.spec,
        Boolean(job.spec.budgetMandate?.enabled),
        initialBudget,
      ),
    });
    setEditConflict(false);
    setPreviewVisit((visit) => visit + 1);
    setAssets([]);
    setIntakeDraft(null);
    setIntakeError("");
    setSpec(job.spec);
    setBudgetEnabled(Boolean(job.spec.budgetMandate?.enabled));
    setBudget(initialBudget);
    setEditing(true);
    setError("");
    const cached = cachedDrafts.current.get(job.id);
    if (cached) restoreDraft(cached);
    focusProduction();
  };
  const resumeDraft = (key: string, draft: RequesterDraft) => {
    if (busy) return;
    if (key === "new") newOrder();
    else if (draft.job) {
      const job = jobs.find((item) => item.id === key) || draft.job;
      select(job);
      beginEdit(job);
    }
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
      forgetDraft(current.id);
      select(job, false);
      beginEdit(job);
    });
  };
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
          className="primary"
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
  const splitIntake = !current && assets.length > 0;
  const needsMatch =
    requiresFreshRecommendation ||
    (!manualSettings && recommendation?.status !== "recommended") ||
    ((!editing || requiresRecommendation) && !spec.recommendedMachineId);
  const needsPermission =
    spec.assetIds.length > 0 &&
    spec.permission !== "authorized" &&
    !(manualSettings && permissionReviewRequested);
  // One sentence explains a disabled preview action instead of a silent button.
  const previewBlocker =
    busy === "upload"
      ? "Uploading your pictures…"
      : analyzing
        ? "Matching a machine to your pictures…"
        : !editing && unresolvedCreation
          ? "Resolve the earlier request above first."
          : editConflict
            ? "Load the saved specification above first."
            : needsMatch
              ? recommendation?.status === "unavailable"
                ? "No suitable machine is available for these pictures yet."
                : "Find a suitable machine for these pictures first."
              : needsPermission
                ? "Confirm you can print these pictures to continue."
                : "";
  return (
    <div
      className={`requester ${!current ? "picture-first" : ""} ${splitIntake ? "picture-split" : ""}`}
      onFocusCapture={() => {
        recoveryInteraction.current++;
      }}
      onInputCapture={(event) => {
        recoveryInteraction.current++;
        // A stored selection can still be loading while this new-order form
        // is visible. Once the requester types, keep that explicit new draft
        // instead of letting a late startup/read-retry adopt the old order.
        if (
          !current &&
          selectedId.current &&
          event.target instanceof HTMLElement &&
          event.target.closest(".intake-panel form")
        ) {
          recoveryContext.current++;
          selectedId.current = null;
          removeStoredValue("local", "fabrary-current-job");
        }
      }}
    >
      <div className="requester-notices">
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
            A newer version of this order is saved. Your draft is kept here.
            Load the saved specification, then reapply the changes you want.
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
            The earlier new-order request may still finish. Check your saved
            orders and open the one marked “Matches interrupted request” to
            resolve it. Browsing other orders keeps this draft protected. It
            will not be submitted again automatically.
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={Boolean(busy) || recoveryReadyFor !== error}
                onClick={() => {
                  void checkSavedOrders();
                }}
              >
                Check saved orders
              </button>
              <button
                type="button"
                className="text-button"
                disabled={Boolean(busy)}
                onClick={() => discardDraft("new")}
              >
                Discard interrupted draft
              </button>
            </div>
          </Notice>
        )}
      </div>
      {hiddenDrafts.length > 0 && (
        <section
          className="requester-drafts"
          aria-labelledby="requester-drafts-title"
        >
          <h2 id="requester-drafts-title" ref={draftsHeading} tabIndex={-1}>
            Your unsaved drafts
          </h2>
          <p>
            Kept privately in this requester session. Resume to continue, or
            discard a draft you no longer need. Closing the browser can lose it.
          </p>
          <ul>
            {hiddenDrafts.map(([key, draft]) => (
              <li key={key}>
                <div>
                  <h3>
                    {key === "new" ? "New order draft" : `Edit ${shortId(key)}`}
                  </h3>
                  <p>{draft.spec.intent || "Untitled artwork"}</p>
                  <small>
                    {outputLabels[draft.spec.outputType]}
                    {draft.baseline
                      ? ` · saved version ${draft.baseline.version}`
                      : ""}
                    {key === "new" && unresolvedCreation
                      ? " · request unresolved"
                      : ""}
                  </small>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy)}
                    aria-label={
                      key === "new"
                        ? "Resume new order draft"
                        : `Resume edit ${shortId(key)}`
                    }
                    onClick={() => resumeDraft(key, draft)}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={Boolean(busy)}
                    aria-label={
                      key === "new"
                        ? "Discard new order draft"
                        : `Discard edit ${shortId(key)}`
                    }
                    onClick={() => discardDraft(key)}
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={`workbench ${!current ? "upload-workbench" : ""}`}>
        <section className="intake-panel">
          <div className="panel-heading">
            <h1 ref={productionHeading} tabIndex={-1}>
              {current && !editing
                ? "Your preview"
                : editing
                  ? "Edit item"
                  : "Upload your pictures"}
            </h1>
            {current && (
              <button
                className="text-button new-order"
                onClick={newOrder}
                disabled={Boolean(busy)}
              >
                {cachedDrafts.current.has("new")
                  ? "Resume new draft"
                  : "New order"}
              </button>
            )}
          </div>
          {hiddenDrafts.length > 0 && (
            <p className="context-note draft-shortcut">
              Your other drafts are kept in this session.{" "}
              <button
                type="button"
                className="text-button"
                onClick={focusDrafts}
              >
                View unsaved drafts
              </button>
            </p>
          )}
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
              <div className="preview-summary">
                <ul className="spec-strip" aria-label="Item details">
                  <li>{outputLabels[current.spec.outputType]}</li>
                  <li>
                    {current.spec.widthMm} × {current.spec.heightMm}
                    {current.spec.outputType === "3d"
                      ? ` × ${current.spec.depthMm}`
                      : ""}{" "}
                    mm
                  </li>
                  <li>Qty {current.spec.quantity}</li>
                  <li>{materialLabel(current.spec.material)}</li>
                </ul>
                <p className="order-intent">{current.spec.intent}</p>
                {["specified", "approved", "quoted"].includes(
                  current.productionState,
                ) &&
                  current.paymentState === "unpaid" && (
                    <button
                      className="text-button"
                      onClick={edit}
                      disabled={Boolean(busy)}
                    >
                      Edit item
                    </button>
                  )}
              </div>
            </>
          ) : (
            <form
              onSubmit={submit}
              aria-busy={Boolean(busy) || analyzing}
              onInvalidCapture={(event) => {
                if (event.target instanceof HTMLElement) {
                  const disclosure = event.target.closest("details");
                  if (disclosure instanceof HTMLDetailsElement) {
                    disclosure.open = true;
                    const field = event.target;
                    if (
                      event.currentTarget.querySelector(
                        "input:invalid, select:invalid, textarea:invalid",
                      ) !== field
                    )
                      return;
                    const initiatingElement = document.activeElement;
                    const interaction = recoveryInteraction.current;
                    const context = recoveryContext.current;
                    requestAnimationFrame(() => {
                      if (
                        !mounted.current ||
                        context !== recoveryContext.current ||
                        interaction !== recoveryInteraction.current ||
                        (document.activeElement !== initiatingElement &&
                          document.activeElement !== document.body)
                      )
                        return;
                      field.focus({ preventScroll: true });
                      field.scrollIntoView({
                        block: "nearest",
                        behavior: "instant",
                      });
                    });
                  }
                }
              }}
            >
              <fieldset
                disabled={Boolean(busy)}
                className={`intake-fields ${assets.length || editing ? "has-pictures" : ""}`}
              >
                <div
                  className={`intake-stage ${dragging ? "dragging" : ""}`}
                  onDragOver={(event) => {
                    if (!Array.from(event.dataTransfer.types).includes("Files"))
                      return;
                    event.preventDefault();
                    if (!dragging) setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    )
                      setDragging(false);
                  }}
                  onDrop={(event) => {
                    if (!Array.from(event.dataTransfer.types).includes("Files"))
                      return;
                    // Handle the drop once here, including drops onto the
                    // native file input, so a replacement uploads only once.
                    event.preventDefault();
                    setDragging(false);
                    if (!busy) void upload(event.dataTransfer.files);
                  }}
                >
                  <label
                    className={`upload-zone picture-upload ${assets.length ? "has-pictures" : ""} ${busy === "upload" ? "uploading" : ""}`}
                  >
                    <input
                      aria-label="Upload artwork"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      onChange={(event) => {
                        void upload(event.target.files);
                        event.target.value = "";
                      }}
                      disabled={Boolean(busy)}
                    />
                    <span className="upload-symbol" aria-hidden="true">
                      {busy === "upload" ? (
                        <span className="spinner" />
                      ) : (
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="upload-copy">
                      <strong>
                        {busy === "upload"
                          ? "Uploading…"
                          : assets.length
                            ? "Replace pictures"
                            : "Add pictures"}
                      </strong>
                      {!assets.length && busy !== "upload" && (
                        <span>Drop or choose up to 4</span>
                      )}
                    </span>
                  </label>
                  {(assets.length > 0 || editing) && (
                    <div
                      className={`originals count-${Math.min(assets.length, 4)}`}
                    >
                      {assets.map((asset) => (
                        <figure key={asset.id}>
                          <img
                            src={asset.url}
                            alt="Uploaded original artwork"
                          />
                        </figure>
                      ))}
                      {editing && !assets.length && (
                        <p>
                          The existing artwork stays selected. Upload pictures
                          to replace it.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="intake-side">
                  {(assets.length > 0 ||
                    editing ||
                    analyzing ||
                    recommendation) && (
                    <section
                      className={`picture-recommendation ${analyzing ? "is-analyzing" : recommendation ? `is-${recommendation.status}` : ""}`}
                      ref={recommendationSection}
                      tabIndex={-1}
                      aria-label="Machine recommendation"
                      aria-live="polite"
                      aria-busy={analyzing}
                    >
                      {analyzing ? (
                        <div className="analysis-progress" role="status">
                          <span className="spinner" aria-hidden="true" />
                          <div>
                            <strong>Finding the right machine…</strong>
                            <p>
                              Checking your pictures against this workshop’s
                              supported machines. You can replace the pictures
                              while this runs.
                            </p>
                          </div>
                        </div>
                      ) : null}
                      {analyzing ? (
                        // Holds the recommendation's shape so controls below
                        // do not jump when the result arrives.
                        <div className="analysis-skeleton" aria-hidden="true">
                          <span className="skeleton-device" />
                          <span className="skeleton-chips">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className="skeleton-line" />
                        </div>
                      ) : recommendation ? (
                        <>
                          <p className="recommendation-meta">
                            <span
                              className={`status-dot ${recommendation.status === "recommended" ? "ok" : "warn"}`}
                              aria-hidden="true"
                            />
                            {recommendation.status === "recommended"
                              ? "Suitable machine found"
                              : "Needs your attention"}
                            <span aria-hidden="true"> · </span>
                            {recommendation.provider === "claude"
                              ? "Agent recommendation"
                              : "Local picture analysis"}
                          </p>
                          <h3>
                            {recommendation.status === "recommended" &&
                            recommendation.spec
                              ? outputLabels[recommendation.spec.outputType]
                              : recommendation.status === "needs_clarification"
                                ? "A little more context would help"
                                : "No suitable machine right now"}
                          </h3>
                          {recommendation.machine &&
                            recommendation.status === "recommended" && (
                              <p className="recommended-device">
                                <strong>{recommendation.machine.name}</strong> ·{" "}
                                {recommendation.machine.model} ·{" "}
                                {recommendation.machine.mode === "simulation"
                                  ? "Simulated device"
                                  : "Hardware · owner readiness required"}
                              </p>
                            )}
                          {recommendation.spec &&
                            recommendation.status === "recommended" && (
                              <ul
                                className="recommendation-facts"
                                aria-label="Prepared settings"
                              >
                                <li>
                                  {spec.widthMm || "—"} × {spec.heightMm || "—"}{" "}
                                  mm
                                </li>
                                <li>
                                  {spec.quantity || "—"}{" "}
                                  {Number(spec.quantity) === 1
                                    ? "item"
                                    : "items"}
                                </li>
                                <li>
                                  {recommendation.spec.outputType === "sticker"
                                    ? "Black and white"
                                    : "Fixed photo film"}
                                </li>
                              </ul>
                            )}
                          {recommendation.status !== "recommended" && (
                            <p className="recommendation-reason">
                              {recommendation.reason}
                            </p>
                          )}
                          {recommendation.questions.length > 0 && (
                            <ul className="recommendation-questions">
                              {recommendation.questions.map(
                                (question, index) => (
                                  <li key={index}>{question}</li>
                                ),
                              )}
                            </ul>
                          )}
                          {recommendation.status !== "recommended" && (
                            <p className="recommendation-next">
                              {recommendation.status === "needs_clarification"
                                ? "Answer in a short note below, then check again."
                                : "Add a note below or check again later. Your pictures are kept."}
                            </p>
                          )}
                          <details className="recommendation-details">
                            <summary>
                              {recommendation.status === "recommended"
                                ? "Why this fits"
                                : "About this analysis"}
                            </summary>
                            {recommendation.status === "recommended" && (
                              <p>{recommendation.reason}</p>
                            )}
                            {recommendation.notice && (
                              <p className="recommendation-limits">
                                {recommendation.notice}
                              </p>
                            )}
                            <p className="analysis-source">
                              {recommendation.provider === "local_analysis"
                                ? "Local analysis is being used. No AI service reviewed these pictures."
                                : "Suggested by the agent. You review the actual preview before approving."}
                            </p>
                          </details>
                        </>
                      ) : manualSettings ? (
                        <>
                          <h3>Print settings are kept</h3>
                          <p>
                            The saved print settings will be checked before
                            quoting. Refinements keep the agent’s selected
                            machine; they never switch devices silently.
                          </p>
                        </>
                      ) : assets.length > 0 ? (
                        <>
                          <h3>Find a suitable machine</h3>
                          <p>
                            Your pictures are kept. Open Add a note to check the
                            workshop again before preparing the preview.
                          </p>
                        </>
                      ) : (
                        <>
                          <h3>One picture, a useful starting point.</h3>
                          <p>
                            We’ll suggest a supported output and a real machine
                            from the workshop. No order, payment or machine run
                            happens during analysis.
                          </p>
                        </>
                      )}
                    </section>
                  )}
                  {analysisError && (
                    <div
                      className="notice error picture-analysis-error"
                      ref={analysisNotice}
                      tabIndex={-1}
                      role="alert"
                    >
                      <strong>Analysis could not be completed.</strong>
                      <p>{analysisError}</p>
                      <p>
                        Your pictures are kept. Try the analysis again; no order
                        or machine run was started.
                      </p>
                    </div>
                  )}
                  <details
                    className="picture-context"
                    ref={pictureContext}
                    open={editing || undefined}
                  >
                    <summary>Add a note</summary>
                    <Field
                      label="What is it for?"
                      hint="Optional. Add a short note if the picture needs context, then refine the recommendation."
                    >
                      <textarea
                        rows={2}
                        maxLength={600}
                        value={spec.intent}
                        onChange={(event) => {
                          analysisSequence.current++;
                          setAnalyzing(false);
                          setRecommendation(null);
                          setAnalysisError("");
                          const intent = event.currentTarget.value;
                          setIntakeDraft((previous) =>
                            previous?.contentReview === "review"
                              ? previous
                              : null,
                          );
                          if (
                            !editing ||
                            requiresRecommendation ||
                            spec.recommendedMachineId
                          ) {
                            setRequiresFreshRecommendation(true);
                            setManualSettings(false);
                          }
                          setSpec((value) => ({ ...value, intent }));
                        }}
                        placeholder="Optional — for example, a club sticker or a keepsake photo"
                      />
                    </Field>
                    {spec.assetIds.length > 0 && (
                      <div className="recommendation-action">
                        <Button
                          className="secondary"
                          type="button"
                          busy={analyzing}
                          disabled={Boolean(busy) || analyzing}
                          onClick={() =>
                            void analyzePictures(
                              assets.length
                                ? assets
                                : spec.assetIds.map((id) => ({
                                    id,
                                    url: "",
                                    sha256: "",
                                  })),
                              spec.intent,
                            )
                          }
                        >
                          {recommendation?.status === "unavailable"
                            ? "Check workshop again"
                            : recommendation?.status === "needs_clarification"
                              ? "Check again with this note"
                              : recommendation
                                ? "Refine recommendation"
                                : analysisError
                                  ? "Retry picture analysis"
                                  : "Find suitable machine"}
                        </Button>
                        <small>
                          Recommendations never place an order or start a
                          machine.
                        </small>
                      </div>
                    )}
                  </details>
                  {spec.assetIds.length > 0 && (
                    <div
                      className={`picture-permission ${spec.permission === "authorized" ? "is-confirmed" : ""}`}
                    >
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={spec.permission === "authorized"}
                          disabled={intakeDraft?.contentReview === "review"}
                          onChange={(event) => {
                            setPermissionReviewRequested(false);
                            const permission = event.target.checked
                              ? "authorized"
                              : "unclear";
                            setSpec((value) => ({ ...value, permission }));
                          }}
                        />
                        <span>
                          I own these pictures or have permission to print them
                        </span>
                      </label>
                      {(intakeDraft?.contentReview === "review" ||
                        (spec.permission !== "authorized" &&
                          permissionReviewRequested)) && (
                        <small>
                          {intakeDraft?.contentReview === "review"
                            ? "The artwork was flagged for owner review. Confirming ownership does not resolve that review; use the explicit review request below."
                            : "You explicitly requested owner permission review. This draft cannot proceed to approval or payment until the owner confirms permission."}
                        </small>
                      )}
                    </div>
                  )}
                  {(spec.assetIds.length > 0 || editing) && (
                    <div className="intake-submit">
                      <Button
                        className="primary full"
                        type="submit"
                        aria-describedby="preview-action-note"
                        busy={busy === "create"}
                        disabled={
                          Boolean(busy) ||
                          analyzing ||
                          requiresFreshRecommendation ||
                          (!manualSettings &&
                            recommendation?.status !== "recommended") ||
                          (spec.assetIds.length > 0 &&
                            spec.permission !== "authorized" &&
                            !(manualSettings && permissionReviewRequested)) ||
                          (!editing && unresolvedCreation) ||
                          editConflict ||
                          ((!editing || requiresRecommendation) &&
                            !spec.recommendedMachineId)
                        }
                      >
                        {editing ? "Update preview" : "Preview your item"}
                      </Button>
                      <small
                        id="preview-action-note"
                        className={previewBlocker ? "is-blocked" : ""}
                      >
                        {previewBlocker ||
                          (editing
                            ? "The updated preview replaces this one. Nothing is charged."
                            : "Nothing is charged or made yet.")}
                      </small>
                    </div>
                  )}
                  {(spec.assetIds.length > 0 || editing) && (
                    <details
                      className="advanced-specification"
                      open={editing || undefined}
                    >
                      <summary>Optional print settings</summary>
                      <p>
                        Refine size, quantity or placement if needed. The
                        agent’s selected machine stays attached to the order and
                        must still support the final settings.
                      </p>
                      {!manualSettings && (
                        <button
                          className="secondary"
                          type="button"
                          onClick={useManualSettings}
                        >
                          Adjust print settings
                        </button>
                      )}
                      <div
                        className="manual-specification-fields"
                        onChangeCapture={useManualSettings}
                      >
                        {editing && current?.spec.outputType === "3d" && (
                          <div className="saved-model-context">
                            <h3>Saved prepared model</h3>
                            <PreparedModelFacts details={current.spec} />
                            <p>
                              This is the existing owner-prepared file. Pictures
                              are never converted into a 3D model. Replacing it
                              with pictures asks the agent for a supported image
                              output.
                            </p>
                          </div>
                        )}
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
                                Optional help with size and placement. The
                                selected machine stays attached to this order.
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
                                      {intakeDraft.questions.map(
                                        (question, index) => (
                                          <li key={index}>{question}</li>
                                        ),
                                      )}
                                    </ul>
                                  </>
                                )}
                                <small>
                                  Review the suggested values below. Suggestions
                                  do not authorize artwork or approve a
                                  production file; machine validation still
                                  applies.
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
                                const crop = e.currentTarget
                                  .value as Spec["crop"];
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
                        <div className="print-material-fact">
                          <strong>Material</strong>
                          <span>
                            {spec.outputType === "sticker"
                              ? "Thermal adhesive paper"
                              : spec.outputType === "instax"
                                ? "Instax mini photo film"
                                : "Saved prepared model material"}
                          </span>
                        </div>
                        <Field label="Artwork permission">
                          <select
                            value={spec.permission}
                            onChange={(e) => {
                              const permission =
                                intakeDraft?.contentReview === "review"
                                  ? "unclear"
                                  : (e.currentTarget
                                      .value as Spec["permission"]);
                              setPermissionReviewRequested(
                                permission === "unclear",
                              );
                              setSpec((s) => ({ ...s, permission }));
                            }}
                          >
                            <option
                              value="authorized"
                              disabled={intakeDraft?.contentReview === "review"}
                            >
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
                              onChange={(e) =>
                                setBudgetEnabled(e.target.checked)
                              }
                            />
                            <span>
                              Automatically accept a quote within my budget
                            </span>
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
                      </div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          useManualSettings();
                          setPermissionReviewRequested(true);
                          setSpec((value) => ({
                            ...value,
                            permission: "unclear",
                          }));
                        }}
                      >
                        Request artwork permission review
                      </button>
                    </details>
                  )}
                  {editing && (
                    <button
                      className="text-button cancel-edit"
                      type="button"
                      onClick={cancelEdit}
                    >
                      Keep current item
                    </button>
                  )}
                  {!editing && unsavedDraft && !unresolvedCreation && (
                    <button
                      className="text-button cancel-edit"
                      type="button"
                      onClick={() => discardDraft("new")}
                    >
                      Discard new draft
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
        </section>
        {current && (
          <aside className="order-panel" aria-label="Order status">
            <OrderDetail
              key={current.id}
              job={current}
              busy={editing ? "editing" : busy}
              action={jobAction}
              health={health}
              previewReady={previewReady}
            />
          </aside>
        )}
      </div>
      {jobs.length > 0 && (
        <section className="orders-section" ref={ordersSection}>
          <div className="section-heading">
            <h2 tabIndex={-1}>Your orders</h2>
            <span>
              {jobs.length} {jobs.length === 1 ? "order" : "orders"}
            </span>
          </div>
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
                  <span className="order-thumb">
                    {job.artifact?.url ? (
                      <img
                        src={job.artifact.previewUrl || job.artifact.url}
                        alt=""
                      />
                    ) : (
                      <DeviceArt type={job.spec.outputType} />
                    )}
                  </span>
                  <span className="order-main">
                    <strong>{job.spec.intent}</strong>
                    <small>
                      {outputLabels[job.spec.outputType]} · {shortId(job.id)} ·{" "}
                      {date(job.createdAt)}
                      {pendingCreation &&
                      pendingCreation.id === job.creationRequestId
                        ? " · Matches interrupted request"
                        : ""}
                    </small>
                  </span>
                  <span className="order-status">
                    {job.productionState === "quoted" &&
                    job.paymentState === "unpaid" &&
                    job.quote &&
                    Date.parse(job.quote.expiresAt) <= Date.now() ? (
                      <Badge tone="amber">Price expired</Badge>
                    ) : (
                      <Badge tone={statusTone(job)}>
                        {requesterStatus(job)}
                      </Badge>
                    )}
                  </span>
                  <span className="order-cost">
                    {job.quote ? money(job.quote.totalCents) : "No price yet"}
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
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
      <p className="preview-caption">
        {job.spec.outputType === "sticker"
          ? "Prepared monochrome output"
          : job.spec.outputType === "3d"
            ? "Owner-prepared model preview"
            : "Prepared photo output"}
      </p>
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
  const pickupDeadline = Date.parse(job.pickup?.expiresAt || "");
  const pickupExpiryKnown = Number.isFinite(pickupDeadline);
  const pickupExpired = pickupExpiryKnown && pickupDeadline <= now;
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
    job.fulfillmentState === "collected"
      ? 4
      : job.productionState === "produced"
        ? 3
        : active || job.productionState === "payment_confirmed"
          ? 2
          : job.productionState === "quoted"
            ? 1
            : 0;
  const statusText: Record<string, string> = {
    specified: "Review your preview",
    approved: "Preview approved",
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
  // What is happening now, in one sentence, for states without a notice.
  const lede =
    job.productionState === "specified"
      ? job.spec.outputType === "3d"
        ? "Confirm the prepared model, overall dimensions, material, single color and estimated machine time. Approval binds this fixed production file to these specifications."
        : "Check the size, crop and artwork. Approving shows the price; nothing is charged yet."
      : job.productionState === "approved"
        ? "Get the price. The matched machine is reserved briefly."
        : job.productionState === "quoted" &&
            job.paymentState === "unpaid" &&
            !expired
          ? "Your machine is held while you decide. Paying does not start production."
          : job.productionState === "payment_confirmed"
            ? "Payment is held. Start when you are ready."
            : job.productionState === "produced" &&
                job.fulfillmentState === "ready_for_pickup" &&
                !pickupExpired
              ? "Your item is waiting at the collection point."
              : "";
  const approveBody = (autoAccept: boolean) => ({
    artifactSha256: job.artifact?.sha256,
    specVersion: job.specVersion,
    recommendedMachineId: job.spec.recommendedMachineId ?? null,
    autoAccept,
  });
  return (
    <div className={`ticket state-${job.productionState}`}>
      <h2 className="ticket-title">
        {statusText[job.productionState] || sentence(job.productionState)}
      </h2>
      {lede && <p className="ticket-lede">{lede}</p>}
      {job.productionState !== "cancelled" && (
        <ol
          className="phase-line"
          aria-label={`Production step ${Math.min(phase + 1, 4)} of 4`}
        >
          {["Preview", "Payment", "Making", "Pickup"].map((s, i) => (
            <li
              className={
                i < phase
                  ? "reached done"
                  : i === phase
                    ? "reached current"
                    : ""
              }
              aria-current={i === phase ? "step" : undefined}
              key={s}
            >
              {s}
            </li>
          ))}
        </ol>
      )}
      {job.productionState === "specified" && (
        <div className="ticket-action">
          {job.spec.outputType === "3d" && (
            <PreparedModelFacts details={job.spec} />
          )}
          <Button
            className="primary full"
            busy={busy === "approve-and-quote"}
            disabled={
              Boolean(busy) ||
              !job.artifact?.sha256 ||
              !previewReady ||
              job.spec.permission !== "authorized"
            }
            onClick={() =>
              action(
                "approve-and-quote",
                approveBody(Boolean(job.spec.budgetMandate?.enabled)),
              )
            }
          >
            Approve preview & see price
          </Button>
          {!busy && !previewReady && job.artifact?.sha256 && (
            <small className="action-note">
              Approval waits until the preview image has loaded.
            </small>
          )}
        </div>
      )}
      {job.productionState === "approved" && (
        <div className="ticket-action">
          <Button
            className="primary full"
            busy={busy === "approve-and-quote"}
            disabled={Boolean(busy)}
            onClick={() =>
              action(
                "approve-and-quote",
                approveBody(Boolean(job.spec.budgetMandate?.enabled)),
              )
            }
          >
            See current price
          </Button>
        </div>
      )}
      {job.fulfillmentState === "ready_for_pickup" && (
        <div
          className={`pickup${pickupExpired ? " expired" : ""}`}
          role="status"
          aria-live="polite"
        >
          <h3>
            {pickupExpired
              ? "Pickup code expired"
              : pickupExpiryKnown
                ? "Ready for pickup"
                : "Pickup status needs checking"}
          </h3>
          <p>
            {q?.collectionPoint || "See the owner at the collection point."}
          </p>
          {pickupExpired ? (
            <p>
              Ask the owner to renew your pickup code. A new code will appear
              here when renewal is confirmed. Your item is still stored; it does
              not need to be made again.
            </p>
          ) : !pickupExpiryKnown ? (
            <p>
              The pickup expiry could not be confirmed. Wait for the saved order
              to refresh before using a code.
            </p>
          ) : job.pickup?.code ? (
            <>
              <span className="pickup-code">{job.pickup.code}</span>
              <p>
                Show this single-use code to the owner when they hand over your
                item.
              </p>
              <small>Expires {date(job.pickup.expiresAt!)}</small>
            </>
          ) : (
            <p>
              Your pickup code will appear when the owner confirms preparation.
            </p>
          )}
        </div>
      )}
      {q && (
        <div className="quote">
          <div className="price-line total">
            <strong>Total</strong>
            <strong>{money(q.totalCents)}</strong>
          </div>
          <p className="payment-mode">
            {q.paymentMode === "testnet"
              ? "Base Sepolia test payment"
              : "Mock payment · no money moves"}
          </p>
          <details className="price-breakdown">
            <summary>Price breakdown</summary>
            {q.items.map((item, index) => (
              <div className="price-line" key={index}>
                <span>{item.label}</span>
                <span>{money(item.cents)}</span>
              </div>
            ))}
            <div className="quote-allocation">
              <span>Owner receives {money(q.ownerCents)}</span>
              <span>Platform {money(q.platformCents)}</span>
            </div>
          </details>
          {q.accepted && job.spec.budgetMandate?.enabled && (
            <p className="mandate-confirmation">
              Accepted within your explicit budget of{" "}
              {money(job.spec.budgetMandate.capCents)}. Checkout still requires
              your confirmation.
            </p>
          )}
          {job.fulfillmentState !== "ready_for_pickup" && (
            <p className="collection-line">
              <span>Collect at</span> <strong>{q.collectionPoint}</strong>
            </p>
          )}
          {job.productionState === "quoted" &&
            job.paymentState === "unpaid" && (
              <div className="quote-action">
                {expired ? (
                  <Notice kind="error">
                    This quote expired. Request a new quote to check
                    availability and pricing again.
                  </Notice>
                ) : (
                  <p className="expiry">
                    <span className="expiry-dot" aria-hidden="true" />
                    Reserved for {Math.floor(remaining / 60000)}:
                    {String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}
                  </p>
                )}
                <Button
                  className="primary full"
                  disabled={Boolean(busy)}
                  busy={busy === (expired ? "approve-and-quote" : "checkout")}
                  onClick={() =>
                    expired
                      ? action("approve-and-quote", approveBody(false))
                      : action("checkout")
                  }
                >
                  {expired
                    ? "Refresh expired quote"
                    : q.paymentMode === "testnet"
                      ? `Pay ${money(q.totalCents)} on testnet`
                      : `Confirm mock payment · ${money(q.totalCents)}`}
                </Button>
                {(expired || q.paymentMode === "testnet") && (
                  <p className="fine-print">
                    {expired
                      ? "Refreshing checks the same approved file and machine again. Nothing is charged."
                      : "Connect your browser wallet on Base Sepolia and sign a test USDC authorization. The platform-managed test hold starts only after settlement is confirmed."}
                  </p>
                )}
              </div>
            )}
        </div>
      )}
      {job.productionState === "payment_confirmed" && (
        <div className="ticket-action">
          <Button
            className="primary full"
            busy={busy === "dispatch"}
            disabled={Boolean(busy)}
            onClick={() => action("dispatch")}
          >
            Start production
          </Button>
          <small className="action-note">
            Sends this approved file to the reserved machine.
          </small>
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
      {job.productionState === "produced" &&
        job.fulfillmentState === "awaiting_owner" && (
          <Notice>
            Your item passed the output check. The owner still needs to remove,
            label and store it before pickup.
          </Notice>
        )}
      {job.fulfillmentState === "collected" && (
        <Notice kind="success">
          Collected. The owner redeemed your pickup code and recorded handoff.
        </Notice>
      )}
      {job.evidence && (
        <div className="evidence">
          <div className="quote-head">
            <h3>Result photo</h3>
            <Badge
              tone={
                job.evidence.result === "pass"
                  ? "green"
                  : job.evidence.result === "fail"
                    ? "red"
                    : "amber"
              }
            >
              {job.evidence.result === "pass"
                ? "Passed"
                : job.evidence.result === "fail"
                  ? "Did not pass"
                  : sentence(job.evidence.result)}
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
      <div className="ticket-more">
        <details className="request-state-details">
          <summary>Order details</summary>
          <dl className="state-facts">
            <div>
              <dt>Order</dt>
              <dd>{shortId(job.id)}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{date(job.createdAt)}</dd>
            </div>
            <div>
              <dt>Production</dt>
              <dd>{describe(productionLabels, job.productionState)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{describe(paymentLabels, job.paymentState)}</dd>
            </div>
            <div>
              <dt>Pickup</dt>
              <dd>{describe(fulfillmentLabels, job.fulfillmentState)}</dd>
            </div>
          </dl>
          <small className="hash-note">
            Production file fingerprint{" "}
            {job.artifact?.sha256?.slice(0, 16) || "unavailable"} ·
            specification v{job.specVersion}
          </small>
        </details>
        <details className="history">
          <summary>Order history</summary>
          <ol>
            {job.history?.length ? (
              job.history.map((event, index) => (
                <li key={index}>
                  <strong>{describe(eventLabels, event.event)}</strong>
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
                api<{ ledger: Ledger[]; mode: string }>(
                  `/jobs/${job.id}/receipt`,
                )
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
      </div>
    </div>
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
    connectors?: ConnectorView[];
    setupCodes?: SetupCodeView[];
  } | null>(null);
  const [model, setModel] = useState("phomemo-m02pro");
  const [mode, setMode] = useState("simulation");
  const [setupCode, setSetupCode] = useState<IssuedSetupCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [identifyText, setIdentifyText] = useState("");
  const [identifyPhoto, setIdentifyPhoto] = useState<File | null>(null);
  const [identification, setIdentification] =
    useState<MachineIdentification | null>(null);
  const readsPhotos = String(health?.integrations?.claude ?? "").startsWith(
    "configured",
  );
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
  const act = async (
    name: string,
    fn: () => Promise<void>,
    onError?: (error: Error) => void,
  ) => {
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
      if (onError) onError(e as Error);
      else setError((e as Error).message);
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
  const connectors = dashboard?.connectors || [];
  // Setups still in progress; registered connectors show on their machine card.
  const connecting = connectors.filter((connector) => !connector.registeredAt);
  // Shown until the code is used or expires; the checklist then takes over.
  const liveSetupCode =
    setupCode &&
    dashboard?.setupCodes?.some((code) => code.id === setupCode.id) &&
    Date.parse(setupCode.expiresAt) > Date.now()
      ? setupCode
      : null;
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
      <div className="owner-login provider-login-minimal">
        <form onSubmit={login}>
          <h1>Open your workshop</h1>
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
        className="owner-workshop provider-minimal"
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
          <h1>Your workshop</h1>
          <p className="provider-summary">
            {dashboard ? (
              <>
                <strong
                  className={
                    jobs.some(needsOwnerAction) ? "is-attention" : undefined
                  }
                >
                  {jobs.filter(needsOwnerAction).length} need you
                </strong>
                <span aria-hidden="true"> · </span>
                {active.length} in production
                <span aria-hidden="true"> · </span>
                {
                  jobs.filter(
                    (job) => job.fulfillmentState === "ready_for_pickup",
                  ).length
                }{" "}
                awaiting pickup
                <span aria-hidden="true"> · </span>
                {machines.filter(available).length} of {machines.length}{" "}
                machines available
              </>
            ) : (
              "Loading orders…"
            )}
          </p>
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
            ["queue", "Orders"],
            ["machines", "Machines"],
            ["payments", "Payments"],
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
                      {handling.length
                        ? "Ready to prepare"
                        : attention.length
                          ? "Your review is needed"
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
                                    job.fulfillmentState === "ready_for_pickup",
                                )
                              ? "Items await collection"
                              : active.length
                                ? "Production is in progress"
                                : "You’re all caught up"}
                    </h2>
                    {!jobs.length && (
                      <p>
                        New orders will appear here when your workshop is ready.
                      </p>
                    )}
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
                                machineName={
                                  machines.find(
                                    (machine) => machine.id === job.machineId,
                                  )?.name
                                }
                                onProducerHub={
                                  !!machines.find(
                                    (machine) => machine.id === job.machineId,
                                  )?.producerHub
                                }
                                ledger={dashboard.ledger}
                                busy={busy}
                                health={health}
                                refresh={refresh}
                                action={(action, body, options) =>
                                  act(
                                    `${job.id}-${action}`,
                                    async () => {
                                      if (options?.onAccepted) {
                                        const result = await api<{
                                          job?: unknown;
                                        }>(
                                          `/owner/jobs/${job.id}/${action}`,
                                          body || {},
                                        );
                                        options.onAccepted(result?.job);
                                      } else
                                        await request(
                                          `/owner/jobs/${job.id}/${action}`,
                                          body || {},
                                        );
                                    },
                                    options?.onError,
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
                        {machines.length
                          ? "Check your machines, then let Fabrary match incoming requests."
                          : "Add your first machine to get your workshop ready."}
                      </p>
                      <button
                        className="secondary"
                        onClick={() => selectTab("machines")}
                      >
                        {machines.length
                          ? "Check machines"
                          : "Set up a machine"}
                      </button>
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
                    <h2>Your machines</h2>
                  </div>
                  <div className="owner-machine-list">
                    {machines.map((machine) => (
                      <OwnerMachine
                        key={machine.id}
                        machine={machine}
                        connector={connectors.find(
                          (connector) =>
                            connector.id === machine.connectorId &&
                            connector.registeredAt,
                        )}
                        onRemoveConnector={(connectorId) =>
                          act(`${connectorId}-remove`, () =>
                            request(
                              `/owner/connectors/${connectorId}/revoke`,
                              {},
                            ),
                          )
                        }
                        busy={busy}
                        action={(action, body, options) =>
                          act(
                            `${machine.id}-${action}`,
                            async () => {
                              try {
                                const result = await api<{ machine?: Machine }>(
                                  `/owner/machines/${machine.id}${action === "calibrate" ? "/calibrate" : ""}`,
                                  body,
                                  action === "calibrate" ? undefined : "PATCH",
                                  {
                                    headers: options?.fingerprint
                                      ? {
                                          "If-Match": `"${options.fingerprint}"`,
                                        }
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
                            },
                            options?.onError,
                          )
                        }
                      />
                    ))}
                  </div>
                  {connecting.length > 0 && (
                    <div className="connector-setups">
                      {connecting.map((connector) => (
                        <ConnectorSetup
                          key={connector.id}
                          connector={connector}
                          machineName={
                            machines.find(
                              (machine) => machine.id === connector.machineId,
                            )?.name ?? connector.machineId
                          }
                          busy={busy}
                          onConsent={(check) =>
                            act(`${connector.id}-consent-${check}`, () =>
                              request(
                                `/owner/connectors/${connector.id}/consent`,
                                { check },
                              ),
                            )
                          }
                          onRetry={() =>
                            act(`${connector.id}-register`, () =>
                              request(
                                `/owner/connectors/${connector.id}/register`,
                                {},
                              ),
                            )
                          }
                          onRemove={() =>
                            act(`${connector.id}-remove`, () =>
                              request(
                                `/owner/connectors/${connector.id}/revoke`,
                                {},
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                  <details
                    className="provider-registration"
                    open={
                      machines.length === 0 ||
                      Boolean(liveSetupCode) ||
                      undefined
                    }
                  >
                    <summary>Add a machine</summary>
                    <p className="add-machine-intro">
                      Tell Fabrary what the machine is, then run one command on
                      the computer next to it. Fabrary checks that computer,
                      asks before each step, and writes the settings for you.
                    </p>
                    <form
                      className="identify-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act("identify", async () => {
                          const body = new FormData();
                          body.set("description", identifyText);
                          if (identifyPhoto)
                            body.set(
                              "photo",
                              await prepareLabelPhoto(identifyPhoto),
                              "label.jpg",
                            );
                          const { identification } = await api<{
                            identification: MachineIdentification;
                          }>("/owner/machine-identification", body);
                          setIdentification(identification);
                          if (identification.model)
                            setModel(identification.model);
                        });
                      }}
                    >
                      <div className="form-grid">
                        <Field label="What machine is it?">
                          <input
                            type="text"
                            value={identifyText}
                            maxLength={200}
                            placeholder="For example, Phomemo M02 Pro"
                            onChange={(e) => setIdentifyText(e.target.value)}
                          />
                        </Field>
                        {readsPhotos && (
                          <Field label="Or a photo of its label or box">
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(e) =>
                                setIdentifyPhoto(e.target.files?.[0] ?? null)
                              }
                            />
                          </Field>
                        )}
                      </div>
                      <Button
                        className="secondary"
                        type="submit"
                        busy={busy === "identify"}
                        disabled={!identifyText.trim() && !identifyPhoto}
                      >
                        Identify
                      </Button>
                      {identification && (
                        <p
                          className={`identify-result is-${identification.status}`}
                          role="status"
                        >
                          {identification.message}
                        </p>
                      )}
                    </form>
                    <form
                      className="setup-code-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act("setup-code", async () => {
                          const issued = await api<{
                            setupCode: IssuedSetupCode;
                            command: string;
                            platformUrl: string;
                          }>("/owner/setup-codes", { model, mode });
                          setCopied(false);
                          setSetupCode({
                            ...issued.setupCode,
                            command: issued.command,
                            platformUrl: issued.platformUrl,
                          });
                        });
                      }}
                    >
                      <div className="form-grid">
                        <Field label="Supported model">
                          <select
                            value={model}
                            onChange={(e) => {
                              setModel(e.target.value);
                              // The identified model no longer describes the choice.
                              if (identification?.model !== e.target.value)
                                setIdentification(null);
                            }}
                          >
                            <option value="phomemo-m02pro">
                              Phomemo M02Pro
                            </option>
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
                              Hardware · a real machine
                            </option>
                          </select>
                        </Field>
                      </div>
                      <Button
                        className="primary"
                        type="submit"
                        busy={busy === "setup-code"}
                      >
                        Get setup command
                      </Button>
                    </form>
                    {liveSetupCode && (
                      <div className="setup-code-panel" role="status">
                        <p>
                          On the computer next to the machine
                          {liveSetupCode.mode === "hardware" &&
                          liveSetupCode.machineId === "phomemo_01"
                            ? " (a Raspberry Pi or Linux computer with Bluetooth)"
                            : ""}
                          , run:
                        </p>
                        <div className="command-box">
                          <code>{liveSetupCode.command}</code>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(liveSetupCode.command)
                                .then(() => setCopied(true))
                                .catch(() => setCopied(false));
                            }}
                          >
                            {copied ? "Copied" : "Copy command"}
                          </button>
                        </div>
                        <p className="fine-print">
                          Setup code {liveSetupCode.code} works once and expires
                          at{" "}
                          {new Date(liveSetupCode.expiresAt).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                          . It is shown only here.
                          {/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(
                            liveSetupCode.platformUrl,
                          )
                            ? " This address works only on this computer. To connect another computer, set FABRARY_HOST=0.0.0.0 and FABRARY_PUBLIC_ORIGIN to this computer's network address, then restart the workshop."
                            : ""}
                        </p>
                        <p className="setup-waiting">
                          <span className="spinner" aria-hidden="true" />{" "}
                          Waiting for the machine computer to connect…
                        </p>
                      </div>
                    )}
                    <details className="manual-registration">
                      <summary>
                        Use a node already set up on this computer
                      </summary>
                      <form
                        className="register-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("register", async () => {
                            await request("/owner/machines", {
                              model,
                              mode,
                            });
                          });
                        }}
                      >
                        <p>
                          Registers the model and mode chosen above with the
                          node configured in this computer’s private local
                          setup. Calibration is a separate step.
                        </p>
                        <Button
                          className="secondary"
                          type="submit"
                          busy={busy === "register"}
                        >
                          Register supported device
                        </Button>
                      </form>
                    </details>
                  </details>
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
                <h2>Payments</h2>
                <p>
                  {health?.paymentMode === "mock"
                    ? "These are mock records; no funds moved."
                    : "These records use Base Sepolia test funds."}{" "}
                  Open an order for any payment that needs follow-up.
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
const checkWords: Record<ConnectorCheckView["status"], string> = {
  done: "Done",
  waiting: "Needs you",
  running: "In progress",
  failed: "Needs attention",
  pending: "Not started",
};
/** Live setup of one machine computer. Each consented step waits for the owner. */
function ConnectorSetup({
  connector,
  machineName,
  busy,
  onConsent,
  onRetry,
  onRemove,
}: {
  connector: ConnectorView;
  machineName: string;
  busy: string;
  onConsent: (check: string) => Promise<boolean>;
  onRetry: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const headingId = useId();
  const current =
    connector.checks.find((check) => check.status !== "done") ?? null;
  const position = current ? connector.checks.indexOf(current) + 1 : 0;
  return (
    <section className="connector-setup" aria-labelledby={headingId}>
      <div className="connector-head">
        <h3 id={headingId}>
          Setting up {machineName}
          {connector.mode === "simulation" ? " (simulation)" : ""}
        </h3>
        <Badge tone={connector.online ? "green" : "amber"}>
          {connector.online ? "Connected" : "Offline"} · {connector.hostLabel}
        </Badge>
      </div>
      <p className="sr-only" aria-live="polite">
        {current
          ? `Step ${position} of ${connector.checks.length}: ${current.label}, ${checkWords[current.status].toLowerCase()}.`
          : "Setup is complete."}
      </p>
      <ol className="setup-checklist">
        {connector.checks.map((check) => (
          <li key={check.id} className={`setup-check is-${check.status}`}>
            <span className="check-mark" aria-hidden="true">
              {check.status === "done" ? (
                "✓"
              ) : check.status === "failed" ? (
                "!"
              ) : check.status === "running" ? (
                <span className="spinner" />
              ) : null}
            </span>
            <div>
              <strong>{check.label}</strong>
              <span className="sr-only"> · {checkWords[check.status]}</span>
              {check.detail && <p>{check.detail}</p>}
              {check.status === "waiting" && check.consent && (
                <Button
                  className={check === current ? "primary" : "secondary"}
                  busy={busy === `${connector.id}-consent-${check.id}`}
                  disabled={Boolean(busy) || !connector.online}
                  onClick={() => {
                    void onConsent(check.id);
                  }}
                >
                  {check.consent}
                </Button>
              )}
              {check.id === "register" && check.status === "failed" && (
                <Button
                  className="secondary"
                  busy={busy === `${connector.id}-register`}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void onRetry();
                  }}
                >
                  Try again
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!connector.online && (
        <p className="fine-print">
          The connector on {connector.hostLabel} is not reaching this workshop.
          Make sure it is still running there.
        </p>
      )}
      {confirmRemove ? (
        <div className="button-row">
          <Button
            className="danger"
            busy={busy === `${connector.id}-remove`}
            disabled={Boolean(busy)}
            onClick={() => {
              void onRemove();
            }}
          >
            Cancel setup
          </Button>
          <button
            type="button"
            className="text-button"
            onClick={() => setConfirmRemove(false)}
          >
            Keep setting up
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-button subdued"
          onClick={() => setConfirmRemove(true)}
        >
          Cancel this setup…
        </button>
      )}
    </section>
  );
}
function OwnerMachine({
  machine: m,
  connector,
  onRemoveConnector,
  busy,
  action,
}: {
  machine: Machine;
  connector?: ConnectorView;
  onRemoveConnector?: (connectorId: string) => Promise<boolean>;
  busy: string;
  action: (
    name: string,
    body: unknown,
    options?: {
      fingerprint?: string;
      onAccepted?: (machine: Machine) => void;
      onConflict?: () => void;
      onError?: (error: Error) => void;
    },
  ) => Promise<boolean>;
}) {
  const [saved, setSaved] = useState(() => settingsSnapshot(m));
  const [base, setBase] = useState(saved);
  const [settings, setSettings] = useState(saved.settings);
  const [inspected, setInspected] = useState(false);
  const [checksOpen, setChecksOpen] = useState(!m.calibrated || m.paused);
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
    m.registrationId,
    m.mode,
    m.outputType,
    m.material,
    m.paired,
    m.configured,
    m.calibrated,
    m.calibrationAt,
    m.calibrationConfirmationId,
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
  const checkedAction = async (
    name: string,
    body: unknown,
    onError?: (error: Error) => void,
  ) => {
    const accepted = await action(name, body, { onError });
    if (accepted) setInspected(false);
    return accepted;
  };
  const [confirmRemove, setConfirmRemove] = useState(false);
  const nextStep =
    connector && !connector.online
      ? `The machine computer ${connector.hostLabel} is not connected. Start the connector there again.`
      : m.activeJobId
        ? "A job is using this machine. Fabrary will track its progress."
        : m.policyReconciliationRequired
          ? "Open Settings to synchronize this machine’s saved policy."
          : !m.paired || !m.configured
            ? "Check the configured device connection before calibration."
            : !m.calibrated
              ? m.mode === "simulation"
                ? "Run a simulation calibration to finish this test setup."
                : "Open Machine checks to run and inspect a supervised calibration."
              : m.paused
                ? "Inspect and clear the machine, then resume when it is safe."
                : !m.listed
                  ? "Open Settings to list this machine when you are ready."
                  : !m.ready
                    ? "Check the saved status below before accepting more work."
                    : "Setup is complete. Fabrary checks availability for each request.";
  const setup = [
    ["Connected", m.paired && m.configured],
    ["Calibrated", m.calibrated],
    ["Listed", m.listed],
    ["Available", m.ready && !m.paused],
  ] as const;
  const setupStep = setup.findIndex(([, done]) => !done);
  return (
    <article className="owner-machine">
      <div className="machine-card-head">
        <DeviceArt type={m.outputType} />
        <div>
          <h3>{m.name}</h3>
          <p>{m.model}</p>
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
      <ol className="setup-steps" aria-label="Machine setup">
        {setup.map(([label, done], index) => (
          <li
            key={label}
            className={done ? "done" : index === setupStep ? "current" : ""}
            aria-current={index === setupStep ? "step" : undefined}
          >
            <span className="setup-dot" aria-hidden="true">
              {done ? "✓" : index + 1}
            </span>
            {label}
            <span className="sr-only">
              {done ? " (done)" : index === setupStep ? " (next)" : " (to do)"}
            </span>
          </li>
        ))}
      </ol>
      <p className="provider-next-step">{nextStep}</p>
      {m.activeJobId && (
        <Notice>
          Active execution: {shortId(m.activeJobId)}. An outstanding pickup does
          not occupy this execution slot.
        </Notice>
      )}
      <details
        className="provider-machine-checks"
        open={checksOpen}
        onToggle={(event) => setChecksOpen(event.currentTarget.open)}
      >
        <summary>Machine checks</summary>
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
            finalize={(body, onError) =>
              checkedAction("calibrate", body, onError)
            }
          />
        )}
      </details>
      <details className="machine-settings">
        <summary>Settings</summary>
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
      <details className="provider-connection-details">
        <summary>Connection details</summary>
        <div className="readiness-facts" aria-label="Saved machine checks">
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
        <p className="fine-print">
          Adapter {m.adapterVersion || "unknown"}. These are saved checks, not a
          live physical inspection.
        </p>
        {m.reason && <p className="machine-reason">{m.reason}</p>}
        {connector && (
          <div className="machine-connector">
            <p>
              Connected through <strong>{connector.hostLabel}</strong> ·{" "}
              {connector.online ? "online" : "offline"}
            </p>
            {confirmRemove ? (
              <div className="button-row">
                <Button
                  className="danger"
                  busy={busy === `${connector.id}-remove`}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void onRemoveConnector?.(connector.id);
                  }}
                >
                  Remove connector
                </Button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setConfirmRemove(false)}
                >
                  Keep it
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-button subdued"
                onClick={() => setConfirmRemove(true)}
              >
                Remove connector…
              </button>
            )}
          </div>
        )}
      </details>
    </article>
  );
}

type Calibration = {
  id: string;
  machineId?: string;
  checkoutKey?: string;
  calibrationDeviceContext?: string;
  attemptId: string;
  version: number;
  createdAt?: string;
  artifact?: { sha256: string };
  specVersion?: number;
  spec?: Spec;
  calibrationInspection?: {
    outcome: "rejected";
    reason: string;
    recordedAt: string;
    attemptId: string;
  };
  executionCancellation?: {
    status: "cancelled_before_acceptance";
    machine_id: string;
    job_id: string;
    attempt_id: string;
    artifact_sha256: string;
    parameters: Record<string, unknown>;
    target_scope: "calibration";
    expected_mode: "hardware" | "simulation";
    cancelled_at: string;
  };
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
  finalize: (
    body: unknown,
    onError?: (error: Error) => void,
  ) => Promise<boolean>;
}) {
  type Lifecycle = {
    activeJobId: string | null;
    calibrationActive: boolean;
    canRequestNew: boolean;
    canRequestCancellation: boolean;
    context: string;
    reasonCode: string;
    reason: string;
    contextMatch: boolean | null;
  };
  type Checkpoint = { key: string | null; pending: boolean; legacy?: boolean };
  const slot = `fabrary-calibration-${m.id}`;
  const validKey = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/.test(value);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(() => {
    const stored = readStoredValue("session", slot);
    if (stored === null) return null;
    if (validKey(stored)) return { key: stored, pending: true, legacy: true };
    try {
      const value = JSON.parse(stored);
      if (
        value?.v === 2 &&
        validKey(value.key) &&
        typeof value.pending === "boolean"
      )
        return { key: value.key, pending: value.pending };
    } catch {
      /* A damaged checkpoint cannot establish that no job was sent. */
    }
    return { key: null, pending: true };
  });
  const checkpointRef = useRef(checkpoint);
  const key = useRef(crypto.randomUUID());
  const storeCheckpoint = (requestKey: string, pending: boolean) => {
    const saved = writeStoredValue(
      "session",
      slot,
      JSON.stringify({ v: 2, key: requestKey, pending }),
    );
    if (saved || !pending) {
      const next = { key: requestKey, pending };
      checkpointRef.current = next;
      setCheckpoint(next);
    }
    return saved;
  };
  const unresolvedStart = checkpoint?.pending === true;
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [preparation, setPreparation] = useState<{
    context: string;
    historicalId: string;
    key: string;
  } | null>(null);
  const [authorizationNotice, setAuthorizationNotice] = useState("");
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
  const [actionError, setActionError] = useState("");
  const actionErrorNotice = useRef<HTMLDivElement>(null);
  const pendingActionFocus = useRef<{
    initiator: Element | null;
    generation: number;
    context: string;
  } | null>(null);
  const [lookupKnown, setLookupKnown] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const permissionContext = JSON.stringify([
    m.activeJobId,
    m.reservation,
    m.policyReconciliationRequired,
  ]);
  const livePermissionContext = useRef(permissionContext);
  livePermissionContext.current = permissionContext;
  const knownPermissionContext = useRef<string | null>(null);
  const recoveryControl = useRef<HTMLElement | null>(null);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const stateHeading = useRef<HTMLElement>(null);
  const pendingRecoveryFocus = useRef<{
    initiator: HTMLElement;
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
    m.registrationId,
    m.calibrationConfirmationId,
    m.mode,
    m.outputType,
    m.adapterVersion,
    m.material,
    m.paired,
    m.configured,
    calibration?.id,
    calibration?.attemptId,
    calibration?.productionState,
    calibration?.calibrationInspection,
    calibration?.executionCancellation,
    calibration?.evidence?.url,
    calibration?.evidence?.capturedAt,
    calibration?.evidence?.machineId,
    calibration?.evidence?.jobId,
  ]);
  const actionContext = JSON.stringify([
    m.id,
    m.registrationId,
    m.mode,
    m.outputType,
    m.adapterVersion,
    m.material,
    m.paired,
    m.configured,
    calibration?.id,
    calibration?.attemptId,
    calibration?.productionState,
    calibration?.calibrationInspection,
    calibration?.executionCancellation,
    calibration?.evidence,
  ]);
  const liveActionContext = useRef(actionContext);
  liveActionContext.current = actionContext;
  useEffect(() => {
    pendingActionFocus.current = null;
    setActionError("");
  }, [actionContext]);
  useEffect(() => {
    // An inspection is a fresh confirmation of this exact attempt and frame.
    // A newer saved attempt must not inherit an earlier checked confirmation.
    setInspected(false);
    setOwnerReady(false);
    setReason("");
    setResolution("completed");
  }, [inspectionContext]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGate.current.generation++;
      readGate.current.queued?.resolve(false);
      readGate.current.queued = null;
    };
  }, []);
  const cancellationParameters = (saved: Calibration) =>
    saved.spec && {
      ...(saved.spec.outputType === "3d"
        ? {
            depthMm: saved.spec.depthMm,
            color: saved.spec.color,
            estimatedSeconds: saved.spec.estimatedSeconds,
          }
        : {}),
      outputType: saved.spec.outputType,
      widthMm: saved.spec.widthMm,
      heightMm: saved.spec.heightMm,
      quantity: saved.spec.quantity,
      material: saved.spec.material,
      crop: saved.spec.crop,
      specVersion: saved.specVersion,
    };
  const validCancellation = (saved: Calibration) => {
    const proof = saved.executionCancellation;
    const expected = cancellationParameters(saved);
    return Boolean(
      proof &&
      typeof proof === "object" &&
      !Array.isArray(proof) &&
      proof.status === "cancelled_before_acceptance" &&
      proof.machine_id === m.id &&
      proof.job_id === saved.id &&
      proof.attempt_id === saved.attemptId &&
      /^[a-f0-9]{64}$/i.test(saved.artifact?.sha256 || "") &&
      proof.artifact_sha256 === saved.artifact?.sha256 &&
      proof.target_scope === "calibration" &&
      ["hardware", "simulation"].includes(proof.expected_mode) &&
      Number.isFinite(Date.parse(proof.cancelled_at)) &&
      Date.parse(proof.cancelled_at) <= Date.now() + 60000 &&
      (saved.createdAt === undefined ||
        (Number.isFinite(Date.parse(saved.createdAt)) &&
          Date.parse(proof.cancelled_at) >=
            Date.parse(saved.createdAt) - 60000)) &&
      expected &&
      proof.parameters &&
      typeof proof.parameters === "object" &&
      !Array.isArray(proof.parameters) &&
      Object.keys(proof.parameters).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([field, value]) =>
          value !== undefined && proof.parameters[field] === value,
      ),
    );
  };
  const validCalibration = (value: unknown): value is Calibration => {
    const saved = value as Calibration | null;
    return Boolean(
      saved &&
      typeof saved === "object" &&
      !Array.isArray(saved) &&
      saved.machineId === m.id &&
      Number.isInteger(saved.version) &&
      saved.version > 0 &&
      (saved.calibrationInspection === undefined ||
        (saved.calibrationInspection !== null &&
          typeof saved.calibrationInspection === "object" &&
          !Array.isArray(saved.calibrationInspection) &&
          saved.calibrationInspection.outcome === "rejected" &&
          saved.calibrationInspection.attemptId === saved.attemptId &&
          typeof saved.calibrationInspection.reason === "string" &&
          saved.calibrationInspection.reason.trim().length >= 10 &&
          saved.calibrationInspection.reason.trim().length <= 1000 &&
          Number.isFinite(Date.parse(saved.calibrationInspection.recordedAt)) &&
          saved.productionState === "produced")) &&
      (saved.executionCancellation === undefined ||
        (saved.productionState === "cancelled" && validCancellation(saved))) &&
      (saved.productionState !== "cancelled" || validCancellation(saved)) &&
      [saved.id, saved.attemptId, saved.productionState].every(
        (field) => typeof field === "string" && field.trim().length > 0,
      ) &&
      (saved.checkoutKey === undefined || validKey(saved.checkoutKey)),
    );
  };
  const refresh = useCallback((): Promise<boolean> => {
    if (!mounted.current) return Promise.resolve(false);
    const gate = readGate.current;
    const read = (): Promise<boolean> => {
      const generation = gate.generation;
      setLookupBusy(true);
      const current = (async () => {
        try {
          const observedPermission = livePermissionContext.current;
          const requestKey = checkpointRef.current?.key;
          const value = await api<{
            calibration: Calibration | null;
            requestedCalibration?: Calibration | null;
            lifecycle: Lifecycle;
            status?: {
              execution_status?: string;
              state?: string;
              reason?: string;
            };
          }>(
            `/owner/machines/${m.id}/calibration${requestKey ? `?requestKey=${encodeURIComponent(requestKey)}` : ""}`,
          );
          if (!mounted.current || generation !== gate.generation) return false;
          const saved = value.calibration;
          const status = value.status;
          const life = value.lifecycle;
          if (
            !Object.prototype.hasOwnProperty.call(value, "calibration") ||
            (saved !== null && !validCalibration(saved)) ||
            !life ||
            typeof life !== "object" ||
            Array.isArray(life) ||
            !(
              life.activeJobId === null ||
              (typeof life.activeJobId === "string" &&
                life.activeJobId.trim().length > 0)
            ) ||
            typeof life.calibrationActive !== "boolean" ||
            typeof life.canRequestNew !== "boolean" ||
            typeof life.canRequestCancellation !== "boolean" ||
            (life.canRequestCancellation &&
              (!life.calibrationActive ||
                life.contextMatch === false ||
                !saved ||
                !["dispatched", "needs_review"].includes(
                  saved.productionState || "",
                ))) ||
            typeof life.context !== "string" ||
            !/^[a-f0-9]{64}$/i.test(life.context) ||
            ![life.reasonCode, life.reason].every(
              (field) => typeof field === "string" && field.trim().length > 0,
            ) ||
            !(
              life.contextMatch === null ||
              typeof life.contextMatch === "boolean"
            ) ||
            life.calibrationActive !==
              Boolean(saved && life.activeJobId === saved.id) ||
            (life.canRequestNew &&
              (life.activeJobId !== null || life.calibrationActive)) ||
            (!saved && life.contextMatch !== null) ||
            (requestKey &&
              (!Object.prototype.hasOwnProperty.call(
                value,
                "requestedCalibration",
              ) ||
                (value.requestedCalibration !== null &&
                  (!validCalibration(value.requestedCalibration) ||
                    value.requestedCalibration.checkoutKey !== requestKey)))) ||
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
          setLifecycle(life);
          knownPermissionContext.current = observedPermission;
          if (
            requestKey &&
            value.requestedCalibration?.checkoutKey === requestKey &&
            (checkpointRef.current?.pending || checkpointRef.current?.legacy)
          )
            storeCheckpoint(requestKey, false);
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
    m.registrationId,
    m.mode,
    m.outputType,
    m.adapterVersion,
    m.material,
    m.paired,
    m.configured,
  ]);
  const liveDeviceContext = useRef(deviceContext);
  liveDeviceContext.current = deviceContext;
  const lastDeviceContext = useRef<string | null>(null);
  const clearPreparationFields = () => {
    setAssets([]);
    setModelId("");
    setWidth(m.outputType === "instax" ? "54" : "53");
    setHeight(m.outputType === "instax" ? "86" : "50");
    setOwnerReady(false);
    setInspected(false);
    setReason("");
    setResolution("completed");
  };
  useEffect(() => {
    const generation = ++readGate.current.generation;
    setLookupKnown(false);
    if (lastDeviceContext.current !== deviceContext) {
      setLifecycle(null);
      setPreparation(null);
      clearPreparationFields();
      lastDeviceContext.current = deviceContext;
    } else setOwnerReady(false);
    setBusy("");
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
  }, [refresh, deviceContext, permissionContext]);
  useEffect(() => {
    if (!preparation || !lookupKnown || !lifecycle) return;
    if (
      lifecycle.context !== preparation.context ||
      lifecycle.activeJobId !== null ||
      calibration?.id !== preparation.historicalId
    ) {
      readGate.current.generation++;
      setPreparation(null);
      clearPreparationFields();
      setBusy("");
    }
  }, [
    preparation,
    lookupKnown,
    lifecycle?.context,
    lifecycle?.activeJobId,
    calibration?.id,
  ]);
  useEffect(() => {
    setOwnerReady(false);
  }, [
    lookupKnown,
    lifecycle?.canRequestNew,
    lifecycle?.activeJobId,
    lifecycle?.context,
    unresolvedStart,
  ]);
  const reservationBlocked = Boolean(
    m.reservation &&
    (!Number.isFinite(Date.parse(m.reservation.expiresAt)) ||
      Date.parse(m.reservation.expiresAt) > Date.now()),
  );
  const dashboardBlocked =
    knownPermissionContext.current !== permissionContext &&
    Boolean(
      m.activeJobId || m.policyReconciliationRequired || reservationBlocked,
    );
  const canRequestNew = Boolean(
    lookupKnown &&
    lifecycle?.canRequestNew &&
    !dashboardBlocked &&
    !unresolvedStart &&
    (!calibration ||
      ["produced", "failed", "cancelled"].includes(
        calibration.productionState || "",
      )),
  );
  const showStartForm = Boolean(
    preparation || (!calibration && lookupKnown && !unresolvedStart),
  );
  const canStart =
    canRequestNew &&
    (!preparation || preparation.context === lifecycle?.context) &&
    (!preparation || preparation.historicalId === calibration?.id);
  const canInspect =
    lookupKnown &&
    !calibration?.calibrationInspection &&
    !calibration?.executionCancellation &&
    lifecycle?.contextMatch !== false &&
    (!unresolvedStart || lifecycle?.calibrationActive === true) &&
    !dashboardBlocked &&
    !reservationBlocked &&
    !m.policyReconciliationRequired &&
    m.paired &&
    m.configured &&
    Boolean(lifecycle?.calibrationActive || lifecycle?.canRequestNew);
  const canConfirm = canInspect && calibration?.productionState === "produced";
  const canNegativeCleanup =
    lookupKnown &&
    lifecycle?.calibrationActive === true &&
    lifecycle.contextMatch !== false &&
    !dashboardBlocked &&
    !calibration?.calibrationInspection &&
    !calibration?.executionCancellation;
  const canReject =
    canNegativeCleanup && calibration?.productionState === "produced";
  const canResolve =
    canInspect &&
    lifecycle?.calibrationActive === true &&
    ["needs_review", "failed"].includes(calibration?.productionState || "");
  const canCancel =
    canNegativeCleanup && lifecycle?.canRequestCancellation === true;
  const canDescribe = Boolean(
    canConfirm || canResolve || canReject || canCancel,
  );
  useEffect(() => {
    if (
      !preparation &&
      !unresolvedStart &&
      (!calibration ||
        ["produced", "failed", "cancelled", "needs_review"].includes(
          calibration.productionState || "",
        ))
    )
      return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [
    calibration?.id,
    calibration?.productionState,
    preparation,
    unresolvedStart,
    refresh,
  ]);
  const run = async (
    name: string,
    fn: (isCurrent: () => boolean) => Promise<unknown>,
  ) => {
    if (!mounted.current) return;
    const localRecovery = ["finalize", "resolve", "reject", "cancel"].includes(
      name,
    );
    const initiator = document.activeElement;
    const context = liveActionContext.current;
    if (localRecovery) {
      setActionError("");
      setInspected(false);
    }
    if (["start", "finalize", "resolve", "reject", "cancel"].includes(name)) {
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
      if (isCurrent()) {
        if (localRecovery && context === liveActionContext.current) {
          setActionError((e as Error).message);
          pendingActionFocus.current = { initiator, generation, context };
        } else if (!localRecovery) setError((e as Error).message);
      }
    } finally {
      if (isCurrent()) setBusy("");
    }
  };
  const recoverLookup = (initiator: HTMLButtonElement) => {
    const requestedDevice = liveDeviceContext.current;
    void run("refresh", async () => {
      const recovered = await refresh();
      if (recovered) setActionError("");
      if (!mounted.current || requestedDevice !== liveDeviceContext.current)
        return;
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
    const recoveredControl = recoveryControl.current;
    const target =
      request.recovered &&
      recoveredControl?.isConnected &&
      !recoveredControl.matches(":disabled")
        ? recoveredControl
        : request.recovered && stateHeading.current
          ? stateHeading.current
          : request.initiator;
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
        // Leave room for the bounded evidence image above an inspection check
        // to finish loading without pushing the focused label below the fold.
        block: target.matches('input[type="checkbox"]') ? "center" : "nearest",
        behavior: "instant",
      });
    });
  }, [recoverySequence, busy, lookupBusy]);
  useEffect(() => {
    const request = pendingActionFocus.current;
    if (!request || busy || !actionError) return;
    pendingActionFocus.current = null;
    requestAnimationFrame(() => {
      if (
        !mounted.current ||
        request.generation !== readGate.current.generation ||
        request.context !== liveActionContext.current
      )
        return;
      const active = document.activeElement;
      if (active !== request.initiator && active !== document.body) return;
      const target = actionErrorNotice.current;
      if (!target?.isConnected || !target.getClientRects().length) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
  }, [actionError, busy]);
  const recordNegativeOutcome = (kind: "reject" | "cancel") => {
    if (
      !calibration ||
      !lifecycle ||
      !inspected ||
      reason.trim().length < 10 ||
      reason.trim().length > 1000 ||
      busy ||
      lookupBusy ||
      !(kind === "reject" ? canReject : canCancel)
    )
      return;
    const target = calibration;
    const expectedContext = lifecycle.context;
    const expectedMode = m.mode;
    const capturedReason = reason.trim();
    const initiator =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : document.body;
    void run(kind, async (isCurrent) => {
      const result = await api<{
        calibration: Calibration | null;
        requestedCalibration?: Calibration | null;
      }>(
        `/owner/machines/${m.id}/calibration/${kind === "reject" ? "reject" : "cancel-before-acceptance"}`,
        {
          attemptId: target.attemptId,
          expectedVersion: target.version,
          expectedContext,
          inspected: true,
          reason: capturedReason,
        },
      );
      const saved = [result?.calibration, result?.requestedCalibration].find(
        (value) =>
          value?.id === target.id && value?.attemptId === target.attemptId,
      );
      if (
        !validCalibration(saved) ||
        saved.version <= target.version ||
        saved.artifact?.sha256 !== target.artifact?.sha256 ||
        saved.calibrationDeviceContext !== target.calibrationDeviceContext ||
        JSON.stringify(cancellationParameters(saved)) !==
          JSON.stringify(cancellationParameters(target)) ||
        (kind === "reject"
          ? saved.calibrationInspection?.outcome !== "rejected" ||
            saved.calibrationInspection.reason !== capturedReason
          : !validCancellation(saved) ||
            saved.executionCancellation?.expected_mode !== expectedMode ||
            saved.executionCancellation?.artifact_sha256 !==
              target.artifact?.sha256 ||
            JSON.stringify(cancellationParameters(saved)) !==
              JSON.stringify(cancellationParameters(target)))
      )
        throw new ApiError(
          "The recovery response could not be matched to this exact saved attempt. Its result is unknown; refresh the saved calibration status before deciding what to do next.",
          "invalid_response",
          0,
          true,
        );
      if (!isCurrent()) return;
      setInspected(false);
      setReason("");
      setResolution("completed");
      const recovered = await refresh();
      if (!recovered && isCurrent())
        throw new Error(
          "The recovery was accepted, but its latest saved state could not be loaded. Refresh the saved calibration status before another action.",
        );
      if (recovered && isCurrent()) {
        pendingRecoveryFocus.current = {
          initiator,
          recovered: true,
          generation: readGate.current.generation,
        };
        setRecoverySequence((value) => value + 1);
      }
    });
  };
  const beginPreparation = (initiator: HTMLButtonElement) => {
    if (!canRequestNew || !lifecycle || !calibration || busy || lookupBusy)
      return;
    key.current = crypto.randomUUID();
    clearPreparationFields();
    setPreparation({
      context: lifecycle.context,
      historicalId: calibration.id,
      key: key.current,
    });
    setError("");
    setAuthorizationNotice("");
    pendingRecoveryFocus.current = {
      initiator,
      recovered: true,
      generation: readGate.current.generation,
    };
    setRecoverySequence((value) => value + 1);
  };
  return (
    <details className="physical-calibration">
      <summary>Physical calibration job & inspection</summary>
      <Notice>
        This starts one real job on the configured device and uses loaded media.
        Check the adapter, output area and camera first. Installing an adapter
        does not establish a calibration pass.
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {authorizationNotice && <Notice>{authorizationNotice}</Notice>}
      {!lookupKnown && (
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
      {unresolvedStart && (
        <Notice>
          {checkpoint?.key
            ? "An earlier calibration request has not been matched to its saved attempt. Its result is unknown. Keep checking this request before preparing another calibration; no new job is sent by refresh."
            : "The saved calibration retry details could not be read. A new physical request is blocked because the earlier result cannot be established."}
          <button
            type="button"
            className="text-button"
            disabled={lookupBusy || Boolean(busy)}
            onClick={(event) => recoverLookup(event.currentTarget)}
          >
            Check saved calibration request
          </button>
        </Notice>
      )}
      {lookupKnown && lifecycle && !lifecycle.canRequestNew && !calibration && (
        <Notice>
          {lifecycle.reason}
          <button
            type="button"
            className="text-button"
            disabled={lookupBusy || Boolean(busy)}
            onClick={(event) => recoverLookup(event.currentTarget)}
          >
            Refresh calibration status
          </button>
        </Notice>
      )}
      {calibration && canRequestNew && !preparation && (
        <div className="calibration-new-intent">
          <p>
            The previous calibration is inactive. A new preparation needs fresh
            artwork or a model and a new supervised readiness check.
          </p>
          <button
            type="button"
            className="secondary"
            ref={(node) => {
              prepareButton.current = node;
              if (node && !canInspect) recoveryControl.current = node;
            }}
            disabled={Boolean(busy) || lookupBusy}
            onClick={(event) => beginPreparation(event.currentTarget)}
          >
            Prepare a new supervised calibration
          </button>
        </div>
      )}
      {showStartForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canStart || !ownerReady || !lifecycle || busy || lookupBusy)
              return;
            const expectedContext = lifecycle.context;
            const requestKey = key.current;
            setAuthorizationNotice("");
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
              if (!storeCheckpoint(requestKey, true)) {
                removeStoredValue("session", slot);
                checkpointRef.current = null;
                setCheckpoint(null);
                throw new Error(
                  "Browser storage is unavailable, so calibration retry details cannot be saved. Allow session storage before starting physical calibration. No job was started.",
                );
              }
              let result: { calibration: Calibration };
              try {
                result = await api<{ calibration: Calibration }>(
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
                    idempotencyKey: requestKey,
                    expectedContext,
                  },
                );
                if (
                  !validCalibration(result?.calibration) ||
                  result.calibration.checkoutKey !== requestKey
                )
                  throw new ApiError(
                    "The calibration response could not be matched to this request. Its result is unknown; check the saved calibration request before starting another.",
                    "invalid_response",
                    0,
                    true,
                  );
              } catch (error) {
                if (
                  isCurrent() &&
                  error instanceof ApiError &&
                  error.status >= 400 &&
                  error.status < 500 &&
                  !error.outcomeUnknown
                ) {
                  storeCheckpoint(requestKey, false);
                  key.current = crypto.randomUUID();
                  setOwnerReady(false);
                  setAuthorizationNotice(
                    `${error.message} No new calibration was accepted for this request. Review the saved status and check readiness again before a deliberate retry.`,
                  );
                  void refresh();
                }
                throw error;
              }
              if (!isCurrent()) return;
              storeCheckpoint(requestKey, false);
              setPreparation(null);
              clearPreparationFields();
              setCalibration(result.calibration);
              await refresh();
            });
          }}
        >
          {preparation && (
            <Notice>
              New supervised calibration preparation. The previous saved attempt
              remains below. Nothing is started until you check readiness and
              choose Start physical calibration.
            </Notice>
          )}
          {m.outputType === "3d" ? (
            <>
              {modelId && (
                <PreparedModelFacts
                  details={catalog.find((model) => model.id === modelId) || {}}
                />
              )}
              <Field label="Calibration prepared model">
                <select
                  ref={(node) => {
                    recoveryControl.current = node;
                  }}
                  required
                  disabled={Boolean(busy) || !canStart}
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
                key={`${deviceContext}:${preparation?.key || "initial"}`}
                ref={(node) => {
                  recoveryControl.current = node;
                }}
                required={!assets.length}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={Boolean(busy) || !canStart}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
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
                  disabled={
                    Boolean(busy) || !canStart || m.outputType === "instax"
                  }
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                />
              </Field>
              <Field label="Calibration height (mm)">
                <input
                  required
                  type="number"
                  min="1"
                  disabled={
                    Boolean(busy) || !canStart || m.outputType === "instax"
                  }
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
              disabled={Boolean(busy) || lookupBusy || !canStart}
              checked={ownerReady}
              onChange={(e) => setOwnerReady(e.target.checked)}
            />
            <span>
              The device is supervised, the output area is clear and I am ready
              to start this physical calibration.
            </span>
          </label>
          <Button
            className="primary"
            type="submit"
            busy={busy === "start"}
            disabled={
              Boolean(busy) ||
              lookupBusy ||
              !canStart ||
              !ownerReady ||
              !m.paired ||
              !m.configured ||
              (m.outputType === "3d" ? !modelId : !assets.length)
            }
          >
            Start physical calibration
          </Button>
          {preparation && (
            <button
              type="button"
              className="text-button"
              disabled={Boolean(busy) || lookupBusy || unresolvedStart}
              onClick={() => {
                const initiator = document.activeElement;
                setPreparation(null);
                clearPreparationFields();
                key.current = crypto.randomUUID();
                pendingRecoveryFocus.current = null;
                requestAnimationFrame(() => {
                  if (
                    mounted.current &&
                    (document.activeElement === initiator ||
                      document.activeElement === document.body)
                  ) {
                    prepareButton.current?.focus({ preventScroll: true });
                    prepareButton.current?.scrollIntoView({
                      block: "nearest",
                      behavior: "instant",
                    });
                  }
                });
              }}
            >
              Cancel calibration preparation
            </button>
          )}
        </form>
      )}
      {calibration && (
        <>
          <div className="calibration-status">
            <strong
              className="calibration-state-heading"
              role="heading"
              aria-level={4}
              tabIndex={-1}
              ref={stateHeading}
            >
              {lifecycle?.calibrationActive
                ? "Current calibration attempt"
                : "Saved inactive calibration"}
            </strong>
            <Badge>
              {human(nodeState || calibration.productionState || "unknown")}
            </Badge>
            <p>
              Attempt {calibration.attemptId}. Reconciliation checks this saved
              attempt and never silently starts another calibration job.
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
          {lifecycle?.contextMatch === false && (
            <Notice>
              This saved attempt belongs to an earlier device setup. Its
              inspection cannot confirm calibration for the current setup.
            </Notice>
          )}
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
                Calibration evidence · {date(calibration.evidence.capturedAt)} ·{" "}
                {calibration.evidence.machineId}
              </figcaption>
            </figure>
          )}
          {calibration.calibrationInspection && (
            <Notice>
              Calibration output rejected. Execution remains completed. The
              machine stays paused and uncalibrated; inspect and fix the setup
              before preparing a new supervised calibration.
            </Notice>
          )}
          {calibration.executionCancellation && (
            <Notice>
              The node durably cancelled this attempt before acceptance. This
              does not stop an accepted job. The machine stays paused and
              uncalibrated.
            </Notice>
          )}
          {!preparation &&
            !calibration.calibrationInspection &&
            !calibration.executionCancellation && (
              <div className="calibration-inspection">
                <p>
                  {calibration.productionState === "produced"
                    ? "The execution completed. Inspect whether its output is usable; completion alone is not a calibration pass."
                    : "Inspect the device and this exact attempt before recording an outcome. Missing node status is not proof that a delayed request cannot still arrive."}
                </p>
                <label className="check">
                  <input
                    ref={(node) => {
                      if (node) recoveryControl.current = node;
                    }}
                    type="checkbox"
                    disabled={Boolean(busy) || !canDescribe}
                    checked={inspected}
                    onChange={(event) => setInspected(event.target.checked)}
                  />
                  <span>
                    I inspected this device and the output state for this
                    calibration attempt.
                  </span>
                </label>
                <Field label="Calibration inspection reason">
                  <input
                    required
                    minLength={10}
                    maxLength={1000}
                    disabled={Boolean(busy) || !canDescribe}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Describe the observed output and inspection"
                  />
                </Field>
                <Button
                  className="secondary"
                  busy={busy === "finalize"}
                  disabled={
                    Boolean(busy) ||
                    lookupBusy ||
                    !canConfirm ||
                    !inspected ||
                    reason.trim().length < 10 ||
                    reason.trim().length > 1000
                  }
                  onClick={() => {
                    const observedReason = reason;
                    void run("finalize", async (isCurrent) => {
                      let failure: Error | undefined;
                      const accepted = await finalize(
                        {
                          inspected: true,
                          attemptId: calibration.attemptId,
                          reason: observedReason,
                        },
                        (error) => {
                          failure = error;
                        },
                      );
                      if (!accepted)
                        throw (
                          failure ||
                          new Error(
                            "The calibration confirmation could not be confirmed. Refresh the saved calibration status.",
                          )
                        );
                      if (!isCurrent()) return;
                      setInspected(false);
                      setReason("");
                      setResolution("completed");
                      if (!(await refresh()) && isCurrent())
                        throw new Error(
                          "Calibration confirmation was accepted, but the latest saved state could not be loaded. Refresh before another action.",
                        );
                    });
                  }}
                >
                  Confirm usable calibration
                </Button>
                {calibration.productionState === "produced" &&
                  lifecycle?.calibrationActive && (
                    <div className="calibration-negative-action">
                      <p>
                        If the completed output is missing or unusable, reject
                        this calibration result. The completed execution record
                        is retained.
                      </p>
                      <Button
                        className="secondary"
                        busy={busy === "reject"}
                        disabled={
                          Boolean(busy) ||
                          lookupBusy ||
                          !canReject ||
                          !inspected ||
                          reason.trim().length < 10 ||
                          reason.trim().length > 1000
                        }
                        onClick={() => recordNegativeOutcome("reject")}
                      >
                        Reject calibration output
                      </Button>
                    </div>
                  )}
                {lifecycle?.canRequestCancellation && (
                  <div className="calibration-negative-action">
                    <p>
                      Request cancellation of this exact saved attempt before
                      device acceptance. Only the node can confirm that it has
                      not accepted the request. This does not stop an accepted
                      job.
                    </p>
                    <Button
                      className="secondary"
                      busy={busy === "cancel"}
                      disabled={
                        Boolean(busy) ||
                        lookupBusy ||
                        !canCancel ||
                        !inspected ||
                        reason.trim().length < 10 ||
                        reason.trim().length > 1000
                      }
                      onClick={() => recordNegativeOutcome("cancel")}
                    >
                      Cancel before device acceptance
                    </Button>
                  </div>
                )}
                {lifecycle?.calibrationActive &&
                  ["needs_review", "failed"].includes(
                    calibration.productionState || "",
                  ) && (
                    <details className="calibration-resolution">
                      <summary>
                        Resolve an uncertain calibration attempt
                      </summary>
                      <p>
                        Record an observed execution outcome after the worker
                        and any stop request have settled. This does not rerun
                        the physical job. An unusable completed output must be
                        rejected separately.
                      </p>
                      <Field label="Observed calibration outcome">
                        <select
                          disabled={Boolean(busy) || !canResolve}
                          value={resolution}
                          onChange={(event) =>
                            setResolution(event.target.value)
                          }
                        >
                          <option
                            value="completed"
                            disabled={calibration.productionState === "failed"}
                          >
                            Completed · output observed
                          </option>
                          <option value="failed">
                            Failed · execution did not complete
                          </option>
                        </select>
                      </Field>
                      <Button
                        className="secondary"
                        disabled={
                          Boolean(busy) ||
                          lookupBusy ||
                          !canResolve ||
                          !inspected ||
                          reason.trim().length < 10 ||
                          reason.trim().length > 1000 ||
                          (calibration.productionState === "failed" &&
                            resolution !== "failed")
                        }
                        busy={busy === "resolve"}
                        onClick={() => {
                          const result = resolution;
                          const observedReason = reason;
                          void run("resolve", async (isCurrent) => {
                            await api(
                              `/owner/machines/${m.id}/calibration/resolve`,
                              {
                                attemptId: calibration.attemptId,
                                result,
                                inspected: true,
                                reason: observedReason,
                              },
                            );
                            if (!isCurrent()) return;
                            setInspected(false);
                            setReason("");
                            setResolution("completed");
                            if (!(await refresh()) && isCurrent())
                              throw new Error(
                                "The observed outcome was accepted, but its latest saved state could not be loaded. Refresh before another action.",
                              );
                          });
                        }}
                      >
                        Record observed outcome
                      </Button>
                    </details>
                  )}
              </div>
            )}
          {actionError && (
            <div
              className="notice error calibration-action-recovery"
              role="alert"
              tabIndex={-1}
              ref={actionErrorNotice}
            >
              <p>
                The calibration result could not be confirmed here. Refresh its
                saved status before deciding what to do next. No replacement job
                was requested.
              </p>
              <p>{actionError}</p>
              <button
                type="button"
                className="text-button"
                disabled={Boolean(busy) || lookupBusy}
                onClick={(event) => recoverLookup(event.currentTarget)}
              >
                Refresh saved calibration status
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}

type OwnerJobAction = (
  name: string,
  body?: unknown,
  options?: {
    onError?: (error: Error) => void;
    onAccepted?: (job: unknown) => void;
  },
) => Promise<boolean>;
type PickupRenewalBody = {
  idempotencyKey: string;
  expectedVersion: number;
  expectedExpiresAt: string;
};
type PickupRenewalDraft = {
  body: PickupRenewalBody;
  phase: "pending" | "unknown";
  message: string;
  checkedVersion?: number;
} | null;
function OwnerPickup({
  job,
  busy,
  action,
  refresh,
}: {
  job: Job;
  busy: string;
  action: OwnerJobAction;
  refresh: () => Promise<boolean>;
}) {
  const scope = ownerActionDraftKey("renewal", job);
  const [code, setCode] = useOwnerDraft(
    ownerActionDraftKey("pickup", job),
    () => "",
    Boolean,
  );
  const [renewal, setRenewal] = useOwnerDraft<PickupRenewalDraft>(
    scope,
    () => null,
    Boolean,
  );
  const [now, setNow] = useState(Date.now());
  const [reading, setReading] = useState(false);
  const [transferringFocus, setTransferringFocus] = useState(false);
  const [readError, setReadError] = useState("");
  const [readResult, setReadResult] = useState<{
    sequence: number;
    ok: boolean;
    initiator: HTMLElement;
  } | null>(null);
  const [focusSequence, setFocusSequence] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(0);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const liveJob = useRef(job);
  liveJob.current = job;
  const notice = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const renewButton = useRef<HTMLButtonElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{
    sequence: number;
    initiator: Element | null;
    kind: "error" | "current";
    minVersion?: number;
  } | null>(null);
  const deadline = Date.parse(job.pickup?.expiresAt || "");
  const expiryKnown = Number.isFinite(deadline);
  const expired = expiryKnown && deadline <= now;
  const renewalBusy = busy === `${job.id}-renew-pickup`;
  const unknownRenewal = Boolean(
    renewal && (renewal.phase === "unknown" || !renewalBusy),
  );
  const blocked = Boolean(busy) || reading;
  const canRenew =
    job.productionState === "produced" &&
    job.fulfillmentState === "ready_for_pickup" &&
    !job.pickup?.redeemedAt &&
    expired &&
    Number.isSafeInteger(job.version) &&
    job.version > 0;
  const canRetry = Boolean(
    unknownRenewal &&
    renewal?.checkedVersion === job.version &&
    renewal.body.expectedVersion === job.version &&
    renewal.body.expectedExpiresAt === job.pickup?.expiresAt &&
    canRenew,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
    };
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.pickup?.expiresAt]);
  useEffect(() => {
    setReadError("");
  }, [scope]);
  const queueFocus = (request: NonNullable<typeof pendingFocus.current>) => {
    pendingFocus.current = request;
    setFocusSequence((value) => value + 1);
  };
  const renewalRecorded = (value: Job, body: PickupRenewalBody) =>
    value.pickupRenewals?.some(
      (record) =>
        record.key === body.idempotencyKey &&
        record.expectedVersion === body.expectedVersion &&
        record.expectedExpiresAt === body.expectedExpiresAt &&
        Number.isFinite(Date.parse(record.renewedAt)),
    );
  const validCurrent = (value: unknown): value is Job => {
    const saved = value as Job | null;
    return Boolean(
      saved &&
      typeof saved === "object" &&
      !Array.isArray(saved) &&
      saved.id === job.id &&
      Number.isSafeInteger(saved.version) &&
      saved.version > 0 &&
      saved.productionState === "produced" &&
      ["ready_for_pickup", "collected"].includes(saved.fulfillmentState) &&
      saved.pickup &&
      typeof saved.pickup === "object" &&
      !Array.isArray(saved.pickup) &&
      typeof saved.pickup.code === "string" &&
      saved.pickup.code.length > 0 &&
      saved.pickup.code.length <= 256 &&
      Number.isFinite(Date.parse(saved.pickup.expiresAt || "")) &&
      (saved.fulfillmentState === "collected"
        ? Number.isFinite(Date.parse(saved.pickup.redeemedAt || ""))
        : !saved.pickup.redeemedAt) &&
      (saved.pickupRenewals === undefined ||
        (Array.isArray(saved.pickupRenewals) &&
          saved.pickupRenewals.every(
            (record) =>
              record &&
              typeof record.key === "string" &&
              Number.isSafeInteger(record.expectedVersion) &&
              record.expectedVersion > 0 &&
              typeof record.expectedExpiresAt === "string" &&
              Number.isFinite(Date.parse(record.expectedExpiresAt)) &&
              Number.isFinite(Date.parse(record.renewedAt)),
          ))),
    );
  };
  const renew = async (retry = false) => {
    if (blocked || !canRenew || (renewal && (!retry || !canRetry))) return;
    const body =
      retry && renewal
        ? renewal.body
        : {
            idempotencyKey: crypto.randomUUID(),
            expectedVersion: job.version,
            expectedExpiresAt: job.pickup!.expiresAt!,
          };
    const capturedScope = scope;
    const initiator = document.activeElement;
    const sequence = ++operation.current;
    setReadError("");
    setTransferringFocus(true);
    setRenewal({ body, phase: "pending", message: "" });
    let failure: Error | undefined;
    let acceptedVersion: number | undefined;
    const accepted = await action("renew-pickup", body, {
      onError: (error) => {
        failure = error;
      },
      onAccepted: (value) => {
        if (
          !validCurrent(value) ||
          value.version <= body.expectedVersion ||
          !renewalRecorded(value, body)
        )
          throw new ApiError(
            "Pickup renewal response could not be matched to this request.",
            "invalid_response",
            0,
            true,
          );
        acceptedVersion = value.version;
      },
    });
    if (!mounted.current || operation.current !== sequence) return;
    if (accepted) {
      if (liveScope.current === capturedScope)
        setRenewal({
          body,
          phase: "unknown",
          message:
            "The renewal was accepted, but the latest pickup state still needs confirmation. Check its saved status before another action.",
        });
      queueFocus({
        sequence,
        initiator,
        kind: "current",
        minVersion: acceptedVersion,
      });
    } else if (liveScope.current === capturedScope) {
      const message =
        failure instanceof ApiError && failure.code === "PICKUP_NOT_EXPIRED"
          ? "The workshop reports that the current code is still valid. Check the saved pickup status before using it or trying again."
          : failure instanceof ApiError &&
              ["PICKUP_CHANGED", "PICKUP_UNAVAILABLE"].includes(failure.code)
            ? "The saved pickup state changed. Check its current status before deciding whether renewal is still needed."
            : "Renewal could not be confirmed. Check the saved pickup status before retrying. No new item or payment was requested.";
      setRenewal({ body, phase: "unknown", message });
      queueFocus({ sequence, initiator, kind: "error" });
    } else setTransferringFocus(false);
  };
  const check = async (initiator: HTMLElement) => {
    if (blocked) return;
    const sequence = ++operation.current;
    setReading(true);
    setReadError("");
    const ok = await refresh();
    if (!mounted.current || operation.current !== sequence) return;
    setReading(false);
    setReadResult({ sequence, ok, initiator });
  };
  useEffect(() => {
    if (!readResult || reading || busy) return;
    const result = readResult;
    setReadResult(null);
    if (result.sequence !== operation.current) return;
    if (!result.ok || !validCurrent(liveJob.current)) {
      setReadError(
        "The saved pickup status could not be confirmed. Keep the current item and try checking again; no renewal was sent by this check.",
      );
      queueFocus({
        sequence: result.sequence,
        initiator: result.initiator,
        kind: "error",
      });
      return;
    }
    if (renewal) {
      const current = liveJob.current;
      if (
        renewalRecorded(current, renewal.body) ||
        current.version > renewal.body.expectedVersion ||
        current.pickup?.expiresAt !== renewal.body.expectedExpiresAt
      )
        setRenewal(null);
      else
        setRenewal({
          ...renewal,
          phase: "unknown",
          checkedVersion: current.version,
        });
    }
    queueFocus({
      sequence: result.sequence,
      initiator: result.initiator,
      kind: "current",
    });
  }, [readResult, reading, busy, job]);
  useEffect(() => {
    const request = pendingFocus.current;
    if (!request || blocked || request.sequence !== operation.current) return;
    requestAnimationFrame(() => {
      if (!mounted.current || request.sequence !== operation.current) return;
      const active = document.activeElement;
      if (active !== request.initiator && active !== document.body) {
        pendingFocus.current = null;
        setTransferringFocus(false);
        return;
      }
      const awaitingState =
        request.minVersion !== undefined &&
        liveJob.current.version < request.minVersion;
      const target =
        request.kind === "error" || awaitingState
          ? notice.current
          : renewal
            ? canRetry
              ? retryButton.current
              : checkButton.current
            : !expired && expiryKnown
              ? input.current
              : renewButton.current || heading.current;
      if (
        !target?.isConnected ||
        !target.getClientRects().length ||
        target.matches(":disabled")
      )
        return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", behavior: "instant" });
      if (awaitingState) request.initiator = target;
      else {
        pendingFocus.current = null;
        setTransferringFocus(false);
      }
    });
  }, [
    focusSequence,
    blocked,
    renewal,
    canRetry,
    expired,
    expiryKnown,
    job.version,
  ]);
  return (
    <section className="owner-pickup">
      <h4 tabIndex={-1} ref={heading}>
        Confirm handoff
      </h4>
      <p>
        {expired
          ? "Pickup code expired. Renew it before recording collection. The item is still stored for this order."
          : !expiryKnown
            ? "The pickup expiry could not be confirmed. Check its saved status before using a code."
            : `Enter the requester’s pickup code when you hand over this item. Expires ${date(job.pickup!.expiresAt!)}. Codes work once.`}
      </p>
      {(expired || transferringFocus) && (
        <div className="pickup-renewal">
          <p>
            A new code will appear in the requester’s order. Renewal does not
            make another item, change payment or record collection.
          </p>
          <button
            className="secondary"
            type="button"
            ref={renewButton}
            disabled={blocked || Boolean(renewal) || !canRenew}
            aria-busy={renewalBusy || undefined}
            onClick={() => void renew()}
          >
            {renewalBusy
              ? "Renewing pickup code…"
              : "Renew expired pickup code"}
          </button>
        </div>
      )}
      {(unknownRenewal ||
        readError ||
        !expiryKnown ||
        reading ||
        readResult ||
        pendingFocus.current?.kind === "current") && (
        <div
          className={`notice ${unknownRenewal || readError || !expiryKnown ? "error" : "info"} pickup-recovery`}
          role={
            unknownRenewal || readError || !expiryKnown ? "alert" : "status"
          }
          tabIndex={-1}
          ref={notice}
        >
          <p>
            {readError ||
              renewal?.message ||
              (!expiryKnown
                ? "The pickup expiry could not be confirmed. Check the saved pickup status before using a code."
                : reading
                  ? "Checking the saved pickup status…"
                  : unknownRenewal
                    ? "An earlier renewal has not been confirmed. Check its saved pickup status before retrying."
                    : "Saved pickup status confirmed.")}
          </p>
          <div className="button-row">
            <button
              className="text-button"
              type="button"
              ref={checkButton}
              disabled={blocked}
              onClick={(event) => void check(event.currentTarget)}
            >
              Check pickup status
            </button>
            {canRetry && (
              <button
                className="text-button"
                type="button"
                ref={retryButton}
                disabled={blocked}
                onClick={() => void renew(true)}
              >
                Retry pickup code renewal
              </button>
            )}
          </div>
        </div>
      )}
      {!unknownRenewal &&
        expiryKnown &&
        !reading &&
        !readResult &&
        !pendingFocus.current && (
          <button
            className="text-button pickup-status-check"
            type="button"
            ref={checkButton}
            disabled={blocked}
            onClick={(event) => void check(event.currentTarget)}
          >
            Check pickup status
          </button>
        )}
      <form
        className="redeem-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (expired || !expiryKnown || blocked || renewal) return;
          if (await action("redeem", { code })) setCode("");
        }}
      >
        <Field label="Pickup code">
          <input
            ref={input}
            required
            disabled={blocked || expired || !expiryKnown || Boolean(renewal)}
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Requester’s code"
          />
        </Field>
        <div className="button-row">
          <Button
            className="primary"
            busy={busy === `${job.id}-redeem`}
            disabled={blocked || expired || !expiryKnown || Boolean(renewal)}
            type="submit"
          >
            Redeem & record collection
          </Button>
          {code && (
            <Button
              className="secondary"
              type="button"
              disabled={blocked}
              onClick={() => setCode("")}
            >
              Discard pickup code
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function OwnerJob({
  job: j,
  busy,
  health,
  action,
  simulation,
  ledger,
  refresh,
  machineName,
  onProducerHub,
}: {
  job: Job;
  ledger: Ledger[];
  machineName?: string;
  /** The machine prints through the producer side's hub, which has no camera yet. */
  onProducerHub?: boolean;
  busy: string;
  health: Health | null;
  action: OwnerJobAction;
  refresh: () => Promise<boolean>;
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
  const preparationComplete = Object.values(prepared).every(Boolean);
  const [stepsOpen, setStepsOpen] = useState(
    () => Object.values(prepared).some(Boolean) && !preparationComplete,
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
  const recovered = j.history?.some(
    (event) => event.event === "owner_recovery",
  );
  // One plain sentence: what is happening with this order and whether it needs you.
  const nextStep = needsHandling
    ? "Passed its result check. Prepare it for pickup below."
    : j.productionState === "needs_review"
      ? j.spec.permission === "unclear" && !j.attemptId
        ? "Confirm whether the requester may print this artwork."
        : "The result is uncertain. Inspect the evidence and the machine, then record a decision."
      : j.productionState === "failed" && !recovered
        ? "The output did not pass its check. Inspect and clear the machine below."
        : j.fulfillmentState === "ready_for_pickup"
          ? "Stored and waiting for the requester. Enter their code at handoff."
          : j.paymentState === "collection_pending"
            ? "Payment is confirming. No action is needed unless it stays pending."
            : j.paymentState === "refund_pending"
              ? "A refund is confirming. No action is needed unless it stays pending."
              : j.paymentState === "release_pending"
                ? "Your payout is confirming. No action is needed unless it stays pending."
                : ["dispatched", "running", "verifying"].includes(
                      j.productionState,
                    )
                  ? "On the machine now. Fabrary tracks progress and checks the result."
                  : j.productionState === "payment_confirmed"
                    ? "Paid. Waiting for the requester to start production."
                    : ["specified", "approved", "quoted"].includes(
                          j.productionState,
                        )
                      ? "Waiting for the requester to approve the preview and pay."
                      : j.fulfillmentState === "collected"
                        ? "Collected. Nothing left to do."
                        : j.productionState === "cancelled"
                          ? "Cancelled. Nothing left to do."
                          : j.productionState === "failed"
                            ? "The machine was cleared. Resume it from Machines when it is safe."
                            : "";
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
        <div className="job-main">
          <h3>
            {outputLabels[j.spec.outputType]} <span>#{shortId(j.id)}</span>
          </h3>
          <p>{j.spec.intent}</p>
        </div>
        <div className="job-states">
          <Badge
            tone={
              needsHandling || needsReview
                ? "amber"
                : j.fulfillmentState === "ready_for_pickup"
                  ? "blue"
                  : j.productionState === "produced"
                    ? "green"
                    : "neutral"
            }
          >
            {needsHandling
              ? "Prepare for pickup"
              : j.productionState === "needs_review"
                ? "Review needed"
                : j.productionState === "failed"
                  ? recovered
                    ? "Failed · cleared"
                    : "Check failed execution"
                  : j.fulfillmentState === "ready_for_pickup"
                    ? "Awaiting pickup"
                    : requesterStatus(j)}
          </Badge>
          {(health?.mode === "simulation" ||
            j.evidence?.source === "simulation") && (
            <span className="sim-label">Simulation</span>
          )}
        </div>
      </div>
      {nextStep && <p className="owner-next-step">{nextStep}</p>}
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
            Check the physical item before confirming. Collection can happen
            later.
          </p>
          <label className="check provider-handling-confirmation">
            <input
              type="checkbox"
              required
              disabled={Boolean(busy)}
              checked={preparationComplete}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setPrepared({
                  removed: checked,
                  labeled: checked,
                  stored: checked,
                  cleared: checked,
                });
              }}
            />
            <span>
              I removed and labeled the item, stored it safely, and cleared the
              machine.
            </span>
          </label>
          <details
            className="provider-handling-steps"
            open={stepsOpen}
            onToggle={(event) => setStepsOpen(event.currentTarget.open)}
          >
            <summary>Record steps separately</summary>
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
          </details>
          <div className="button-row">
            <Button
              className="primary"
              busy={busy === `${j.id}-prepare`}
              disabled={Boolean(busy) || !preparationComplete}
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
        <OwnerPickup job={j} busy={busy} action={action} refresh={refresh} />
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
      {onProducerHub &&
        j.productionState === "needs_review" &&
        j.attemptId && (
          <div className="approve-print">
            <p>
              This printer has no camera yet, so you are the check. Look at the
              print, take it off the printer, then approve it to free the
              printer for the next order.
            </p>
            <Button
              className="primary"
              busy={busy === `${j.id}-approve-print`}
              disabled={Boolean(busy)}
              onClick={() => void action("approve-print", { checked: true })}
            >
              Printed fine · approve and free the printer
            </Button>
          </div>
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
      {j.abortStatus && (
        <Notice>
          Machine stop status: <strong>{human(j.abortStatus)}</strong>.{" "}
          {j.abortStatus === "stopped"
            ? "The device confirmed that this attempt stopped."
            : "A stop is not confirmed. Inspect and reconcile the machine before any new execution."}
        </Notice>
      )}
      <div className="owner-job-more">
        <details className="provider-order-facts">
          <summary>Order details</summary>
          <p>
            {machineName || j.machineId || "Machine not reserved"} ·{" "}
            {j.spec.quantity} × {j.spec.widthMm} × {j.spec.heightMm}
            {j.spec.outputType === "3d"
              ? ` × ${j.spec.depthMm} mm · ${j.spec.color} · estimated ${j.spec.estimatedSeconds} seconds`
              : " mm"}{" "}
            · {materialLabel(j.spec.material)}
          </p>
          <dl>
            <div>
              <dt>Production</dt>
              <dd>{describe(productionLabels, j.productionState)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{describe(paymentLabels, j.paymentState)}</dd>
            </div>
            <div>
              <dt>Collection</dt>
              <dd>{describe(fulfillmentLabels, j.fulfillmentState)}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{date(j.createdAt)}</dd>
            </div>
          </dl>
        </details>
        {j.quote && ["produced", "failed"].includes(j.productionState) && (
          <TrialEconomicsForm
            jobId={j.id}
            economics={j.economics}
            simulation={health?.mode !== "hardware"}
            busy={Boolean(busy)}
            onSubmit={(values) => action("economics", values)}
          />
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
              Applies to the machine’s next simulated job. This does not
              validate hardware.
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
                <option value="lost_ack">
                  Lost acknowledgment · uncertain
                </option>
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
      </div>
    </article>
  );
}
const ledgerKinds: Record<string, string> = {
  collection: "Payment collected",
  release: "Payout to owner",
  refund: "Refund to requester",
};
const ledgerStates: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  submitting: "Sending",
  unknown: "Needs checking",
  failed: "Failed",
};
function LedgerList({ ledger }: { ledger: Ledger[] }) {
  return ledger?.length ? (
    <div className="ledger-list">
      {ledger.map((item, index) => {
        const state = String(item.state || item.status || "recorded");
        const reference =
          item.transactionRef || item.transactionHash || item.reference;
        return (
          <div className="ledger-entry" key={item.id || index}>
            <div>
              <strong>
                {describe(
                  ledgerKinds,
                  String(item.kind || item.type || "Payment record"),
                )}
              </strong>
              <small>
                {item.jobId ? `Order ${shortId(item.jobId)}` : ""}
                {item.mode === "mock"
                  ? " · Mock record"
                  : item.mode === "testnet"
                    ? " · Testnet"
                    : ""}
              </small>
            </div>
            <Badge
              tone={
                state === "confirmed"
                  ? "green"
                  : ["failed", "unknown"].includes(state)
                    ? "amber"
                    : "neutral"
              }
            >
              {describe(ledgerStates, state)}
            </Badge>
            <strong className="ledger-amount">
              {money(Number(item.amountCents ?? item.cents ?? 0))}
            </strong>
            {Boolean(reference) && (
              <code className="transaction-ref">{String(reference)}</code>
            )}
          </div>
        );
      })}
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
