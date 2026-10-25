import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mutate } from "../store.ts";
import {
  hash,
  id,
  now,
  ownValue,
  Problem,
  record,
  requireThat,
  specificationHash,
  type Asset,
  type Job,
  type Machine,
  type Operation,
  type State,
} from "../model.ts";
import type { Service } from "../service.ts";
import type { PaymentResult, PaymentTarget } from "../payments.ts";
import type { ProducerHubNode } from "../producer-hub.ts";
import {
  createClaudeProvider,
  type DesignDraft,
  type DraftInput,
  type RequestBrief,
  type RequestInput,
} from "../../integrations/src/claude.ts";
import { createNanoBananaProvider } from "../../integrations/src/nano-banana.ts";
import { createOpenAIImageProvider } from "../../integrations/src/openai-images.ts";
import type {
  ImageDraft,
  ImageDraftInput,
} from "../../integrations/src/picture-drafts.ts";
import { localAnalysis, type ImageAnalysis } from "../recommendations.ts";
import {
  PROCESS_SHEETS,
  RELIEF_CATALOG,
  REAL_CAPABLE_PROCESSES,
  addMachine,
  advance,
  applyOutage,
  cancelJobs,
  counters,
  createEngine,
  generateNetwork,
  restoreAll,
  scheduleJobs,
  setTimeScale,
  splitQuantity,
  unstartedJobs,
  type NetworkMachine,
  type SplitCandidate,
  type TimeScale,
} from "../relief/index.ts";
import { callCourier, parseChoice, sameChoice } from "./delivery.ts";
import { fixtureDrafts } from "./fixture-designs.ts";
import {
  asksForColour,
  latestName,
  latestProcess,
  leftOutNote,
  localIntent,
  namedProcesses,
  NEUTRAL_TAG_TEXT,
  oneOfEach,
  requestedThings,
  tagText,
  wantsColour,
} from "./intent.ts";
import {
  PUBLISHED_PROFILES,
  producerProfile,
  type MachineKnowledgeProfile,
} from "./knowledge.ts";
import {
  BUSY_REASON,
  eligibleRegistryMachines,
  PROCESS_OUTPUT,
} from "./matching.ts";
import { PRICE_POLICY, priceAssignment, registryPriceCard } from "./pricing.ts";
import {
  cliRunner,
  designDigest,
  importOutput,
  ownedAssetId,
  preparationKey,
  type ProducerRunner,
} from "./producer.ts";
import type {
  Assignment,
  CandidateSet,
  DesignCandidate,
  ExecutionMode,
  Experience,
  OrderSource,
  FormatSuggestion,
  IntentBrief,
  IntentItem,
  MakeIntent,
  Offer,
  Order,
  Plan,
  PlanItem,
  PlanStatus,
  PreparationReceipt,
  PreparationStage,
  PriceBasis,
  Process,
  ReliefState,
} from "./types.ts";

const MAX_ROUNDS = 3;
const DRAFTS_PER_ROUND = 3;
const EVENT_LIMIT = 300;
const PROMPT_VERSION = "drafts/2";
const COMPILER = "producer-prepare/1";
/** A printer check younger than this is reused; an older one is asked again. */
const CHECK_FRESH_MS = 60_000;
/** A check older than this no longer says anything about the printer. */
const CHECK_VALID_MS = 10 * 60_000;
type PrinterCheck = { ok: boolean; detail: string };
/** Pause reasons that only mean the printer could not be reached: nothing was printed. */
const UNREACHED =
  /not found|could not connect|did not answer|is not connected to the producer side's hub|is offline at the producer side's hub/i;
/** Where a machine with no saved location stands: the Palace of Fine Arts. */
const SITE = {
  lat: Number(process.env.FABYN_SITE_LAT ?? 37.8029),
  lng: Number(process.env.FABYN_SITE_LNG ?? -122.4484),
  label: process.env.FABYN_SITE_LABEL ?? "Palace of Fine Arts, San Francisco",
};
/** A job waiting for its machine: reserved or paid, not yet running. */
const QUEUED = ["quoted", "approved", "authorized", "payment_confirmed"];
const OUTPUT_TITLE: Record<string, string> = {
  sticker: "A sticker",
  instax: "A photo print",
  "3d": "A 3D print",
};
/** How often paused, unreachable printers are checked again. */
const RECOVERY_SCAN_MS = 60_000;

export interface OrchestratorDeps {
  producer?: ProducerRunner;
  background?: (work: Promise<unknown>) => void;
  understand?: (input: RequestInput) => Promise<RequestBrief>;
  draft?: (input: DraftInput) => Promise<DesignDraft[]>;
  imageDraft?: (input: ImageDraftInput) => Promise<ImageDraft[]>;
  /** Picture providers, labelled test fixtures, or none. Local library scripts can inject saved SVG drafts. */
  designProvider?: DesignProvider;
  analyze?: (assets: Asset[]) => Promise<ImageAnalysis>;
  /** Connects to a real printer on the producer side's hub once, printing nothing. */
  checkPrinter?: (machine: Machine) => Promise<PrinterCheck>;
  offerMs?: number;
  reliefSeed?: number;
  clock?: () => number;
}
type Actor = { id: string; role: string };
type DesignProvider = "openai" | "nano-banana" | "claude" | "fixture" | "none";
/** A drawing comes back as SVG, a picture as image bytes. */
type Draft = { title: string; svg?: string; image?: ImageDraft["image"] };

const stage = (o: Order, value: PreparationStage, reason?: string) => {
  o.draft.stage = value;
  if (reason === undefined) delete o.draft.reason;
  else o.draft.reason = reason;
};
function event(o: Order, type: string, data: Record<string, unknown> = {}) {
  o.events.push({
    seq: o.nextSeq++,
    type,
    at: now(),
    draftRevision: o.draft.revision,
    planVersion: o.plan?.version ?? null,
    data,
  });
  if (o.events.length > EVENT_LIMIT)
    o.events.splice(0, o.events.length - EVENT_LIMIT);
}
/** When a busy machine should be free: its running job's estimate, or its reservation's end. */
function freeAt(s: State, machineId: string, at: number): string | undefined {
  const m = ownValue(s.machines, machineId);
  if (!m) return undefined;
  const job = m.activeJobId ? ownValue(s.jobs, m.activeJobId) : undefined;
  const started = job?.history.find((h) => /dispatch|execution/.test(h.event));
  const seconds = job?.spec.estimatedSeconds;
  const end = started && seconds
    ? Date.parse(started.at) + seconds * 1000
    : !job && m.reservation
      ? Date.parse(m.reservation.expiresAt)
      : NaN;
  return Number.isFinite(end) && end > at ? new Date(end).toISOString() : undefined;
}
const plainSuggestion = ({ real: _real, ...g }: FormatSuggestion & { real?: boolean }): FormatSuggestion => g;
const label = (p: Process) =>
  ({
    sticker_print: "Sticker",
    photo_print: "Photo print",
    fdm_print: "3D print",
  })[p as string] ?? PROCESS_SHEETS[p].label;

export class Orchestrator {
  private inflight = new Map<string, Promise<unknown>>();
  private paymentLocks = new Map<string, Promise<unknown>>();
  private async withPaymentLock<T>(
    orderId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.paymentLocks.get(orderId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.paymentLocks.set(orderId, next);
    try {
      return await next;
    } finally {
      if (this.paymentLocks.get(orderId) === next)
        this.paymentLocks.delete(orderId);
    }
  }
  private lastRecoveryScan = 0;
  /** The latest check of each real printer on the hub, kept in memory only. */
  private printerChecks = new Map<
    string,
    {
      at: number;
      result: Promise<PrinterCheck>;
      /** Set once the printer answered (or did not). */
      answer?: PrinterCheck & { at: number };
    }
  >();
  private producer: ProducerRunner;
  constructor(
    public service: Service,
    private deps: OrchestratorDeps = {},
  ) {
    this.producer = deps.producer ?? cliRunner();
  }
  private get clock() {
    return this.deps.clock ?? Date.now;
  }
  get designProvider(): DesignProvider {
    if (this.deps.designProvider) return this.deps.designProvider;
    const env = process.env.FABYN_DESIGN_PROVIDER;
    if (
      env === "openai" ||
      env === "nano-banana" ||
      env === "fixture" ||
      env === "none"
    )
      return env;
    // Migrate the old SVG setting to the same Image API used for photo art.
    // An Anthropic key still enables request understanding, never artwork.
    if (env === "claude")
      return process.env.OPENAI_API_KEY ? "openai" : "none";
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.GEMINI_API_KEY) return "nano-banana";
    return "none";
  }
  private get dataDir() {
    return this.service.config.dataDir;
  }
  /** Wait for background preparation of an order (tests and shutdown). */
  async settle(orderId: string) {
    for (let i = 0; i < 20 && this.inflight.has(orderId); i++)
      await this.inflight.get(orderId);
  }
  private track(orderId: string, work: Promise<unknown>) {
    const tracked = work
      .catch(() => undefined)
      .finally(() => {
        if (this.inflight.get(orderId) === tracked)
          this.inflight.delete(orderId);
      });
    this.inflight.set(orderId, tracked);
    this.deps.background?.(tracked);
  }
  private async load(orderId: string) {
    const s = await this.service.read();
    const o = ownValue(s.orders ?? {}, orderId);
    requireThat(o, "NOT_FOUND", "Order not found.", 404);
    return { s, o };
  }
  private owned(o: Order, actor: Actor) {
    requireThat(
      o.requesterId === actor.id ||
        (actor.role === "owner" && o.experience === "relief"),
      "FORBIDDEN",
      "This order belongs to a different account.",
      403,
    );
  }
  /** Apply a change only while the draft revision (and lease, when given) is current. */
  private async commit(
    orderId: string,
    revision: number,
    lease: string | null,
    fn: (o: Order, s: State) => void,
  ) {
    return mutate(this.service.store, (s) => {
      const o = ownValue(s.orders ?? {}, orderId);
      if (!o || o.draft.revision !== revision) return false;
      if (lease && o.draft.lease?.id !== lease) return false;
      fn(o, s);
      o.version++;
      o.updatedAt = now();
      return true;
    });
  }

  // ---------- Creating and editing ----------

