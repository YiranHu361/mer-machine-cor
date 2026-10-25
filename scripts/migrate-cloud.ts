import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { ConvexFiles, digest } from "../server/cloud-files.ts";
import type { State } from "../server/model.ts";
import { splitChunks } from "../server/convex-store.ts";

// Explicit --write is required. Never overwrite a different populated deployment.
const sourceMode = process.env.FABYN_STORE ?? "sqlite-development";
const sourceUrl = process.env.CONVEX_URL;
const sourceSecret = process.env.FABYN_PUBLISH_SECRET ?? "";
let state: State, version: number;
if (sourceMode === "convex") {
  if (!sourceUrl || !sourceSecret)
    throw new Error("Source Convex URL and publish secret are required.");
  const source = await new ConvexHttpClient(sourceUrl).query(
    anyApi.state.read,
    { secret: sourceSecret },
  );
  if (!source) throw new Error("Source store is empty.");
  state = JSON.parse(source.chunks.join(""));
  version = source.version;
} else if (sourceMode === "sqlite-development") {
  const db = new DatabaseSync(
    join(resolve(process.env.FABYN_DATA_DIR ?? ".data"), "app.sqlite"),
    { readOnly: true },
  );
  const row = db
    .prepare("SELECT version,data FROM app_state WHERE id=1")
    .get() as { version: number; data: string };
  if (!row) throw new Error("Source store is empty.");
  state = JSON.parse(row.data);
  version = row.version;
  db.close();
} else
  throw new Error("Migrate from Convex or SQLite; export other stores first.");
const assets = Object.values(state.assets);
console.log(
  `Source: ${sourceMode}; ${assets.length} assets, ${Object.keys(state.jobs).length} jobs. No credentials are displayed.`,
);
if (!process.argv.includes("--write")) {
  console.log(
    "Dry run only. Stop the old app, finish/reconcile active jobs, set FABYN_CLOUD_CONVEX_URL and FABYN_CLOUD_PUBLISH_SECRET, then run with --write.",
  );
  process.exit(0);
}
if (
  Object.values(state.jobs).some((j) =>
    ["dispatched", "running", "verifying", "needs_review"].includes(
      j.productionState,
    ),
  ) ||
  Object.values(state.operations).some((o) =>
    ["submitting", "pending"].includes(o.status),
  )
)
  throw new Error(
    "Finish or reconcile physical jobs and pending payments before migration.",
  );
const targetUrl = process.env.FABYN_CLOUD_CONVEX_URL ?? sourceUrl;
const targetSecret = process.env.FABYN_CLOUD_PUBLISH_SECRET ?? sourceSecret;
if (!targetUrl || !targetSecret)
  throw new Error("Target Convex URL and publish secret are required.");
const target = new ConvexHttpClient(targetUrl);
const existing = await target.query(anyApi.state.read, {
  secret: targetSecret,
});
const same = sourceMode === "convex" && targetUrl === sourceUrl;
if (!same && existing) {
  const current: State = JSON.parse(existing.chunks.join(""));
  if (
    Object.keys(current.assets).length ||
    Object.keys(current.jobs).length ||
    Object.keys(current.sessions).length ||
    Object.keys(current.orders ?? {}).length
  )
    throw new Error(
      "Refusing to overwrite a populated target. Use a new Convex deployment.",
    );
}
if (same && existing?.version !== version)
  throw new Error("The source changed. Stop its writers before migrating.");
const files = new ConvexFiles(targetUrl, targetSecret);
for (const asset of assets) {
  if (same && asset.storageId) continue;
  const bytes = await readFile(asset.path);
  if (digest(bytes) !== asset.sha256)
    throw new Error(`Asset ${asset.id} checksum mismatch; migration stopped.`);
  asset.storageId = await files.upload(bytes, asset.mime);
}
// Existing loopback/connector routes must be explicitly linked to the new producer by the owner.
for (const machine of Object.values(state.machines)) {
  machine.ready = false;
  machine.paused = true;
  delete machine.connectorId;
  delete machine.nodeUrl;
  delete machine.producerHub;
  machine.reason = "Link the tested local producer before accepting orders.";
}
delete state.producer;
const ok = await target.mutation(anyApi.state.compareAndSet, {
  secret: targetSecret,
  expectedVersion: existing?.version ?? 0,
  chunks: splitChunks(JSON.stringify(state)),
});
if (!ok)
  throw new Error(
    "Target changed during migration; no state was overwritten. Inspect it before retrying.",
  );
console.log(
  `Migrated ${assets.length} assets and saved state. Link the three printers in the workshop Connections panel.`,
);
