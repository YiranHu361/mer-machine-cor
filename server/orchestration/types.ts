import type {
  EngineState,
  NetworkMachine,
  ProcessId,
} from "../relief/index.ts";

/** Product experience, chosen by the entry point, never by the requester. */
export type Experience = "best_single" | "gift" | "relief";
/** Where an order came in: the web app, or the ASI:One agent on Agentverse. */
export type OrderSource = "web" | "asi1";
export type ExecutionMode = "simulation" | "hardware";
export type Process = ProcessId;

export interface IntentItem {
  process: Process;
  name: string;
  why: string;
  quantity: number;
  creation: "preserve" | "generate" | "combine";
  /** Requester-owned photos this item is made from. */
  photoAssetIds: string[];
  /** What to draw when new artwork is needed, e.g. "cat". */
  subject?: string;
  /** Normalized [x0, y0, x1, y1] per photo asset. */
  subjectBoxes?: Record<string, [number, number, number, number]>;
  /** Keychain text for the text-tag template. */
  text?: string;
  colorImportant: boolean;
  catalogItemId?: string;
}
export interface IntentBrief {
  provider: "claude" | "local";
  model?: string;
  outcome: string;
  items: IntentItem[];
  /** How many of the items the request asked for (several-thing orders); later ones are extras. Absent means one. */
  requested?: number;
  question: string | null;
  reason: string;
}
export interface DesignCandidate {
  id: string;
  round: number;
  index: number;
  title: string;
  /** A drawing (Claude, fixture) has an SVG; a picture (OpenAI, Nano Banana) has an image. */
  svgAssetId?: string;
  svgSha256?: string;
  imageAssetId?: string;
  imageSha256?: string;
  previewAssetId: string;
  previewUrl: string;
  provider: "claude" | "fixture" | "nano-banana" | "openai";
  model?: string;
  promptVersion: string;
  createdAt: string;
}
export interface CandidateSet {
  id: string;
  draftRevision: number;
  itemId: string;
  subject: string;
  rounds: number;
  maxRounds: number;
  status: "generating" | "ready" | "failed";
  candidates: DesignCandidate[];
  recommendedId: string | null;
  selectedId: string | null;
  reason?: string;
}
/** The producer's saved answer to one pure preparation request. */
export interface PreparationReceipt {
  id: string;
  key: string;
  inputDigest: string;
  ownerId: string;
  machineId: string;
  executionMode: ExecutionMode;
  process: Process;
  profileVersion: string;
  compilerVersion: string;
  artifact: {
    assetId: string;
    sha256: string;
    mediaType: string;
    bytes: number;
  } | null;
  recipe: { sha256: string; itemId: string; name: string } | null;
  preview: {
    assetId: string;
    url: string;
    sha256: string;
    widthPx: number;
    heightPx: number;
    color: "mono" | "color";
  };
  parameters: Record<string, unknown>;
  estimates: {
    material: { amount: number; unit: string };
    minutesPerUnit: number;
    setupMinutes: number;
    basis: string;
  };
  warnings: string[];
  handling: string[];
  createdAt: string;
}
export interface PlanItem {
  id: string;
  process: Process;
  name: string;
  why: string;
  quantity: number;
  source: "requested" | "extra";
  extraOf?: string;
  /** Quantity no machine could take yet; a new machine may pick it up. */
  unallocatedQuantity?: number;
  design: {
    kind: "photos" | "svg" | "text_tag" | "sim_catalog_item";
    candidateId?: string;
    photoAssetIds?: string[];
    text?: string;
    catalogItemId?: string;
  };
}
export interface PriceTerms {
  ownerCents: number;
  feeCents: number;
  totalCents: number;
  terms: { label: string; cents: number }[];
  policy: string;
}
export interface Assignment {
  id: string;
  itemId: string;
  machineId: string;
  machineSource: "registry" | "network";
  machineName: string;
  executionMode: ExecutionMode;
  /** Only hardware work enters the payable total. */
  chargeable: boolean;
  quantity: number;
  preparationId: string;
  artifactSha256: string | null;
  recipeSha256: string | null;
  previewUrl: string;
  parameters: Record<string, unknown>;
  schedule: { startSeconds: number; finishSeconds: number };
  price: PriceTerms;
  childJobId?: string;
  simJobId?: string;
}
export type PlanStatus =
  | "proposed"
  | "approved"
  | "in_progress"
  | "done"
  | "partial"
  | "cancelled"
  | "needs_review";