  async createOrder(actor: Actor, body: any, key: unknown) {
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "Creating an order needs a stable creation key.",
      422,
    );
    const experience: Experience =
      body?.experience === "gift" || body?.experience === "relief"
        ? body.experience
        : "best_single";
    // The ASI:One agent says so in the body; everything else is the web app.
    const source: OrderSource = body?.source === "asi1" ? "asi1" : "web";
    // The person's own name for the order, shown to the maker ("Henry's order").
    requireThat(
      body?.requesterName == null || typeof body.requesterName === "string",
      "INVALID_NAME",
      "Give your name as text, up to 40 characters.",
      422,
    );
    const requesterName = String(body?.requesterName ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    requireThat(
      requesterName.length <= 40 && !/[<>]/.test(requesterName),
      "INVALID_NAME",
      "Give your name as text, up to 40 characters.",
      422,
    );
    requireThat(
      experience !== "relief" || actor.role === "owner",
      "COORDINATOR_REQUIRED",
      "Relief plans are created from the coordinator's workshop access.",
      403,
    );
    requireThat(
      experience === "relief" || actor.role === "requester",
      "REQUESTER_REQUIRED",
      "Use requester access to create an order.",
      403,
    );
    const requestText =
      typeof body?.requestText === "string" ? body.requestText.trim() : "";
    requireThat(
      requestText.length <= 2000,
      "REQUEST_TOO_LONG",
      "Keep the request to 2,000 characters.",
      422,
    );
    const photos: string[] = Array.isArray(body?.photoAssetIds)
      ? body.photoAssetIds
      : [];
    requireThat(
      photos.length <= 4 &&
        photos.every((p) => typeof p === "string") &&
        new Set(photos).size === photos.length,
      "INVALID_PHOTOS",
      "Add up to four different photos.",
      422,
    );
    requireThat(
      experience === "relief" || requestText || photos.length,
      "REQUEST_EMPTY",
      "Describe what you want, add a photo, or both.",
      422,
    );
    const headCount =
      experience === "relief"
        ? Number.isSafeInteger(body?.headCount)
          ? body.headCount
          : Number(
              /\b(\d{1,5})\s+(?:people|residents|evacuees|guests)\b/i.exec(
                requestText,
              )?.[1] ?? 300,
            )
        : undefined;
    requireThat(
      headCount === undefined || (headCount >= 1 && headCount <= 10000),
      "INVALID_HEAD_COUNT",
      "Give a head count between 1 and 10,000.",
      422,
    );
    const created = await mutate(this.service.store, (s) => {
      s.orders ??= {};
      const existing = Object.values(s.orders).find(
        (o) => o.requesterId === actor.id && o.creationKey === key,
      );
      if (existing) return { order: existing, created: false };
      for (const assetId of photos)
        requireThat(
          ownValue(s.assets, assetId)?.ownerId === actor.id,
          "ASSET_ACCESS",
          "Upload your own photos first.",
          403,
        );
      const at = now();
      const order: Order = {
        id: id("ord"),
        requesterId: actor.id,
        creationKey: key as string,
        experience,
        source,
        ...(requesterName ? { requesterName } : {}),
        createdAt: at,
        updatedAt: at,
        version: 1,
        draft: {
          revision: 1,
          requestText,
          photoAssetIds: photos,
          stage: "created",
          ...(headCount !== undefined ? { headCount } : {}),
        },
        planHistory: [],
        suggestions: [],
        status: "preparing",
        events: [],
        nextSeq: 1,
      };
      event(order, "draft.updated", {
        photos: photos.length,
        text: !!requestText,
      });
      s.orders[order.id] = order;
      return { order, created: true };
    });
    if (created.created) this.start(created.order.id, 1);
    return created;
  }
  private start(orderId: string, revision: number) {
    this.track(orderId, this.run(orderId, revision));
  }
  async editDraft(actor: Actor, orderId: string, body: any) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    requireThat(
      !o.makeIntent,
      "ORDER_CONFIRMED",
      "This order is already confirmed; it can no longer be edited.",
    );
    requireThat(
      body?.expectedRevision === o.draft.revision,
      "STALE_DRAFT",
      "This order changed. Refresh it before editing again.",
    );
    if (typeof body?.removeItemId === "string") {
      await mutate(this.service.store, (s) => {
        const order = s.orders![orderId];
        requireThat(
          order.draft.revision === o.draft.revision,
          "STALE_DRAFT",
          "This order changed. Refresh it before editing again.",
        );
        const plan = order.plan;
        const item = plan?.items.find((i) => i.id === body.removeItemId);
        requireThat(
          plan && item && item.source === "extra",
          "NOT_REMOVABLE",
          "Only an added extra can be removed; the requested item stays.",
          422,
        );
        const next = this.revisePlan(order, s, {
          items: plan.items.filter((i) => i.id !== item.id),
          assignments: plan.assignments.filter((a) => a.itemId !== item.id),
          changes: [`Removed the extra "${item.name}".`],
        });
        order.intent!.items = order.intent!.items.filter(
          (_, index) => `it_${index + 1}` !== item.id,
        );
        event(order, "plan.proposed", {
          version: next.version,
          removed: item.id,
        });
        order.version++;
        order.updatedAt = now();
      });
      return this.view(actor, orderId);
    }
    const requestText =
      typeof body?.requestText === "string"
        ? body.requestText.trim()
        : o.draft.requestText;
    const photos: string[] = Array.isArray(body?.photoAssetIds)
      ? body.photoAssetIds
      : o.draft.photoAssetIds;
    requireThat(
      photos.length <= 4 &&
        photos.every((p) => typeof p === "string") &&
        new Set(photos).size === photos.length,
      "INVALID_PHOTOS",
      "Add up to four different photos.",
      422,
    );
    requireThat(
      requestText.length <= 2000 &&
        photos.length <= 4 &&
        (requestText || photos.length || o.experience === "relief"),
      "REQUEST_EMPTY",
      "Describe what you want, add a photo, or both.",
      422,
    );
    const revision = await mutate(this.service.store, (s) => {
      const order = s.orders![orderId];
      for (const assetId of photos)
        requireThat(
          ownValue(s.assets, assetId)?.ownerId === order.requesterId,
          "ASSET_ACCESS",
          "Upload your own photos first.",
          403,
        );
      order.draft = {
        revision: order.draft.revision + 1,
        requestText,
        photoAssetIds: photos,
        stage: "created",
        ...(order.draft.headCount ? { headCount: order.draft.headCount } : {}),
      };
      delete order.intent;
      delete order.candidates;
      delete order.offer;
      if (order.plan) order.plan.status = "cancelled";
      delete order.plan;
      order.suggestions = [];
      order.status = "preparing";
      event(order, "draft.updated", { superseded: order.draft.revision - 1 });
      order.version++;
      order.updatedAt = now();
      return order.draft.revision;
    });
    this.start(orderId, revision);
    return this.view(actor, orderId);
  }

  // ---------- Pickup or delivery ----------

  /** Where the order leaves from: its first machine, or the Palace site. */
  private handoffSite(o: Order, s: State) {
    const machineId = o.plan?.assignments[0]?.machineId;
    return (machineId && ownValue(s.machines, machineId)?.location) || SITE;
  }
  private orderJobs(s: State, orderId: string) {
    return Object.values(s.jobs).filter((j) => j.orderId === orderId);
  }
  /** The person picks pickup or delivery; it can change until a courier is called or it is collected. */
  async chooseDelivery(actor: Actor, orderId: string, body: any) {
    const { o, s } = await this.load(orderId);
    this.owned(o, actor);
    const choice = parseChoice(body, this.handoffSite(o, s));
    // a retried request writes nothing
    if (sameChoice(o.delivery, choice)) return this.view(actor, orderId);
    await mutate(this.service.store, (st) => {
      const order = st.orders![orderId];
      requireThat(
        order.status !== "cancelled",
        "ORDER_CLOSED",
        "This order was stopped, so there is nothing to hand over.",
      );
      if (sameChoice(order.delivery, choice)) return;
      requireThat(
        !order.delivery?.courier,
        "COURIER_CALLED",
        "A courier is already on the way for this order. Ask the maker to change it.",
      );
      requireThat(
        !order.delivery?.handedOverAt &&
          !this.orderJobs(st, orderId).some(
            (j) => j.fulfillmentState === "collected",
          ),
        "ALREADY_COLLECTED",
        "This order was already handed over.",
      );
      order.delivery = { ...choice, chosenAt: now() };
      event(order, "delivery.chosen", { mode: choice.mode });
      order.version++;
      order.updatedAt = now();
    });
    return this.view(actor, orderId);
  }
  /** The owner calls the courier for a made delivery order; calling again returns the same courier. */
  async callCourier(orderId: string, body: any) {
    const { o, s } = await this.load(orderId);
    const cancel = body?.cancel === true;
    // calling again, or cancelling no courier, writes nothing
    if (cancel ? !o.delivery?.courier : o.delivery?.courier)
      return { delivery: o.delivery ?? null };
    const from = this.handoffSite(o, s);
    const at = this.clock();
    return mutate(this.service.store, (st) => {
      const order = st.orders![orderId];
      const delivery = order.delivery;
      if (cancel) {
        if (!delivery?.courier) return { delivery: delivery ?? null };
        requireThat(
          Date.parse(delivery.courier.pickupAt) > at,
          "COURIER_PICKED_UP",
          "The courier already has the order.",
        );
        delete delivery.courier;
        event(order, "courier.cancelled");
      } else {
        requireThat(
          delivery?.mode === "delivery",
          "NOT_DELIVERY",
          "The customer has not asked for delivery. Keep it at your table for pickup.",
        );
        if (delivery.courier) return { delivery };
        const jobs = this.orderJobs(st, orderId).filter(
          (j) => j.productionState !== "cancelled",
        );
        requireThat(
          jobs.length > 0 && jobs.every((j) => j.productionState === "produced"),
          "NOT_MADE",
          "Call a courier once every item of the order is made.",
        );
        requireThat(
          !jobs.some((j) => j.fulfillmentState === "collected"),
          "ALREADY_COLLECTED",
          "This order was already handed over.",
        );
        delivery.courier = callCourier(orderId, delivery, from, at);
        event(order, "courier.called", { name: delivery.courier.name });
      }
      order.version++;
      order.updatedAt = now();
      return { delivery: order.delivery ?? null };
    });
  }
  /** A pickup with no pickup code (nothing was charged): the owner records the hand-over. */
  async handOver(orderId: string) {
    const { o } = await this.load(orderId);
    if (o.delivery?.handedOverAt) return { delivery: o.delivery };
    return mutate(this.service.store, (st) => {
      const order = st.orders![orderId];
      if (order.delivery?.handedOverAt) return { delivery: order.delivery };
      requireThat(
        order.delivery?.mode !== "delivery",
        "NOT_PICKUP",
        "This order goes out with a courier.",
      );
      const jobs = this.orderJobs(st, orderId).filter(
        (j) => j.productionState !== "cancelled",
      );
      requireThat(
        jobs.length > 0 && jobs.every((j) => j.productionState === "produced"),
        "NOT_MADE",
        "Hand it over once every item of the order is made.",
      );
      requireThat(
        !jobs.some((j) => j.pickup && !j.pickup.redeemedAt),
        "USE_PICKUP_CODE",
        "Enter the customer's pickup code to hand it over.",
      );
      const at = now();
      order.delivery = {
        mode: "pickup",
        km: null,
        chosenAt: order.delivery?.chosenAt ?? at,
        handedOverAt: at,
      };
      event(order, "delivery.handed_over");
      order.version++;
      order.updatedAt = at;
      return { delivery: order.delivery };
    });
  }

  // ---------- Preparation pipeline ----------

  private async run(orderId: string, revision: number) {
    const lease = id("lease");
    const started = await this.commit(orderId, revision, null, (o) => {
      o.draft.lease = {
        id: lease,
        expiresAt: new Date(this.clock() + 120_000).toISOString(),
      };
    });
    if (!started) return;
    try {
      let { o, s } = await this.load(orderId);
      if (!o.intent) {
        await this.commit(orderId, revision, lease, (x) =>
          stage(x, "understanding"),
        );
        const intent =
          o.experience === "relief"
            ? this.reliefIntent(o)
            : await this.understand(o, s);
        const ok = await this.commit(orderId, revision, lease, (x) => {
          x.intent = intent;
          stage(x, "resolving_profiles");
          event(x, "draft.understood", {
            provider: intent.provider,
            items: intent.items.map((i) => i.process),
          });
        });
        if (!ok) return;
        ({ o, s } = await this.load(orderId));
      }
      // Wake the printers this order may use while its drafts are drawn; the
      // plan waits for the answers.
      this.checkPrinters(s, o);
      const drawItem = o.intent!.items.findIndex(
        (i) =>
          i.creation === "generate" &&
          i.process !== "fdm_print" &&
          !i.catalogItemId,
      );
      if (
        drawItem >= 0 &&
        o.experience !== "relief" &&
        !o.candidates?.selectedId
      ) {
        if (!o.candidates)
          await this.generateRound(orderId, revision, lease, drawItem);
        return;
      }
      await this.preparePlan(orderId, revision, lease);
    } catch (e) {
      await this.commit(orderId, revision, lease, (o) => {
        stage(o, "failed", (e as Error).message.slice(0, 300));
        event(o, "plan.needs_action", {
          reason: (e as Error).message.slice(0, 300),
        });
      });
    }
  }
  /**
   * Checks, in the background, every real printer on the producer side's hub
   * that a flat print could use, its own kind or the fallback. A node online
   * is not proof its printer is awake: Bluetooth printers sleep when idle.
   */
  private checkPrinters(s: State, o: Order) {
    if (
      !o.intent?.items.some(
        (i) => i.process === "sticker_print" || i.process === "photo_print",
      )
    )
      return;
    for (const m of Object.values(s.machines))
      if (
        m.producerHub &&
        m.mode === "hardware" &&
        (m.outputType === "sticker" || m.outputType === "instax")
      )
        this.startCheck(m);
  }
  /** One check per printer at a time; a printer that answers is returned to service if it was only unreachable. */
  private startCheck(m: Machine) {
    const last = this.printerChecks.get(m.id);
    if (last && this.clock() - last.at < CHECK_FRESH_MS) return;
    const entry: {
      at: number;
      result: Promise<PrinterCheck>;
      answer?: PrinterCheck & { at: number };
    } = {
      at: this.clock(),
      result: Promise.resolve({ ok: false, detail: "" }),
    };
    entry.result = this.checkPrinter(m)
      .catch((e) => ({
        ok: false,
        detail: (e as Error).message.slice(0, 200),
      }))
      .then(async (answer) => {
        if (answer.ok) await this.recoverPrinter(m.id).catch(() => undefined);
        // Keep the last answer through the next check, so the status never blanks.
        entry.answer = { ...answer, at: this.clock() };
        return answer;
      });
    if (last?.answer) entry.answer = last.answer;
    this.printerChecks.set(m.id, entry);
    this.deps.background?.(entry.result);
  }
  /**
   * What the site shows for each real printer: whether it answered its
   * latest check, is printing, is being checked, or waits for the owner.
   */
  async printerStatus() {
    const s = await this.service.read();
    return Object.values(s.machines)
      .filter(
        (m) =>
          m.producerHub &&
          m.mode === "hardware" &&
          (m.outputType === "sticker" || m.outputType === "instax"),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => {
        const check = this.printerChecks.get(m.id);
        const answer = check?.answer;
        // A paused printer still holding an order is waiting, not printing.
        const status =
          m.activeJobId && !m.paused
            ? "busy"
            : answer && !answer.ok
              ? "not_answering"
              : m.paused && !UNREACHED.test(m.reason ?? "")
                ? "paused"
                : answer?.ok && this.clock() - answer.at < 3 * CHECK_FRESH_MS
                  ? "connected"
                  : "checking";
        return {
          id: m.id,
          name: m.name,
          model: m.model,
          makes: m.outputType === "instax" ? "Photo prints" : "Stickers",
          status,
          detail:
            status === "not_answering"
              ? answer!.detail
              : status === "paused"
                ? (m.reason ?? "")
                : "",
          checkedAt: answer ? new Date(answer.at).toISOString() : null,
        };
      });
  }
  /**
   * The owner's "check printer": asks one machine now and returns its answer.
   * A hub printer is checked through the hub (and returned to service if it
   * was only unreachable); a machine on a local node or connector is asked
   * for its capabilities.
   */
  async checkNow(
    machineId: string,
  ): Promise<PrinterCheck & { checkedAt: string }> {
    const m = ownValue((await this.service.read()).machines, machineId);
    requireThat(m, "MACHINE_NOT_FOUND", "There is no machine with that id.", 404);
    let answer: PrinterCheck;
    if (m.producerHub) {
      // Ask again even if a recent answer exists: the owner pressed the button.
      const last = this.printerChecks.get(m.id);
      this.printerChecks.delete(m.id);
      this.startCheck(m);
      const entry = this.printerChecks.get(m.id)!;
      if (!entry.answer && last?.answer) entry.answer = last.answer;
      answer = await entry.result;
    } else
      answer = await this.service.node
        .call("get_capabilities", { machine_id: m.id }, m)
        .then((manifest: unknown) =>
          manifest
            ? { ok: true, detail: "It answered." }
            : { ok: false, detail: "Its program sent no answer." },
        )
        .catch((e: unknown) => ({
          ok: false,
          detail: (e as Error).message.slice(0, 200),
        }));
    return { ...answer, checkedAt: new Date(this.clock()).toISOString() };
  }
  /**
   * The public map and machine detail: where each machine is, who runs it,
   * what it is making and what waits. Titles only: no requester, pickup code,
   * link or owner detail leaves the server.
   */
  async liveMachines() {
    const s = await this.service.read();
    const title = (j: Job) => {
      const o = j.orderId ? s.orders?.[j.orderId] : undefined;
      const a = o?.plan?.assignments.find((x) => x.childJobId === j.id);
      const item = a && o?.plan?.items.find((i) => i.id === a.itemId);
      return item?.name ?? OUTPUT_TITLE[j.spec.outputType] ?? "A print";
    };
    const processOf = (output: string) =>
      Object.entries(PROCESS_OUTPUT).find(([, o]) => o === output)?.[0] ?? null;
    const sourceOf = (j: Job) =>
      (j.orderId && s.orders?.[j.orderId]?.source) || "web";
    return Object.values(s.machines)
      .filter((m) => m.listed || m.activeJobId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => {
        const active = m.activeJobId ? s.jobs[m.activeJobId] : undefined;
        const status = m.paused
          ? "paused"
          : active
            ? ["dispatched", "running", "verifying"].includes(
                active.productionState,
              )
              ? "printing"
              : "needs_attention"
            : !m.ready
              ? "offline"
              : "available";
        const started = active?.history.find((h) =>
          /dispatch|execution/.test(h.event),
        );
        return {
          id: m.id,
          displayName: m.name,
          model: m.model,
          process: processOf(m.outputType),
          mode: m.mode,
          location: m.location ?? SITE,
          ownerName: m.ownerName ?? process.env.FABYN_OWNER_NAME ?? "Lucas",
          status,
          current: active
            ? {
                title: title(active),
                process: processOf(active.spec.outputType),
                // Nodes report states, not percentages; screens estimate.
                progress: null,
                startedAt: started?.at ?? active.updatedAt,
              }
            : null,
          queue: Object.values(s.jobs)
            .filter(
              (j) =>
                j.machineId === m.id &&
                j.id !== m.activeJobId &&
                QUEUED.includes(j.productionState),
            )
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((j) => ({
              title: title(j),
              process: processOf(j.spec.outputType),
              source: sourceOf(j),
            })),
        };
      });
  }
  /**
   * A printer paused only because it could not be reached comes back on its
   * own once a check reaches it: the failed print never got to the printer,
   * so there is nothing to inspect. Any other pause (no film, a print that
   * may have come out) still waits for the owner.
   */
  private async recoverPrinter(machineId: string) {
    const s = await this.service.read();
    const m = s.machines[machineId];
    if (!m?.producerHub || !m.paused || !UNREACHED.test(m.reason ?? "")) return;
    const job = m.activeJobId ? s.jobs[m.activeJobId] : undefined;
    if (job && job.productionState !== "failed") return;
    if (job)
      await this.service.clearFailed(job.id, {
        inspected: true,
        cleared: true,
        reason:
          "The printer could not be reached, so nothing was printed; it answered a later check.",
      });
    await mutate(this.service.store, (state) => {
      const x = state.machines[machineId];
      if (!x?.producerHub || x.activeJobId || x.reservation) return;
      x.paused = false;
      x.ready = true;
      x.reason = `Prints through the producer side's hub as ${x.producerHub.machineId}. It answered a check after being unreachable.`;
    });
  }
  private checkPrinter(m: Machine): Promise<PrinterCheck> {
    if (this.deps.checkPrinter) return this.deps.checkPrinter(m);
    const hub = (this.service.node as { hub?: ProducerHubNode }).hub;
    return hub
      ? hub.check(m.producerHub!.machineId)
      : Promise.resolve({ ok: true, detail: "No hub to check through." });
  }
  /**
   * The machines as a plan sees them: a printer of this kind whose recent
   * check went unanswered is not ready for this plan. Only checks of the kind
   * about to be used are awaited. Nothing is saved; the next check decides again.
   */
  private async afterChecks(
    s: State,
    process: Process,
    silent: Map<string, Machine>,
  ): Promise<State> {
    const output = PROCESS_OUTPUT[process];
    const machines = { ...s.machines };
    for (const [machineId, check] of this.printerChecks) {
      const m = machines[machineId];
      if (
        !m ||
        m.outputType !== output ||
        this.clock() - check.at > CHECK_VALID_MS
      )
        continue;
      const answer = await check.result;
      if (answer.ok) {
        // It may have just been returned to service: plan with its saved state.
        if (m.paused)
          machines[machineId] =
            (await this.service.read()).machines[machineId] ?? m;
        continue;
      }
      silent.set(m.id, m);
      machines[machineId] = {
        ...m,
        ready: false,
        reason: `It did not answer a check: ${answer.detail}`,
      };
    }
    return { ...s, machines };
  }
  private async understand(o: Order, s: State): Promise<IntentBrief> {
    const assets = o.draft.photoAssetIds.map((a) => s.assets[a]);
    const experience = o.experience as "best_single" | "gift";
    // The ASI:One agent describes one item per order, so its orders stay single.
    const single = o.source === "asi1";
    // A name tag whose name is stated needs no reading: the local rules are exact.
    if (
      experience === "best_single" &&
      !assets.length &&
      latestProcess(o.draft.requestText) === "fdm_print" &&
      latestName(o.draft.requestText) &&
      (single || requestedThings(o.draft.requestText).length < 2)
    )
      return localIntent(experience, o.draft.requestText, [], { single });
    let facts: {
      assetId: string;
      colorful: boolean;
      kind: ImageAnalysis["kind"];
    }[] = [];
    if (assets.length) {
      try {
        const analysis = await (this.deps.analyze ?? localAnalysis)(assets);
        facts = assets.map((a) => ({
          assetId: a.id,
          colorful: analysis.colorful,
          kind: analysis.kind,
        }));
      } catch {
        facts = assets.map((a) => ({
          assetId: a.id,
          colorful: true,
          kind: "photo" as const,
        }));
      }
    }
    const understand =
      this.deps.understand ??
      (process.env.ANTHROPIC_API_KEY
        ? (input: RequestInput) =>
            createClaudeProvider().understandRequest(input)
        : undefined);
    if (understand) {
      try {
        const brief = await understand({
          requestText: o.draft.requestText,
          experience,
          ...(single ? { single } : {}),
          processes: ["sticker_print", "photo_print", "fdm_print"],
          photos: await Promise.all(
            assets.map(async (a) => ({
              assetId: a.id,
              image: {
                bytes: await readFile(a.path),
                mediaType: a.mime as "image/png",
              },
            })),
          ),
        });
        // A process the person named is their choice of outcome: "i want a
        // sticker" of a colour photo is a black-and-white sticker, as in the
        // local rules, unless the request itself asks to keep the colour.
        const asked = latestProcess(o.draft.requestText);
        const colourAsked = asksForColour(o.draft.requestText);
        // Several things asked: each one the request names counts as named.
        const several = experience === "best_single" && brief.items.length > 1;
        const named = several ? namedProcesses(o.draft.requestText) : null;
        const isAsked = (p: string) => (named ? named.has(p as Process) : p === asked);
        // Colour asked for in words makes a colour print even of a named
        // sticker: the whole request for one item, or the words of that item's
        // own part when several things are asked (none when they cannot be told apart).
        const things = several ? requestedThings(o.draft.requestText) : [];
        const colourWords = (p: string) =>
          experience === "best_single" &&
          (several
            ? wantsColour(things.find((t) => t.process === p)?.text ?? "")
            : wantsColour(o.draft.requestText));
        const mapped: IntentItem[] = brief.items.map((i) => {
            // A sticker printer prints only black. When colour matters and no
            // sticker was named, the item is a colour print, so its drafts are
            // drawn in colour and a colour printer can take it.
            const toColour =
              (experience === "best_single" &&
                i.process === "sticker_print" &&
                !isAsked("sticker_print") &&
                (i.colorImportant || colourAsked)) ||
              (i.process === "sticker_print" && colourWords(i.process));
            const process = toColour ? "photo_print" : (i.process as Process);
            return {
              process,
              name: toColour
                ? i.name.replace(/\bsticker\b/gi, "print")
                : i.name,
              why: i.why,
              quantity: i.quantity,
              creation: i.creation,
              photoAssetIds: i.photoAssetIds,
              ...(i.subject ? { subject: i.subject } : {}),
              ...(process === "fdm_print" ? { text: tagText(i.text) } : {}),
              colorImportant:
                toColour ||
                (i.process === "photo_print" && colourWords(i.process)) ||
                (i.colorImportant && (!isAsked(i.process) || colourAsked)),
              ...(Object.keys(i.subjectBoxes).length
                ? { subjectBoxes: i.subjectBoxes }
                : {}),
            };
          });
        const kept = several ? oneOfEach(mapped) : { items: mapped, left: [] };
        return {
          provider: "claude",
          model: brief.model,
          outcome: brief.outcome,
          question: brief.question ?? leftOutNote(kept.left),
          reason: brief.reason,
          items: kept.items,
          ...(kept.items.length > 1 && experience === "best_single"
            ? { requested: kept.items.length }
            : {}),
        };
      } catch (e) {
        // Fall through to the labelled local rules; the order stays usable.
        // One line, so it shows next time: the error code only, never the request.
        const why = /^[A-Z_]+(?:: HTTP \d{3})?/.exec(String((e as Error)?.message ?? ""))?.[0];
        console.warn(`[fabyn] Claude could not read order ${o.id} (${why ?? (e as Error)?.name ?? "error"}); using the local rules.`);
      }
    }
    return localIntent(experience, o.draft.requestText, facts, { single });
  }
  private reliefIntent(o: Order): IntentBrief {
    const quantities = this.reliefQuantities(o.draft.headCount ?? 300);
    return {
      provider: "local",
      outcome: `Shelter supplies for ${o.draft.headCount ?? 300} people from the fixed relief catalog.`,
      question: null,
      reason:
        "Relief items come only from the fixed catalog; quantities scale with the head count.",
      items: RELIEF_CATALOG.map((c) => ({
        process: c.process,
        name: c.name,
        why: "Relief catalog item.",
        quantity: quantities[c.id],
        creation: "generate" as const,
        photoAssetIds:
          c.process === "photo_print" ? o.draft.photoAssetIds.slice(0, 1) : [],
        colorImportant: c.process === "photo_print",
        catalogItemId: c.id,
      })),
    };
  }
  private reliefQuantities(headCount: number): Record<string, number> {
    return Object.fromEntries(
      RELIEF_CATALOG.map((c) => [
        c.id,
        Math.max(1, Math.ceil((headCount / 100) * c.perHundredPeople)),
      ]),
    );
  }

  // ---------- Drafts ----------

  private async drafts(
    input: ImageDraftInput & { requestText: string },
    provider: DesignProvider,
  ): Promise<Draft[]> {
    if (provider === "fixture")
      return fixtureDrafts(
        input.subject,
        input.previousTitles.length,
        input.count,
      );
    // Preserve the local artwork-library scripts without calling Claude to draw.
    if (provider === "claude" && this.deps.draft)
      return this.deps.draft(input);
    if (provider === "openai" || provider === "nano-banana")
      return (
        this.deps.imageDraft ??
        ((i: ImageDraftInput) =>
          (provider === "openai"
            ? createOpenAIImageProvider()
            : createNanoBananaProvider()
          ).draftImages(i))
      )({
        subject: input.subject,
        count: input.count,
        previousTitles: input.previousTitles,
        colour: input.colour,
        stickerPrinter: input.stickerPrinter,
      });
    throw new Problem(
      "DESIGN_UNAVAILABLE",
      "Drawing new artwork is not available here.",
      503,
    );
  }
  /** Saves a draft's files: a drawing gets a rendered preview, a picture is its own preview. */
  private async storeDraft(requesterId: string, draft: Draft) {
    const save = async (kind: string, bytes: Buffer | string, mime: string) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const assetId = ownedAssetId(kind, requesterId, sha256);
      const path = join(this.dataDir, "assets", assetId);
      await writeFile(path, bytes);
      return { id: assetId, path, mime, sha256 };
    };
    if (draft.image) {
      const image = await save(
        "design_image",
        Buffer.from(draft.image.bytes),
        draft.image.mediaType,
      );
      return {
        assets: [image],
        previewAssetId: image.id,
        design: { imageAssetId: image.id, imageSha256: image.sha256 },
      };
    }
    if (!draft.svg) return null;
    const rendered = await this.producer({
      operation: "render_design_preview",
      svg: draft.svg,
      size_px: 512,
      output_dir: join(this.dataDir, "producer"),
    }).catch(() => null);
    if (!rendered || rendered.status !== "ready") return null;
    const preview = await importOutput(
      this.dataDir,
      rendered.path,
      "design_preview",
      rendered.sha256,
      requesterId,
    );
    const svg = await save("design_svg", draft.svg, "image/svg+xml");
    return {
      assets: [
        svg,
        {
          id: preview.assetId,
          path: preview.path,
          mime: "image/png",
          sha256: preview.sha256,
        },
      ],
      previewAssetId: preview.assetId,
      design: { svgAssetId: svg.id, svgSha256: svg.sha256 },
    };
  }
  private async generateRound(
    orderId: string,
    revision: number,
    lease: string | null,
    itemIndex: number,
  ) {
    const { o, s } = await this.load(orderId);
    const item = o.intent!.items[itemIndex];
    const provider = this.designProvider;
    const subject =
      (item.subject ?? o.draft.requestText).slice(0, 40) || "design";
    if (provider === "none") {
      await this.commit(orderId, revision, null, (x) => {
        stage(
          x,
          "unavailable",
          "Drawing new artwork is unavailable right now. Your request is saved; add a photo or try again later.",
        );
        event(x, "plan.needs_action", { reason: "design_unavailable" });
      });
      return;
    }
    const setId = o.candidates?.id ?? id("cset");
    const round = (o.candidates?.rounds ?? 0) + 1;
    requireThat(
      round <= MAX_ROUNDS,
      "ROUNDS_EXHAUSTED",
      "No more design rounds are left for this order.",
      409,
    );
    const ok = await this.commit(orderId, revision, null, (x) => {
      if (!x.candidates)
        x.candidates = {
          id: setId,
          draftRevision: revision,
          itemId: `it_${itemIndex + 1}`,
          subject,
          rounds: 0,
          maxRounds: MAX_ROUNDS,
          status: "generating",
          candidates: [],
          recommendedId: null,
          selectedId: null,
        };
      x.candidates.rounds = round;
      x.candidates.status = "generating";
      if (!x.candidates.selectedId) stage(x, "generating_candidates");
      event(x, "design.round_started", { round });
    });
    if (!ok) return;
    let drafts: Draft[] = [];
    try {
      // Match preparation's hardware-first preference. This guides the artwork;
      // preparation still checks the final assignment and converts the image.
      const { candidates } = eligibleRegistryMachines(
        s,
        item,
        (mode) => this.service.modeAllowed(mode),
        this.clock(),
      );
      const profile = (
        candidates.find((c) => c.mode === "hardware") ?? candidates[0]
      )?.profile;
      drafts = await this.drafts(
        {
          subject,
          requestText: o.draft.requestText,
          count: DRAFTS_PER_ROUND,
          previousTitles: (o.candidates?.candidates ?? []).map((c) => c.title),
          colour: item.process === "photo_print",
          ...(item.process === "sticker_print" && profile
            ? {
                stickerPrinter: {
                  model: profile.model,
                  printableWidthMm: profile.fields.printableWidthMm.value,
                  dpi: profile.fields.dpi.value,
                  safeMarginMm: profile.fields.safeMarginMm,
                  minLineMm: profile.fields.minLineMm,
                },
              }
            : {}),
        },
        provider,
      );
    } catch (e) {
      // The requester sees a plain message; the operator sees why.
      console.warn(
        `Drawing failed for ${orderId} (${provider}): ${(e as Error).message.slice(0, 300)}`,
      );
      await this.commit(orderId, revision, null, (x) => {
        x.candidates!.status = "failed";
        x.candidates!.reason =
          "Drawing failed; your request is saved. Try again or add a photo.";
        if (!x.candidates!.selectedId)
          stage(x, "unavailable", x.candidates!.reason);
        event(x, "design.round_finished", {
          round,
          valid: 0,
          error: (e as Error).message.slice(0, 120),
        });
      });
      return;
    }
    let valid = 0;
    await mkdir(join(this.dataDir, "assets"), { recursive: true });
    for (const [index, draft] of drafts.entries()) {
      const files = await this.storeDraft(o.requesterId, draft);
      if (!files) continue;
      const stored = await this.commit(orderId, revision, null, (x, s) => {
        if (x.candidates?.id !== setId) return;
        const at = now();
        for (const file of files.assets)
          s.assets[file.id] ??= {
            id: file.id,
            ownerId: x.requesterId,
            path: file.path,
            url: `/assets/${file.id}`,
            sha256: file.sha256,
            mime: file.mime,
            width: 0,
            height: 0,
            createdAt: at,
          };
        const candidate: DesignCandidate = {
          id: id("cand"),
          round,
          index: x.candidates.candidates.length,
          title: draft.title,
          ...files.design,
          previewAssetId: files.previewAssetId,
          previewUrl: `/assets/${files.previewAssetId}`,
          provider,
          promptVersion: PROMPT_VERSION,
          createdAt: at,
        };
        x.candidates.candidates.push(candidate);
        x.candidates.recommendedId ??= candidate.id;
        if (!x.candidates.selectedId) stage(x, "awaiting_design_choice");
        event(x, "design.candidate_ready", {
          round,
          candidateId: candidate.id,
          index,
        });
      });
      if (stored) valid++;
    }
    await this.commit(orderId, revision, null, (x) => {
      if (x.candidates?.id !== setId) return;
      x.candidates.status = valid ? "ready" : "failed";
      if (!valid) {
        x.candidates.reason =
          "No usable drafts came back. Try again or add a photo.";
        if (!x.candidates.selectedId)
          stage(x, "unavailable", x.candidates.reason);
      }
      event(x, "design.round_finished", {
        round,
        valid,
        requested: DRAFTS_PER_ROUND,
      });
    });
    void lease;
  }
  async chooseDesign(actor: Actor, orderId: string, body: any) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    requireThat(
      !o.makeIntent,
      "ORDER_CONFIRMED",
      "This order is already confirmed.",
    );
    const set = o.candidates;
    requireThat(
      set &&
        body?.expectedRevision === o.draft.revision &&
        set.id === body?.candidateSetId &&
        set.candidates.some((c) => c.id === body?.candidateId),
      "STALE_CHOICE",
      "These drafts changed. Refresh and choose again.",
    );
    await this.commit(orderId, o.draft.revision, null, (x) => {
      x.candidates!.selectedId = body.candidateId;
      delete x.offer;
      stage(x, "designing");
      event(x, "design.selected", { candidateId: body.candidateId });
    });
    this.start(orderId, o.draft.revision);
    return this.view(actor, orderId);
  }
  async moreLikeThis(actor: Actor, orderId: string, body: any) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    requireThat(
      !o.makeIntent,
      "ORDER_CONFIRMED",
      "This order is already confirmed.",
    );
    const set = o.candidates;
    requireThat(
      set &&
        body?.expectedRevision === o.draft.revision &&
        set.id === body?.candidateSetId,
      "STALE_CHOICE",
      "These drafts changed. Refresh first.",
    );
    requireThat(
      set.status !== "generating",
      "ROUND_RUNNING",
      "Wait for the current drafts to finish.",
    );
    requireThat(
      set.rounds < MAX_ROUNDS,
      "ROUNDS_EXHAUSTED",
      "No more design rounds are left for this order.",
    );
    const index = Number(set.itemId.slice(3)) - 1;
    this.track(
      orderId,
      this.generateRound(orderId, o.draft.revision, null, index),
    );
    return this.view(actor, orderId);
  }

  // ---------- Producer preparation, pricing and the offer ----------

  private profileFor(
    machine: { model: string; process: Process },
    network: boolean,
  ): MachineKnowledgeProfile | null {
    if (!network)
      return Object.hasOwn(PUBLISHED_PROFILES, machine.model)
        ? PUBLISHED_PROFILES[machine.model]
        : null;
    return null;
  }
  private async receipt(
    ownerId: string,
    request: {
      process: Process;
      mode: ExecutionMode;
      machine: { id: string; model: string };
      profile: Record<string, unknown> & { version: string };
      design: Record<string, unknown>;
      params: Record<string, unknown>;
    },
  ): Promise<PreparationReceipt | { rejected: string }> {
    const design = { ...request.design };
    design.canonical_sha256 = designDigest(design);
    const key = preparationKey({ ownerId, ...request, design });
    const existing = Object.values(
      (await this.service.read()).preparations ?? {},
    ).find((r) => r.key === key);
    if (existing) return existing;
    const result = await this.producer({
      operation: "prepare",
      preparation_key: key,
      process: request.process,
      execution_mode: request.mode,
      machine: request.machine,
      profile: request.profile,
      design,
      params: request.params,
      output_dir: join(this.dataDir, "producer"),
    });
    if (result?.status !== "ready")
      return {
        rejected: `${result?.code ?? "rejected"}: ${result?.reason ?? "The producer could not prepare this."}`,
      };
    requireThat(
      result.machine_id === request.machine.id &&
        result.execution_mode === request.mode &&
        result.process === request.process,
      "PREPARATION_MISMATCH",
      "The producer's answer does not match the request.",
      502,
    );
    const preview = await importOutput(
      this.dataDir,
      result.preview.path,
      "prep_preview",
      result.preview.sha256,
      ownerId,
    );
    const artifact = result.artifact
      ? await importOutput(
          this.dataDir,
          result.artifact.path,
          "prep_artifact",
          result.artifact.sha256,
          ownerId,
        )
      : null;
    const receipt: PreparationReceipt = {
      id: result.preparation_id,
      key,
      inputDigest: result.input_digest,
      ownerId,
      machineId: request.machine.id,
      executionMode: request.mode,
      process: request.process,
      profileVersion: result.profile_version,
      compilerVersion: result.compiler_version ?? COMPILER,
      artifact: artifact
        ? {
            assetId: artifact.assetId,
            sha256: artifact.sha256,
            mediaType: result.artifact.media_type,
            bytes: artifact.bytes,
          }
        : null,
      recipe: result.recipe
        ? {
            sha256: result.recipe.sha256,
            itemId: result.recipe.item_id,
            name: result.recipe.name,
          }
        : null,
      preview: {
        assetId: preview.assetId,
        url: `/assets/${preview.assetId}`,
        sha256: preview.sha256,
        widthPx: result.preview.width_px,
        heightPx: result.preview.height_px,
        color: result.preview.color,
      },
      parameters: result.parameters,
      estimates: {
        material: result.estimates.material,
        minutesPerUnit: result.estimates.minutes_per_unit,
        setupMinutes: result.estimates.setup_minutes,
        basis: result.estimates.basis,
      },
      warnings: result.warnings ?? [],
      handling: result.handling ?? [],
      createdAt: now(),
    };
    await mutate(this.service.store, (s) => {
      s.preparations ??= {};
      s.preparations[receipt.id] ??= receipt;
      const at = now();
      for (const [assetId, path, mime, sha] of [
        [preview.assetId, preview.path, "image/png", preview.sha256],
        ...(artifact
          ? [
              [
                artifact.assetId,
                artifact.path,
                result.artifact.media_type,
                artifact.sha256,
              ],
            ]
          : []),
      ] as [string, string, string, string][])
        s.assets[assetId] ??= {
          id: assetId,
          ownerId,
          path,
          url: `/assets/${assetId}`,
          sha256: sha,
          mime,
          width: 0,
          height: 0,
          createdAt: at,
        };
    });
    return (await this.service.read()).preparations![receipt.id];
  }
  /** What the producer needs for one item: the canonical design and its parameters. */
  private designFor(
    o: Order,
    s: State,
    item: IntentItem,
    index: number,
    process: Process,
  ) {
    const photos = item.photoAssetIds.map((a) => s.assets[a]).filter(Boolean);
    if (process === "fdm_print")
      return {
        kind: "text_tag" as const,
        design: {
          kind: "text_tag",
          text: tagText(item.text ?? NEUTRAL_TAG_TEXT),
        },
      };
    const candidate =
      o.candidates?.itemId === `it_${index + 1}` ||
      (item.creation === "generate" && !photos.length)
        ? o.candidates?.candidates.find(
            (c) => c.id === o.candidates?.selectedId,
          )
        : undefined;
    if (candidate || (item.creation === "generate" && !photos.length)) {
      requireThat(candidate, "DESIGN_REQUIRED", "Choose a design first.", 409);
      // A generated picture is prepared like a photo: dithered for a sticker,
      // fitted to the film for a photo print.
      if (candidate.imageAssetId) {
        const image = s.assets[candidate.imageAssetId];
        return {
          kind: "photos" as const,
          design: {
            kind: "photos",
            photos: [
              { path: image.path, sha256: image.sha256, subject_box: null },
            ],
          },
          candidateId: candidate.id,
        };
      }
      const svg = s.assets[candidate.svgAssetId!];
      return {
        kind: "svg" as const,
        design: { kind: "svg", svg: svgText(svg) },
        candidateId: candidate.id,
      };
    }
    requireThat(
      photos.length,
      "PHOTO_REQUIRED",
      "Add a photo for this item.",
      422,
    );
    return {
      kind: "photos" as const,
      design: {
        kind: "photos",
        photos: photos.slice(0, 1).map((a) => ({
          path: a.path,
          sha256: a.sha256,
          subject_box: item.subjectBoxes?.[a.id] ?? null,
        })),
      },
    };
  }
  private paramsFor(
    process: Process,
    profile: MachineKnowledgeProfile | null,
    quantity: number,
    color: boolean,
  ) {
    // Stickers take the design's shape with empty space trimmed; wide photos
    // turn to use the film's long side and are cropped only when little is lost.
    if (process === "sticker_print")
      return {
        width_mm: profile?.fields.printableWidthMm.value ?? 53,
        height_mm: 53,
        quantity,
        material: "thermal-paper",
        crop: "contain",
        color_mode: "mono",
        fit: "content",
      };
    if (process === "photo_print")
      return {
        width_mm: 54,
        height_mm: 86,
        quantity,
        material: "photo-film",
        crop: "auto",
        color_mode: "color",
        orientation: "auto",
      };
    if (process === "fdm_print")
      return {
        width_mm: 70,
        height_mm: 18,
        quantity,
        material: "pla",
        crop: "contain",
        color_mode: "mono",
      };
    return {
      width_mm: 100,
      height_mm: 100,
      quantity,
      material: PROCESS_SHEETS[process].materialUnit,
      crop: "contain",
      color_mode: color ? "color" : "mono",
    };
  }
  private async preparePlan(orderId: string, revision: number, lease: string) {
    const ok = await this.commit(orderId, revision, lease, (x) =>
      stage(x, "producer_preparing"),
    );
    if (!ok) return;
    const { o, s } = await this.load(orderId);
    // Use the printer checks started with the drafts (or start them now), so a
    // printer that has gone to sleep is not offered.
    this.checkPrinters(s, o);
    const silent = new Map<string, Machine>();
    let checked = s;
    const items: PlanItem[] = [];
    const assignments: Assignment[] = [];
    const allowed = (m: ExecutionMode) => this.service.modeAllowed(m);
    const unavailable: string[] = [];
    let missingRequested = false;
    const freeAts: string[] = [];
    let alternative: (FormatSuggestion & { real?: boolean }) | undefined;
    for (const [index, intended] of o.intent!.items.entries()) {
      const itemId = `it_${index + 1}`;
      if (o.experience === "relief") {
        const prepared = await this.planReliefItem(o, s, intended, itemId);
        items.push(prepared.item);
        assignments.push(...prepared.assignments);
        continue;
      }
      let item = intended;
      checked = await this.afterChecks(checked, item.process, silent);
      let { candidates, rejected } = eligibleRegistryMachines(
        checked,
        item,
        allowed,
      );
      const real = (list: typeof candidates) =>
        list.filter((c) => c.mode === "hardware");
      // The item keeps the process it was asked for: the other flat printer is
      // only ever offered as a choice the person presses (alternativeFor).
      // Real machines first: a simulated one is used only when no real one can make it.
      candidates = [
        ...real(candidates),
        ...candidates.filter((c) => c.mode !== "hardware"),
      ];
      const chosen = candidates[0];
      // Only a one-item order is offered the other flat printer, and only by a button.
      const swappable =
        o.experience === "best_single" &&
        this.requestedCount(o) === 1 &&
        index === 0;
      if (!chosen) {
        if (index < this.requestedCount(o)) missingRequested = true;
        // when the busy machine of this kind should be free, if its job says
        const free = rejected
          .filter((r) => r.reason === BUSY_REASON)
          .map((r) => freeAt(checked, r.machineId, this.clock()))
          .filter((t): t is string => !!t)
          .sort()[0];
        if (free) freeAts.push(free);
        const minutes = free
          ? Math.max(1, Math.ceil((Date.parse(free) - this.clock()) / 60_000))
          : 0;
        unavailable.push(
          silent.size
            ? silent.size > 1
              ? `${[...silent.values()].map((m) => m.name).join(" and ")} did not answer: they may be off or asleep. Turn them on, close their phone apps, then try again.`
              : `${[...silent.values()][0].name} did not answer: it may be off or asleep. Turn it on, close its phone app, then try again.`
            : item.colorImportant &&
                rejected.some((r) => r.reason.includes("colour"))
              ? "No available machine can keep these colours right now."
              : rejected.some((r) => r.reason === BUSY_REASON)
                ? `The machine for "${item.name}" is finishing another order; the owner frees it after checking that print. ${minutes ? `It should be free in about ${minutes} min.` : "Try again in a moment."}`
                : `No available machine can make "${item.name}" right now.`,
        );
        if (swappable)
          alternative = await this.alternativeFor(o, item, itemId, () => checked, (next) => (checked = next), silent);
        continue;
      }
      // A simulated machine makes nothing physical: when a real one of the
      // other flat kind is free, the person may choose it.
      if (swappable && chosen.mode !== "hardware") {
        const offer = await this.alternativeFor(o, item, itemId, () => checked, (next) => (checked = next), silent);
        if (offer?.real) alternative = offer;
      }
      const design = this.designFor(o, s, item, index, item.process);
      const receipt = await this.receipt(o.requesterId, {
        process: item.process,
        mode: chosen.mode,
        machine: { id: chosen.machine.id, model: chosen.machine.model },
        profile: producerProfile(chosen.profile),
        design: design.design,
        params: this.paramsFor(
          item.process,
          chosen.profile,
          item.quantity,
          item.colorImportant,
        ),
      });
      if ("rejected" in receipt) {
        if (index < this.requestedCount(o)) missingRequested = true;
        unavailable.push(
          `"${item.name}" could not be prepared: ${receipt.rejected}`,
        );
        continue;
      }
      // The owner's per-job time limit is checked against the prepared
      // estimate before any offer, so dispatch never meets it as a surprise.
      if (
        item.process === "fdm_print" &&
        jobSeconds(receipt, item.quantity) > chosen.machine.maxJobSeconds
      ) {
        if (index < this.requestedCount(o)) missingRequested = true;
        unavailable.push(
          `"${item.name}" takes about ${Math.ceil(jobSeconds(receipt, item.quantity) / 60)} min; ${chosen.machine.name} allows ${Math.floor(chosen.machine.maxJobSeconds / 60)} min per job.`,
        );
        continue;
      }
      items.push({
        id: itemId,
        process: item.process,
        name: item.name,
        why: item.why,
        quantity: item.quantity,
        source: index >= this.requestedCount(o) ? "extra" : "requested",
        ...(index >= this.requestedCount(o) ? { extraOf: "it_1" } : {}),
        design: {
          kind: design.kind,
          ...("candidateId" in design
            ? { candidateId: design.candidateId }
            : {}),
          ...(design.kind === "photos"
            ? { photoAssetIds: item.photoAssetIds }
            : {}),
          ...(design.kind === "text_tag"
            ? { text: (design.design as any).text }
            : {}),
        },
      });
      assignments.push(
        this.assignment(
          itemId,
          chosen.machine,
          "registry",
          receipt,
          item.quantity,
          0,
        ),
      );
    }
    await this.commit(orderId, revision, lease, (x, state) => {
      stage(x, "preflighting");
      // One requested thing with extras goes ahead without a missing extra;
      // a several-thing order needs every requested thing, like a gift.
      if (
        unavailable.length &&
        (o.experience !== "best_single" ||
          !items.length ||
          (missingRequested && this.requestedCount(o) > 1))
      ) {
        stage(x, "unavailable", unavailable.join(" "));
        x.status = "preparing";
        // the latest a busy machine should be free; the order waits for all of them
        if (freeAts.length) x.draft.freeAt = freeAts.sort()[freeAts.length - 1];
        else delete x.draft.freeAt;
        // the other flat printer, as a button; a plain stale list never lingers
        x.suggestions = alternative ? [plainSuggestion(alternative)] : [];
        event(x, "plan.needs_action", { reasons: unavailable });
        return;
      }
      delete x.draft.freeAt;
      const plan = this.revisePlan(x, state, {
        items,
        assignments,
        changes: x.plan ? ["Prepared again."] : ["First proposal."],
      });
      const offered = this.suggestions(x, state, plan);
      x.suggestions = alternative
        ? [plainSuggestion(alternative), ...offered.filter((g) => g.process !== alternative!.process)].slice(0, 2)
        : offered;
      stage(x, "proposed");
      event(x, "plan.proposed", {
        version: plan.version,
        payableCents: plan.payableCents,
      });
    });
  }
  private requestedCount(o: Order) {
    return o.experience === "gift"
      ? 3
      : o.experience === "relief"
        ? o.intent!.items.length
        : (o.intent?.requested ?? 1);
  }
  private assignment(
    itemId: string,
    machine: {
      id: string;
      name?: string;
      displayName?: string;
      mode?: ExecutionMode;
      executionMode?: ExecutionMode;
      priceCard: any;
    },
    source: "registry" | "network",
    receipt: PreparationReceipt,
    quantity: number,
    startSeconds: number,
  ): Assignment {
    const mode = receipt.executionMode;
    const card =
      source === "registry"
        ? registryPriceCard(machine as Machine)
        : { ...machine.priceCard, setupCents: 0 };
    const materialPerUnit =
      receipt.estimates.material.amount / Math.max(1, quantity);
    const price = priceAssignment(
      card,
      quantity,
      materialPerUnit,
      receipt.estimates.minutesPerUnit,
    );
    // The same inputs, shown with the price; the amounts above are the policy's own.
    const basis: PriceBasis = {
      quantity,
      materialPerUnit,
      materialUnit: receipt.estimates.material.unit,
      materialRateCents: card.materialCentsPerUnit,
      machineRateCents: card.unitCents,
      handlingCents: card.setupCents,
      minimumCents: card.minimumCents,
      ...(card.timeCentsPerMinute
        ? {
            minutesPerUnit: receipt.estimates.minutesPerUnit,
            timeRateCents: card.timeCentsPerMinute,
          }
        : {}),
    };
    const minutes =
      receipt.estimates.setupMinutes +
      receipt.estimates.minutesPerUnit * quantity;
    return {
      id: `asg_${hash({ itemId, machine: machine.id, receipt: receipt.id, quantity, startSeconds }).slice(0, 20)}`,
      itemId,
      machineId: machine.id,
      machineSource: source,
      machineName: machine.name ?? machine.displayName ?? machine.id,
      executionMode: mode,
      chargeable: this.chargeable(mode, source),
      quantity,
      preparationId: receipt.id,
      artifactSha256: receipt.artifact?.sha256 ?? null,
      recipeSha256: receipt.recipe?.sha256 ?? null,
      previewUrl: receipt.preview.url,
      parameters: receipt.parameters,
      schedule: {
        startSeconds,
        finishSeconds: startSeconds + Math.round(minutes * 60),
      },
      price: { ...price, basis },
    };
  }
  /**
   * Hardware work is always paid. In testnet payment mode a simulated registry
   * machine is paid and picked up like hardware too, unless
   * FABYN_CHARGE_SIMULATED=0; mock mode keeps it estimate-only. Simulated relief
   * network work is never charged.
   */
  private chargeable(mode: ExecutionMode, source: "registry" | "network") {
    if (mode === "hardware") return true;
    return (
      source === "registry" &&
      this.service.config.paymentMode === "testnet" &&
      this.service.payment.mode === "testnet" &&
      this.service.config.chargeSimulated !== false
    );
  }
  /** Save a new immutable plan version with its offer; the old offer stops being confirmable. */
  private revisePlan(
    o: Order,
    s: State,
    next: { items: PlanItem[]; assignments: Assignment[]; changes: string[] },
  ) {
    const payable = next.assignments.filter((a) => a.chargeable);
    const payableCents = payable.reduce((t, a) => t + a.price.totalCents, 0);
    const feeCents = payable.reduce((t, a) => t + a.price.feeCents, 0);
    const simulatedEstimateCents = next.assignments
      .filter((a) => !a.chargeable)
      .reduce((t, a) => t + a.price.totalCents, 0);
    const collectionPoint =
      next.assignments
        .map((a) => ownValue(s.machines, a.machineId)?.collectionPoint)
        .find(Boolean) ?? "Team demo table";
    const version = (o.plan?.version ?? o.planHistory.at(-1)?.version ?? 0) + 1;
    const body = {
      version,
      experience: o.experience,
      items: next.items,
      assignments: next.assignments,
      payableCents,
      feeCents,
      simulatedEstimateCents,
      collectionPoint,
    };
    const plan: Plan = {
      ...body,
      digest: hash(body),
      currency: "USD",
      paymentMode: this.service.config.paymentMode,
      readyEstimateMinutes: Math.ceil(
        Math.max(0, ...next.assignments.map((a) => a.schedule.finishSeconds)) /
          60,
      ),
      status: "proposed",
      changes: next.changes,
      createdAt: now(),
      policyVersion: PRICE_POLICY,
    };
    if (o.plan)
      o.planHistory.push({
        version: o.plan.version,
        digest: o.plan.digest,
        createdAt: o.plan.createdAt,
        changes: o.plan.changes,
      });
    o.plan = plan;
    o.status = "proposed";
    const offer: Offer = {
      id: id("offer"),
      planVersion: plan.version,
      planDigest: plan.digest,
      payableCents,
      simulatedEstimateCents,
      paymentMode: plan.paymentMode,
      allocationDigest: hash(
        next.assignments
          .filter((a) => a.chargeable)
          .map((a) => [a.id, a.price.totalCents]),
      ),
      expiresAt: new Date(
        this.clock() + (this.deps.offerMs ?? 15 * 60_000),
      ).toISOString(),
      createdAt: now(),
      collectionPoint,
    };
    o.offer = offer;
    return plan;
  }
  private suggestions(o: Order, s: State, plan: Plan): FormatSuggestion[] {
    if (o.experience !== "best_single" || plan.items.length !== 1) return [];
    const item = plan.items[0];
    const allowed = (m: ExecutionMode) => this.service.modeAllowed(m);
    const out: FormatSuggestion[] = [];
    const offer = (
      process: Process,
      labelText: string,
      operation: "add" | "replace",
      note: string,
    ) => {
      const { candidates } = eligibleRegistryMachines(
        s,
        { process, quantity: 1, colorImportant: false },
        allowed,
      );
      if (candidates[0])
        out.push({
          id: `sug_${process}`,
          process,
          label: labelText,
          operation,
          itemId: item.id,
          estimateCents: candidates[0].estimateCents,
          note,
        });
    };
    if (item.design.kind === "svg") {
      offer(
        "photo_print",
        "Also make this as a colour print",
        "add",
        "The same drawing on photo film.",
      );
      offer(
        "fdm_print",
        "Also make a keychain",
        "add",
        `A text tag that says ${NEUTRAL_TAG_TEXT}; the text is editable.`,
      );
    } else if (
      item.design.kind === "photos" &&
      item.process === "photo_print"
    ) {
      offer(
        "sticker_print",
        "Also make this as a sticker",
        "add",
        "A black-and-white sticker of the same photo.",
      );
    } else if (
      item.design.kind === "photos" &&
      item.process === "sticker_print"
    ) {
      offer(
        "photo_print",
        "Use a colour print instead",
        "replace",
        "Keeps the colours on photo film.",
      );
    }
    return out.slice(0, 2);
  }
  /**
   * The other flat printer for a one-item order, as a replace suggestion the
   * person presses: a photo or colour item becomes a sticker only this way, and
   * its note says the colours become black and white.
   */
  private async alternativeFor(
    o: Order,
    item: IntentItem,
    itemId: string,
    get: () => State,
    set: (s: State) => void,
    silent: Map<string, Machine>,
  ): Promise<(FormatSuggestion & { real: boolean }) | undefined> {
    const swap: Process | null =
      item.process === "photo_print"
        ? "sticker_print"
        : item.process === "sticker_print"
          ? "photo_print"
          : null;
    if (!swap) return undefined;
    // the check of the other printer is its own: a silent one is not reported for this item
    const quiet = new Map(silent);
    set(await this.afterChecks(get(), swap, quiet));
    const { candidates } = eligibleRegistryMachines(
      get(),
      { ...item, process: swap, colorImportant: false },
      (m: ExecutionMode) => this.service.modeAllowed(m),
    );
    const best =
      candidates.find((c) => c.mode === "hardware") ?? candidates[0];
    if (!best) return undefined;
    const what = item.photoAssetIds.length ? "your photo" : "your design";
    const colour = item.colorImportant || item.process === "photo_print";
    return {
      id: `alt_${swap}`,
      process: swap,
      label:
        swap === "sticker_print"
          ? "Use a black-and-white sticker instead"
          : "Use a photo print instead",
      operation: "replace",
      itemId,
      estimateCents: best.estimateCents,
      note:
        swap === "sticker_print"
          ? `Made as a sticker of ${what} on ${best.machine.name}${colour ? "; its colours become black and white" : ""}.`
          : `Printed on photo film on ${best.machine.name}.`,
      real: best.mode === "hardware",
    };
  }
  async selectAlternative(
    actor: Actor,
    orderId: string,
    suggestionId: string,
    body: any,
  ) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    requireThat(
      !o.makeIntent,
      "ORDER_CONFIRMED",
      "This order is already confirmed.",
    );
    const suggestion = o.suggestions.find((x) => x.id === suggestionId);
    requireThat(
      suggestion &&
        (body?.expectedPlanVersion ?? null) === (o.plan?.version ?? null) &&
        body?.operation === suggestion.operation,
      "STALE_SUGGESTION",
      "This suggestion changed. Refresh first.",
    );
    const revision = o.draft.revision;
    await this.commit(orderId, revision, null, (x) => {
      const base = x.intent!.items[0];
      const next: IntentItem = {
        process: suggestion.process,
        name: suggestion.label
          .replace(/^(Also make this as |Also make |Use )/, "")
          .replace(/ instead$/, "")
          .replace(/^a /, "A "),
        why: suggestion.note,
        quantity: 1,
        creation:
          base.photoAssetIds.length && suggestion.process !== "fdm_print"
            ? "preserve"
            : "generate",
        photoAssetIds:
          suggestion.process === "fdm_print" ? [] : base.photoAssetIds,
        ...(base.subject ? { subject: base.subject } : {}),
        ...(suggestion.process === "fdm_print"
          ? { text: NEUTRAL_TAG_TEXT }
          : {}),
        colorImportant: suggestion.process === "photo_print",
      };
      if (suggestion.operation === "replace") x.intent!.items[0] = next;
      else x.intent!.items.push(next);
      delete x.offer;
      stage(x, "designing");
      event(x, "plan.preparing", {
        suggestion: suggestionId,
        operation: suggestion.operation,
      });
    });
    this.start(orderId, revision);
    return this.view(actor, orderId);
  }

  // ---------- Relief ----------

  async relief(): Promise<ReliefState> {
    const s = await this.service.read();
    if (s.relief) return s.relief;
    return mutate(this.service.store, (state) => {
      state.relief ??= this.freshRelief(this.deps.reliefSeed ?? 13);
      return state.relief;
    });
  }
  private freshRelief(seed: number): ReliefState {
    return {
      seed,
      network: generateNetwork(seed, 150),
      engine: createEngine(this.clock(), 10),
      outages: [],
    };
  }
  private async planReliefItem(
    o: Order,
    s: State,
    item: IntentItem,
    itemId: string,
  ) {
    const r = s.relief ?? (await this.relief());
    const catalog = RELIEF_CATALOG.find((c) => c.id === item.catalogItemId)!;
    const allowed = (m: ExecutionMode) => this.service.modeAllowed(m);
    // Real machines take their share first: one allocation each (no queue), up to
    // their capacity, and only when their design can be prepared.
    const real = REAL_CAPABLE_PROCESSES.includes(item.process)
      ? eligibleRegistryMachines(s, { ...item, quantity: 1 }, allowed)
          .candidates
      : [];
    const realAllocations: {
      machineId: string;
      quantity: number;
      startSeconds: number;
    }[] = [];
    let remaining = item.quantity;
    for (const c of real) {
      if (!remaining || !this.reliefRealDesign(o, s, item)) break;
      const quantity = Math.min(
        remaining,
        catalog.chunkSize,
        c.machine.mediaRemaining,
        c.machine.policy.maxQuantity,
      );
      if (quantity < 1) continue;
      realAllocations.push({
        machineId: c.machine.id,
        quantity,
        startSeconds: 0,
      });
      remaining -= quantity;
    }
    const busyUntil = this.networkBusyUntil(r);
    const candidates: SplitCandidate[] = r.network
      .filter((m) => m.process === item.process && m.status === "online")
      .map((m) => ({
        id: m.id,
        process: m.process,
        availableAtSeconds: busyUntil[m.id] ?? 0,
        setupSeconds: m.timeModel.setupSeconds,
        secondsPerUnit: m.timeModel.secondsPerUnit,
        capacityUnits: m.capacityUnits,
        maxAssignments: null,
        real: false,
      }));
    const split = splitQuantity(remaining, catalog.chunkSize, candidates);
    const assignments: Assignment[] = [];
    const network = new Map(r.network.map((m) => [m.id, m]));
    const requests = [];
    for (const allocation of [
      ...realAllocations.map((a) => ({ ...a, real: true })),
      ...split.allocations,
    ]) {
      if (allocation.real) {
        const m = s.machines[allocation.machineId];
        const design = this.reliefRealDesign(o, s, item)!;
        const receipt = await this.receipt(o.requesterId, {
          process: item.process,
          mode: m.mode,
          machine: { id: m.id, model: m.model },
          profile: producerProfile(PUBLISHED_PROFILES[m.model]),
          design: design.design,
          params: this.paramsFor(
            item.process,
            PUBLISHED_PROFILES[m.model],
            allocation.quantity,
            item.colorImportant,
          ),
        });
        if ("rejected" in receipt) continue;
        assignments.push(
          this.assignment(
            itemId,
            m,
            "registry",
            receipt,
            allocation.quantity,
            allocation.startSeconds,
          ),
        );
      } else requests.push(allocation);
    }
    const prepared = await this.prepareNetwork(
      o,
      item,
      requests.map((a) => ({
        machine: network.get(a.machineId)!,
        quantity: a.quantity,
        startSeconds: a.startSeconds,
      })),
    );
    for (const p of prepared)
      assignments.push(
        this.assignment(
          itemId,
          p.machine,
          "network",
          p.receipt,
          p.quantity,
          p.startSeconds,
        ),
      );
    const allocated = assignments.reduce((t, a) => t + a.quantity, 0);
    return {
      item: {
        id: itemId,
        process: item.process,
        name: item.name,
        why: item.why,
        quantity: item.quantity,
        source: "requested" as const,
        design: {
          kind: "sim_catalog_item" as const,
          catalogItemId: item.catalogItemId,
        },
        unallocatedQuantity: item.quantity - allocated,
      },
      assignments,
    };
  }
  private reliefRealDesign(o: Order, s: State, item: IntentItem) {
    if (item.process === "sticker_print")
      return { design: { kind: "svg", svg: COT_LABEL_SVG } };
    if (item.process === "photo_print" && item.photoAssetIds.length) {
      const a = s.assets[item.photoAssetIds[0]];
      return {
        design: {
          kind: "photos",
          photos: [{ path: a.path, sha256: a.sha256, subject_box: null }],
        },
      };
    }
    // Tarp clips need a vetted catalog model; none is configured here.
    return null;
  }
  private async prepareNetwork(
    o: Order,
    item: IntentItem,
    allocations: {
      machine: NetworkMachine;
      quantity: number;
      startSeconds: number;
    }[],
  ) {
    const out: {
      machine: NetworkMachine;
      receipt: PreparationReceipt;
      quantity: number;
      startSeconds: number;
    }[] = [];
    const catalog = RELIEF_CATALOG.find((c) => c.id === item.catalogItemId)!;
    const prepareOne = async (a: (typeof allocations)[number]) => {
      const sheet = PROCESS_SHEETS[a.machine.process];
      const receipt = await this.receipt(o.requesterId, {
        process: a.machine.process,
        mode: "simulation",
        machine: { id: a.machine.id, model: `Simulated ${sheet.label}` },
        profile: {
          version: `sim-sheet:${a.machine.process}:${hash(sheet).slice(0, 12)}`,
        },
        design: {
          kind: "sim_catalog_item",
          catalog_item: {
            id: catalog.id,
            name: catalog.name,
            unit: catalog.unit,
            setup_seconds: a.machine.timeModel.setupSeconds,
            seconds_per_unit: a.machine.timeModel.secondsPerUnit,
            material_per_unit: sheet.materialPerUnit,
            material_unit: sheet.materialUnit,
          },
        },
        params: this.paramsFor(a.machine.process, null, a.quantity, false),
      });
      return "rejected" in receipt ? null : { ...a, receipt };
    };
    // Each preparation is a separate pure producer run; a few run at once.
    const prepared: (Awaited<ReturnType<typeof prepareOne>> | undefined)[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, allocations.length) }, async () => {
        while (next < allocations.length) {
          const index = next++;
          prepared[index] = await prepareOne(allocations[index]);
        }
      }),
    );
    for (const p of prepared)
      if (p)
        out.push({
          machine: p.machine,
          receipt: p.receipt,
          quantity: p.quantity,
          startSeconds: p.startSeconds,
        });
    return out;
  }
  private networkBusyUntil(r: ReliefState) {
    const until: Record<string, number> = {};
    const simNow =
      ((this.clock() - r.engine.epochMs) / 1000) * r.engine.timeScale;
    for (const j of Object.values(r.engine.jobs))
      if (
        j.status === "queued" ||
        j.status === "running" ||
        j.status === "paused"
      )
        until[j.machineId] = Math.max(
          until[j.machineId] ?? simNow,
          j.plannedStartSeconds + j.durationSeconds,
        );
    return until;
  }

  // ---------- One confirmation ----------

  async confirm(actor: Actor, orderId: string, body: any, payload?: any) {
    return this.withPaymentLock(orderId, () =>
      this.confirmLocked(actor, orderId, body, payload),
    );
  }
  private paymentTarget(o: Order): PaymentTarget {
    const offer = o.offer!,
      plan = o.plan!;
    return {
      id: o.id,
      quote: {
        id: offer.id,
        totalCents: offer.payableCents,
        ownerCents: offer.payableCents - plan.feeCents,
        platformCents: plan.feeCents,
        expiresAt: offer.expiresAt,
      },
      paymentResourcePath: `/api/orders/${encodeURIComponent(o.id)}/pay?offer=${encodeURIComponent(offer.id)}&plan=${encodeURIComponent(offer.planDigest)}`,
    };
  }
  private async confirmLocked(
    actor: Actor,
    orderId: string,
    body: any,
    payload?: any,
  ) {
    const key = body?.idempotencyKey;
    requireThat(
      typeof key === "string" && key.length >= 8 && key.length <= 200,
      "IDEMPOTENCY_REQUIRED",
      "Confirming needs a stable idempotency key.",
      422,
    );
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    if (o.makeIntent) {
      requireThat(
        o.makeIntent.key === key,
        "ORDER_CONFIRMED",
        "This order is already confirmed.",
      );
      await this.resumePayment(orderId);
      return this.view(actor, orderId);
    }
    requireThat(
      body?.permission === true &&
        body?.consent?.payment === true &&
        body?.consent?.production === true,
      "CONSENT_REQUIRED",
      "Confirm artwork permission and consent to payment and production.",
      422,
    );
    requireThat(
      o.plan &&
        o.offer &&
        o.draft.stage === "proposed" &&
        body.offerId === o.offer.id &&
        body.planVersion === o.plan.version &&
        body.planDigest === o.plan.digest,
      "STALE_OFFER",
      "This proposal changed. Review the current preview and total before confirming.",
    );
    requireThat(
      Date.parse(o.offer.expiresAt) > this.clock(),
      "OFFER_EXPIRED",
      "This proposal expired. Ask for a fresh one; nothing was charged.",
    );
    requireThat(
      o.offer.paymentMode === this.service.payment.mode,
      "PAYMENT_MODE_CHANGED",
      "Payment mode changed. Request a fresh proposal before paying.",
    );
    this.validatePaymentPlan((await this.load(orderId)).s, o);
    if (
      o.plan.payableCents > 0 &&
      this.service.payment.mode === "testnet" &&
      !payload
    ) {
      requireThat(
        this.service.payment.challenge,
        "PAYMENT_UNAVAILABLE",
        "Test payment service is unavailable.",
        503,
      );
      const challenge = await this.service.payment.challenge(
        this.paymentTarget(o),
      );
      throw Object.assign(
        new Problem(
          "PAYMENT_REQUIRED",
          "Base Sepolia test payment is required.",
          402,
        ),
        { challenge },
      );
    }
    // Commit the accepted offer, reservations and collection operation before any settlement.
    const created = await mutate(this.service.store, (s) => {
      const order = s.orders![orderId];
      if (order.makeIntent) {
        requireThat(
          order.makeIntent.key === key,
          "ORDER_CONFIRMED",
          "This order is already confirmed.",
        );
        return false;
      }
      requireThat(
        order.plan?.digest === o.plan!.digest &&
          order.offer?.id === o.offer!.id &&
          order.draft.stage === "proposed" &&
          Date.parse(order.offer.expiresAt) > this.clock(),
        "STALE_OFFER",
        "This proposal changed or expired. Review it again.",
      );
      this.validatePaymentPlan(s, order);
      const plan = order.plan!;
      const at = now();
      const reservationExpires = new Date(
        Math.max(
          Date.parse(order.offer!.expiresAt),
          this.clock() + 10 * 60_000,
        ),
      ).toISOString();
      for (const a of plan.assignments) {
        if (a.machineSource !== "registry") continue;
        const receipt = s.preparations![a.preparationId];
        const m = s.machines[a.machineId];
        const item = plan.items.find((i) => i.id === a.itemId)!;
        const job = childJob(order, a, item, receipt, m, at);
        s.jobs[job.id] = job;
        m.reservation = { jobId: job.id, expiresAt: reservationExpires };
        a.childJobId = job.id;
      }
      const intent: MakeIntent = {
        id: id("make"),
        key,
        offerId: order.offer!.id,
        planDigest: plan.digest,
        planVersion: plan.version,
        permission: true,
        consent: { payment: true, production: true },
        authorizedCents: plan.payableCents,
        reassignment: order.experience === "relief" ? "relief_mandate" : "none",
        ...(order.experience === "relief"
          ? {
              mandate: {
                capCents: Math.ceil(plan.simulatedEstimateCents * 1.25),
                sameMode: true as const,
                sameProcess: true as const,
              },
            }
          : {}),
        status: plan.payableCents > 0 ? "collecting" : "funded",
        payment: {
          operationId: null,
          status: plan.payableCents > 0 ? "submitting" : "not_required",
        },
        createdAt: at,
        updatedAt: at,
      };
      order.makeIntent = intent;
      if (plan.payableCents > 0) {
        const operationId = `collect:${order.id}:${intent.id}`;
        intent.payment.operationId = operationId;
        s.operations[operationId] = {
          id: operationId,
          jobId: order.id,
          kind: "collection",
          status: "submitting",
          amountCents: intent.authorizedCents,
          mode: this.service.payment.mode,
          createdAt: at,
          updatedAt: at,
        };
      }
      plan.status = "approved";
      order.status = "approved";
      event(order, "plan.approved", {
        payableCents: plan.payableCents,
        simulatedEstimateCents: plan.simulatedEstimateCents,
      });
      order.version++;
      order.updatedAt = at;
      return true;
    });
    if (
      created &&
      (await this.load(orderId)).o.makeIntent!.payment.status === "submitting"
    )
      await this.collect(orderId, payload);
    await this.resumePayment(orderId);
    return this.view(actor, orderId);
  }
  private validatePaymentPlan(s: State, order: Order) {
    const allowed = (mode: ExecutionMode) => this.service.modeAllowed(mode);
    const mediaUse: Record<string, number> = {};
    for (const a of order.plan!.assignments) {
      const receipt = ownValue(s.preparations ?? {}, a.preparationId);
      requireThat(
        receipt &&
          receipt.executionMode === a.executionMode &&
          receipt.machineId === a.machineId,
        "PREPARATION_CHANGED",
        "A prepared file changed. Review a fresh proposal; nothing was charged.",
      );
      if (a.machineSource === "network") {
        const m = s.relief?.network.find((x) => x.id === a.machineId);
        requireThat(
          m?.status === "online",
          "PLAN_CHANGED",
          "A simulated machine went offline. Review a fresh proposal; nothing was charged.",
        );
        continue;
      }
      const m = s.machines[a.machineId];
      requireThat(
        m && m.mode === a.executionMode && allowed(m.mode),
        "MODE_MISMATCH",
        "A machine's mode changed. Review a fresh proposal; nothing was charged.",
      );
      const still = eligibleRegistryMachines(
        s,
        {
          process: receipt.process,
          quantity: a.quantity,
          colorImportant: false,
        },
        allowed,
      );
      requireThat(
        still.candidates.some((c) => c.machine.id === m.id),
        "PLAN_CHANGED",
        `${m.name} is no longer ready. Review a fresh proposal; nothing was charged.`,
      );
      mediaUse[m.id] = (mediaUse[m.id] ?? 0) + a.quantity;
      requireThat(
        mediaUse[m.id] <= m.mediaRemaining &&
          order.plan!.assignments.filter((x) => x.machineId === m.id).length ===
            1,
        "PLAN_CHANGED",
        `${m.name} cannot take all of this work at once. Review a fresh proposal.`,
      );
    }
  }
  /** One settlement funds only the hardware allocations in the accepted plan. */
  private async collect(orderId: string, payload?: any) {
    const { o, s } = await this.load(orderId);
    const op = s.operations[o.makeIntent!.payment.operationId!];
    let result: PaymentResult;
    try {
      result = await this.service.payment.collect(
        this.paymentTarget(o),
        op,
        payload,
      );
    } catch (e) {
      result = {
        status: (e as any).safeToRetry === true ? "failed" : "pending",
        reference: `unsubmitted:${op.id}`,
        reason: (e as Error).message,
      };
    }
    await this.applyOrderPayment(orderId, op.id, result);
  }
  private async applyOrderPayment(
    orderId: string,
    operationId: string,
    result: PaymentResult,
  ) {
    await mutate(this.service.store, (s) => {
      const order = s.orders![orderId],
        mi = order.makeIntent!;
      const op = s.operations[operationId];
      if (["confirmed", "failed"].includes(mi.payment.status)) return;
      if (result.status === "confirmed") {
        const previous = s.paymentReferences[result.reference];
        requireThat(
          !previous || previous === op.id,
          "PAYMENT_REPLAY",
          "This payment reference already funded another order.",
        );
        s.paymentReferences[result.reference] = op.id;
      }
      // A thrown transport/checkpoint error must never discard a durable nonce or hash.
      Object.assign(op, result, { updatedAt: now() });
      if (op.receipt) {
        op.reference = op.receipt.reference;
        op.transactionHash = op.receipt.transactionHash;
      }
      mi.payment = {
        operationId: op.id,
        status: result.status,
        reference: op.reference,
        transactionHash: op.transactionHash,
        reason: result.reason,
      };
      if (result.status === "confirmed") {
        const late =
          mi.cancelRequested ||
          order.status === "cancelled" ||
          Date.parse(order.offer!.expiresAt) <= this.clock() ||
          order.plan!.assignments.some(
            (a) =>
              a.childJobId &&
              (s.jobs[a.childJobId].productionState === "cancelled" ||
                s.machines[a.machineId]?.reservation?.jobId !== a.childJobId ||
                Date.parse(s.machines[a.machineId].reservation!.expiresAt) <=
                  this.clock()),
          );
        this.fundChildren(
          s,
          order,
          result.reference,
          result.receipt?.payer,
          !!late,
        );
        mi.status = late ? "cancelled" : "funded";
        if (late) {
          mi.cancelRequested = true;
          order.status = order.plan!.status = "needs_review";
          for (const a of order.plan!.assignments) {
            if (!a.childJobId) continue;
            const j = s.jobs[a.childJobId];
            j.productionState = a.chargeable ? "needs_review" : "cancelled";
            if (s.machines[a.machineId].reservation?.jobId === j.id)
              delete s.machines[a.machineId].reservation;
          }
          mi.payment.reason =
            "Payment confirmed after the order stopped or expired. The workshop must review it; production has not started.";
        }
        event(order, "payment.confirmed", {
          cents: mi.authorizedCents,
          mode: op.mode,
          transactionHash: op.transactionHash,
        });
      } else if (result.status === "failed") {
        mi.status = "payment_failed";
        this.releaseChildren(s, order, "Payment failed; nothing was made.");
        order.status = order.plan!.status = "cancelled";
        event(order, "payment.failed", { reason: result.reason ?? "" });
      } else {
        if (!mi.cancelRequested) mi.status = "payment_pending";
        event(order, "payment.pending", { reason: result.reason ?? "" });
      }
      mi.updatedAt = order.updatedAt = now();
      order.version++;
    });
  }
  /** Reconcile saved transactions only. Never reconstruct or resubmit a payer authorization. */
  private async resumePayment(orderId: string) {
    let { o, s } = await this.load(orderId);
    if (!o.makeIntent) return;
    const op = s.operations[o.makeIntent.payment.operationId ?? ""];
    if (op && ["pending", "submitting"].includes(op.status)) {
      const machine =
        s.machines[o.plan!.assignments.find((a) => a.chargeable)!.machineId];
      try {
        const result = await this.service.payment.reconcile(
          this.paymentTarget(o),
          machine,
          op,
        );
        await this.applyOrderPayment(orderId, op.id, result);
      } catch {
        /* Leave the durable operation pending for the next poll. */
      }
      ({ o, s } = await this.load(orderId));
    }
    if (o.makeIntent!.cancelRequested) return;
    if (["funded", "submitted"].includes(o.makeIntent!.status))
      await this.submit(orderId);
  }
  private fundChildren(
    s: State,
    order: Order,
    reference: string,
    payer?: string,
    stopped = false,
  ) {
    for (const a of order.plan!.assignments) {
      if (!a.childJobId || !a.chargeable) continue;
      const j = s.jobs[a.childJobId];
      const op: Operation = {
        id: `allocation:${order.id}:${a.id}`,
        jobId: j.id,
        kind: "collection",
        status: "confirmed",
        reference: `${reference}#${a.id}`,
        reason: "Allocated from the order's single collection.",
        createdAt: now(),
        updatedAt: now(),
        amountCents: a.price.totalCents,
        mode: this.service.payment.mode,
        receipt: { parentReference: reference, assignmentId: a.id },
      };
      s.operations[op.id] = op;
      s.paymentReferences[op.reference!] = op.id;
      j.collectionOperationId = op.id;
      j.requesterAddress = payer;
      j.paymentState = "held";
      j.productionState = stopped ? "needs_review" : "payment_confirmed";
      record(
        j,
        "collection_confirmed",
        "Funded by allocation from the order's confirmed collection.",
      );
    }
  }
  private releaseChildren(s: State, order: Order, reason: string) {
    for (const a of order.plan!.assignments) {
      if (!a.childJobId) continue;
      const j = s.jobs[a.childJobId];
      if (j.attemptId) continue;
      j.productionState = "cancelled";
      const m = s.machines[j.machineId!];
      if (m?.reservation?.jobId === j.id) delete m.reservation;
      record(j, "cancelled", reason);
    }
  }
  /** Dispatch each child through the existing guarded service and schedule simulated work. */
  private async submit(orderId: string) {
    await mutate(this.service.store, (s) => {
      const order = s.orders![orderId];
      if (
        order.makeIntent!.status === "submitted" ||
        order.makeIntent!.cancelRequested
      )
        return;
      requireThat(
        order.makeIntent!.status === "funded",
        "UNPAID",
        "Confirmed payment is required before production.",
      );
      const r = s.relief;
      const network = order.plan!.assignments.filter(
        (a) => a.machineSource === "network" && !a.simJobId,
      );
      if (network.length && r) {
        const durations = new Map(
          network.map((a) => [
            a.id,
            a.schedule.finishSeconds - a.schedule.startSeconds,
          ]),
        );
        const items = network.map((a) => ({
          id: `sim_${a.id}`,
          orderId,
          assignmentId: a.id,
          machineId: a.machineId,
          quantity: a.quantity,
          process: order.plan!.items.find((i) => i.id === a.itemId)!.process,
          plannedStartSeconds: Math.max(
            a.schedule.startSeconds,
            ((this.clock() - r.engine.epochMs) / 1000) * r.engine.timeScale,
          ),
          durationSeconds: Math.max(1, durations.get(a.id)!),
        }));
        scheduleJobs(r.engine, items);
        for (const a of network) a.simJobId = `sim_${a.id}`;
      }
      order.makeIntent!.status = "submitted";
      order.makeIntent!.updatedAt = now();
      order.plan!.status = "in_progress";
      order.status = "in_progress";
      event(order, "plan.in_progress", {
        children: order.plan!.assignments.filter((a) => a.childJobId).length,
        simulated: network.length,
      });
      order.version++;
    });
    const { o } = await this.load(orderId);
    for (const a of o.plan!.assignments) {
      if (!a.childJobId) continue;
      const child = await this.service.job(a.childJobId);
      if (child.attemptId || child.productionState === "cancelled") continue;
      try {
        await this.service.dispatch(a.childJobId);
      } catch (e) {
        await mutate(this.service.store, (s) =>
          event(s.orders![orderId], "job.failed", {
            assignmentId: a.id,
            reason: (e as Error).message.slice(0, 200),
          }),
        );
      }
    }
  }
  async cancel(actor: Actor, orderId: string) {
    return this.withPaymentLock(orderId, () =>
      this.cancelLocked(actor, orderId),
    );
  }
  private async cancelLocked(actor: Actor, orderId: string) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    if (!o.makeIntent) {
      await this.commit(orderId, o.draft.revision, null, (x) => {
        delete x.offer;
        x.status = "cancelled";
        if (x.plan) x.plan.status = "cancelled";
        stage(
          x,
          "superseded",
          "Cancelled before confirmation; nothing was charged.",
        );
        event(x, "plan.cancelled", {});
      });
      return this.view(actor, orderId);
    }
    await mutate(this.service.store, (s) => {
      const order = s.orders![orderId];
      order.makeIntent!.cancelRequested = true;
      if (order.makeIntent!.status !== "submitted") {
        order.makeIntent!.status = "cancelled";
        order.status = order.plan!.status = "cancelled";
      }
    });
    const notes: string[] = [];
    for (const a of o.plan!.assignments) {
      if (a.childJobId) {
        try {
          await this.service.cancel(a.childJobId);
          notes.push(`${a.id}: cancelled before dispatch`);
        } catch (e) {
          notes.push(
            `${a.id}: stop requested; it may have started and will be reconciled`,
          );
        }
      }
    }
    await mutate(this.service.store, (s) => {
      const order = s.orders![orderId];
      if (s.relief)
        cancelJobs(
          s.relief.engine,
          order
            .plan!.assignments.map((a) => a.simJobId)
            .filter(Boolean) as string[],
        );
      event(order, "plan.cancel_requested", { notes });
      order.version++;
    });
    return this.view(actor, orderId);
  }

  // ---------- Progress, replanning and the relief demo ----------

  async tick() {
    const payments = await this.service.read();
    for (const o of Object.values(payments.orders ?? {})) {
      if (!o.makeIntent || this.paymentLocks.has(o.id)) continue;
      if (
        ["submitting", "pending"].includes(o.makeIntent.payment.status) ||
        o.makeIntent.status === "funded" ||
        (o.makeIntent.status === "submitted" &&
          o.plan?.assignments.some(
            (a) =>
              a.childJobId &&
              !payments.jobs[a.childJobId].attemptId &&
              payments.jobs[a.childJobId].productionState !== "cancelled",
          ))
      )
        await this.withPaymentLock(o.id, () => this.resumePayment(o.id));
    }
    const s = await this.service.read();
    // Ask every real printer about once a minute: the site shows whether each
    // one answers, and one paused only because it could not be reached comes
    // back on its own once it is on again.
    if (this.clock() - this.lastRecoveryScan >= RECOVERY_SCAN_MS) {
      this.lastRecoveryScan = this.clock();
      for (const m of Object.values(s.machines))
        if (
          m.producerHub &&
          m.mode === "hardware" &&
          (m.outputType === "sticker" || m.outputType === "instax") &&
          (!m.paused || UNREACHED.test(m.reason ?? ""))
        )
          this.startCheck(m);
    }
    if (s.relief && Object.keys(s.relief.engine.jobs).length)
      await mutate(this.service.store, (state) => {
        const events = advance(
          state.relief!.engine,
          state.relief!.network,
          this.clock(),
        );
        for (const e of events) {
          const job = state.relief!.engine.jobs[e.jobId];
          const order = ownValue(state.orders ?? {}, job?.orderId ?? "");
          if (order && (e.type !== "sim_job.progress" || e.progress === 1))
            event(order, e.type, {
              simJobId: e.jobId,
              machineId: e.machineId,
              progress: e.progress,
            });
        }
      });
    const state = await this.service.read();
    for (const o of Object.values(state.orders ?? {})) {
      if (
        !o.plan ||
        !["in_progress", "approved"].includes(o.plan.status) ||
        o.makeIntent?.status !== "submitted"
      )
        continue;
      const status = this.planStatus(state, o);
      if (status !== o.plan.status)
        await mutate(this.service.store, (x) => {
          const order = x.orders![o.id];
          order.plan!.status = status;
          order.status = status;
          event(order, status === "done" ? "plan.done" : `plan.${status}`, {});
          order.version++;
        });
    }
  }
  private planStatus(s: State, o: Order): PlanStatus {
    const states = o.plan!.assignments.map((a) => {
      if (a.childJobId) {
        const j = s.jobs[a.childJobId];
        if (j.productionState === "needs_review") return "review";
        if (j.productionState === "failed" || j.productionState === "cancelled")
          return "failed";
        if (
          ["ready_for_pickup", "collected", "simulation_complete"].includes(
            j.fulfillmentState,
          )
        )
          return "done";
        return "running";
      }
      const job = a.simJobId ? s.relief?.engine.jobs[a.simJobId] : undefined;
      if (!job) return "running";
      if (job.status === "done") return "done";
      if (job.status === "cancelled") return "failed";
      return "running";
    });
    if (states.includes("review")) return "needs_review";
    if (states.includes("running")) return "in_progress";
    if (states.every((x) => x === "done")) return "done";
    return states.includes("done") ? "partial" : "cancelled";
  }
  async reliefDemo(action: string, body: any) {
    const at = this.clock();
    if (action === "reset") {
      const seed = Number.isSafeInteger(body?.seed) ? body.seed : 13;
      await mutate(this.service.store, (s) => {
        for (const o of Object.values(s.orders ?? {}))
          if (
            o.experience === "relief" &&
            o.plan &&
            ["approved", "in_progress", "proposed"].includes(o.plan.status)
          ) {
            o.plan.status = "cancelled";
            o.status = "cancelled";
            event(o, "scenario.reset", {
              note: "Simulated work was cleared by a demo reset; real children are untouched.",
            });
          }
        s.relief = this.freshRelief(seed);
      });
      return this.relief();
    }
    await this.relief();
    if (action === "time_scale") {
      requireThat(
        [1, 10, 60].includes(body?.x),
        "INVALID_SCALE",
        "Choose 1, 10 or 60.",
        422,
      );
      await mutate(this.service.store, (s) =>
        setTimeScale(s.relief!.engine, body.x as TimeScale, at),
      );
      return this.relief();
    }
    if (action === "add_machine") {
      requireThat(
        typeof body?.process === "string" &&
          Number.isFinite(body?.lat) &&
          Number.isFinite(body?.lng),
        "INVALID_MACHINE",
        "Give a process, latitude and longitude.",
        422,
      );
      const added = await mutate(this.service.store, (s) => {
        const machine = addMachine(
          s.relief!.network,
          body.process,
          body.lat,
          body.lng,
        );
        return machine;
      });
      await this.replan(
        "A simulated machine joined.",
        (o, item) =>
          (item.unallocatedQuantity ?? 0) > 0 && item.process === added.process,
      );
      return this.relief();
    }
    if (action === "outage") {
      requireThat(
        Array.isArray(body?.polygon) && body.polygon.length >= 3,
        "INVALID_POLYGON",
        "Draw an outage area with at least three points.",
        422,
      );
      const offline = await mutate(this.service.store, (s) => {
        const ids = applyOutage(s.relief!.network, body.polygon);
        s.relief!.outages.push({
          id: id("outage"),
          polygon: body.polygon,
          at: now(),
        });
        return ids;
      });
      await this.replan(
        `An outage took ${offline.length} simulated machines offline.`,
        () => true,
        offline,
      );
      return this.relief();
    }
    if (action === "restore") {
      await mutate(this.service.store, (s) => restoreAll(s.relief!.network));
      return this.relief();
    }
    throw new Problem("UNKNOWN_ACTION", "Unknown demo action.", 404);
  }
  /**
   * Move only never-started simulated work under the relief mandate: same
   * process and mode, within the cap. Real or possibly started work never moves.
   */
  private async replan(
    reason: string,
    eligibleItem: (o: Order, item: PlanItem) => boolean,
    offline: string[] = [],
  ) {
    const s = await this.service.read();
    for (const o of Object.values(s.orders ?? {})) {
      if (
        o.experience !== "relief" ||
        o.plan?.status !== "in_progress" ||
        o.makeIntent?.reassignment !== "relief_mandate"
      )
        continue;
      const moved = offline.length
        ? unstartedJobs(s.relief!.engine, offline).filter(
            (j) => j.orderId === o.id,
          )
        : [];
      const displaced = new Map<string, number>();
      for (const j of moved) {
        const a = o.plan.assignments.find((x) => x.id === j.assignmentId)!;
        displaced.set(a.itemId, (displaced.get(a.itemId) ?? 0) + j.quantity);
      }
      const items = o.plan.items.filter(
        (i) => displaced.has(i.id) || eligibleItem(o, i),
      );
      if (!items.length) continue;
      await mutate(this.service.store, (x) => {
        cancelJobs(
          x.relief!.engine,
          moved.map((j) => j.id),
        );
      });
      const assignments = o.plan.assignments.filter(
        (a) => !moved.some((j) => j.assignmentId === a.id),
      );
      const nextItems = o.plan.items.map((i) => ({ ...i }));
      const state = await this.service.read();
      for (const item of nextItems) {
        const need =
          (displaced.get(item.id) ?? 0) +
          (eligibleItem(o, item) ? (item.unallocatedQuantity ?? 0) : 0);
        if (!need) continue;
        const catalog = RELIEF_CATALOG.find(
          (c) => c.id === item.design.catalogItemId,
        )!;
        const r = state.relief!;
        const busy = this.networkBusyUntil(r);
        const split = splitQuantity(
          need,
          catalog.chunkSize,
          r.network
            .filter((m) => m.process === item.process && m.status === "online")
            .map((m) => ({
              id: m.id,
              process: m.process,
              availableAtSeconds: busy[m.id] ?? 0,
              setupSeconds: m.timeModel.setupSeconds,
              secondsPerUnit: m.timeModel.secondsPerUnit,
              capacityUnits: m.capacityUnits,
              maxAssignments: null,
              real: false,
            })),
        );
        const network = new Map(r.network.map((m) => [m.id, m]));
        const intentItem = o.intent!.items.find(
          (_, index) => `it_${index + 1}` === item.id,
        )!;
        const prepared = await this.prepareNetwork(
          o,
          intentItem,
          split.allocations.map((a) => ({
            machine: network.get(a.machineId)!,
            quantity: a.quantity,
            startSeconds: a.startSeconds,
          })),
        );
        for (const p of prepared)
          assignments.push(
            this.assignment(
              item.id,
              p.machine,
              "network",
              p.receipt,
              p.quantity,
              p.startSeconds,
            ),
          );
        item.unallocatedQuantity =
          (eligibleItem(o, item) ? 0 : (item.unallocatedQuantity ?? 0)) +
          split.unallocated;
      }
      const simulated = assignments
        .filter((a) => !a.chargeable)
        .reduce((t, a) => t + a.price.totalCents, 0);
      await mutate(this.service.store, (x) => {
        const order = x.orders![o.id];
        const cap = order.makeIntent!.mandate?.capCents ?? 0;
        if (simulated > cap) {
          event(order, "plan.needs_action", {
            reason:
              "Moving this work would exceed the accepted cap; it waits for the coordinator.",
          });
          return;
        }
        const version = order.plan!.version;
        const replaced = moved.map((j) => j.assignmentId);
        const plan = this.revisePlan(order, x, {
          items: nextItems,
          assignments,
          changes: [
            reason,
            `Moved ${moved.reduce((t, j) => t + j.quantity, 0)} never-started simulated units.`,
          ],
        });
        // The mandate covers this move: keep the accepted intent bound to the new version.
        plan.status = "in_progress";
        order.status = "in_progress";
        order.makeIntent!.planDigest = plan.digest;
        order.makeIntent!.planVersion = plan.version;
        delete order.offer;
        event(order, "plan.replanned", {
          from: version,
          to: plan.version,
          replaced,
          reason,
        });
        order.version++;
      });
      await this.submit(o.id);
    }
  }

  // ---------- Views ----------

  async view(actor: Actor, orderId: string) {
    const { o, s } = await this.load(orderId);
    this.owned(o, actor);
    return orderView(o, s, actor);
  }
  async events(actor: Actor, orderId: string, after: number) {
    const { o } = await this.load(orderId);
    this.owned(o, actor);
    return {
      events: o.events.filter((e) => e.seq > after),
      nextSeq: o.nextSeq,
    };
  }
}

