import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { now, type Job, type Machine, type State } from "./model.ts";
import type { Store } from "./store.ts";
import type { Order } from "./orchestration/types.ts";
import { PROCESS_OUTPUT } from "./orchestration/matching.ts";

/**
 * publish(type, data) into Convex, the live read model every screen watches
 * (design doc, "Convex live state"). Events are §5 envelopes, batched into one
 * publish:batch mutation. Convex is never on the order path: a failed send is
 * kept for a retry and logged once, and nothing here throws into the app.
 */
export interface Publisher {
  publish(type: string, data: Record<string, unknown>): void;
  flush(): Promise<void>;
}
type Send = (
  events: { type: string; ts: string; data: unknown }[],
) => Promise<unknown>;

export class ConvexPublisher implements Publisher {
  private queue: { type: string; ts: string; data: unknown }[] = [];
  private timer: NodeJS.Timeout | undefined;
  private sending: Promise<void> | undefined;
  private failing = false;
  constructor(
    private readonly send: Send,
    private readonly options: { delayMs?: number; maxQueue?: number } = {},
  ) {}
  static connect(url: string, secret: string) {
    const client = new ConvexHttpClient(url);
    return new ConvexPublisher((events) =>
      client.mutation(anyApi.publish.batch, {
        secret,
        source: "consumer",
        events,
      }),
    );
  }
  publish(type: string, data: Record<string, unknown>) {
    this.queue.push({ type, ts: now(), data });
    const max = this.options.maxQueue ?? 2000;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.delayMs ?? 200);
  }
  async flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.queue.length) {
        const batch = this.queue.slice(0, 100);
        try {
          await this.send(batch);
        } catch (error) {
          if (!this.failing)
            console.warn(
              `Convex publish failed; the live view is stale until it recovers. Orders continue. ${(error as Error).message}`,
            );
          this.failing = true;
          this.timer ??= setTimeout(() => {
            this.timer = undefined;
            void this.flush();
          }, 5000);
          return;
        }
        if (this.failing) console.warn("Convex publish recovered.");
        this.failing = false;
        this.queue.splice(0, batch.length);
      }
    })().finally(() => (this.sending = undefined));
    return this.sending;
  }
  close() {
    clearTimeout(this.timer);
  }
}

const OUTPUT_PROCESS = Object.fromEntries(
  Object.entries(PROCESS_OUTPUT).map(([process, output]) => [output, process]),
) as Record<Machine["outputType"], string>;

/** §2 manifest with live status, for one of our registry machines. */
export function machineEvent(m: Machine) {
  return {
    machine_id: m.id,
    process: OUTPUT_PROCESS[m.outputType] ?? m.outputType,
    display_name: m.name,
    model: m.model,
    simulated: m.mode === "simulation",
    status: m.paused
      ? "paused"
      : !m.listed || !m.ready
        ? "not_ready"
        : m.activeJobId
          ? "busy"
          : "idle",
    reason: m.reason,
    media_loaded: { remaining_est: m.mediaRemaining },
    ...(m.producerHub ? { linked_machine_id: m.producerHub.machineId } : {}),
  };
}

/** Our job states in the §4 vocabulary. */
export function jobState(j: Job) {
  if (["ready_for_pickup", "collected"].includes(j.fulfillmentState))
    return "done";
  switch (j.productionState) {
    case "dispatched":
      return "offered";
    case "running":
      return "running";
    case "verifying":
      return "running";
    case "needs_review":
      return "needs_review";
    case "produced":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

/** §4 job, without requester ids, pickup codes or signed file links. */
export function jobEvent(j: Job, order?: Order) {
  const assignment = order?.plan?.assignments.find(
    (a) => a.childJobId === j.id,
  );
  return {
    job_id: j.id,
    order_id: j.orderId,
    item_id: assignment?.itemId,
    machine_id: j.machineId ?? undefined,
    process: OUTPUT_PROCESS[j.spec.outputType],
    simulated: (j.executionMode ?? "simulation") === "simulation",
    state: jobState(j),
    production_state: j.productionState,
    payment_state: j.paymentState,
    fulfillment_state: j.fulfillmentState,
  };
}

/** §3 plan for one order. */
export function planEvent(o: Order) {
  const plan = o.plan;
  return {
    order_id: o.id,
    mode: o.experience,
    title: o.intent?.outcome ?? (o.draft.requestText || "Order"),
    request_text: o.draft.requestText,
    stage: o.draft.stage,
    status: o.status,
    version: plan?.version,
    payable_cents: plan?.payableCents,
    simulated_estimate_cents: plan?.simulatedEstimateCents,
    payment_mode: plan?.paymentMode,
    payment: { status: o.makeIntent?.payment.status },
    ready_estimate_minutes: plan?.readyEstimateMinutes,
    items: (plan?.items ?? []).map((i) => ({
      item_id: i.id,
      name: i.name,
      process: i.process,
      quantity: i.quantity,
    })),
    assignments: (plan?.assignments ?? []).map((a) => ({
      item_id: a.itemId,
      machine_id: a.machineId,
      machine_name: a.machineName,
      simulated: a.executionMode === "simulation",
      quantity: a.quantity,
      job_id: a.childJobId ?? a.simJobId,
      total_cents: a.price.totalCents,
    })),
  };
}

/**
 * Mirrors saved state into Convex: after each committed change, publishes the
 * machines, plans and jobs whose projection changed since the last send. One
 * read per burst of writes; heartbeats never reach this path.
 */
export function mirrorState(
  store: Store,
  publisher: Publisher,
  options: { debounceMs?: number } = {},
) {
  const sent = new Map<string, string>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  const emit = (key: string, type: string, data: Record<string, unknown>) => {
    const body = JSON.stringify(data);
    if (sent.get(key) === body) return;
    sent.set(key, body);
    publisher.publish(type, data);
  };
  const sync = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const s: State = (await store.read()).data;
      for (const m of Object.values(s.machines))
        emit(`machine:${m.id}`, "machine.updated", machineEvent(m));
      const orders = s.orders ?? {};
      for (const o of Object.values(orders)) {
        const before = sent.get(`plan:${o.id}`);
        const data = planEvent(o);
        const prevVersion = before ? JSON.parse(before).version : undefined;
        const type =
          prevVersion &&
          data.version &&
          data.version > prevVersion &&
          o.makeIntent
            ? "plan.replanned"
            : ["proposed", "approved"].includes(o.status)
              ? `plan.${o.status}`
              : "plan.updated";
        emit(`plan:${o.id}`, type, data);
      }
      for (const j of Object.values(s.jobs)) {
        if (!j.orderId) continue;
        const data = jobEvent(j, orders[j.orderId]);
        emit(
          `job:${j.id}`,
          data.state === "done"
            ? "job.done"
            : data.state === "failed"
              ? "job.failed"
              : "job.updated",
          data,
        );
      }
    } catch (error) {
      console.warn(`Convex mirror skipped a sync: ${(error as Error).message}`);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      void sync();
    }, options.debounceMs ?? 250);
  };
  const unsubscribe = store.subscribe(schedule);
  schedule();
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}

/** The deployment URL: CONVEX_URL, or the name inside a dev/prod deploy key. */
export function convexUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.CONVEX_URL) return env.CONVEX_URL;
  const name = /^(?:dev|prod):([a-z0-9-]+)\|/.exec(
    env.CONVEX_DEPLOY_KEY ?? "",
  )?.[1];
  return name ? `https://${name}.convex.cloud` : undefined;
}
