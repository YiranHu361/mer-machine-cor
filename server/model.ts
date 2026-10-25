import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
export function ownValue<T>(
  values: Record<string, T>,
  key: string,
): T | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}
export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const canonical = (x: unknown): string =>
  x === null || typeof x !== "object"
    ? JSON.stringify(x)
    : Array.isArray(x)
      ? `[${x.map(canonical).join(",")}]`
      : `{${Object.keys(x as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((x as any)[k])}`)
          .join(",")}}`;
export const hash = (x: unknown) =>
  createHash("sha256")
    .update(typeof x === "string" ? x : canonical(x))
    .digest("hex");
export class Problem extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function requireThat(
  x: unknown,
  code: string,
  message: string,
  status = 409,
): asserts x {
  if (!x) throw new Problem(code, message, status);
}
export const specSchema = z
  .object({
    assetIds: z.array(z.string()).min(1).max(4),
    intent: z.string().trim().min(3).max(2000),
    outputType: z.enum(["sticker", "instax", "3d"]),
    widthMm: z.number().int().positive(),
    heightMm: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10),
    material: z.string().min(1),
    permission: z.enum(["authorized", "unclear"]),
    crop: z.enum(["contain", "cover"]),
    budgetMandate: z
      .object({
        enabled: z.literal(true),
        capCents: z.number().int().min(1).max(100000),
      })
      .optional(),
    preparedModelId: z.string().optional(),
    depthMm: z.number().positive().max(180).optional(),
    color: z.string().trim().min(1).max(60).optional(),
    estimatedSeconds: z.number().int().positive().max(3600).optional(),
    recommendedMachineId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      v.outputType === "sticker" &&
      (![15, 25, 48, 53].includes(v.widthMm) ||
        v.heightMm < 5 ||
        v.heightMm > 150 ||
        v.material !== "thermal-paper")
    )
      fail(
        "Thermal stickers support 15, 25 or 53 mm rolls, heights up to 150 mm, and loaded thermal-paper only.",
      );
    if (
      v.outputType === "instax" &&
      (v.widthMm !== 54 ||
        v.heightMm !== 86 ||
        v.material !== "photo-film" ||
        v.quantity > 3)
    )
      fail(
        "Instax mini uses a fixed 54 × 86 mm format, photo-film, and 1–3 sheets.",
      );
    if (
      v.outputType === "3d" &&
      (!v.preparedModelId ||
        !v.depthMm ||
        !v.color ||
        !v.estimatedSeconds ||
        v.material !== "pla" ||
        v.quantity !== 1)
    )
      fail(
        "3D output requires a configured, pre-sliced single-color PLA model and quantity one.",
      );
  });
export type Spec = z.infer<typeof specSchema>;
export interface Asset {
  /** Durable private object storage; path is only a disposable local cache. */
  storageId?: string;
  id: string;
  ownerId: string;
  path: string;
  url: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  createdAt: string;
  jobId?: string;
}
export interface Machine {
  id: string;
  ownerId: string;
  name: string;
  model: string;
  outputType: Spec["outputType"];
  adapterVersion: string;
  registrationId?: string;
  policyObservationId?: string;
  mode: "simulation" | "hardware";
  paired: boolean;
  configured: boolean;
  calibrated: boolean;
  listed: boolean;
  ready: boolean;
  paused: boolean;
  reason: string;
  mediaRemaining: number;
  material: string;
  priceCard: {
    consumables: number;
    machine: number;
    handling: number;
    platform: number;
  };
  hours: { start: number; end: number };
  maxJobSeconds: number;
  collectionPoint: string;
  activeJobId: string | null;
  reservation?: { jobId: string; expiresAt: string };
  nodeUrl?: string;
  /** Set when the machine is reached through an outbound connector. */
  connectorId?: string;
  /** Set when the machine prints through the producer side's hub; the hub's id for it. */
  producerHub?: { machineId: string; since: string };
  policy: { authorizedArtwork: boolean; maxQuantity: number };
  ownerAddress?: string;
  /** Shown on the public map; machines without one stand at the site default. */
  location?: { lat: number; lng: number; label: string };
  /** The maker's display name on the public map. */
  ownerName?: string;
  policyReconciliationRequired?: boolean;
  calibrationAt?: string;
  calibrationConfirmationId?: string;
}
export interface Quote {
  id: string;
  version: number;
  expiresAt: string;
  specHash: string;
  items: { label: string; cents: number }[];
  totalCents: number;
  ownerCents: number;
  platformCents: number;
  currency: "USD";
  paymentMode: "mock" | "testnet";
  collectionPoint: string;
  accepted?: boolean;
}
export interface Job {
  id: string;
  requesterId: string;
  creationRequestId?: string;
  creationSpecHash?: string;
  calibrationDeviceContext?: string;
  mediaEstimateBaseline?: string;
  mediaEstimateObserved?: {
    machineId: string;
    attemptId: string;
    remaining: number;
    observedAt: string;
    applied: boolean;
  };

  calibrationInspection?: {
    outcome: "rejected";
    reason: string;
    recordedAt: string;
    attemptId: string;
  };
  executionCancellation?: ExecutionCancellation;
  machineId: string | null;
  specVersion: number;
  spec: Spec;
  artifact: { id: string; url: string; sha256: string; previewUrl?: string };
  approvedSpecHash?: string;
  productionState: string;
  paymentState: string;
  fulfillmentState: string;
  quote?: Quote;
  attemptId?: string;
  deviceCompletedAt?: string;
  pickup?: { code: string; expiresAt: string; redeemedAt?: string };
  pickupRenewals?: {
    key: string;
    expectedVersion: number;
    expectedExpiresAt: string;
    renewedAt: string;
  }[];
  history: { at: string; event: string; reason: string }[];
  createdAt: string;
  updatedAt: string;
  version: number;
  checkoutKey?: string;
  collectionOperationId?: string;
  abortStatus?: string;
  economics?: {
    consumablesCents: number;
    machineSeconds: number;
    handlingSeconds: number;
    failedAttempts: number;
    apiCostCents: number;
    machineCostCents: number;
    quoteCents: number;
    platformFeeCents: number;
    ownerPayoutCents: number;
    quotedOwnerPayoutCents: number;
    quotedPlatformFeeCents: number;
    paymentStateAtRecording: string;
    ownerNetCents: number;
    platformMarginCents: number;
    ownerEarningsPerHandlingMinuteCents: number | null;
    recordedAt: string;
  };
  requesterAddress?: string;
  /** Fixed when the job is authorized; legacy jobs use the configured mode. */
  executionMode?: "simulation" | "hardware";
  /** false for estimate-only simulated children (mock mode), which never collect or release funds. */
  chargeable?: boolean;
  orderId?: string;
  assignmentId?: string;
  preparationId?: string;
}
export interface ExecutionCancellation {
  status: "cancelled_before_acceptance";
  machine_id: string;
  job_id: string;
  attempt_id: string;
  artifact_sha256: string;
  parameters: Record<string, unknown>;
  target_scope: "dispatch" | "calibration";
  expected_mode: "simulation" | "hardware";
  cancelled_at: string;
}
export interface Operation {
  id: string;
  jobId: string;
  kind: "collection" | "release" | "refund";
  status: "submitting" | "pending" | "confirmed" | "failed";
  reference?: string;
  transactionHash?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  amountCents: number;
  mode: "mock" | "testnet";
  receipt?: any;
  retryable?: boolean;
}
/** A one-time code that lets one machine computer enroll one connector. */
export interface SetupCode {
  id: string;
  codeHash: string;
  machineId: string;
  mode: "simulation" | "hardware";
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  connectorId?: string;
}
export type ConnectorCheckStatus =
  "pending" | "running" | "waiting" | "done" | "failed";
/** One step of automatic setup, reported by the connector or the backend. */
export interface ConnectorCheck {
  id: string;
  label: string;
  status: ConnectorCheckStatus;
  detail?: string;
  /** The owner must allow this step before the connector runs it. */
  consent?: string;
}
/** An enrolled machine computer that dials out to this workshop. */
export interface Connector {
  id: string;
  machineId: string;
  mode: "simulation" | "hardware";
  keyHash: string;
  hostLabel: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  checks: ConnectorCheck[];
  consents: Record<string, string>;
  ready?: boolean;
  registeredAt?: string;
  registrationError?: string;
}
export interface State {
  uploadTickets?: Record<string, import("./cloud-uploads.ts").UploadTicket>;
  producer?: import("./cloud-producer.ts").ProducerState;
  machines: Record<string, Machine>;
  jobs: Record<string, Job>;
  assets: Record<string, Asset>;
  operations: Record<string, Operation>;
  sessions: Record<
    string,
    { id: string; role: "owner" | "requester"; expiresAt: string }
  >;
  paymentReferences: Record<string, string>;
  calibrations?: Record<string, Job>;
  setupCodes?: Record<string, SetupCode>;
  connectors?: Record<string, Connector>;
  orders?: Record<string, import("./orchestration/types.ts").Order>;
  preparations?: Record<
    string,
    import("./orchestration/types.ts").PreparationReceipt
  >;
  relief?: import("./orchestration/types.ts").ReliefState;
  schemaVersion: 1;
}
export function initialState(): State {
  const machines: State["machines"] = {};
  for (const [machineId, name, model, outputType, material] of [
    [
      "phomemo_01",
      "Sticker counter",
      "Phomemo M02Pro",
      "sticker",
      "thermal-paper",
    ],
    [
      "instax_01",
      "Photo counter",
      "Instax Mini Link 3",
      "instax",
      "photo-film",
    ],
    ["bambu_01", "Model counter", "Bambu Lab A1 mini", "3d", "pla"],
  ] as const)
    machines[machineId] = {
      id: machineId,
      ownerId: "team_owner",
      name,
      model,
      outputType,
      adapterVersion: "simulation-v1",
      mode: "simulation",
      paired: true,
      configured: true,
      calibrated: false,
      listed: false,
      ready: false,
      paused: true,
      reason:
        "Run simulated calibration, inspect the result, then list and resume.",
      mediaRemaining: 100,
      material,
      priceCard: {
        consumables: outputType === "instax" ? 100 : 20,
        machine: 10,
        handling: 30,
        platform: 15,
      },
      hours: { start: 0, end: 24 },
      maxJobSeconds: outputType === "3d" ? 1800 : 180,
      collectionPoint: "Team demo table (location to be confirmed)",
      activeJobId: null,
      policy: { authorizedArtwork: true, maxQuantity: 10 },
    };
  return {
    machines,
    jobs: {},
    assets: {},
    operations: {},
    sessions: {},
    paymentReferences: {},
    schemaVersion: 1,
  };
}
export function record(job: Job, event: string, reason: string) {
  job.history.push({ at: now(), event, reason });
  job.updatedAt = now();
  job.version++;
}
export function specificationHash(job: Job) {
  return hash({
    spec: job.spec,
    specVersion: job.specVersion,
    artifactSha256: job.artifact.sha256,
  });
}
export function parameters(job: Job) {
  return {
    ...(job.spec.outputType === "3d"
      ? {
          depthMm: job.spec.depthMm,
          color: job.spec.color,
          estimatedSeconds: job.spec.estimatedSeconds,
        }
      : {}),
    outputType: job.spec.outputType,
    widthMm: job.spec.widthMm,
    heightMm: job.spec.heightMm,
    quantity: job.spec.quantity,
    material: job.spec.material,
    crop: job.spec.crop,
    specVersion: job.specVersion,
  };
}
