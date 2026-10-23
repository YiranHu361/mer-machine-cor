import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadCatalog } from "../server/catalog.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, parameters } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
test("reviewed catalog binds full3D specification and rejects changed artifacts or characteristics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fabrary-catalog-"));
  let store: SqliteStore | undefined;
  try {
    // Opaque software-only archive fixture; this never runs an adapter or qualifies
    // as a sliced/physical Bambu result. The checks target reviewed byte integrity.
    const bytes = Buffer.from(
      "PK\x03\x04software-only-catalog-integrity-fixture",
    );
    const file = join(dir, "fixture.3mf"),
      previewFile = join(dir, "preview.png");
    await writeFile(file, bytes);
    await writeFile(
      previewFile,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const entry = {
      id: "software_fixture",
      name: "Software integrity fixture",
      reviewed: true,
      file,
      previewFile,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      widthMm: 30,
      heightMm: 30,
      depthMm: 5,
      material: "pla",
      color: "blue",
      estimatedSeconds: 180,
    };
    const path = join(dir, "catalog.json");
    await writeFile(path, JSON.stringify([entry]));
    const { models, assets } = await loadCatalog(path, dir);
    const model = models[0];
    assert.equal(model.artifact.sha256, entry.sha256);
    assert.match(model.artifact.previewUrl, /catalog_preview_/);
    assert.equal(model.file, undefined);
    store = new SqliteStore(join(dir, "app.sqlite"), initialState());
    await mutate(store, (s) => {
      for (const asset of assets) s.assets[asset.id] = asset;
      Object.assign(s.machines.bambu_01, {
        calibrated: true,
        ready: true,
        paused: false,
        listed: true,
      });
    });
    const cfg: Config = {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "fixture-secret",
      quoteMs: 120000,
      pickupMs: 1000,
      ownerCode: "fixture-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
      catalog: models,
    };
    const service = new Service(
      store,
      {
        async call() {
          throw new Error("This test must not execute any device");
        },
        token() {
          throw new Error("This test must not issue execution tokens");
        },
      },
      new MockPayment(),
      cfg,
    );
    const spec = {
      assetIds: [model.artifactId],
      intent: "Reviewed catalog software fixture",
      outputType: "3d",
      widthMm: 30,
      heightMm: 30,
      depthMm: 5,
      material: "pla",
      color: "blue",
      estimatedSeconds: 180,
      quantity: 1,
      permission: "authorized",
      crop: "contain",
      preparedModelId: model.id,
    };
    const j = await service.create("requester", spec, model.artifact);
    assert.equal(parameters(j).depthMm, 5);
    assert.equal(parameters(j).color, "blue");
    assert.equal(parameters(j).estimatedSeconds, 180);
    await service.approve(j.id, {
      specVersion: 1,
      artifactSha256: entry.sha256,
    });
    assert.equal((await service.quote(j.id)).machineId, "bambu_01");
    await assert.rejects(
      service.revise(j.id, { ...spec, color: "red" }, model.artifact),
      /exact dimensions/,
    );
    await assert.rejects(
      service.revise(j.id, { ...spec, depthMm: 6 }, model.artifact),
      /exact dimensions/,
    );
    await writeFile(file, Buffer.from("PK\x03\x04changed"));
    await assert.rejects(loadCatalog(path, dir), /hash mismatch/);
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
