import { useEffect, useId, type SetStateAction } from "react";
import { useOwnerDraft } from "./owner-drafts";

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
  const [draft, setDraft] = useOwnerDraft(
    `payment:${jobId}`,
    () => ({ operationId: "", transactionHash: "", reason: "", failed: false }),
    (value) =>
      Boolean(value.operationId || value.transactionHash || value.reason),
  );
  const { operationId, transactionHash, reason, failed } = draft;
  const setOperationId = (operationId: string) =>
    setDraft((current) => ({ ...current, operationId }));
  const setTransactionHash = (transactionHash: string) =>
    setDraft((current) => ({ ...current, transactionHash }));
  const setReason = (reason: string) =>
    setDraft((current) => ({ ...current, reason }));
  const setFailed = (failed: boolean) =>
    setDraft((current) => ({ ...current, failed }));
  const pendingPayment = [
    "collection_pending",
    "release_pending",
    "refund_pending",
  ].includes(paymentState);
  const dirty = Boolean(operationId || transactionHash || reason);
  if (!pendingPayment) return null;
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
          aria-busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            setFailed(false);
            const accepted = await onSubmit({
              operationId,
              transactionHash: transactionHash.trim(),
              reason: reason.trim(),
            });
            if (accepted) {
              setOperationId("");
              setTransactionHash("");
              setReason("");
            } else setFailed(true);
          }}
        >
          <fieldset disabled={busy}>
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
              <label htmlFor={`${prefix}-reason`}>
                Payment recovery reason
              </label>
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
                The reference was not confirmed here. Refresh the existing
                payment record before retrying; no replacement payment was sent.
              </div>
            )}
            <button className="secondary" disabled={busy} type="submit">
              {busy
                ? "Checking transaction…"
                : "Validate confirmed transaction reference"}
            </button>
            {dirty && (
              <button
                className="secondary"
                disabled={busy}
                type="button"
                onClick={() => {
                  setOperationId("");
                  setTransactionHash("");
                  setReason("");
                  setFailed(false);
                }}
              >
                Discard payment draft
              </button>
            )}
          </fieldset>
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
  jobId,
  economics,
  simulation,
  busy,
  onSubmit,
}: {
  jobId: string;
  economics?: TrialEconomics;
  simulation: boolean;
  busy: boolean;
  onSubmit: (values: TrialEconomics) => Promise<boolean>;
}) {
  const prefix = useId();
  const fromSaved = () =>
    Object.fromEntries(
      trialFields.map(([key]) => [
        key,
        economics ? String(economics[key]) : "",
      ]),
    );
  const [draft, setDraft] = useOwnerDraft(
    `trial:${jobId}`,
    () => ({
      values: fromSaved(),
      error: "",
      dirty: false,
      baseRecordedAt: economics?.recordedAt,
      acceptedPendingRefresh: false,
    }),
    (value) => value.dirty,
  );
  const { values, error, dirty, baseRecordedAt, acceptedPendingRefresh } =
    draft;
  const setValues = (update: SetStateAction<Record<string, string>>) =>
    setDraft((current) => ({
      ...current,
      values: typeof update === "function" ? update(current.values) : update,
    }));
  const setError = (error: string) =>
    setDraft((current) => ({ ...current, error }));
  const setDirty = (dirty: boolean) =>
    setDraft((current) => ({ ...current, dirty }));
  const resetDraft = () => {
    setDraft({
      values: fromSaved(),
      baseRecordedAt: economics?.recordedAt,
      dirty: false,
      error: "",
      acceptedPendingRefresh: false,
    });
  };
  useEffect(() => {
    if (
      !dirty &&
      economics &&
      (!acceptedPendingRefresh || economics.recordedAt !== baseRecordedAt)
    ) {
      setDraft((current) => ({
        ...current,
        values: fromSaved(),
        baseRecordedAt: economics.recordedAt,
        acceptedPendingRefresh: false,
      }));
    }
  }, [economics?.recordedAt, dirty, acceptedPendingRefresh]);
  const newerSaved = dirty && economics?.recordedAt !== baseRecordedAt;
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
      {newerSaved && (
        <div className="notice" role="status">
          New saved measurements are available. Your unsaved values are kept;
          saving them will replace the saved record.
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              resetDraft();
            }}
          >
            Use saved measurements
          </button>
        </div>
      )}
      <form
        aria-label="Record trial costs and handling"
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const saveBaseRecordedAt = economics?.recordedAt;
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
              "The trial record could not be confirmed here. Refresh the existing order before retrying; your entered measurements are kept.",
            );
          else
            setDraft((current) => ({
              ...current,
              dirty: false,
              baseRecordedAt: saveBaseRecordedAt,
              acceptedPendingRefresh: true,
            }));
        }}
      >
        <fieldset disabled={busy}>
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
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setDirty(true);
                    setValues((current) => ({ ...current, [key]: value }));
                  }}
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
          {dirty && !newerSaved && (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={resetDraft}
            >
              Discard trial edits
            </button>
          )}
        </fieldset>
      </form>
    </details>
  );
}
