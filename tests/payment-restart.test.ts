import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntegratedPayment } from "../server/external.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState, now, id, type Operation } from "../server/model.ts";
import { Service, type Config } from "../server/service.ts";
import type {
  PaymentAdapter,
  PaymentOperation,
  PaymentReceipt,
} from "../integrations/src/payments.ts";
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "fabyn-payment-restart-"));
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const boundary = new IntegratedPayment(store, {
    FABYN_PAYMENT_MODE: "mock",
  });
  boundary.mode = "testnet";
  const config: Config = {
    mode: "simulation",
    paymentMode: "testnet",
    storeMode: "sqlite-development",
    assetOrigin: "http://127.0.0.1:1/assets",
    secret: "test-fixture-secret",
    quoteMs: 120000,
    pickupMs: 10000,
    ownerCode: "fixture-owner-code",
    dataDir: dir,
    nodeUrl: "http://127.0.0.1:1",
  };
  const service = new Service(
    store,
    {
      async call() {
        throw new Error("No physical execution in payment fixture");
      },
      token() {
        throw new Error("No execution token in payment fixture");
      },
    },
    boundary,
    config,
  );
  await mutate(store, (s) => {
    Object.assign(s.machines.phomemo_01, {
      calibrated: true,
      listed: true,
      paused: false,
      ready: true,
    });
    s.assets.a = {
      id: "a",
      ownerId: "r",
      path: "fixture",
      url: "/assets/a",
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 1,
      height: 1,
      createdAt: now(),
    };
  });
  const j = await service.create(
    "r",
    {
      assetIds: ["a"],
      intent: "Payment restart boundary fixture",
      outputType: "sticker",
      widthMm: 53,
      heightMm: 50,
      quantity: 1,
      material: "thermal-paper",
      permission: "authorized",
      crop: "contain",
    },
    { id: "a", url: "/assets/a", sha256: "a".repeat(64) },
  );
  await service.approve(j.id, {
    specVersion: 1,
    artifactSha256: j.artifact.sha256,
  });
  await service.quote(j.id);
  return {
    store,
    boundary,
    service,
    j,
    async close() {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
function receipt(
  op: PaymentOperation,
  kind: "collection" | "release" | "refund",
): PaymentReceipt {
  return {
    mode: "testnet",
    kind,
    status: "pending",
    reference: `fixture:${op.operationId}`,
    transactionHash: "0x" + "a".repeat(64),
    payer: "fixture-payer",
    amountCents: kind === "release" ? op.quote.ownerCents : op.quote.totalCents,
  };
}
function adapter(
  collect: (op: PaymentOperation) => Promise<PaymentReceipt>,
  release?: (op: PaymentOperation) => Promise<PaymentReceipt>,
): PaymentAdapter {
  return {
    mode: "testnet",
    async challenge() {
      throw new Error("Fixture passes explicit payload");
    },
    collect,
    release:
      release ??
      (async () => {
        throw new Error("No release expected");
      }),
    async refund() {
      throw new Error("No refund expected");
    },
    async reconcile(op) {
      return op.receipt!;
    },
  };
}
test("active verify/queued submission stays pending; restarted unsubmitted collection safely returns to unpaid", async () => {
  const f = await fixture();
  try {
    let unblock!: () => void,
      entered!: () => void,
      calls = 0;
    const waiting = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        unblock = r;
      });
    f.boundary.adapter = adapter(async (op) => {
      calls++;
      entered();
      await gate;
      const pending = receipt(op, "collection");
      await op.onSubmitted!(pending);
      return { ...pending, status: "confirmed" };
    });
    const checkout = f.service.checkout(f.j.id, "restart-checkout-key", {});
    await waiting;
    await f.service.reconcile(f.j.id);
    assert.equal(
      (await f.service.job(f.j.id)).paymentState,
      "collection_pending",
    );
    assert.equal(calls, 1);
    unblock();
    await checkout;
    assert.equal((await f.service.job(f.j.id)).paymentState, "held");
    // Separate fresh fixture models a process death after durable allocation but
    // before any library call/checkpoint. No fake onchain result is used to recover.
    const g = await fixture();
    try {
      const oldId = "allocated-before-crash";
      await mutate(g.store, (s) => {
        const j = s.jobs[g.j.id];
        j.paymentState = "collection_pending";
        j.checkoutKey = "crashed-checkout-key";
        j.collectionOperationId = oldId;
        s.operations[oldId] = {
          id: oldId,
          jobId: j.id,
          kind: "collection",
          status: "submitting",
          createdAt: now(),
          updatedAt: now(),
          amountCents: j.quote!.totalCents,
          mode: "testnet",
        };
      });
      g.boundary.adapter = adapter(async (op) => {
        const pending = receipt(op, "collection");
        await op.onSubmitted!(pending);
        return { ...pending, status: "confirmed" };
      });
      await g.service.reconcile(g.j.id);
      assert.equal((await g.service.job(g.j.id)).paymentState, "unpaid");
      assert.equal((await g.service.read()).operations[oldId].status, "failed");
      await g.service.checkout(g.j.id, "crashed-checkout-key", {});
      assert.equal((await g.service.job(g.j.id)).paymentState, "held");
      assert.notEqual(
        (await g.service.job(g.j.id)).collectionOperationId,
        oldId,
      );
      await g.service.applyPayment(oldId, {
        status: "failed",
        reference: "unsubmitted:" + oldId,
      });
      assert.equal((await g.service.job(g.j.id)).paymentState, "held");
    } finally {
      await g.close();
    }
  } finally {
    await f.close();
  }
});
test("restart retries a provably unsubmitted release with the same allocation; submitted unknown never resubmits", async () => {
  const f = await fixture();
  try {
    let transfers = 0;
    f.boundary.adapter = adapter(
      async (op) => {
        const pending = receipt(op, "collection");
        await op.onSubmitted!(pending);
        return { ...pending, status: "confirmed" };
      },
      async (op) => {
        transfers++;
        const pending = receipt(op, "release");
        await op.onSubmitted!(pending);
        return { ...pending, status: "confirmed" };
      },
    );
    await f.service.checkout(f.j.id, "funded-fixture-key", {});
    const opId = "release:" + f.j.id;
    await mutate(f.store, (s) => {
      const j = s.jobs[f.j.id];
      j.productionState = "produced";
      j.paymentState = "release_pending";
      s.operations[opId] = {
        id: opId,
        jobId: j.id,
        kind: "release",
        status: "submitting",
        createdAt: now(),
        updatedAt: now(),
        amountCents: j.quote!.ownerCents,
        mode: "testnet",
      };
    });
    await f.service.reconcile(f.j.id);
    assert.equal((await f.service.job(f.j.id)).paymentState, "released");
    assert.equal(transfers, 1);
    assert.equal((await f.service.read()).operations[opId].status, "confirmed");
    await f.service.reconcile(f.j.id);
    assert.equal(transfers, 1);
    // A different durable pending transfer has a checkpoint/hash: no new signing.
    const stored = (await f.service.read()).operations[opId];
    const pending = {
      ...stored,
      status: "pending" as const,
      receipt: { ...stored.receipt, status: "pending" as const },
    };
    const result = await f.boundary.reconcile(
      await f.service.job(f.j.id),
      (await f.service.read()).machines.phomemo_01,
      pending,
    );
    assert.equal(result.status, "pending");
    assert.equal(transfers, 1);
  } finally {
    await f.close();
  }
});
