import { useId, useState } from "react";

export type PaymentRecord = {
  id?: string;
  jobId?: string;
  mode?: string;
  kind?: string;
  status?: unknown;
  state?: unknown;
  receipt?: unknown;
};
export type TrialEconomics = {
  consumablesCents: number;
  machineSeconds: number;
  handlingSeconds: number;
  failedAttempts: number;
  apiCostCents: number;
  machineCostCents: number;
  ownerNetCents?: number;
  platformMarginCents?: number;
  ownerEarningsPerHandlingMinuteCents?: number | null;
  recordedAt?: string;
};
const amount = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );

export function PaymentReferenceForm({
  jobId,
  paymentState,
  records,
  busy,
  onSubmit,
}: {
  jobId: string;
  paymentState: string;
  records: PaymentRecord[];
  busy: boolean;
  onSubmit: (values: {
    operationId: string;
    transactionHash: string;
    reason: string;
  }) => Promise<boolean>;
}) {
  const prefix = useId();
  const [operationId, setOperationId] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);
  if (
    !["collection_pending", "release_pending", "refund_pending"].includes(
      paymentState,
    )
  )
    return null;
  const eligible = records.filter(
    (record) =>
      record.jobId === jobId &&
      record.mode === "testnet" &&
      String(record.status || record.state) === "pending" &&
      record.receipt &&
      record.id,
  );
  return (
    <details className="payment-recovery" open>
      <summary>Resolve a pending test payment</summary>
      <p>
        Use the confirmed Base Sepolia transaction for an existing saved
        operation. This validates the expected transfer and does not send a
        replacement payment. Unknown or mismatched references leave the payment
        pending.
      </p>
      {eligible.length ? (
        <form
          aria-label="Resolve pending test payment"
          onSubmit={async (e) => {
            e.preventDefault();
            setFailed(false);
            const accepted = await onSubmit({
              operationId,
              transactionHash: transactionHash.trim(),
              reason: reason.trim(),
            });
            if (accepted) {
              setTransactionHash("");
              setReason("");
            } else setFailed(true);
          }}
        >
          <div className="field">
            <label htmlFor={`${prefix}-operation`}>
              Pending test payment operation
            </label>
            <select
              id={`${prefix}-operation`}
              required
              value={operationId}
              onChange={(e) => setOperationId(e.target.value)}
            >
              <option value="">Choose a saved operation</option>
              {eligible.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.kind || "Payment"} · {record.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-transaction`}>
              Confirmed Base Sepolia transaction hash
            </label>
            <input
              id={`${prefix}-transaction`}
              required
              pattern="0x[0-9a-fA-F]{64}"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={transactionHash}
              onChange={(e) => setTransactionHash(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-reason`}>Payment recovery reason</label>
            <textarea
              id={`${prefix}-reason`}
              required
              minLength={10}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the observed transfer and why this reference belongs to the saved operation"
            />
          </div>
          {failed && (
            <div className="notice error" role="alert">
              The reference was not confirmed. The saved payment state is
              unchanged; check the workshop message before retrying.
            </div>
          )}
          <button className="secondary" disabled={busy} type="submit">
            {busy
              ? "Checking transaction…"
              : "Validate confirmed transaction reference"}
          </button>
        </form>
      ) : (
        <div className="notice">
          No pending testnet operation with a saved receipt is available for
          this order. Reconcile the existing payment record before attaching a
          transaction reference.
        </div>
      )}
    </details>
  );
}
const trialFields = [
  ["consumablesCents", "Consumables (USD cents)", 1],
  ["machineSeconds", "Machine time (seconds)", 0.1],
  ["handlingSeconds", "Owner handling time (seconds)", 0.1],
  ["failedAttempts", "Failed attempts", 1],
  ["apiCostCents", "API cost (USD cents)", 1],
  ["machineCostCents", "Machine cost (USD cents)", 1],
] as const;
export function TrialEconomicsForm({
  economics,
  simulation,
  busy,
  onSubmit,
}: {
  economics?: TrialEconomics;
  simulation: boolean;
  busy: boolean;
  onSubmit: (values: TrialEconomics) => Promise<boolean>;
}) {
  const prefix = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      trialFields.map(([key]) => [
        key,
        economics ? String(economics[key]) : "",
      ]),
    ),
  );
  const [error, setError] = useState("");
  return (
    <details className="trial-economics">
      <summary>Trial costs & handling time</summary>
      <p>
        {simulation
          ? "Simulation trial records do not establish physical consumable costs or hardware performance."
          : "Enter costs and times observed for this trial. Blank values remain unknown until entered."}{" "}
        These records do not change the quote or submit a payment.
      </p>
      {economics && (
        <dl className="trial-summary">
          <div>
            <dt>Owner allocation after recorded costs</dt>
            <dd>{amount(economics.ownerNetCents || 0)}</dd>
          </div>
          <div>
            <dt>Platform fee after API cost</dt>
            <dd>{amount(economics.platformMarginCents || 0)}</dd>
          </div>
          <div>
            <dt>Owner allocation per handling minute</dt>
            <dd>
              {economics.ownerEarningsPerHandlingMinuteCents == null
                ? "Not measured"
                : amount(economics.ownerEarningsPerHandlingMinuteCents)}
            </dd>
          </div>
        </dl>
      )}
      <form
        aria-label="Record trial costs and handling"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const result: TrialEconomics = {
            consumablesCents: Number(values.consumablesCents),
            machineSeconds: Number(values.machineSeconds),
            handlingSeconds: Number(values.handlingSeconds),
            failedAttempts: Number(values.failedAttempts),
            apiCostCents: Number(values.apiCostCents),
            machineCostCents: Number(values.machineCostCents),
          };
          if (
            Object.values(result).some(
              (value) =>
                typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0,
            )
          ) {
            setError("Enter a measured, non-negative value in every field.");
            return;
          }
          if (!(await onSubmit(result)))
            setError(
              "The trial record was not saved. Check the workshop message and retry.",
            );
        }}
      >
        <div className="form-grid">
          {trialFields.map(([key, label, step]) => (
            <div className="field" key={key}>
              <label htmlFor={`${prefix}-${key}`}>{label}</label>
              <input
                id={`${prefix}-${key}`}
                type="number"
                required
                min="0"
                step={step}
                value={values[key]}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    [key]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="secondary" type="submit" disabled={busy}>
          {busy ? "Saving trial record…" : "Save trial measurements"}
        </button>
      </form>
    </details>
  );
}