export interface Plan {
  version: number;
  digest: string;
  experience: Experience;
  items: PlanItem[];
  assignments: Assignment[];
  payableCents: number;
  feeCents: number;
  simulatedEstimateCents: number;
  currency: "USD";
  paymentMode: "mock" | "testnet";
  collectionPoint: string;
  readyEstimateMinutes: number;
  status: PlanStatus;
  changes: string[];
  createdAt: string;
  policyVersion: string;
}
export interface FormatSuggestion {
  id: string;
  process: Process;
  label: string;
  operation: "replace" | "add";
  itemId: string;
  estimateCents: number;
  note: string;
}
export interface Offer {
  id: string;
  planVersion: number;
  planDigest: string;
  payableCents: number;
  simulatedEstimateCents: number;
  paymentMode: "mock" | "testnet";
  allocationDigest: string;
  expiresAt: string;
  createdAt: string;
  collectionPoint: string;
}
export interface MakeIntent {
  id: string;
  key: string;
  offerId: string;
  planDigest: string;
  planVersion: number;
  permission: true;
  consent: { payment: true; production: true };
  authorizedCents: number;
  cancelRequested?: boolean;
  reassignment: "none" | "relief_mandate";
  mandate?: { capCents: number; sameMode: true; sameProcess: true };
  status:
    | "authorized"
    | "collecting"
    | "funded"
    | "submitted"
    | "payment_pending"
    | "payment_failed"
    | "cancelled";
  payment: {
    operationId: string | null;
    status: "not_required" | "submitting" | "pending" | "confirmed" | "failed";
    reference?: string;
    transactionHash?: string;
    reason?: string;
  };
  createdAt: string;
  updatedAt: string;
}
export type PreparationStage =
  | "created"
  | "understanding"
  | "resolving_profiles"
  | "generating_candidates"
  | "awaiting_design_choice"
  | "designing"
  | "producer_preparing"
  | "preflighting"
  | "proposed"
  | "needs_clarification"
  | "unavailable"
  | "failed"
  | "superseded";
export interface OrderEvent {
  seq: number;
  type: string;
  at: string;
  draftRevision: number;
  planVersion: number | null;
  data: Record<string, unknown>;
}
export interface Order {
  id: string;
  requesterId: string;
  creationKey: string;
  experience: Experience;
  /** Absent on orders made before sources were recorded: those came from the web. */
  source?: OrderSource;
  /** The name the person gave, for the maker's screens. */
  requesterName?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  draft: {
    revision: number;
    requestText: string;
    photoAssetIds: string[];
    stage: PreparationStage;
    reason?: string;
    question?: string | null;
    headCount?: number;
    /** Fences a preparation worker: a stale worker never commits. */
    lease?: { id: string; expiresAt: string };
  };
  intent?: IntentBrief;
  candidates?: CandidateSet;
  plan?: Plan;
  planHistory: {
    version: number;
    digest: string;
    createdAt: string;
    changes: string[];
  }[];
  suggestions: FormatSuggestion[];
  offer?: Offer;
  makeIntent?: MakeIntent;
  /** Pickup or delivery, set by the person; the courier is called by the owner. */
  delivery?: Delivery;
  status: PlanStatus | "preparing";
  events: OrderEvent[];
  nextSeq: number;
}
export interface DeliveryCourier {
  name: string;
  vehicle: string;
  /** A display number; nothing dials it. */
  phone: string;
  calledAt: string;
  /** Estimates fixed when the courier is called. */
  pickupAt: string;
  arriveAt: string;
}
export interface Delivery {
  mode: "pickup" | "delivery";
  /** Delivery only: where the person is, rounded to 4 decimals. */
  to?: { lat: number; lng: number; label: string; source: "gps" | "map" };
  /** Street-route km when the person's page had one. */
  km: number | null;
  chosenAt: string;
  courier?: DeliveryCourier;
  /** A pickup the owner handed over without a pickup code. */
  handedOverAt?: string;
}
export interface ReliefState {
  seed: number;
  network: NetworkMachine[];
  engine: EngineState;
  outages: { id: string; polygon: [number, number][]; at: string }[];
}
