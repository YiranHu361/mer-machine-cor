import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mutate } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import {
  nodeHttpFixture as fixture,
  spec,
  delay,
} from "./helpers/node-http.ts";
async function paid(f: Awaited<ReturnType<typeof fixture>>, outcome = "pass") {
  f.released.release();
  await f.node.call("/calibrate", {
    machine_id: "phomemo_01",
    inspected: true,
  });
  await f.node.call("/machines/phomemo_01/policy", {
    listed: true,
    paused: false,
    ready: true,
    cleared: true,
    inspected: true,
    mediaRemaining: 100,
  });
  await f.node.call("/simulation/phomemo_01", { outcome });
  const j = await f.service.create("requester", spec, f.artifact);
  await f.service.approve(j.id, {
    specVersion: j.specVersion,
    artifactSha256: j.artifact.sha256,
  });
  await f.service.quote(j.id);
  await f.service.checkout(j.id, "isolated-media-checkout");
  await f.service.dispatch(j.id);
  return j;
}
async function settle(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  state: string,
) {
  for (let i = 0; i < 50; i++) {
    await f.service.reconcile(id);
    if ((await f.service.job(id)).productionState === state)
      return f.service.job(id);
    await delay(30);
  }
  assert.fail(`Isolated order did not reach ${state}`);
}

test(
  "actual completed calibration estimate is saved once through status, resolution and final confirmation",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      await mutate(f.store, (s) => {
        s.assets.fixture_art.ownerId = "team_owner";
      });
      f.released.release();
      const c = await f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        f.artifact,
        "actual-media-calibration",
        true,
      );
      for (let i = 0; i < 50; i++) {
        const status = await f.service.calibrationStatus("phomemo_01");
        if (status.status.execution_status === "completed") break;
        await delay(30);
      }
      let s = await f.service.read();
      assert.equal(s.calibrations![c.id].productionState, "produced");
      assert.equal(s.machines.phomemo_01.mediaRemaining, 99);
      await f.service.resolveCalibration("phomemo_01", {
        attemptId: c.attemptId,
        inspected: true,
        result: "completed",
        reason: "Owner inspected the finished authorized simulation pattern",
      });
      const owner = request.agent(createApp(f.service));
      await owner
        .post("/api/session")
        .send({ role: "owner", accessCode: f.service.config.ownerCode })
        .expect(200);
      await owner
        .post("/api/owner/machines/phomemo_01/calibrate")
        .send({
          attemptId: c.attemptId,
          inspected: true,
          reason: "Owner inspected alignment and all image corners",
        })
        .expect(200);
      await f.service.calibrationStatus("phomemo_01");
      s = await f.service.read();
      const device = await f.node.call("get_capabilities", {
        machine_id: "phomemo_01",
      });
      assert.equal(s.machines.phomemo_01.mediaRemaining, 99);
      assert.equal(device.media_remaining, 99);
      assert.equal(
        s.calibrations![c.id].mediaEstimateObserved?.attemptId,
        c.attemptId,
      );
      assert.equal(
        s.calibrations![c.id].history.filter(
          (e) => e.event === "media_estimate_observed",
        ).length,
        1,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "actual failed customer verification consumes the Node estimate and clearing never leaves backend stock overstated",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      const j = await paid(f, "fail");
      const failed = await settle(f, j.id, "failed");
      assert.equal(failed.paymentState, "refunded");
      assert.equal(failed.evidence.result, "fail");
      assert.equal(
        (await f.service.read()).machines.phomemo_01.mediaRemaining,
        99,
      );
      await f.service.clearFailed(j.id, {
        inspected: true,
        cleared: true,
        reason: "Owner inspected and cleared the unsuccessful output",
      });
      await f.service.reconcile(j.id);
      const s = await f.service.read(),
        device = await f.node.call("get_status", {
          machine_id: "phomemo_01",
          job_id: j.id,
          attempt_id: failed.attemptId,
        });
      assert.equal(device.execution_status, "completed");
      assert.equal(device.media_remaining, 99);
      assert.equal(s.machines.phomemo_01.mediaRemaining, 99);
      assert.equal(
        s.jobs[j.id].history.filter(
          (e) => e.event === "media_estimate_observed",
        ).length,
        1,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "actual normal production accounts before pickup handling and cannot deduct twice",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      const j = await paid(f);
      await settle(f, j.id, "produced");
      assert.equal(
        (await f.service.read()).machines.phomemo_01.mediaRemaining,
        99,
      );
      const handling = {
        removed: true,
        labeled: true,
        stored: true,
        cleared: true,
      };
      await f.service.prepare(j.id, handling);
      await f.service.prepare(j.id, handling);
      const s = await f.service.read(),
        device = await f.node.call("get_capabilities", {
          machine_id: "phomemo_01",
        });
      assert.equal(s.jobs[j.id].fulfillmentState, "ready_for_pickup");
      assert.equal(s.machines.phomemo_01.mediaRemaining, 99);
      assert.equal(device.media_remaining, 99);
    } finally {
      await f.close();
    }
  },
);