const svgText = (asset: Asset) => readFileSync(asset.path, "utf8");
/** Whole seconds one prepared job runs: setup once plus every unit. */
const jobSeconds = (receipt: PreparationReceipt, quantity: number) =>
  Math.max(
    60,
    Math.round(
      (receipt.estimates.setupMinutes +
        receipt.estimates.minutesPerUnit * quantity) *
        60,
    ),
  );
const COT_LABEL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect x="14" y="14" width="172" height="172" fill="none" stroke="black" stroke-width="8"/><path d="M40 120 L160 120 L160 140 M40 100 L40 150 M160 120 L160 150" fill="none" stroke="black" stroke-width="10" stroke-linecap="round"/><circle cx="62" cy="96" r="14" fill="black"/><rect x="82" y="92" width="74" height="22" fill="black"/></svg>';

/** A child job created from an approved plan; the producer-prepared artifact is bound as is. */
function childJob(
  order: Order,
  a: Assignment,
  item: PlanItem,
  receipt: PreparationReceipt,
  m: Machine,
  at: string,
): Job {
  const p = receipt.parameters as any;
  const outputType = PROCESS_OUTPUT[receipt.process]!;
  const artifactAsset = receipt.artifact!;
  const spec: any = {
    assetIds: [artifactAsset.assetId],
    intent: `${item.name}. ${item.why}`.slice(0, 2000).padEnd(3, "."),
    outputType,
    widthMm: Math.round(p.width_mm),
    heightMm: Math.round(p.height_mm),
    quantity: a.quantity,
    material: p.material,
    permission: "authorized",
    crop: p.crop ?? "contain",
    recommendedMachineId: m.id,
    ...(outputType === "3d"
      ? {
          preparedModelId: receipt.id,
          depthMm: Number(p.model_size_mm?.[2] ?? p.depth_mm ?? 3.6),
          color: "Loaded single color",
          estimatedSeconds: jobSeconds(receipt, a.quantity),
        }
      : {}),
  };
  const job: Job = {
    id: id("job"),
    requesterId: order.requesterId,
    machineId: m.id,
    specVersion: 1,
    spec,
    artifact: {
      id: artifactAsset.assetId,
      url: `/assets/${artifactAsset.assetId}`,
      sha256: artifactAsset.sha256,
      previewUrl: receipt.preview.url,
    },
    productionState: a.chargeable ? "quoted" : "authorized",
    paymentState: a.chargeable ? "unpaid" : "not_charged",
    fulfillmentState: "unprepared",
    history: [],
    createdAt: at,
    updatedAt: at,
    version: 1,
    executionMode: a.executionMode,
    chargeable: a.chargeable,
    orderId: order.id,
    assignmentId: a.id,
    preparationId: receipt.id,
  };
  job.approvedSpecHash = specificationHash(job);
  job.quote = {
    id: id("quote"),
    version: 1,
    expiresAt: order.offer!.expiresAt,
    specHash: job.approvedSpecHash,
    items: a.price.terms.map((t) => ({ label: t.label, cents: t.cents })),
    totalCents: a.price.totalCents,
    ownerCents: a.price.ownerCents,
    platformCents: a.price.feeCents,
    currency: "USD",
    paymentMode: order.plan!.paymentMode,
    collectionPoint: m.collectionPoint,
    accepted: true,
  };
  record(
    job,
    "specified",
    `Created from plan version ${order.plan!.version}; the producer-prepared artifact ${artifactAsset.sha256.slice(0, 12)} is bound.`,
  );
  record(
    job,
    "specification_approved",
    "The requester confirmed this exact preview, machine and total with one make action.",
  );
  if (!a.chargeable)
    record(
      job,
      "authorized_without_payment",
      "Simulated work is estimate-only: no payment is collected and no pickup code is issued.",
    );
  else if (a.executionMode === "simulation")
    record(
      job,
      "simulated_paid",
      "Made on a simulated machine and paid in Base Sepolia test USDC like real work: the pickup code is issued once the owner stores the item.",
    );
  return job;
}

