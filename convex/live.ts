import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkSecret } from "./publish";

/* Live queries every screen subscribes to. All read-only and public. */

export const machines = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("machines").collect();
    return rows.sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.machineId.localeCompare(b.machineId),
    );
  },
});

export const order = query({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .unique();
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .collect();
    const events = await ctx.db
      .query("events")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .order("desc")
      .take(30);
    return { plan, jobs, events };
  },
});

export const recentEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    ctx.db
      .query("events")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 30, 1), 100)),
});

/** Counters for the live view: machines online, jobs running, items done. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const machines = await ctx.db.query("machines").collect();
    const jobs = await ctx.db.query("jobs").collect();
    return {
      machinesOnline: machines.filter((m) => m.status !== "offline").length,
      machines: machines.length,
      processes: new Set(machines.map((m) => m.process)).size,
      jobsRunning: jobs.filter((j) => j.hubState === "running" || j.state === "running").length,
      jobsDone: jobs.filter((j) => j.state === "done" || j.hubState === "done").length,
    };
  },
});

/** /demo/reset: clears the read model; the hubs republish what is live. */
export const reset = mutation({
  args: { secret: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    let more = false;
    for (const table of ["events", "jobs", "plans", "machines"] as const) {
      const rows = await ctx.db.query(table).take(1000);
      for (const r of rows) await ctx.db.delete(r._id);
      more ||= rows.length === 1000;
    }
    return more;
  },
});
