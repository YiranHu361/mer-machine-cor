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
  /** Where the order was placed: the fabyn site, or a chat with the Fabyn agent on ASI:One. */
  source?: "web" | "asi1";
  /** The name the customer gave with the order. */
  requesterName?: string;
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
  reference?: string;
  /** Base Sepolia transaction for an x402 testnet payment. */
  transactionHash?: string;
  reason?: string;
  /** x402 settlement receipt; the hash may land here before the entry's own field is set. */
  receipt?: { transactionHash?: string; payer?: string };
  createdAt: string;
  updatedAt: string;
}

/** The courier the owner called, with the times the server fixed then (estimates). */
export interface DeliveryCourier {
  name: string;
  vehicle: string;
  /** Shown as text only; nothing on the page dials it. */
  phone: string;
  calledAt: string;
  pickupAt: string;
  arriveAt: string;
}

/** Pickup or delivery for one order, as the customer chose it (POST /api/orders/:id/delivery). */
export interface OrderDelivery {
  mode: "pickup" | "delivery";
  /** Delivery only: the customer's spot and its neighbourhood. */
  to?: { lat: number; lng: number; label: string; source: "gps" | "map" };
  /** The customer's street-route km, when their page had one. */
  km: number | null;
  chosenAt: string;
  courier?: DeliveryCourier;
  /** A pickup handed over without a pickup code. */
  handedOverAt?: string;
}

export interface Dashboard {
  revision: number;
  machines: OwnerMachine[];
  jobs: OwnerJob[];
  ledger: LedgerEntry[];
  connectors: Connector[];
  setupCodes: SetupCodeView[];
  /** By order id; only orders whose customer chose (or that were handed over). */
  deliveries?: Record<string, OrderDelivery>;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** A real printer's latest check, from POST /api/owner/machines/:id/check or GET /api/printers. */
export interface PrinterCheck {
  ok: boolean;
  detail: string;
  checkedAt: string | null;
}

/** GET /api/printers: whether each real printer on the hub answered its latest check. */
export interface PrinterStatusRow {
  id: string;
  name: string;
  model: string;
  makes: string;
  status: "connected" | "checking" | "not_answering" | "busy" | "paused";
  detail: string;
  checkedAt: string | null;
}

export const BASESCAN_TX = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
