import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkSecret } from "./publish";

export const uploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    return ctx.storage.generateUploadUrl();
  },
});
export const url = query({
  args: { secret: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { secret, storageId }) => {
    checkSecret(secret);
    return ctx.storage.getUrl(storageId);
  },
});
