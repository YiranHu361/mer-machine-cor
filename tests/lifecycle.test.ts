import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore, mutate } from "../server/store.ts";
import {
  initialState,
  id,
  now,
  specSchema,
  type Job,
  type Machine,
  type Operation,
} from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import {
  MockPayment,
  type PaymentResult,
  type PaymentBoundary,
} from "../server/payments.ts";
import type { NodeBoundary } from "../server/node-client.ts";
class Device implements NodeBoundary {
  calls = 0;
  outcome = "visible";
  lost = false;
  status = "completed";
  token() {
    return {
      token: "signed-test-boundary",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    };
  }
  async call(tool: string, input: any) {
    if (tool === "camera_snapshot")
      return {
        frame_url: "http://127.0.0.1:8788/frames/example.png",
        captured_at: new Date(Date.now() + 1).toISOString(),
        completion_credible: input.phase === "result",
        machine_id: input.machine_id,
        job_id: input.job_id,
        attempt_id: input.attempt_id,
        source: "simulation",
        observation: this.outcome,
      };
    if (tool === "run_job") {
      this.calls++;
      if (this.lost) throw new Error("ack lost");
      return { status: "accepted", execution_status: "running" };
    }
    if (tool === "get_status")
      return {
        machine_id: input.machine_id,
        mode: "simulation",
        ready: true,
        calibrated: true,
        execution_status: this.status,
        completion_credible: true,
      };
    if (tool === "abort")
      return { status: "unsupported", reason: "Test boundary cannot stop." };
    return { calibrated: true };
  }
}
function fixture(payment: PaymentBoundary = new MockPayment()) {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-domain-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  const device = new Device();
  const config: Config = {
    mode: "simulation",
    paymentMode: payment.mode,
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:4318/assets",
    secret: "test-secret",
    quoteMs: 120000,
    pickupMs: 86400000,
    ownerCode: "test-owner-code",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:8788",
  };
  const service = new Service(store, device, payment, config);
  return {
    dir,
    store,
    device,
    service,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const spec = {
  assetIds: ["asset_test"],
  intent: "Club sticker",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
async function draft(
  f: ReturnType<typeof fixture>,
  requester = "r1",
  extra: any = {},
) {
  await mutate(f.store, (s) => {
    s.assets.asset_test = {
      id: "asset_test",
      ownerId: requester,
      path: "test-boundary",
      url: "/assets/asset_test",
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 20,
      height: 20,
      createdAt: now(),
    };
    const m = s.machines.phomemo_01;
    m.calibrated = true;
    m.listed = true;
    m.ready = true;
    m.paused = false;
  });
  return f.service.create(
    requester,
    { ...spec, ...extra },
    { id: "asset_test", url: "/assets/asset_test", sha256: "a".repeat(64) },
  );
}
async function approved(
  f: ReturnType<typeof fixture>,
  requester = "r1",
  extra: any = {},
) {
  const j = await draft(f, requester, extra);
  return f.service.approve(j.id, {
    specVersion: j.specVersion,
    artifactSha256: j.artifact.sha256,
  });
}
async function paid(f: ReturnType<typeof fixture>) {
  const j = await approved(f);
  await f.service.quote(j.id);
  await f.service.checkout(j.id, "stable-checkout-key");
  return f.service.job(j.id);
}
test("spec validation rejects size/material/quantity; authorized club artwork allowed", () => {
  assert(specSchema.safeParse(spec).success);
  for (const change of [
    { widthMm: 50 },
    { material: "waterproof" },
    { quantity: 1.5 },
    { heightMm: 1 },
    { quantity: 11 },
  ])
    assert(!specSchema.safeParse({ ...spec, ...change }).success);
  assert(specSchema.safeParse({ ...spec, permission: "unclear" }).success);
});
test("approval invalidation requires reapproval and artifact hash binding", async () => {
  const f = fixture();
  try {
    const j = await approved(f);
    await assert.rejects(
      f.service.approve(j.id, { specVersion: 1, artifactSha256: "wrong" }),
      /current preview/,
    );
    await f.service.quote(j.id);
    const revised = await f.service.revise(
      j.id,
      { ...spec, quantity: 2 },
      j.artifact,
    );
    assert.equal(revised.approvedSpecHash, undefined);
    assert.equal(revised.quote, undefined);
    await assert.rejects(f.service.quote(j.id), /Approve/);
  } finally {
    f.close();
  }
});
test("two concurrent reservations yield one winner and no double reservation", async () => {
  const f = fixture();
  try {
    const a = await approved(f);
    const b = await approved(f);
    const results = await Promise.allSettled([
      f.service.quote(a.id),
      f.service.quote(b.id),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const s = await f.service.read();
    assert.equal(
      Object.values(s.machines).filter((m) => m.reservation).length,
      1,
    );
  } finally {
    f.close();
  }
});
test("quote integer items sum, expiry blocks checkout, mandate requires explicit approved cap", async () => {
  const f = fixture();
  try {
    const j = await approved(f);
    await assert.rejects(f.service.quote(j.id, true), /mandate/);
    const q = await f.service.quote(j.id);
    assert.equal(q.quote!.totalCents, 75);
    assert.equal(q.quote!.ownerCents, 60);
    await mutate(f.store, (s) => {
      s.jobs[j.id].quote!.expiresAt = new Date(Date.now() - 1).toISOString();
    });
    await assert.rejects(f.service.checkout(j.id, "stable-key"), /expired/);
    const auto = await approved(f, "r1", {
      budgetMandate: { enabled: true, capCents: 100 },
    });
    await mutate(f.store, (s) => {
      delete s.machines.phomemo_01.reservation;
    });
    assert.equal((await f.service.quote(auto.id, true)).quote!.accepted, true);
  } finally {
    f.close();
  }
});
test("unpaid dispatch rejected and repeat checkout collects once", async () => {
  const f = fixture();
  try {
    const j = await approved(f);
    await assert.rejects(f.service.dispatch(j.id), /confirmed collected/);
    await f.service.quote(j.id);
    await Promise.all([
      f.service.checkout(j.id, "stable-key"),
      f.service.checkout(j.id, "stable-key"),
    ]);
    assert.equal((await f.service.job(j.id)).paymentState, "held");
    assert.equal(Object.keys((await f.service.read()).operations).length, 1);
    assert.equal(f.device.calls, 0);
  } finally {
    f.close();
  }
});
test("cancel before payment releases reservation; paid cancellation confirms mock refund once", async () => {
  const f = fixture();
  try {
    const a = await approved(f);
    await f.service.quote(a.id);
    await f.service.cancel(a.id);
    assert.equal(
      (await f.service.read()).machines.phomemo_01.reservation,
      undefined,
    );
    const b = await paid(f);
    await Promise.all([f.service.cancel(b.id), f.service.cancel(b.id)]);
    assert.equal((await f.service.job(b.id)).paymentState, "refunded");
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (o) => o.kind === "refund",
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});
test("cancellation racing dispatch has one atomic winner", async () => {
  for (let i = 0; i < 8; i++) {
    const f = fixture();
    try {
      const j = await paid(f);
      const r = await Promise.allSettled(
        i % 2
          ? [f.service.dispatch(j.id), f.service.cancel(j.id)]
          : [f.service.cancel(j.id), f.service.dispatch(j.id)],
      );
      const done = await f.service.job(j.id);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert(
        done.attemptId
          ? done.productionState !== "cancelled"
          : done.productionState === "cancelled",
      );
      assert(f.device.calls <= 1);
    } finally {
      f.close();
    }
  }
});
test("dispatch retries reuse attempt and lost acknowledgment remains review without reprint", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    f.device.lost = true;
    const first = await f.service.dispatch(j.id);
    assert.equal(first.productionState, "needs_review");
    const second = await f.service.dispatch(j.id);
    assert.equal(second.attemptId, first.attemptId);
    assert.equal(f.device.calls, 1);
    assert.equal((await f.service.read()).machines.phomemo_01.paused, true);
  } finally {
    f.close();
  }
});
test("complete simulated pass, owner handling, new job before collection, atomic single-use pickup", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    const produced = await f.service.job(j.id);
    assert.equal(produced.productionState, "produced");
    assert.equal(produced.paymentState, "released");
    assert.equal(produced.fulfillmentState, "awaiting_owner");
    await assert.rejects(f.service.prepare(j.id, { removed: true }), /Confirm/);
    const ready = await f.service.prepare(j.id, {
      removed: true,
      labeled: true,
      stored: true,
      cleared: true,
    });
    assert.equal(ready.fulfillmentState, "ready_for_pickup");
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      null,
    );
    const next = await approved(f);
    assert.equal((await f.service.quote(next.id)).productionState, "quoted");
    const attempts = await Promise.allSettled([
      f.service.redeem(j.id, ready.pickup!.code),
      f.service.redeem(j.id, ready.pickup!.code),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await f.service.job(j.id)).fulfillmentState, "collected");
  } finally {
    f.close();
  }
});
test("expired pickup rejected", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    const ready = await f.service.prepare(j.id, {
      removed: true,
      labeled: true,
      stored: true,
      cleared: true,
    });
    await mutate(f.store, (s) => {
      s.jobs[j.id].pickup!.expiresAt = new Date(Date.now() - 10).toISOString();
    });
    await assert.rejects(f.service.redeem(j.id, ready.pickup!.code), /expired/);
  } finally {
    f.close();
  }
});
test("missing output refunds; ambiguity holds; visible operator override releases with reason", async () => {
  for (const [outcome, production, payment] of [
    ["missing", "failed", "refunded"],
    ["ambiguous", "needs_review", "held"],
  ]) {
    const f = fixture();
    try {
      f.device.outcome = outcome;
      const j = await paid(f);
      await f.service.dispatch(j.id);
      await f.service.reconcile(j.id);
      const result = await f.service.job(j.id);
      assert.equal(result.productionState, production);
      assert.equal(result.paymentState, payment);
      if (outcome === "ambiguous") {
        await assert.rejects(
          f.service.operatorReview(j.id, "pass", ""),
          /reason/,
        );
        const reviewed = await f.service.operatorReview(
          j.id,
          "pass",
          "Owner inspected visible sticker matching preview",
        );
        assert.equal(reviewed.paymentState, "released");
        assert(reviewed.history.some((h) => h.event === "operator_override"));
      }
    } finally {
      f.close();
    }
  }
});
test("late collection never dispatches expired reservation and refunds", async () => {
  class Pending extends MockPayment {
    override async collect(j: Job, o: Operation): Promise<PaymentResult> {
      return { status: "pending", reference: "pending-ref" };
    }
  }
  const f = fixture(new Pending());
  try {
    const j = await approved(f);
    await f.service.quote(j.id);
    await f.service.checkout(j.id, "stable-key");
    await mutate(f.store, (s) => {
      s.jobs[j.id].quote!.expiresAt = new Date(Date.now() - 1).toISOString();
    });
    const op = Object.values((await f.service.read()).operations)[0];
    await f.service.applyPayment(op.id, {
      status: "confirmed",
      reference: "late-collected",
    });
    assert.equal((await f.service.job(j.id)).paymentState, "refunded");
    await assert.rejects(f.service.dispatch(j.id), /confirmed collected/);
    assert.equal(f.device.calls, 0);
  } finally {
    f.close();
  }
});
test("unknown collection stays pending across restart; callback replay cannot allocate twice", async () => {
  class Unknown extends MockPayment {
    override async collect(): Promise<PaymentResult> {
      throw new Error("timeout after possible settlement");
    }
  }
  const f = fixture(new Unknown());
  try {
    const j = await approved(f);
    await f.service.quote(j.id);
    await f.service.checkout(j.id, "stable-key");
    assert.equal(
      (await f.service.job(j.id)).paymentState,
      "collection_pending",
    );
    const op = Object.values((await f.service.read()).operations)[0];
    assert.equal(op.status, "pending");
    const restart = new SqliteStore(
      join(f.dir, "state.sqlite"),
      initialState(),
    );
    assert.equal(
      (await restart.read()).data.jobs[j.id].paymentState,
      "collection_pending",
    );
    restart.close();
    await f.service.applyPayment(op.id, {
      status: "confirmed",
      reference: "confirmed-ref",
    });
    await f.service.applyPayment(op.id, {
      status: "confirmed",
      reference: "confirmed-ref",
    });
    assert.equal(Object.keys((await f.service.read()).operations).length, 1);
  } finally {
    f.close();
  }
});
test("release/refund race is exclusive and stable across replay", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    await mutate(f.store, (s) => {
      s.jobs[j.id].evidence = { result: "pass" };
    });
    await Promise.allSettled([
      f.service.transfer(j.id, "release"),
      f.service.transfer(j.id, "refund"),
    ]);
    const ops = Object.values((await f.service.read()).operations).filter(
      (o) => o.kind !== "collection",
    );
    assert.equal(ops.length, 1);
    assert.equal(ops[0].status, "confirmed");
    await f.service.transfer(j.id, ops[0].kind as "release" | "refund");
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (o) => o.kind !== "collection",
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});
test("abort response is honest, requester isolation prevents cross-job access", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    await assert.rejects(
      f.service.job(j.id, { id: "stranger", role: "requester" }),
      /different account/,
    );
    await f.service.dispatch(j.id);
    const a = await f.service.abort(j.id);
    assert.equal(a.abort.status, "unsupported");
    assert.notEqual(a.job.productionState, "cancelled");
  } finally {
    f.close();
  }
});