function orderView(o: Order, s: State, actor: Actor) {
  const engine = s.relief?.engine;
  const assignments = o.plan?.assignments.map((a) => {
    const j = a.childJobId ? s.jobs[a.childJobId] : undefined;
    const sim = a.simJobId ? engine?.jobs[a.simJobId] : undefined;
    return {
      ...a,
      child: j
        ? {
            id: j.id,
            productionState: j.productionState,
            paymentState: j.paymentState,
            fulfillmentState: j.fulfillmentState,
            pickupCode: actor.id === o.requesterId ? j.pickup?.code : undefined,
          }
        : undefined,
      sim: sim ? { status: sim.status, progress: sim.progress } : undefined,
    };
  });
  const { key: _key, ...makeIntent } = o.makeIntent ?? ({} as any);
  return {
    id: o.id,
    experience: o.experience,
    source: o.source ?? "web",
    requesterName: o.requesterName,
    status: o.status,
    version: o.version,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    draft: {
      revision: o.draft.revision,
      requestText: o.draft.requestText,
      photoAssetIds: o.draft.photoAssetIds,
      stage: o.draft.stage,
      reason: o.draft.reason,
      freeAt: o.draft.freeAt,
      headCount: o.draft.headCount,
    },
    intent: o.intent
      ? {
          provider: o.intent.provider,
          outcome: o.intent.outcome,
          question: o.intent.question,
        }
      : undefined,
    candidates: o.candidates,
    plan: o.plan && assignments ? { ...o.plan, assignments } : undefined,
    planHistory: o.planHistory,
    suggestions: o.suggestions,
    offer: o.offer,
    makeIntent: o.makeIntent ? makeIntent : undefined,
    delivery: o.delivery,
    events: o.events.slice(-60),
    nextSeq: o.nextSeq,
    counters:
      engine && o.experience === "relief" ? counters(engine) : undefined,
  };
}
export const randomKey = () => randomBytes(12).toString("hex");
