import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, now, type Job } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { calibrationDeviceContext } from "../server/calibration-context.ts";
import { mediaEstimateSnapshot } from "../server/media-estimate.ts";
import { accountPreparedEstimate } from "../server/media-estimate.ts";
import { createApp } from "../server/app.ts";
const mid = "phomemo_01",
  cid = "calibration_media_cas",
  aid = "attempt_media_cas";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-media-cas-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  let calls = 0;
  const service = new Service(
    store,
    {
      token: () => ({
        token: "isolated",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      }),
      async call(tool) {
        calls++;
        return {
          machine_id: mid,
          job_id: cid,
          attempt_id: aid,
          mode: "simulation",
          execution_status: "completed",
          media_remaining: 99,
        };
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:1/assets",
      secret: "isolated-media",
      quoteMs: 120000,
      pickupMs: 60000,
      ownerCode: "isolated-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  await mutate(store, (s) => {
    const m = s.machines[mid];
    m.activeJobId = cid;
    const c: Job = {
      id: cid,
      requesterId: "team_owner",
      machineId: mid,
      attemptId: aid,
      calibrationDeviceContext: calibrationDeviceContext(m),
      mediaEstimateBaseline: mediaEstimateSnapshot(m).fingerprint,
      specVersion: 1,
      spec: {
        assetIds: ["fixture"],
        intent: "Authorized media estimate fixture",
        outputType: "sticker",
        widthMm: 53,
        heightMm: 50,
        quantity: 1,
        material: "thermal-paper",
        permission: "authorized",
        crop: "contain",
      },
      artifact: {
        id: "fixture",
        url: "/assets/fixture",
        sha256: "a".repeat(64),
      },
      productionState: "dispatched",
      paymentState: "unpaid",
      fulfillmentState: "unprepared",
      history: [],
      createdAt: now(),
      updatedAt: now(),
      version: 1,
    };
    s.calibrations = { [cid]: c };
  });
  return {
    store,
    service,
    calls: () => calls,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("media estimate CAS retry preserves newer owner stock without starving a still-current calibration result", async () => {
  const f = await fixture();
  try {
    const cas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, data) => {
      if (armed && data.calibrations![cid].mediaEstimateObserved) {
        armed = false;
        await mutate(f.store, (s) => {
          s.machines[mid].mediaRemaining = 70;
          s.machines[mid].policyObservationId = "new-owner-count";
        });
      }
      return cas(version, data);
    };
    const status = await f.service.calibrationStatus(mid);
    const s = await f.service.read();
    assert.equal(status.calibration?.productionState, "produced");
    assert.equal(status.status.execution_status, "completed");
    assert.equal(s.machines[mid].mediaRemaining, 70);
    assert.equal(s.calibrations![cid].mediaEstimateObserved?.applied, false);
    assert.equal(f.calls(), 1);
  } finally {
    f.close();
  }
});
test("unrelated CAS conflict still accounts one current terminal media estimate without another Node request", async () => {
  const f = await fixture();
  try {
    const cas = f.store.compareAndSet.bind(f.store);
    let armed = true;
    f.store.compareAndSet = async (version, data) => {
      if (armed && data.calibrations![cid].mediaEstimateObserved) {
        armed = false;
        await mutate(f.store, (s) => {
          s.machines.instax_01.reason = "Unrelated workshop update";
        });
      }
      return cas(version, data);
    };
    await f.service.calibrationStatus(mid);
    const s = await f.service.read();
    assert.equal(s.machines[mid].mediaRemaining, 99);
    assert.equal(s.calibrations![cid].mediaEstimateObserved?.applied, true);
    assert.equal(
      s.calibrations![cid].history.filter(
        (e) => e.event === "media_estimate_observed",
      ).length,
      1,
    );
    assert.equal(f.calls(), 1);
  } finally {
    f.close();
  }
});

test("a declined calibration inspection still accounts its exact completed Node estimate without marking calibration passed", async () => {
  const f = await fixture();
  try {
    const call = f.service.node.call.bind(f.service.node);
    f.service.node.call = async (tool, body, machine) =>
      tool === "/calibrate"
        ? {
            machine_id: mid,
            job_id: cid,
            attempt_id: aid,
            mode: "simulation",
            execution_status: "completed",
            media_remaining: 99,
            calibrated: false,
            reason:
              "The completed output still requires a usable inspection frame",
          }
        : call(tool, body, machine);
    const owner = request.agent(createApp(f.service));
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "isolated-owner" })
      .expect(200);
    await owner
      .post(`/api/owner/machines/${mid}/calibrate`)
      .send({ inspected: true, attemptId: aid })
      .expect(409);
    const s = await f.service.read();
    assert.equal(s.machines[mid].mediaRemaining, 99);
    assert.equal(s.machines[mid].calibrated, false);
    assert.equal(s.machines[mid].activeJobId, cid);
    assert.equal(s.machines[mid].ready, false);
    assert.equal(s.machines[mid].paused, true);
    assert.equal(s.calibrations![cid].mediaEstimateObserved?.remaining, 99);
  } finally {
    f.close();
  }
});

