// Types for the owner API the seller side reads (GET /api/owner/dashboard and friends).
// Only the fields the seller screens use. The server is the source of truth for every rule.

/** Display names only. Everything else about the maker comes from the API. */
export const MAKER = { name: "Lucas", place: "Palace of Fine Arts, San Francisco" } as const;

export interface OwnerMachine {
  id: string;
  name: string;
  model: string;
  outputType: string;
  mode: "simulation" | "hardware";
  adapterVersion: string;
  paired: boolean;
  configured: boolean;
  calibrated: boolean;
  calibrationAt?: string;
  listed: boolean;
  ready: boolean;
  paused: boolean;
  reason: string;
  mediaRemaining: number;
  material: string;
  activeJobId: string | null;
  reservation?: { jobId: string; expiresAt: string };
  connectorId?: string;
  producerHub?: { machineId: string; since: string };
  policyReconciliationRequired?: boolean;
  maxJobSeconds: number;
  collectionPoint: string;
  /** Sent with every change as If-Match so a stale screen cannot overwrite newer settings. */
  settingsFingerprint: string;
}

export interface OwnerJob {
  id: string;
  orderId?: string;
  assignmentId?: string;
  machineId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  spec: {
    intent: string;
    outputType: string;
    widthMm: number;
    heightMm: number;
    quantity: number;
    material: string;
    permission: string;
    estimatedSeconds?: number;
  };
  artifact?: { id: string; url: string; sha256: string; previewUrl?: string };
  productionState: string;
  paymentState: string;
  fulfillmentState: string;
  chargeable?: boolean;
  attemptId?: string;
  evidence?: { result: string; source: string; reason: string; capturedAt: string; machineId: string; completionCredible: boolean; url?: string };
  /** The code itself is never shown on the maker side; only whether it is set and when it ends. */
  pickup?: { expiresAt?: string; redeemedAt?: string };
  history: { at: string; event: string; reason: string }[];
  quote?: { totalCents: number; ownerCents: number };
  economics?: { ownerNetCents: number };
}

export interface Connector {
  id: string;
  machineId: string;
  online: boolean;
  hostLabel: string;
  ready: boolean;
  registeredAt?: string;
}

export interface SetupCodeView {
  id: string;
  machineId: string;
  mode: "simulation" | "hardware";
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
}

export interface LedgerEntry {
  id: string;
  jobId: string;
  kind: "collection" | "release" | "refund";
  status: "submitting" | "pending" | "confirmed" | "failed";
  amountCents: number;
  mode: "mock" | "testnet";
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  revision: number;
  machines: OwnerMachine[];
  jobs: OwnerJob[];
  ledger: LedgerEntry[];
  connectors: Connector[];
  setupCodes: SetupCodeView[];
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