test("stale, mismatched or noncredible frames require review and preserve hold", async () => {
  for (const kind of ["stale", "mismatched", "noncredible"]) {
    const f = fixture();
    try {
      const original = f.device.call.bind(f.device);
      f.device.call = async (tool, input) => {
        const response = await original(tool, input);
        if (tool === "camera_snapshot" && input.phase === "result") {
          if (kind === "stale")
            response.captured_at = "2020-01-01T00:00:00.000Z";
          if (kind === "mismatched") response.job_id = "other-job";
          if (kind === "noncredible") response.completion_credible = false;
        }
        return response;
      };
      const j = await paid(f);
      await f.service.dispatch(j.id);
      await f.service.reconcile(j.id);
      assert.equal((await f.service.job(j.id)).productionState, "needs_review");
      assert.equal((await f.service.job(j.id)).paymentState, "held");
    } finally {
      f.close();
    }
  }
});
test("definite prerequisite failure retries same transfer allocation, ambiguous submission never does", async () => {
  class Payments extends MockPayment {
    missing = true;
    attempts = 0;
    override async transfer(j: Job, m: Machine, op: Operation) {
      this.attempts++;
      if (this.missing) throw new Error("OWNER_ADDRESS_REQUIRED");
      return super.transfer(j, m, op);
    }
  }
  const payment = new Payments(),
    f = fixture(payment);
  try {
    const j = await paid(f);
    await mutate(f.store, (s) => {
      s.jobs[j.id].evidence = { result: "pass" };
    });
    await f.service.transfer(j.id, "release");
    const op = Object.values((await f.service.read()).operations).find(
      (o) => o.kind === "release",
    )!;
    assert.equal(op.status, "failed");
    assert.equal(op.retryable, true);
    assert.equal((await f.service.job(j.id)).paymentState, "release_pending");
    payment.missing = false;
    await f.service.reconcile(j.id);
    assert.equal((await f.service.job(j.id)).paymentState, "released");
    assert.equal(payment.attempts, 2);
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (o) => o.kind === "release",
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});
test("explicit calibration intent journals once and normal jobs cannot masquerade as calibration", async () => {
  const f = fixture();
  try {
    const j = await draft(f, "team_owner");
    const artifact = j.artifact;
    const cal = await f.service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      artifact,
      "calibration-stable-key",
      true,
    );
    assert.match(cal.attemptId!, /^calibration_attempt_/);
    const again = await f.service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      artifact,
      "calibration-stable-key",
      true,
    );
    assert.equal(again.attemptId, cal.attemptId);
    await assert.rejects(
      f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        { ...spec, crop: "cover" },
        artifact,
        "calibration-stable-key",
        true,
      ),
      /already binds/,
    );
    assert.equal(Object.keys((await f.service.read()).calibrations!).length, 1);
    await assert.rejects(
      f.service.startCalibration(
        "phomemo_01",
        "team_owner",
        spec,
        artifact,
        "another-stable-key",
        false,
      ),
      /Confirm loaded media/,
    );
    assert.equal(
      (await f.service.read()).machines.phomemo_01.calibrated,
      false,
    );
  } finally {
    f.close();
  }
});
test("failed physical result requires recorded clearing before next job", async () => {
  const f = fixture();
  try {
    f.device.outcome = "missing";
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    await assert.rejects(
      f.service.clearFailed(j.id, {
        inspected: true,
        cleared: false,
        reason: "Inspected missing output",
      }),
      /Inspect and clear/,
    );
    await f.service.clearFailed(j.id, {
      inspected: true,
      cleared: true,
      reason: "Inspected missing output and cleared paper path",
    });
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      null,
    );
    assert.equal((await f.service.read()).machines.phomemo_01.paused, true);
    assert(
      (await f.service.job(j.id)).history.some(
        (h) => h.event === "owner_recovery",
      ),
    );
  } finally {
    f.close();
  }
});
test("content review allows documented authorization and requires new requester approval", async () => {
  const f = fixture();
  try {
    const j = await draft(f, "r1", { permission: "unclear" });
    await assert.rejects(
      f.service.approve(j.id, {
        specVersion: 1,
        artifactSha256: j.artifact.sha256,
      }),
      /operator/,
    );
    const reviewed = await f.service.operatorReview(
      j.id,
      "pass",
      "Club officer confirmed this is their own authorized design",
    );
    assert.equal(reviewed.productionState, "specified");
    assert.equal(reviewed.specVersion, 2);
    assert.equal(reviewed.approvedSpecHash, undefined);
    await assert.rejects(f.service.quote(j.id), /Approve/);
  } finally {
    f.close();
  }
});

