import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/*
 * The one write path into Convex: each hub's publish(type, data) batches §5
 * events ({type, ts, data}) into this mutation, which applies them to the
 * tables in order inside one transaction. Browsers only read.
 */
type Data = Record<string, any>;
type Source = "consumer" | "producer";

export function checkSecret(secret: string) {
  const expected = process.env.FABRARY_PUBLISH_SECRET;
  if (!expected)
    throw new Error(
      "FABRARY_PUBLISH_SECRET is not set on this Convex deployment; run npm run convex:push.",
    );
  if (secret !== expected) throw new Error("Not a Fabrary hub.");
}

export const batch = mutation({
  args: {
    secret: v.string(),
    source: v.union(v.literal("consumer"), v.literal("producer")),
    events: v.array(v.object({ type: v.string(), ts: v.string(), data: v.any() })),
  },
  returns: v.number(),
  handler: async (ctx, { secret, source, events }) => {
    checkSecret(secret);
    for (const e of events) await apply(ctx, source, e.type, e.ts, e.data ?? {});
    return events.length;
  },
});

async function apply(ctx: MutationCtx, source: Source, type: string, ts: string, d: Data) {
  if (type.startsWith("machine.")) return machine(ctx, source, type, ts, d);
  if (type.startsWith("plan.")) return plan(ctx, type, ts, d);
  if (type.startsWith("job.")) return job(ctx, source, type, ts, d);
  await log(ctx, { type, ts, source, summary: str(d.summary) ?? type });
}

async function log(
  ctx: MutationCtx,
  e: {
    type: string;
    ts: string;
    source: string;
    summary: string;
    orderId?: string;
    machineId?: string;
    jobId?: string;
  },
) {
  await ctx.db.insert("events", e);
}

async function machine(ctx: MutationCtx, source: Source, type: string, ts: string, d: Data) {
  const machineId = str(d.machine_id);
  if (!machineId) return;
  const existing = await ctx.db
    .query("machines")
    .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
    .unique();
  const status = type === "machine.offline" ? "offline" : (str(d.status) ?? existing?.status ?? "idle");
  const location = d.location;
  const row = {
    machineId,
    source,
    process: str(d.process) ?? existing?.process ?? "unknown",
    displayName: str(d.display_name) ?? existing?.displayName ?? machineId,
    model: str(d.model) ?? existing?.model,
    simulated: typeof d.simulated === "boolean" ? d.simulated : (existing?.simulated ?? false),
    status,
    reason: str(d.reason) ?? (type === "machine.offline" ? undefined : existing?.reason),
    mediaRemaining: num(d.media_loaded?.remaining_est) ?? existing?.mediaRemaining,
    location:
      location && num(location.lat) !== undefined && num(location.lng) !== undefined
        ? { lat: location.lat, lng: location.lng, label: str(location.label) ?? "" }
        : existing?.location,
    linkedMachineId: str(d.linked_machine_id) ?? existing?.linkedMachineId,
    updatedAt: ts,
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("machines", row);
  if (!existing || existing.status !== status)
    await log(ctx, {
      type,
      ts,
      source,
      machineId,
      summary: `${row.displayName}: ${status.replaceAll("_", " ")}${row.reason && status === "offline" ? ` (${row.reason})` : ""}`,
    });
}

async function plan(ctx: MutationCtx, type: string, ts: string, d: Data) {
  const orderId = str(d.order_id);
  if (!orderId) return;
  const existing = await ctx.db
    .query("plans")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .unique();
  const row = {
    orderId,
    mode: str(d.mode) ?? "best_single",
    title: str(d.title) ?? "Order",
    requestText: str(d.request_text) ?? "",
    stage: str(d.stage) ?? "created",
    status: str(d.status) ?? "preparing",
    version: num(d.version),
    payableCents: num(d.payable_cents),
    simulatedEstimateCents: num(d.simulated_estimate_cents),
    paymentMode: str(d.payment_mode),
    paymentStatus: str(d.payment?.status),
    readyEstimateMinutes: num(d.ready_estimate_minutes),
    items: (Array.isArray(d.items) ? d.items : []).map((i: Data) => ({
      itemId: String(i.item_id),
      name: String(i.name),
      process: String(i.process),
      quantity: Number(i.quantity),
    })),
    assignments: (Array.isArray(d.assignments) ? d.assignments : []).map((a: Data) => ({
      itemId: String(a.item_id),
      machineId: String(a.machine_id),
      machineName: String(a.machine_name),
      simulated: !!a.simulated,
      quantity: Number(a.quantity),
      jobId: str(a.job_id),
      totalCents: Number(a.total_cents ?? 0),
    })),
    updatedAt: ts,
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("plans", row);
  if (!existing || existing.stage !== row.stage || existing.status !== row.status)
    await log(ctx, {
      type,
      ts,
      source: "consumer",
      orderId,
      summary: `${row.title.replace(/[.!?]+$/, "")}: ${row.status === "preparing" ? row.stage.replaceAll("_", " ") : row.status.replaceAll("_", " ")}`,
    });
}

async function job(ctx: MutationCtx, source: Source, type: string, ts: string, d: Data) {
  // A producer report names our job in params.fabrary_job_id; its own job_id
  // is the hub's. Anything else is keyed by its own job_id.
  const ours = str(d.params?.fabrary_job_id);
  const fromHub = source === "producer";
  const jobId = fromHub ? (ours ?? str(d.job_id)) : str(d.job_id);
  if (!jobId) return;
  const existing = await ctx.db
    .query("jobs")
    .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
    .unique();
  const patch: Data = fromHub
    ? {
        hubJobId: str(d.job_id),
        producerMachineId: str(d.machine_id),
        hubState: str(d.state),
        progress: num(d.progress),
        etaS: num(d.eta_s),
        reason: str(d.error) ?? str(d.reason),
        verification:
          d.verification && typeof d.verification === "object"
            ? {
                pass: typeof d.verification.pass === "boolean" ? d.verification.pass : null,
                reason: str(d.verification.reason),
              }
            : undefined,
      }
    : {
        orderId: str(d.order_id),
        itemId: str(d.item_id),
        machineId: str(d.machine_id),
        process: str(d.process),
        simulated: typeof d.simulated === "boolean" ? d.simulated : undefined,
        state: str(d.state),
        productionState: str(d.production_state),
        paymentState: str(d.payment_state),
        fulfillmentState: str(d.fulfillment_state),
      };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  if (existing) await ctx.db.patch(existing._id, { ...patch, updatedAt: ts });
  else await ctx.db.insert("jobs", { jobId, ...patch, updatedAt: ts });
  const before = fromHub ? existing?.hubState : existing?.state;
  const after = fromHub ? patch.hubState : patch.state;
  if (after && after !== before)
    await log(ctx, {
      type,
      ts,
      source,
      jobId,
      orderId: existing?.orderId ?? patch.orderId,
      machineId: fromHub ? patch.producerMachineId : patch.machineId,
      summary: fromHub
        ? `${patch.producerMachineId ?? "machine"}: ${after}${patch.reason ? ` (${patch.reason})` : ""}`
        : `Job ${after.replaceAll("_", " ")}`,
    });
}

const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
