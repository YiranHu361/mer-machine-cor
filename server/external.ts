import {
  createPaymentAdapter,
  type PaymentAdapter,
  type PaymentOperation,
  type PaymentReceipt,
} from "../integrations/src/payments.ts";
import type { Job, Machine, Operation } from "./model.ts";
import type {
  PaymentBoundary,
  PaymentResult,
  PaymentTarget,
} from "./payments.ts";
import type { Store } from "./store.ts";
import { mutate } from "./store.ts";
import { requireThat, record, now } from "./model.ts";
export class IntegratedPayment implements PaymentBoundary {
  adapter: PaymentAdapter;
  mode: "mock" | "testnet";
  private transferQueue = Promise.resolve();
  private inFlight = new Set<string>();
  constructor(
    public store: Store,
    env = process.env,
  ) {
    this.adapter = createPaymentAdapter(env);
    this.mode = this.adapter.mode;
  }
  operation(
    j: PaymentTarget,
    op: Operation,
    m?: Machine,
    payload?: any,
  ): PaymentOperation {
    return {
      jobId: j.id,
      operationId: op.id,
      quote: j.quote!,
      resourcePath: j.paymentResourcePath,
      payload,
      requesterAddress: j.requesterAddress,
      ownerAddress: m?.ownerAddress,
      receipt: op.receipt,
      onSubmitted: async (receipt) => {
        await mutate(this.store, (s) => {
          const existing = s.paymentReferences[receipt.reference];
          requireThat(
            !existing || existing === op.id,
            "PAYMENT_REPLAY",
            "Payment authorization is bound to another order.",
          );
          s.paymentReferences[receipt.reference] = op.id;
          const stored = s.operations[op.id];
          stored.receipt = receipt;
          stored.reference = receipt.reference;
          stored.transactionHash = receipt.transactionHash;
          stored.status = "pending";
          stored.updatedAt = now();
          if (s.jobs[j.id])
            record(
              s.jobs[j.id],
              "transaction_submitted",
              "Transaction outcome is pending confirmation.",
            );
        });
      },
    };
  }
  result(r: PaymentReceipt): PaymentResult {
    return { ...r, receipt: r };
  }
  async challenge(j: PaymentTarget) {
    return this.adapter.challenge({
      jobId: j.id,
      operationId: `collect:${j.id}`,
      quote: j.quote!,
      resourcePath: j.paymentResourcePath,
    });
  }
  private async submissionError(op: Operation, error: unknown) {
    const stored = (await this.store.read()).data.operations[op.id];
    const prefix =
      /^([A-Z][A-Z0-9_]+)(?::|$)/.exec((error as Error).message)?.[1] ??
      "PAYMENT_SERVICE_UNAVAILABLE";
    return Object.assign(
      new Error(
        `${prefix}: ${stored?.receipt ? "Reconcile the recorded operation before any replacement." : "No submission was recorded. Check test-payment configuration and retry."}`,
      ),
      { safeToRetry: !stored?.receipt },
    );
  }
  async collect(j: PaymentTarget, op: Operation, payload?: any) {
    this.inFlight.add(op.id);
    try {
      return this.result(
        await this.adapter.collect(this.operation(j, op, undefined, payload)),
      );
    } catch (e) {
      throw await this.submissionError(op, e);
    } finally {
      this.inFlight.delete(op.id);
    }
  }
  async transfer(j: Job, m: Machine, op: Operation) {
    // Include queued signing work, not only the currently signing operation.
    this.inFlight.add(op.id);
    const run = async () => {
      try {
        return this.result(
          await (op.kind === "release"
            ? this.adapter.release(this.operation(j, op, m))
            : this.adapter.refund(this.operation(j, op, m))),
        );
      } catch (e) {
        throw await this.submissionError(op, e);
      }
    };
    const task = this.transferQueue.then(run);
    this.transferQueue = task.then(
      () => {},
      () => {},
    );
    return task.finally(() => {
      this.inFlight.delete(op.id);
    });
  }
  async reconcile(
    j: PaymentTarget,
    m: Machine,
    op: Operation,
  ): Promise<PaymentResult> {
    if (this.inFlight.has(op.id))
      return {
        status: "pending",
        reference: op.reference ?? `allocation:${op.id}`,
        reason:
          "The existing submission is still running; no replacement is permitted.",
      };
    if (this.mode === "testnet" && !op.receipt) {
      // This adapter awaits its durable checkpoint before settlement/broadcast.
      // With no live call and no checkpoint, a restarted process can prove that
      // this allocation did not submit funds. It never reconstructs a signature.
      return {
        status: "failed",
        reference: `unsubmitted:${op.id}`,
        retryable: op.kind !== "collection",
        reason:
          "No durable submission checkpoint exists and no call is active. No collection/transfer was submitted; retry the authorized operation.",
      };
    }
    if (this.mode === "mock" && !op.receipt) {
      const request = this.operation(j, op, m);
      return this.result(
        await (op.kind === "collection"
          ? this.adapter.collect(request)
          : op.kind === "release"
            ? this.adapter.release(request)
            : this.adapter.refund(request)),
      );
    }
    return this.result(await this.adapter.reconcile(this.operation(j, op, m)));
  }
}