test("replaying an old failure recovery cannot clear a new machine execution", async () => {
  const f = fixture();
  try {
    f.device.outcome = "missing";
    const old = await paid(f);
    await f.service.dispatch(old.id);
    await f.service.reconcile(old.id);
    await f.service.clearFailed(old.id, {
      inspected: true,
      cleared: true,
      reason: "Inspected failed output and cleared the paper path",
    });
    f.device.outcome = "visible";
    const next = await paid(f);
    await f.service.dispatch(next.id);
    const before = (await f.service.read()).machines.phomemo_01;
    await f.service.clearFailed(old.id, {
      inspected: true,
      cleared: true,
      reason: "Replayed old recovery must not affect new execution",
    });
    const after = (await f.service.read()).machines.phomemo_01;
    assert.equal(after.activeJobId, next.id);
    assert.equal(after.paused, before.paused);
  } finally {
    f.close();
  }
});
test("uncertain transfer reconciliation never submits a replacement", async () => {
  class UnknownTransfer extends MockPayment {
    transfers = 0;
    override async transfer(): Promise<PaymentResult> {
      this.transfers++;
      throw new Error("Connection lost around possible broadcast");
    }
    override async reconcile(
      j: Job,
      m: Machine,
      o: Operation,
    ): Promise<PaymentResult> {
      return {
        status: "pending",
        reference: o.reference ?? "uncertain-existing-ref",
        reason: "Unknown transaction; no replacement",
      };
    }
  }
  const p = new UnknownTransfer(),
    f = fixture(p);
  try {
    const j = await paid(f);
    await mutate(f.store, (s) => {
      s.jobs[j.id].evidence = { result: "pass" };
    });
    await f.service.transfer(j.id, "release");
    assert.equal((await f.service.job(j.id)).paymentState, "release_pending");
    await f.service.reconcile(j.id);
    await f.service.reconcile(j.id);
    await f.service.transfer(j.id, "release");
    assert.equal(p.transfers, 1);
    assert.equal((await f.service.job(j.id)).paymentState, "release_pending");
  } finally {
    f.close();
  }
});

