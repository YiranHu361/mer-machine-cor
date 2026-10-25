import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { checkSecret } from "./publish";

/*
 * The app's authoritative state when FABYN_STORE=convex (server/convex-store.ts).
 * The server keeps one JSON document, split into chunks below Convex's 1 MiB
 * document limit. A write replaces every chunk and bumps the version inside one
 * mutation, so a write against a stale version is refused atomically
 * (compare-and-set). Every function needs the hub secret: the state holds
 * sessions and pickup codes, so no browser may read it.
 */
const KEY = "app";

async function head(ctx: QueryCtx) {
  return ctx.db
    .query("app_state")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
}

/** The current version only: what the server's subscription watches. */
export const version = query({
  args: { secret: v.string() },
  returns: v.number(),
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    return (await head(ctx))?.version ?? 0;
  },
});

export const read = query({
  args: { secret: v.string() },
  returns: v.union(
    v.null(),
    v.object({ version: v.number(), chunks: v.array(v.string()) }),
  ),
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    const h = await head(ctx);
    if (!h) return null;
    const rows = await ctx.db
      .query("app_state_chunks")
      .withIndex("by_key_index", (q) => q.eq("key", KEY))
      .collect();
    if (rows.length !== h.chunks)
      throw new Error(
        `STATE_CHUNKS: expected ${h.chunks} chunks, found ${rows.length}.`,
      );
    return { version: h.version, chunks: rows.map((r) => r.data) };
  },
});

export const compareAndSet = mutation({
  args: {
    secret: v.string(),
    expectedVersion: v.number(),
    chunks: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { secret, expectedVersion, chunks }) => {
    checkSecret(secret);
    const h = await head(ctx);
    if ((h?.version ?? 0) !== expectedVersion) return false;
    const old = await ctx.db
      .query("app_state_chunks")
      .withIndex("by_key_index", (q) => q.eq("key", KEY))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);
    for (const [index, data] of chunks.entries())
      await ctx.db.insert("app_state_chunks", { key: KEY, index, data });
    if (h)
      await ctx.db.patch(h._id, {
        version: h.version + 1,
        chunks: chunks.length,
      });
    else
      await ctx.db.insert("app_state", {
        key: KEY,
        version: 1,
        chunks: chunks.length,
      });
    return true;
  },
});
