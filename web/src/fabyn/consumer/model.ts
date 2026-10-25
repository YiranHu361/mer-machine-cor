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
  price?: { totalCents: number; terms: { label: string; cents: number }[] };
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