for (const ownerCount of [70, undefined])
  test(
    ownerCount === undefined
      ? "existing customer reconciliation repairs a skipped media read after a nonstock policy update without changing its outcome"
      : "delayed real terminal estimate preserves a newer owner count through fresh reconciliation and pickup",
    { timeout: 15000 },
    async () => {
      const f = await fixture();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((done) => {
          release = done;
        }),
        called = new Promise<void>((done) => {
          entered = done;
        });
      let pending: Promise<any> | undefined;
      try {
        const j = await paid(f),
          original = f.node.call.bind(f.node);
        for (let i = 0; i < 50; i++) {
          const status = await original("get_status", {
            machine_id: "phomemo_01",
            job_id: j.id,
            attempt_id: (await f.service.job(j.id)).attemptId,
          });
          if (status.execution_status === "completed") break;
          await delay(30);
        }
        let armed = true,
          statusReads = 0;
        f.node.call = async (tool, body, machine) => {
          if (tool === "get_status") statusReads++;
          const result = await original(tool, body, machine);
          if (
            armed &&
            tool === "get_status" &&
            body.job_id === j.id &&
            result.execution_status === "completed"
          ) {
            armed = false;
            entered();
            await gate;
          }
          return result;
        };
        pending = f.service.reconcile(j.id);
        await called;
        await original(
          "/machines/phomemo_01/policy",
          ownerCount === undefined
            ? { maxQuantity: 3 }
            : { mediaRemaining: ownerCount },
        );
        await mutate(f.store, (s) => {
          if (ownerCount === undefined)
            s.machines.phomemo_01.policy.maxQuantity = 3;
          else s.machines.phomemo_01.mediaRemaining = ownerCount;
          s.machines.phomemo_01.policyObservationId = "newer-owner-stock-reset";
        });
        release();
        await pending;
        const produced = await f.service.job(j.id);
        assert.equal(produced.productionState, "produced");
        assert.equal(produced.mediaEstimateObserved?.applied, false);
        const operations = (await f.service.read()).operations;
        await f.service.reconcile(j.id);
        const refreshed = await f.service.job(j.id);
        assert.equal(refreshed.productionState, produced.productionState);
        assert.equal(refreshed.paymentState, produced.paymentState);
        assert.deepEqual(refreshed.history.slice(0, -1), produced.history);
        assert.equal(
          refreshed.history.at(-1)?.event,
          "media_estimate_refreshed",
        );
        assert.deepEqual((await f.service.read()).operations, operations);
        assert.equal(refreshed.mediaEstimateObserved?.applied, true);
        assert.equal(statusReads, 2);
        await f.service.reconcile(j.id);
        assert.equal(
          statusReads,
          2,
          "Already-applied terminal observations do not cause further node reads",
        );
        await f.service.prepare(j.id, {
          removed: true,
          labeled: true,
          stored: true,
          cleared: true,
        });
        assert.equal(
          (await f.service.read()).machines.phomemo_01.mediaRemaining,
          ownerCount ?? 99,
        );
        assert.equal(
          (await original("get_capabilities", { machine_id: "phomemo_01" }))
            .media_remaining,
          ownerCount ?? 99,
        );
      } finally {
        release();
        await pending?.catch(() => {});
        await f.close();
      }
    },
  );

test(
  "target finalization accounts an actual completed calibration even without an earlier backend status read",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      await mutate(f.store, (s) => {
        s.assets.fixture_art.ownerId = "team_owner";
      });
      f.released.release();
      const c = await f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        f.artifact,
        "actual-direct-finalize-media",
        true,
      );
      for (let i = 0; i < 50; i++) {
        const status = await f.node.call("get_status", {
          machine_id: "phomemo_01",
          job_id: c.id,
          attempt_id: c.attemptId,
        });
        if (status.execution_status === "completed") break;
        await delay(30);
      }
      assert.equal(
        (await f.service.read()).calibrations![c.id].mediaEstimateObserved,
        undefined,
      );
      const owner = request.agent(createApp(f.service));
      await owner
        .post("/api/session")
        .send({ role: "owner", accessCode: f.service.config.ownerCode })
        .expect(200);
      await owner
        .post("/api/owner/machines/phomemo_01/calibrate")
        .send({
          attemptId: c.attemptId,
          inspected: true,
          reason: "Owner inspected the completed finite calibration pattern",
        })
        .expect(200);
      const s = await f.service.read();
      assert.equal(s.machines.phomemo_01.mediaRemaining, 99);
      assert.equal(
        s.calibrations![c.id].mediaEstimateObserved?.attemptId,
        c.attemptId,
      );
      assert.equal(
        (await f.node.call("get_capabilities", { machine_id: "phomemo_01" }))
          .media_remaining,
        99,
      );
    } finally {
      await f.close();
    }
  },
);
