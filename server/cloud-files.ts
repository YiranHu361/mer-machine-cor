import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { Store } from "./store.ts";
import type { State } from "./model.ts";

export const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export interface FileStorage {
  upload(bytes: Buffer, mime?: string): Promise<string>;
  download(storageId: string): Promise<Buffer>;
  url(storageId: string): Promise<string>;
  uploadUrl(): Promise<string>;
  signedUrl?(storageId: string, mime: string): string;
}

/** Only the backend has the Convex secret. Producers receive short-lived upload URLs. */
export class ConvexFiles implements FileStorage {
  private client: ConvexHttpClient;
  constructor(
    private deploymentUrl: string,
    private secret: string,
  ) {
    this.client = new ConvexHttpClient(deploymentUrl);
  }
  signedUrl(storageId: string, mime: string) {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const sig = createHmac("sha256", this.secret)
      .update(`${storageId}:${expires}:${mime}`)
      .digest("hex");
    const origin =
      process.env.CONVEX_SITE_URL ??
      this.deploymentUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
    return `${origin}/file?${new URLSearchParams({ id: storageId, expires: String(expires), mime, sig })}`;
  }
  uploadUrl(): Promise<string> {
    return this.client.mutation(anyApi.files.uploadUrl, {
      secret: this.secret,
    });
  }
  async upload(bytes: Buffer, mime = "application/octet-stream") {
    const response = await fetch(await this.uploadUrl(), {
      method: "POST",
      headers: { "content-type": mime },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("Cloud file upload failed");
    return (await response.json()).storageId as string;
  }
  async url(storageId: string): Promise<string> {
    const url = await this.client.query(anyApi.files.url, {
      secret: this.secret,
      storageId,
    });
    if (!url) throw new Error("Cloud file is missing");
    return url;
  }
  async download(storageId: string) {
    const response = await fetch(await this.url(storageId), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("Cloud file download failed");
    return Buffer.from(await response.arrayBuffer());
  }
}

/** Disk is a disposable cache; bytes are uploaded before their state reference commits. */
export class CloudFileStore implements Store {
  private downloads = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    readonly files: FileStorage,
    private dataDir: string,
  ) {}
  async read() {
    const snapshot = await this.store.read();
    await Promise.all(
      Object.values(snapshot.data.assets).map(async (asset) => {
        if (!asset.storageId)
          throw new Error(`Asset ${asset.id} needs migration to cloud storage`);
        const path = join(this.dataDir, "assets", asset.id);
        asset.path = path;
        try {
          if (digest(await readFile(path)) === asset.sha256) return;
        } catch {}
        let download = this.downloads.get(asset.id);
        if (!download) {
          download = (async () => {
            const bytes = await this.files.download(asset.storageId!);
            if (digest(bytes) !== asset.sha256)
              throw new Error("Cloud artwork checksum mismatch");
            await mkdir(dirname(path), { recursive: true });
            const temp = `${path}.${crypto.randomUUID()}.tmp`;
            await writeFile(temp, bytes);
            await rename(temp, path);
          })().finally(() => this.downloads.delete(asset.id));
          this.downloads.set(asset.id, download);
        }
        await download;
      }),
    );
    return snapshot;
  }
  async compareAndSet(version: number, data: State) {
    for (const asset of Object.values(data.assets)) {
      if (asset.storageId) continue;
      const bytes = await readFile(asset.path);
      if (digest(bytes) !== asset.sha256)
        throw new Error("Artwork changed before upload");
      asset.storageId = await this.files.upload(bytes, asset.mime);
    }
    return this.store.compareAndSet(version, data);
  }
  subscribe(fn: () => void) {
    return this.store.subscribe(fn);
  }
  close() {
    return this.store.close();
  }
}