test("disconnected idle node removes availability and requires explicit owner recovery", async () => {
  const f = fixture();
  try {
    await draft(f);
    const inspectionAt = now();
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.calibrationAt = inspectionAt;
    });
    f.device.call = async () => {
      throw new Error("Configured node disconnected");
    };
    await f.service.probeAvailability();
    const m = (await f.service.read()).machines.phomemo_01;
    assert.equal(m.ready, false);
    assert.equal(m.paused, true);
    assert.match(m.reason, /disconnected/);
    assert.equal(m.calibrated, true);
    assert.equal(m.calibrationAt, inspectionAt);
  } finally {
    f.close();
  }
});

test("operator can resolve an unknown settlement only with a confirmed matching existing transfer", async () => {
  const knownHash = "0x" + "a".repeat(64);
  const payment: PaymentBoundary = {
    mode: "testnet",
    async collect(j, op) {
      return {
        status: "pending",
        reference: "test-authorization-nonce",
        receipt: {
          mode: "testnet",
          kind: "collection",
          status: "pending",
          reference: "test-authorization-nonce",
          payer: "test-payer",
          amountCents: j.quote!.totalCents,
        },
      };
    },
    async transfer() {
      throw new Error("No transfer expected in this fixture");
    },
    async reconcile(j, m, op) {
      return {
        status:
          op.receipt?.transactionHash === knownHash ? "confirmed" : "failed",
        reference: "test-authorization-nonce",
        transactionHash: op.receipt?.transactionHash,
        receipt: {
          ...op.receipt,
          status:
            op.receipt?.transactionHash === knownHash ? "confirmed" : "failed",
        },
      };
    },
  };
  const f = fixture(payment);
  try {
    const j = await approved(f);
    await f.service.quote(j.id);
    await f.service.checkout(j.id, "stable-key");
    const op = Object.values((await f.service.read()).operations)[0];
    await assert.rejects(
      f.service.attachConfirmedPaymentReference(
        j.id,
        op.id,
        "0x" + "b".repeat(64),
        "Operator supplied a candidate settlement transaction",
      ),
      /not confirmed/,
    );
    assert.equal(
      (await f.service.job(j.id)).paymentState,
      "collection_pending",
    );
    assert.equal(
      (await f.service.read()).operations[op.id].transactionHash,
      undefined,
    );
    const confirmed = await f.service.attachConfirmedPaymentReference(
      j.id,
      op.id,
      knownHash,
      "Facilitator provided the confirmed matching transfer",
    );
    assert.equal(confirmed.paymentState, "held");
    assert(
      confirmed.history.some(
        (h) => h.event === "operator_payment_reconciliation",
      ),
    );
  } finally {
    f.close();
  }
});

