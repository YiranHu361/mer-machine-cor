import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Asset } from "./model.ts";
const entry = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    name: z.string().min(3).max(100),
    reviewed: z.literal(true),
    file: z.string(),
    previewFile: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    widthMm: z.number().int().positive().max(180),
    heightMm: z.number().int().positive().max(180),
    depthMm: z.number().positive().max(180),
    material: z.literal("pla"),
    color: z.string().trim().min(1).max(60),
    estimatedSeconds: z.number().int().min(1).max(3600),
  })
  .strict();
export async function loadCatalog(path: string | undefined, dataDir: string) {
  if (!path) return { models: [], assets: [] as Asset[] };
  const entries = z
    .array(entry)
    .max(20)
    .refine(
      (entries) =>
        new Set(entries.map((model) => model.id)).size === entries.length,
      "Prepared catalog model IDs must be unique.",
    )
    .parse(JSON.parse(await readFile(path, "utf8")));
  const models: any[] = [],
    assets: Asset[] = [];
  await mkdir(join(dataDir, "assets"), { recursive: true });
  for (const m of entries) {
    if (extname(m.file).toLowerCase() !== ".3mf")
      throw new Error("Prepared catalog accepts inspected .3mf files only.");
    const bytes = await readFile(resolve(m.file));
    if (
      bytes.length > 50 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== m.sha256 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b
    )
      throw new Error(
        "Prepared 3MF file size, archive signature or reviewed hash mismatch.",
      );
    const preview = await readFile(resolve(m.previewFile));
    if (
      !preview
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Prepared model preview must be an inspected PNG.");
    const artifactId = `catalog_${m.id}_${m.sha256.slice(0, 12)}`,
      previewId = `catalog_preview_${m.id}_${createHash("sha256").update(preview).digest("hex").slice(0, 12)}`;
    for (const [assetId, b, mime] of [
      [artifactId, bytes, "model/3mf"],
      [previewId, preview, "image/png"],
    ] as const) {
      const dest = join(dataDir, "assets", assetId);
      await writeFile(dest, b);
      assets.push({
        id: assetId,
        ownerId: "catalog",
        path: dest,
        url: `/assets/${assetId}`,
        sha256: createHash("sha256").update(b).digest("hex"),
        mime,
        width: m.widthMm,
        height: m.heightMm,
        createdAt: new Date().toISOString(),
      });
    }
    const { file, previewFile, ...publicModel } = m;
    models.push({
      ...publicModel,
      artifactId,
      previewUrl: `/assets/${previewId}`,
      artifact: {
        id: artifactId,
        url: `/assets/${artifactId}`,
        sha256: m.sha256,
        previewUrl: `/assets/${previewId}`,
      },
    });
  }
  return { models, assets };
}
