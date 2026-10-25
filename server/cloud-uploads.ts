import type { Express, Request } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { digest } from "./cloud-files.ts";
import { id, now, requireThat, type Asset } from "./model.ts";
import { mutate } from "./store.ts";
import type { Service } from "./service.ts";
import type { CloudProducer } from "./cloud-producer.ts";

export interface UploadTicket {
  ownerId: string;
  sha256: string;
  size: number;
  expiresAt: number;
  assetId?: string;
}

/** Large image bytes go directly to storage, avoiding Vercel's request body limit. */
export function registerCloudUploads(
  app: Express,
  service: Service,
  producer: CloudProducer,
  actor: (req: Request) => Promise<{ id: string; role: string }>,
) {
  app.post("/api/uploads/storage", async (req, res) => {
    const a = await actor(req);
    const body = z
      .object({
        files: z
          .array(
            z.object({
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              size: z
                .number()
                .int()
                .min(1)
                .max(12 * 1024 * 1024),
            }),
          )
          .min(1)
          .max(4),
      })
      .parse(req.body);
    const uploads = await Promise.all(
      body.files.map(async (file) => ({
        ticketId: id("upload"),
        url: await producer.files.uploadUrl(),
        ...file,
      })),
    );
    await mutate(service.store, (s) => {
      s.uploadTickets ??= {};
      for (const [key, ticket] of Object.entries(s.uploadTickets))
        if (ticket.expiresAt < Date.now()) delete s.uploadTickets[key];
      for (const u of uploads)
        s.uploadTickets[u.ticketId] = {
          ownerId: a.id,
          sha256: u.sha256,
          size: u.size,
          expiresAt: Date.now() + 15 * 60_000,
        };
    });
    res.json({ uploads });
  });
  app.post("/api/uploads/complete", async (req, res) => {
    const a = await actor(req);
    const { uploads } = z
      .object({
        uploads: z
          .array(z.object({ ticketId: z.string(), storageId: z.string() }))
          .min(1)
          .max(4),
      })
      .parse(req.body);
    const s = await service.read();
    const assets: Asset[] = [];
    for (const u of uploads) {
      const ticket = s.uploadTickets?.[u.ticketId];
      requireThat(
        ticket && ticket.ownerId === a.id && ticket.expiresAt >= Date.now(),
        "UPLOAD_EXPIRED",
        "Start this upload again from your session.",
        403,
      );
      if (ticket.assetId) {
        assets.push(s.assets[ticket.assetId]);
        continue;
      }
      const bytes = await producer.files.download(u.storageId);
      requireThat(
        bytes.length === ticket.size && digest(bytes) === ticket.sha256,
        "UPLOAD_MISMATCH",
        "Uploaded bytes do not match the selected picture.",
        422,
      );
      const assetId = `asset_${u.ticketId}`,
        path = join(service.config.dataDir, "assets", assetId);
      await mkdir(join(service.config.dataDir, "assets"), { recursive: true });
      await writeFile(path, bytes);
      const dimensions = await producer.rpc("inspect", { path }, [path]);
      assets.push({
        id: assetId,
        path,
        ownerId: a.id,
        url: `/assets/${assetId}`,
        storageId: u.storageId,
        sha256: ticket.sha256,
        mime: dimensions.mime,
        width: dimensions.width,
        height: dimensions.height,
        createdAt: now(),
      });
    }
    await mutate(service.store, (current) => {
      for (const [index, u] of uploads.entries()) {
        const ticket = current.uploadTickets?.[u.ticketId];
        requireThat(
          ticket?.ownerId === a.id && ticket.expiresAt >= Date.now(),
          "UPLOAD_EXPIRED",
          "Upload expired.",
          403,
        );
        current.assets[assets[index].id] = assets[index];
        ticket.assetId = assets[index].id;
      }
    });
    res.status(201).json({
      assets: assets.map(
        ({ path, ownerId, storageId, ...publicAsset }) => publicAsset,
      ),
    });
  });
}