test("failed trial economics never count quoted owner payout or platform fee as received", async () => {
  const f = fixture();
  try {
    f.device.outcome = "missing";
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    const measured = await f.service.recordEconomics(j.id, {
      consumablesCents: 20,
      machineSeconds: 30,
      handlingSeconds: 60,
      failedAttempts: 1,
      apiCostCents: 1,
      machineCostCents: 2,
    });
    assert.equal(measured.economics!.paymentStateAtRecording, "refunded");
    assert.equal(measured.economics!.ownerPayoutCents, 0);
    assert.equal(measured.economics!.platformFeeCents, 0);
    assert.equal(measured.economics!.quotedOwnerPayoutCents, 60);
    assert.equal(measured.economics!.ownerNetCents, -22);
    assert.equal(measured.economics!.platformMarginCents, -1);
  } finally {
    f.close();
  }
});

test("a delayed verification cannot undo completed handling or pause the next execution", async () => {
  const f = fixture();
  let unblock!: () => void;
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    const original = f.device.call.bind(f.device);
    let enter!: () => void,
      resultCalls = 0;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    f.device.call = async (tool, input) => {
      const response = await original(tool, input);
      if (
        tool === "camera_snapshot" &&
        input.phase === "result" &&
        ++resultCalls === 1
      ) {
        response.observation = "missing";
        enter();
        await gate;
      }
      return response;
    };
    const delayed = f.service.reconcile(j.id);
    await entered;
    await f.service.verify(j.id);
    const ready = await f.service.prepare(j.id, {
      removed: true,
      labeled: true,
      stored: true,
      cleared: true,
    });
    const next = await paid(f);
    await f.service.dispatch(next.id);
    const machineBefore = (await f.service.read()).machines.phomemo_01;
    unblock();
    await delayed;
    const final = await f.service.job(j.id);
    assert.equal(final.productionState, "produced");
    assert.equal(final.evidence.result, "pass");
    assert.equal(final.paymentState, "released");
    assert.equal(final.fulfillmentState, "ready_for_pickup");
    assert.equal(final.pickup!.code, ready.pickup!.code);
    assert.deepEqual(
      (await f.service.read()).machines.phomemo_01,
      machineBefore,
    );
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (op) => op.jobId === j.id && op.kind === "refund",
      ).length,
      0,
    );
  } finally {
    unblock?.();
    f.close();
  }
});

