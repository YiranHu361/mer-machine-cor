import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();
// Large private images bypass Vercel's response limit, with the same bounded access window.
http.route({
  path: "/file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "",
      expires = Number(params.get("expires"));
    const mime = params.get("mime") ?? "application/octet-stream",
      sig = params.get("sig") ?? "";
    const now = Date.now() / 1000,
      secret = process.env.FABYN_PUBLISH_SECRET;
    if (
      !secret ||
      !Number.isFinite(expires) ||
      expires < now ||
      expires > now + 600 ||
      !/^[a-f0-9]{64}$/.test(sig)
    )
      return new Response("Unauthorized", { status: 401 });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(sig.match(/../g)!, (v) => parseInt(v, 16)),
      new TextEncoder().encode(`${id}:${expires}:${mime}`),
    );
    if (!valid) return new Response("Unauthorized", { status: 401 });
    let blob: Blob | null;
    try {
      blob = await ctx.storage.get(id as Id<"_storage">);
    } catch {
      blob = null;
    }
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});
export default http;
