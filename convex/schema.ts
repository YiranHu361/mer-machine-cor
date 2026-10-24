import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/*
 * Convex is the live read model every screen watches (design doc, "Convex live
 * state"). The hubs are the only writers, through publish:batch; the app's own
 * store and the producer gateway stay authoritative, so a Convex outage never
 * stops an order or a print. Rows mirror the shared contracts §2–§4.
 *
 * Nothing here is secret: no requester ids, pickup codes, signed asset links or
 * owner credentials are ever published.
 */
export default defineSchema({
  // §2 machine manifest with live status. Our registry machines (source
  // "consumer") and the producer gateway's nodes (source "producer") both
  // appear; linkedMachineId ties a registry machine to the node that prints it.
  machines: defineTable({
    machineId: v.string(),
    source: v.union(v.literal("consumer"), v.literal("producer")),
    process: v.string(),
    displayName: v.string(),
    model: v.optional(v.string()),
    simulated: v.boolean(),
    status: v.string(),
    reason: v.optional(v.string()),
    mediaRemaining: v.optional(v.number()),
    location: v.optional(
      v.object({ lat: v.number(), lng: v.number(), label: v.string() }),
    ),
    linkedMachineId: v.optional(v.string()),
    updatedAt: v.string(),
  }).index("by_machineId", ["machineId"]),

  // §3 plan: one row per order, replaced on every change.
  plans: defineTable({
    orderId: v.string(),
    mode: v.string(),
    title: v.string(),
    requestText: v.string(),
    stage: v.string(),
    status: v.string(),
    version: v.optional(v.number()),
    payableCents: v.optional(v.number()),
    simulatedEstimateCents: v.optional(v.number()),
    paymentMode: v.optional(v.string()),
    paymentStatus: v.optional(v.string()),
    readyEstimateMinutes: v.optional(v.number()),
    items: v.array(
      v.object({
        itemId: v.string(),
        name: v.string(),
        process: v.string(),
        quantity: v.number(),
      }),
    ),
    assignments: v.array(
      v.object({
        itemId: v.string(),
        machineId: v.string(),
        machineName: v.string(),
        simulated: v.boolean(),
        quantity: v.number(),
        jobId: v.optional(v.string()),
        totalCents: v.number(),
      }),
    ),
    updatedAt: v.string(),
  }).index("by_orderId", ["orderId"]),

  // §4 job. The two writers own separate fields so neither can roll the other
  // back: the consumer writes the order-side states (state, production,
  // payment, fulfillment); the producer gateway writes what the node reports
  // (hubJobId, hubState, progress, verification).
  jobs: defineTable({
    jobId: v.string(),
    orderId: v.optional(v.string()),
    itemId: v.optional(v.string()),
    machineId: v.optional(v.string()),
    process: v.optional(v.string()),
    simulated: v.optional(v.boolean()),
    state: v.optional(v.string()),
    productionState: v.optional(v.string()),
    paymentState: v.optional(v.string()),
    fulfillmentState: v.optional(v.string()),
    hubJobId: v.optional(v.string()),
    producerMachineId: v.optional(v.string()),
    hubState: v.optional(v.string()),
    progress: v.optional(v.number()),
    etaS: v.optional(v.number()),
    reason: v.optional(v.string()),
    verification: v.optional(
      v.object({
        pass: v.union(v.boolean(), v.null()),
        reason: v.optional(v.string()),
      }),
    ),
    updatedAt: v.string(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_orderId", ["orderId"])
    .index("by_hubJobId", ["hubJobId"]),

  // Append-only §5 event log for tickers and order timelines.
  events: defineTable({
    type: v.string(),
    ts: v.string(),
    source: v.string(),
    summary: v.string(),
    orderId: v.optional(v.string()),
    machineId: v.optional(v.string()),
    jobId: v.optional(v.string()),
  })
    .index("by_orderId", ["orderId"])
    .index("by_jobId", ["jobId"]),
});