test("an uncertain running attempt does not freeze its media count before the settled owner resolution", async () => {
  const f = await fixture();
  try {
    const call = f.service.node.call.bind(f.service.node);
    f.service.node.call = async (tool, body, machine) => {
      if (tool === "get_status")
        return {
          machine_id: mid,
          job_id: cid,
          attempt_id: aid,
          mode: "simulation",
          execution_status: "uncertain",
          media_remaining: 100,
        };
      if (tool === "/reconcile")
        return {
          machine_id: mid,
          job_id: cid,
          attempt_id: aid,
          mode: "simulation",
          execution_status: "failed",
          media_remaining: 99,
        };
      return call(tool, body, machine);
    };
    await f.service.calibrationStatus(mid);
    const before = await f.service.read();
    assert.equal(before.calibrations![cid].productionState, "needs_review");
    assert.equal(before.calibrations![cid].mediaEstimateObserved, undefined);
    assert.equal(before.machines[mid].mediaRemaining, 100);
    await f.service.resolveCalibration(mid, {
      attemptId: aid,
      result: "failed",
      inspected: true,
      reason:
        "Owner inspected the settled failed attempt and safely cleared it",
    });
    const s = await f.service.read();
    assert.equal(s.machines[mid].mediaRemaining, 99);
    assert.equal(s.calibrations![cid].mediaEstimateObserved?.remaining, 99);
    assert.equal(
      s.calibrations![cid].history.filter(
        (entry) => entry.event === "media_estimate_observed",
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});

test("a fresh terminal read repairs a skipped nonstock-policy observation while preserving an explicit owner count", async () => {
  for (const ownerCount of [undefined, 70]) {
    const f = await fixture();
    try {
      const cas = f.store.compareAndSet.bind(f.store);
      let armed = true;
      f.store.compareAndSet = async (version, data) => {
        if (armed && data.calibrations![cid].mediaEstimateObserved) {
          armed = false;
          await mutate(f.store, (s) => {
            s.machines[mid].policyObservationId = "new-owner-policy";
            if (ownerCount === undefined)
              s.machines[mid].policy.maxQuantity = 3;
            else s.machines[mid].mediaRemaining = ownerCount;
          });
        }
        return cas(version, data);
      };
      await f.service.calibrationStatus(mid);
      const skipped = await f.service.read();
      assert.equal(
        skipped.calibrations![cid].mediaEstimateObserved?.applied,
        false,
      );
      assert.equal(skipped.machines[mid].mediaRemaining, ownerCount ?? 100);
      if (ownerCount !== undefined) {
        const call = f.service.node.call.bind(f.service.node);
        f.service.node.call = async (tool, body, machine) => ({
          ...(await call(tool, body, machine)),
          media_remaining: ownerCount,
        });
      }
      await f.service.calibrationStatus(mid);
      const fresh = await f.service.read();
      assert.equal(fresh.machines[mid].mediaRemaining, ownerCount ?? 99);
      assert.equal(
        fresh.calibrations![cid].mediaEstimateObserved?.applied,
        true,
      );
      assert.equal(
        accountPreparedEstimate(fresh.machines[mid], fresh.calibrations![cid]),
        false,
      );
      assert.equal(fresh.machines[mid].mediaRemaining, ownerCount ?? 99);
      const version = fresh.calibrations![cid].version;
      await f.service.calibrationStatus(mid);
      assert.equal(
        (await f.service.read()).calibrations![cid].version,
        version,
      );
      assert.equal(
        fresh.calibrations![cid].history.filter(
          (entry) => entry.event === "media_estimate_observed",
        ).length,
        1,
      );
      assert.equal(
        fresh.calibrations![cid].history.filter(
          (entry) => entry.event === "media_estimate_refreshed",
        ).length,
        1,
      );
    } finally {
      f.close();
    }
  }
});

for (const action of ["reject", "resolve", "finalize"] as const)
  test(`${action} cannot retire a calibration across an unaccounted owner-policy change; refresh and deliberate retry recover safely`, async () => {
    for (const ownerCount of [undefined, 70]) {
      const f = await fixture();
      try {
        await mutate(f.store, (s) => {
          s.calibrations![cid].productionState = "produced";
        });
        let counter = 99;
        f.service.node.call = async (tool) => {
          return {
            machine_id: mid,
            job_id: cid,
            attempt_id: aid,
            mode: "simulation",
            execution_status: action === "resolve" ? "failed" : "completed",
            media_remaining: counter,
            stop_pending: false,
            calibrated: true,
          };
        };
        const cas = f.store.compareAndSet.bind(f.store);
        let armed = true;
        f.store.compareAndSet = async (version, data) => {
          if (
            armed &&
            data.calibrations![cid].mediaEstimateObserved &&
            data.machines[mid].activeJobId === null
          ) {
            armed = false;
            if (ownerCount !== undefined) counter = ownerCount;
            await mutate(f.store, (s) => {
              s.machines[mid].policyObservationId = "new-owner-policy";
              if (ownerCount === undefined)
                s.machines[mid].policy.maxQuantity = 3;
              else s.machines[mid].mediaRemaining = ownerCount;
            });
          }
          return cas(version, data);
        };
        const owner = request.agent(createApp(f.service));
        await owner
          .post("/api/session")
          .send({ role: "owner", accessCode: "isolated-owner" })
          .expect(200);
        const perform = async (conflict: boolean) => {
          const current = await f.service.read();
          const body = {
            attemptId: aid,
            expectedVersion: current.calibrations![cid].version,
            expectedContext: calibrationDeviceContext(current.machines[mid]),
            inspected: true,
            reason: "Owner inspected this exact settled calibration result",
          };
          if (action === "finalize") {
            const response = await owner
              .post(`/api/owner/machines/${mid}/calibrate`)
              .send({ inspected: true, attemptId: aid })
              .expect(conflict ? 409 : 200);
            if (conflict)
              assert.equal(response.body.error.code, "CALIBRATION_NOT_CURRENT");
          } else {
            const pending =
              action === "reject"
                ? f.service.rejectCalibration(mid, body)
                : f.service.resolveCalibration(mid, {
                    attemptId: aid,
                    inspected: true,
                    result: "failed",
                    reason: body.reason,
                  });
            if (conflict)
              await assert.rejects(pending, {
                code: "CALIBRATION_NOT_CURRENT",
              });
            else await pending;
          }
        };
        await perform(true);
        const blocked = await f.service.read();
        assert.equal(blocked.machines[mid].activeJobId, cid);
        assert.equal(blocked.machines[mid].ready, false);
        assert.equal(blocked.machines[mid].paused, true);
        assert.equal(blocked.machines[mid].calibrated, false);
        assert.equal(blocked.machines[mid].mediaRemaining, ownerCount ?? 100);
        assert.equal(
          blocked.calibrations![cid].mediaEstimateObserved?.applied,
          false,
        );
        await f.service.calibrationStatus(mid);
        const refreshed = await f.service.read();
        assert.equal(refreshed.machines[mid].mediaRemaining, ownerCount ?? 99);
        assert.equal(
          refreshed.calibrations![cid].mediaEstimateObserved?.applied,
          true,
        );
        assert.equal(refreshed.machines[mid].activeJobId, cid);
        assert.equal(
          refreshed.machines[mid].calibrated,
          false,
          "A passed Node inspection cannot make the conflicted backend confirmation appear passed",
        );
        await perform(false);
        const retired = await f.service.read();
        assert.equal(retired.machines[mid].activeJobId, null);
        assert.equal(retired.machines[mid].mediaRemaining, ownerCount ?? 99);
        assert.equal(retired.machines[mid].calibrated, action === "finalize");
      } finally {
        f.close();
      }
    }
  });

for (const action of ["prepare", "clear"] as const)
  test(`customer ${action} preserves its active slot until a skipped media estimate is explicitly reconciled`, async () => {
    for (const ownerCount of [undefined, 70]) {
      const f = await fixture();
      try {
        await mutate(f.store, (s) => {
          const job = s.calibrations![cid];
          delete s.calibrations![cid];
          s.jobs[cid] = job;
          job.productionState = action === "prepare" ? "produced" : "failed";
          job.paymentState = action === "prepare" ? "released" : "refunded";
          job.mediaEstimateObserved = {
            machineId: mid,
            attemptId: aid,
            remaining: 99,
            observedAt: now(),
            applied: false,
          };
          s.machines[mid].policyObservationId = "new-owner-policy";
          if (ownerCount !== undefined)
            s.machines[mid].mediaRemaining = ownerCount;
        });
        let reads = 0;
        f.service.node.call = async (tool) => {
          assert.equal(tool, "get_status");
          reads++;
          return {
            machine_id: mid,
            job_id: cid,
            attempt_id: aid,
            mode: "simulation",
            execution_status: action === "prepare" ? "completed" : "failed",
            media_remaining: ownerCount ?? 99,
          };
        };
        const perform = () =>
          action === "prepare"
            ? f.service.prepare(cid, {
                removed: true,
                labeled: true,
                stored: true,
                cleared: true,
              })
            : f.service.clearFailed(cid, {
                inspected: true,
                cleared: true,
                reason: "Owner inspected and safely cleared this failed output",
              });
        const before = await f.service.read();
        await assert.rejects(perform(), { code: "MEDIA_ESTIMATE_NOT_CURRENT" });
        assert.deepEqual(await f.service.read(), before);
        assert.equal(reads, 0);
        await f.service.reconcile(cid);
        const refreshed = await f.service.read();
        assert.equal(refreshed.jobs[cid].mediaEstimateObserved?.applied, true);
        assert.equal(refreshed.machines[mid].mediaRemaining, ownerCount ?? 99);
        await perform();
        const retired = await f.service.read();
        assert.equal(retired.machines[mid].activeJobId, null);
        assert.equal(retired.machines[mid].mediaRemaining, ownerCount ?? 99);
        assert.equal(reads, 1, "Handling and clearing add no Node I/O");
      } finally {
        f.close();
      }
    }
  });
