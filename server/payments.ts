import type { Job, Operation, Machine } from "./model.ts";
export interface PaymentResult {
  status: "pending" | "confirmed" | "failed";
  reference: string;
  transactionHash?: string;
  reason?: string;
  receipt?: any;
  retryable?: boolean;
}
export interface PaymentBoundary {
  mode: "mock" | "testnet";
  challenge?(job: Job): Promise<any>;
  collect(job: Job, op: Operation, payload?: any): Promise<PaymentResult>;
  transfer(job: Job, machine: Machine, op: Operation): Promise<PaymentResult>;
  reconcile(job: Job, machine: Machine, op: Operation): Promise<PaymentResult>;
}
export class MockPayment implements PaymentBoundary {
  mode = "mock" as const;
  async collect(
    job: Job,
    op: Operation,
    payload?: any,
  ): Promise<PaymentResult> {
    return {
      status:
        payload?.simulationOutcome === "pending"
          ? "pending"
          : payload?.simulationOutcome === "failed"
            ? "failed"
            : "confirmed",
      reference: `mock:${op.id}`,
      reason: "Labeled mock payment; no funds moved.",
    };
  }
  async transfer(
    job: Job,
    machine: Machine,
    op: Operation,
  ): Promise<PaymentResult> {
    return {
      status: "confirmed",
      reference: `mock:${op.id}`,
      reason: "Labeled mock transfer; no funds moved.",
    };
  }
  async reconcile(
    job: Job,
    machine: Machine,
    op: Operation,
  ): Promise<PaymentResult> {
    return {
      status: "confirmed",
      reference: op.reference ?? `mock:${op.id}`,
      reason: "Mock operation reconciled.",
    };
  }
}