test("a delayed node error cannot replace a finalized outcome or pause new work", async () => {
  const f = fixture();
  let unblock!: () => void;
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    const original = f.device.call.bind(f.device);
    let enter!: () => void,
      statusCalls = 0;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    f.device.call = async (tool, input) => {
      if (tool === "get_status" && ++statusCalls === 1) {
        enter();
        await gate;
        throw new Error("Delayed disconnected response from old request");
      }
      return original(tool, input);
    };
    const delayed = f.service.reconcile(j.id);
    await entered;
    await f.service.reconcile(j.id);
    await f.service.prepare(j.id, {
      removed: true,
      labeled: true,
      stored: true,
      cleared: true,
    });
    const next = await paid(f);
    await f.service.dispatch(next.id);
    const before = (await f.service.read()).machines.phomemo_01;
    unblock();
    await delayed;
    assert.equal((await f.service.job(j.id)).productionState, "produced");
    assert.equal(
      (await f.service.job(j.id)).fulfillmentState,
      "ready_for_pickup",
    );
    assert.deepEqual((await f.service.read()).machines.phomemo_01, before);
  } finally {
    unblock?.();
    f.close();
  }
});

test("conflicting concurrent owner reviews preserve one outcome and one matching allocation", async () => {
  const f = fixture();
  try {
    f.device.outcome = "ambiguous";
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    await Promise.allSettled([
      f.service.operatorReview(
        j.id,
        "pass",
        "Owner confirmed matching visible output",
      ),
      f.service.operatorReview(
        j.id,
        "fail",
        "Other simultaneous stale inspection reported failure",
      ),
    ]);
    const final = await f.service.job(j.id);
    const transfers = Object.values((await f.service.read()).operations).filter(
      (op) => op.jobId === j.id && op.kind !== "collection",
    );
    assert.equal(transfers.length, 1);
    assert.equal(
      final.evidence.result,
      final.productionState === "produced" ? "pass" : "fail",
    );
    assert.equal(
      transfers[0].kind,
      final.productionState === "produced" ? "release" : "refund",
    );
    assert.equal(
      final.paymentState,
      final.productionState === "produced" ? "released" : "refunded",
    );
  } finally {
    f.close();
  }
});

