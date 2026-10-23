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

test("catalog color metadata round trips through specification normalization and model IDs stay unambiguous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fabrary-catalog-schema-"));
  try {
    const file = join(dir, "fixture.3mf"),
      previewFile = join(dir, "preview.png"),
      path = join(dir, "catalog.json");
    const bytes = Buffer.from("PK\x03\x04software-only-schema-fixture");
    await writeFile(file, bytes);
    await writeFile(
      previewFile,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const entry = {
      id: "schema_fixture",
      name: "Prepared model schema fixture",
      reviewed: true,
      file,
      previewFile,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      widthMm: 30,
      heightMm: 30,
      depthMm: 5,
      material: "pla",
      color: "\ufeff  青色 blue\u00a0",
      estimatedSeconds: 180,
    };
    await writeFile(path, JSON.stringify([entry]));
    const { models } = await loadCatalog(path, dir);
    assert.equal(models[0].color, "青色 blue");
    const { specSchema } = await import("../server/model.ts");
    const spec = specSchema.parse({
      assetIds: [models[0].artifactId],
      intent: "Catalog metadata must remain orderable",
      outputType: "3d",
      widthMm: models[0].widthMm,
      heightMm: models[0].heightMm,
      depthMm: models[0].depthMm,
      material: models[0].material,
      color: models[0].color,
      estimatedSeconds: models[0].estimatedSeconds,
      quantity: 1,
      permission: "authorized",
      crop: "contain",
      preparedModelId: models[0].id,
    });
    const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
    try {
      const service = new Service(
        store,
        {
          async call() {
            throw new Error("No device calls in catalog schema test");
          },
          token() {
            throw new Error("No execution tokens in catalog schema test");
          },
        },
        new MockPayment(),
        {
          mode: "simulation",
          paymentMode: "mock",
          storeMode: "sqlite-development",
          assetOrigin: "http://127.0.0.1:1/assets",
          secret: "isolated-test",
          quoteMs: 1000,
          pickupMs: 1000,
          ownerCode: "isolated-test",
          dataDir: dir,
          nodeUrl: "http://127.0.0.1:1",
          catalog: models,
        },
      );
      service.validateCatalog(spec, models[0].artifact);
    } finally {
      store.close();
    }
    for (const color of [
      "   ",
      "\ufeff\u00a0",
      "x".repeat(61),
      "😀".repeat(61),
    ]) {
      await writeFile(path, JSON.stringify([{ ...entry, color }]));
      await assert.rejects(loadCatalog(path, dir));
    }
    await writeFile(
      path,
      JSON.stringify([{ ...entry, color: "😀".repeat(60) }]),
    );
    assert.equal(
      (await loadCatalog(path, dir)).models[0].color,
      "😀".repeat(60),
    );
    await writeFile(
      path,
      JSON.stringify([
        entry,
        { ...entry, name: "Duplicate model ID", color: "red" },
      ]),
    );
    await assert.rejects(loadCatalog(path, dir), /IDs must be unique/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
