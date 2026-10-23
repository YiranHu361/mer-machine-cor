import { test } from "node:test";
import assert from "node:assert/strict";
import { mutate } from "../server/store.ts";
import { type Job } from "../server/model.ts";
import {
  nodeHttpFixture as fixture,
  spec,
  journal,
} from "./helpers/node-http.ts";

test(
  "actual Python HTTP cancellation fences a pending customer dispatch before an owner failure can refund",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let pending: Promise<Job> | undefined;
    try {
      const created = await f.service.create("requester", spec, f.artifact);
      await f.service.approve(created.id, {
        specVersion: created.specVersion,
        artifactSha256: created.artifact.sha256,
      });
      await f.service.quote(created.id);
      await f.service.checkout(created.id, "isolated-cross-language-checkout");
      pending = f.service.dispatch(created.id);
      await f.entered.promise;
      const saved = await f.service.job(created.id);
      assert(saved.attemptId);
      await assert.rejects(
        f.node.call("get_status", {
          machine_id: saved.machineId,
          job_id: saved.id,
          attempt_id: saved.attemptId,
        }),
        { code: "unknown_attempt", status: 404 },
      );
      await f.service.reviewUncertain(
        saved.id,
        "Fixture: original device HTTP request remains held before durable acceptance",
      );
      const resolved = await f.service.operatorReview(
        saved.id,
        "fail",
        "Owner inspected the idle fixture; cancel before acceptance, never stop or repeat output",
      );
      assert.equal(resolved.productionState, "failed");
      assert.equal(resolved.paymentState, "refunded");
      assert.deepEqual(
        journal(f.dir),
        { attempts: 0, tombstones: 1 },
        "Refund requires the committed device cancellation barrier",
      );
      f.released.release();
      await pending;
      assert.equal(f.fetches(), 1);
      assert.deepEqual(
        journal(f.dir),
        { attempts: 0, tombstones: 1 },
        "Original in-flight HTTP request cannot accept or start after cancellation",
      );
      assert.equal((await f.service.job(saved.id)).paymentState, "refunded");
      const nodeState = await f.node.call("get_capabilities", {
        machine_id: saved.machineId,
      });
      assert.equal(nodeState.media_remaining, 100);
    } finally {
      f.released.release();
      if (pending) await pending.catch(() => undefined);
      await f.close();
    }
  },
);

test(
  "actual Python HTTP cancellation releases only the exact saved calibration intent and fences its late acceptance",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let pending: Promise<Job> | undefined;
    try {
      await mutate(f.store, (s) => {
        s.assets.fixture_art.ownerId = "team_owner";
      });
      const before = await f.service.calibrationStatus("phomemo_01");
      const requestKey = "isolated-cross-language-calibration";
      pending = f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        f.artifact,
        requestKey,
        true,
        before.lifecycle.context,
      );
      await f.entered.promise;
      const state = await f.service.read();
      const saved = Object.values(state.calibrations ?? {})[0];
      assert(saved?.attemptId);
      await assert.rejects(
        f.node.call("get_status", {
          machine_id: saved.machineId,
          job_id: saved.id,
          attempt_id: saved.attemptId,
        }),
        { code: "unknown_attempt", status: 404 },
      );
      const cancelled = await f.service.cancelCalibrationBeforeAcceptance(
        "phomemo_01",
        {
          attemptId: saved.attemptId,
          expectedVersion: saved.version,
          expectedContext: before.lifecycle.context,
          inspected: true,
          reason:
            "Owner explicitly requests cancellation only before device acceptance; no stop or replacement output",
        },
      );
      assert.equal(cancelled.calibration?.id, saved.id);
      assert.equal(cancelled.calibration?.productionState, "cancelled");
      assert.equal(cancelled.lifecycle.activeJobId, null);
      assert.equal(cancelled.lifecycle.canRequestNew, true);
      assert.deepEqual(journal(f.dir), { attempts: 0, tombstones: 1 });
      f.released.release();
      const late = await pending;
      assert.equal(late.id, saved.id);
      assert.equal(late.productionState, "cancelled");
      const replay = await f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        f.artifact,
        requestKey,
        true,
        before.lifecycle.context,
      );
      assert.equal(replay.id, saved.id);
      assert.equal(replay.attemptId, saved.attemptId);
      assert.equal(f.fetches(), 1);
      assert.deepEqual(journal(f.dir), { attempts: 0, tombstones: 1 });
      const machine = (await f.service.read()).machines.phomemo_01;
      assert.equal(machine.calibrated, false);
      assert.equal(machine.paused, true);
      assert.equal(machine.ready, false);
    } finally {
      f.released.release();
      if (pending) await pending.catch(() => undefined);
      await f.close();
    }
  },
);