test("background reconciliation recovers a crash between final outcome and transfer allocation", async () => {
  for (const outcome of ["produced", "failed"]) {
    const f = fixture();
    try {
      const j = await paid(f);
      await mutate(f.store, (s) => {
        const current = s.jobs[j.id];
        current.productionState = outcome;
        current.evidence = { result: outcome === "produced" ? "pass" : "fail" };
        s.machines.phomemo_01.activeJobId = j.id;
        s.machines.phomemo_01.ready = false;
      });
      // A new service sees only persisted state, with no allocation yet made.
      const restarted = new Service(
        f.store,
        f.device,
        f.service.payment,
        f.service.config,
      );
      await restarted.tick();
      await restarted.tick();
      const transfers = Object.values(
        (await f.service.read()).operations,
      ).filter((op) => op.jobId === j.id && op.kind !== "collection");
      assert.equal(transfers.length, 1);
      assert.equal(
        transfers[0].kind,
        outcome === "produced" ? "release" : "refund",
      );
      assert.equal(
        (await f.service.job(j.id)).paymentState,
        outcome === "produced" ? "released" : "refunded",
      );
    } finally {
      f.close();
    }
  }
});

test("background reconciliation retries a proven unsubmitted transfer after its prerequisite is repaired", async () => {
  class Prerequisite extends MockPayment {
    ready = false;
    calls = 0;
    override async transfer(j: Job, m: Machine, op: Operation) {
      this.calls++;
      if (!this.ready) throw new Error("OWNER_ADDRESS_REQUIRED");
      return super.transfer(j, m, op);
    }
  }
  const payment = new Prerequisite(),
    f = fixture(payment);
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    assert.equal((await f.service.job(j.id)).paymentState, "release_pending");
    payment.ready = true;
    await f.service.tick();
    await f.service.tick();
    assert.equal((await f.service.job(j.id)).paymentState, "released");
    assert.equal(payment.calls, 2);
    assert.equal(
      Object.values((await f.service.read()).operations).filter(
        (op) => op.jobId === j.id && op.kind === "release",
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});

test("handling requires explicit boolean confirmations rather than truthy values", async () => {
  const f = fixture();
  try {
    const j = await paid(f);
    await f.service.dispatch(j.id);
    await f.service.reconcile(j.id);
    for (const value of ["false", "true", 1, [], {}]) {
      await assert.rejects(
        f.service.prepare(j.id, {
          removed: value,
          labeled: true,
          stored: true,
          cleared: true,
        }),
        /Confirm removal/,
      );
    }
    assert.equal(
      (await f.service.job(j.id)).fulfillmentState,
      "awaiting_owner",
    );
    assert.equal(
      (await f.service.read()).machines.phomemo_01.activeJobId,
      j.id,
    );
  } finally {
    f.close();
  }
});

test("retrying approval preserves an existing quote and does not strand checkout", async () => {
  const f = fixture();
  try {
    const j = await approved(f);
    const quoted = await f.service.quote(j.id);
    const retried = await f.service.approve(j.id, {
      specVersion: j.specVersion,
      artifactSha256: j.artifact.sha256,
    });
    assert.equal(retried.productionState, "quoted");
    assert.equal(retried.quote!.id, quoted.quote!.id);
    await f.service.quote(j.id);
    assert.equal(
      (await f.service.checkout(j.id, "approval-retry-checkout")).paymentState,
      "held",
    );
  } finally {
    f.close();
  }
});

test("cancelled orders cannot be reopened by stale approval or specification requests", async () => {
  const f = fixture();
  try {
    const j = await approved(f);
    await f.service.quote(j.id);
    await f.service.cancel(j.id);
    await assert.rejects(
      f.service.approve(j.id, {
        specVersion: j.specVersion,
        artifactSha256: j.artifact.sha256,
      }),
      /cannot be reapproved/,
    );
    await assert.rejects(f.service.revise(j.id, spec, j.artifact), /cancelled/);
    await assert.rejects(f.service.quote(j.id), /active order/);
    assert.equal((await f.service.job(j.id)).productionState, "cancelled");
    assert.equal(
      (await f.service.read()).machines.phomemo_01.reservation,
      undefined,
    );
  } finally {
    f.close();
  }
});

test("replaying an older calibration resolution cannot clear a newer execution", async () => {
  const f = fixture();
  try {
    const calibrationArtwork = await draft(f, "team_owner");
    const calibration = await f.service.startCalibration(
      "phomemo_01",
      "team_owner",
      spec,
      calibrationArtwork.artifact,
      "old-calibration-resolution",
      true,
    );
    await f.service.resolveCalibration("phomemo_01", {
      attemptId: calibration.attemptId,
      inspected: true,
      result: "failed",
      reason: "Owner inspected failed calibration and cleared its paper path",
    });
    const next = await paid(f);
    await f.service.dispatch(next.id);
    const before = (await f.service.read()).machines.phomemo_01;
    await assert.rejects(
      f.service.resolveCalibration("phomemo_01", {
        attemptId: calibration.attemptId,
        inspected: true,
        result: "failed",
        reason: "Stale repeated inspection from an older calibration screen",
      }),
      /no longer the active/,
    );
    assert.deepEqual((await f.service.read()).machines.phomemo_01, before);
    assert.equal(before.activeJobId, next.id);
  } finally {
    f.close();
  }
});

test("a stale content inspection cannot authorize a newly revised unclear specification", async () => {
  const f = fixture();
  let unblock!: () => void;
  try {
    const j = await draft(f, "r1", { permission: "unclear" });
    const original = f.service.job.bind(f.service);
    let enter!: () => void,
      armed = true;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    f.service.job = async (id, actor) => {
      const snapshot = await original(id, actor);
      if (armed) {
        armed = false;
        enter();
        await gate;
      }
      return snapshot;
    };
    const reviewing = f.service.operatorReview(
      j.id,
      "pass",
      "Owner inspected permission for the original artwork",
    );
    await entered;
    await f.service.revise(
      j.id,
      { ...spec, permission: "unclear", quantity: 2 },
      j.artifact,
    );
    const rejected = assert.rejects(reviewing, /no longer current/);
    unblock();
    await rejected;
    const final = await f.service.job(j.id);
    assert.equal(final.specVersion, 2);
    assert.equal(final.spec.quantity, 2);
    assert.equal(final.spec.permission, "unclear");
    assert.equal(final.productionState, "needs_review");
    assert.equal(final.approvedSpecHash, undefined);
  } finally {
    unblock?.();
    f.close();
  }
});

test("authenticated calibration revocation clears stale inspection provenance and prevents stale resume", async () => {
  for (const calibrated of [false, undefined]) {
    const f = fixture();
    try {
      const j = await draft(f);
      const inspectionAt = now();
      await mutate(f.store, (s) => {
        s.machines.phomemo_01.calibrationAt = inspectionAt;
      });
      f.service.node.call = async (_tool, input) => ({
        machine_id: input.machine_id,
        mode: "simulation",
        ready: false,
        ...(calibrated === undefined ? {} : { calibrated }),
        reason:
          "Device or camera configuration changed; physical calibration required",
      });
      await f.service.probeAvailability();
      const machine = (await f.service.read()).machines.phomemo_01;
      assert.equal(machine.ready, false);
      assert.equal(machine.paused, true);
      assert.equal(machine.calibrated, calibrated === false ? false : true);
      assert.equal(
        machine.calibrationAt,
        calibrated === false ? undefined : inspectionAt,
      );
      await f.service.approve(j.id, {
        specVersion: j.specVersion,
        artifactSha256: j.artifact.sha256,
      });
      await assert.rejects(f.service.quote(j.id), /No ready machine/);
    } finally {
      f.close();
    }
  }
});

test("calibration idempotency keys must be bounded strings before any device intent is persisted", async () => {
  const f = fixture();
  try {
    const artwork = await draft(f, "team_owner");
    const before = await f.store.read();
    for (const key of [
      { length: 8 },
      ["01234567"],
      12345678,
      "x".repeat(201),
    ]) {
      await assert.rejects(
        f.service.startCalibration(
          "phomemo_01",
          "team_owner",
          spec,
          artwork.artifact,
          key as any,
          true,
        ),
        /stable idempotency key/,
      );
      assert.deepEqual(await f.store.read(), before);
    }
  } finally {
    f.close();
  }
});
