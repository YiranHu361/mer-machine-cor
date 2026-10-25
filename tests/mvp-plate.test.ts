import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState, type Job } from "../server/model.ts";
import { SqliteStore } from "../server/store.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";

test("MVP completion frees the A1 without an owner plate check, while failures remain paused", async () => {
  for (const outcome of ["completed", "failed", "unknown"]) {
    const directory = await mkdtemp(join(tmpdir(), "fabyn-mvp-plate-"));
    const state = initialState();
    const at = new Date().toISOString();
    const job: Job = {
      id: "a1_job",
      requesterId: "test",
      machineId: "bambu_01",
      specVersion: 1,
      spec: {
        assetIds: ["part"],
        intent: "Name tag",
        outputType: "3d",
        widthMm: 40,
        heightMm: 20,
        depthMm: 3,
        quantity: 1,
        material: "pla",
        color: "white",
        preparedModelId: "part",
        estimatedSeconds: 60,
        permission: "authorized",
        crop: "contain",
      },
      artifact: { id: "part", url: "/assets/part", sha256: "a".repeat(64) },
      productionState: "running",
      paymentState: "unpaid",
      fulfillmentState: "unprepared",
      history: [],
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    state.jobs[job.id] = job;
    Object.assign(state.machines.bambu_01, {
      producerHub: { machineId: "m_fdm_01", since: at },
      calibrated: true,
      activeJobId: job.id,
      paused: false,
      ready: false,
    });
    const store = new SqliteStore(join(directory, "state.sqlite"), state);
    const calls: string[] = [];
    const service = new Service(
      store,
      {
        async call(tool) {
          calls.push(tool);
          return { accepted: true };
        },
        token() {
          throw new Error("No dispatch in this fixture");
        },
      },
      new MockPayment(),
      {
        mode: "hardware",
        paymentMode: "mock",
        storeMode: "test",
        secret: "test",
        ownerCode: "test",
        quoteMs: 120000,
        pickupMs: 86400000,
        dataDir: directory,
        assetOrigin: "http://127.0.0.1:4318/assets",
        nodeUrl: "http://127.0.0.1:9",
        autoPrepareHubPrints: false,
      },
    );
    try {
      await service.applyNodeStatus(job.id, { execution_status: outcome });
      const current = await service.read();
      const printer = current.machines.bambu_01;
      if (outcome === "completed") {
        assert.deepEqual(
          [printer.ready, printer.paused, printer.activeJobId],
          [true, false, null],
        );
        assert.equal(current.jobs[job.id].fulfillmentState, "ready_for_pickup");
        assert.match(
          current.jobs[job.id].history.at(-1)!.reason,
          /MVP assumes.*no plate inspection/,
        );
        const pickup = current.jobs[job.id].pickup?.code;
        await service.applyNodeStatus(job.id, { execution_status: outcome });
        assert.equal(
          (await service.job(job.id)).pickup?.code,
          pickup,
          "A replay does not handle the same output twice",
        );
        assert.deepEqual(calls, ["/machines/bambu_01/policy"]);
      } else {
        assert.deepEqual([printer.ready, printer.paused], [false, true]);
        assert.deepEqual(calls, []);
        assert.equal(
          current.jobs[job.id].productionState,
          outcome === "unknown" ? "needs_review" : "failed",
        );
      }
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
