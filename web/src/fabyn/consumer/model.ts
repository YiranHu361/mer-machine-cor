/* Shapes of the real order view (server/orchestration/orchestrator.ts orderView).
   Only the fields the consumer screens read are typed here. */

export type Process = "fdm_print" | "sticker_print" | "photo_print";

export interface OrderItem {
  id: string;
  process: Process;
  name: string;
  why: string;
  quantity: number;
  source: "requested" | "extra";
  design: {
    kind: string;
    text?: string;
    /** lettering set under a sticker's picture */
    caption?: string;
    candidateId?: string;
    photoAssetIds?: string[];
  };
}

export interface Assignment {
  id: string;
  itemId: string;
  machineId: string;
  machineName: string;
  machineSource: string;
  executionMode: "simulation" | "hardware";
  chargeable: boolean;
  quantity: number;
  previewUrl?: string;
  /** what the producer prepared: sizes in mm, material, text */
  parameters?: {
    width_mm?: number;
    height_mm?: number;
    model_size_mm?: number[];
    material?: string;
    color_mode?: string;
    text?: string;
  };
  schedule?: { startSeconds: number; finishSeconds: number };
  /** the server's price: maker's price + fabyn fee (10%) = total; basis once the server sends it */
  price?: {
    totalCents: number;
    ownerCents?: number;
    feeCents?: number;
    terms: { label: string; cents: number }[];
    basis?: PriceBasis;
  };
  child?: {
    id: string;
    productionState: string;
    paymentState: string;
    fulfillmentState: string;
    pickupCode?: string;
    evidence?: { result: string; source: string };
  };
  sim?: { status: string; progress: number };
}

/** The pricing policy's inputs: P_owner = max(minimum, handling + quantity × (material × rate + machine)). */
export interface PriceBasis {
  quantity: number;
  materialPerUnit: number;
  materialUnit: string;
  materialRateCents: number;
  machineRateCents: number;
  handlingCents: number;
  minimumCents: number;
}

export interface Candidate {
  id: string;
  round: number;
  index: number;
  title: string;
  previewUrl: string;
}

export interface CandidateSet {
  id: string;
  subject: string;
  rounds: number;
  maxRounds: number;
  status: "generating" | "ready" | "failed";
  candidates: Candidate[];
  recommendedId: string | null;
  selectedId: string | null;
  reason?: string;
  /** the one item of a several-thing order these drafts are for */
  itemId?: string;
}

export interface Plan {
  version: number;
  digest: string;
  items: OrderItem[];
  assignments: Assignment[];
  payableCents: number;
  simulatedEstimateCents: number;
  paymentMode: "mock" | "testnet";
  collectionPoint: string;
  readyEstimateMinutes: number;
  status: string;
}

export interface OrderEvent {
  seq: number;
  type: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface Suggestion {
  id: string;
  process: Process;
  label: string;
  operation: "add" | "replace";
  estimateCents: number;
  note: string;
  itemId?: string;
}

/** Pickup or delivery, saved on the order; the maker's courier and its times come from the server. */
export interface DeliveryCourier {
  name: string;
  vehicle: string;
  /** text only, never a link */
  phone: string;
  calledAt: string;
  pickupAt: string;
  arriveAt: string;
}

export interface Delivery {
  mode: "pickup" | "delivery";
  to?: { lat: number; lng: number; label: string; source: "gps" | "map" };
  km: number | null;
  chosenAt: string;
  courier?: DeliveryCourier;
  handedOverAt?: string;
}

export interface OrderView {
  id: string;
  experience: "best_single" | "gift" | "relief";
  status: string;
  createdAt: string;
  updatedAt: string;
  draft: {
    revision: number;
    requestText: string;
    photoAssetIds: string[];
    stage: string;
    reason?: string;
    /** when the busy machine should be free, for an unavailable order */
    freeAt?: string;
  };
  intent?: { provider: string; outcome: string; question: string | null };
  candidates?: CandidateSet;
  plan?: Plan;
  suggestions: Suggestion[];
  offer?: {
    id: string;
    planVersion: number;
    planDigest: string;
    expiresAt: string;
  };
  makeIntent?: {
    status: string;
    payment: { status: string; reason?: string; transactionHash?: string; payer?: string };
  };
  /** where the order came from: this site or the ASI:One agent */
  source?: "web" | "asi1";
  delivery?: Delivery;
  /** the name the person ordered under, when the server keeps it */
  requesterName?: string;
  /** the conversation the order was chosen in; later messages go there */
  conversationId?: string;
  events: OrderEvent[];
}

/** Display names and places for the demo. Fake data allowed for names and locations only. */
export const PLACE = "Palace of Fine Arts, San Francisco";
export const PLACE_SHORT = "Palace of Fine Arts";
export const MACHINE_NAME: Record<string, string> = {
  bambu_01: "Bambu Lab A1 mini",
  phomemo_01: "Phomemo M02 Pro",
  instax_01: "instax mini Link 3",
};
export type MachineKind = "a1mini" | "m02pro" | "instax";
export const KIND_OF_PROCESS: Record<Process, MachineKind> = {
  fdm_print: "a1mini",
  sticker_print: "m02pro",
  photo_print: "instax",
};
export const LABEL_OF_PROCESS: Record<Process, string> = {
  fdm_print: "keychain",
  sticker_print: "sticker",
  photo_print: "photo print",
};
/** The machine type a process needs, as the agent states the match. */
export const MATCH_OF_PROCESS: Record<Process, string> = {
  fdm_print: "3D printer (FDM) · PLA",
  sticker_print: "sticker printer (thermal)",
  photo_print: "photo printer (instax mini)",
};
export function machineLabel(machineId: string, fallback: string) {
  return MACHINE_NAME[machineId] ?? fallback;
}
