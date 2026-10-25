// The owner actions a job's state allows, exactly as the server enforces them.
// Nothing here is shown unless the job's current state permits it.
import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { needsHandling, waitingPickup } from "./status";
import type { Dashboard, OwnerJob, OwnerMachine } from "./data";

export type Act = (key: string, run: () => Promise<unknown>, done?: string) => Promise<boolean>;

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function JobActions({ job, machine, busy, act, now }: { job: OwnerJob; machine?: OwnerMachine; busy: string; act: Act; now: number }) {
  const recovered = job.history?.some((e) => e.event === "owner_recovery");
  const running = ["dispatched", "running", "verifying"].includes(job.productionState);
  // Printers on the producer side's hub finish from the machine's own report;
  // the owner only confirms the finished piece is off the printer.
  const onHub = Boolean(machine?.producerHub);
  return (
    <div className="sl-job-actions">
      {needsHandling(job) && (onHub ? <ClearPlateForm job={job} busy={busy} act={act} /> : <HandlingForm job={job} busy={busy} act={act} />)}
      {job.productionState === "needs_review" && <ReviewForm job={job} busy={busy} act={act} />}
      {job.productionState === "failed" && !recovered && <ClearForm job={job} busy={busy} act={act} />}
      {waitingPickup(job) && !job.pickup?.redeemedAt && <PickupForm job={job} busy={busy} act={act} now={now} />}
      {running && job.attemptId && <StopButton job={job} busy={busy} act={act} />}
    </div>
  );
}

function ClearPlateForm({ job, busy, act }: { job: OwnerJob; busy: string; act: Act }) {
  const [done, setDone] = useState(false);
  const plate = job.spec.outputType === "3d";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!done) return;
    const ok = await act(
      `${job.id}-clear-print`,
      () => api(`/owner/jobs/${job.id}/clear-print`, { cleared: true }),
      plate ? "Printed fine. The plate is clear and the printer takes the next order." : "Taken off. The printer takes the next order.",
    );
    if (ok) setDone(false);
  };
  return (
    <form className="sl-review" onSubmit={submit}>
      <h5>{plate ? "Take the print off the plate" : "Take the print off the printer"}</h5>
      <p className="sl-fine">
        {plate
          ? "The printer reported it finished. A 3D print stays on the build plate until you take it off, so the next order waits for you."
          : "The printer reported it finished. Take the piece off so the next order can start."}
      </p>
      <label className="sl-check">
        <input type="checkbox" checked={done} disabled={Boolean(busy)} onChange={(e) => setDone(e.target.checked)} />
        <span>{plate ? "I took the print off and the build plate is clear." : "I took the print off the printer."}</span>
      </label>
      <div className="sl-actions">
        <button className="sl-btn solid" type="submit" disabled={!done || Boolean(busy)}>
          {busy === `${job.id}-clear-print` ? "Saving…" : "Printed fine · approve and free the printer"}
        </button>
      </div>
    </form>
  );
}

function HandlingForm({ job, busy, act }: { job: OwnerJob; busy: string; act: Act }) {
  const [done, setDone] = useState(false);
  const [resume, setResume] = useState(true);
  // Orders taken without a charge have nothing to collect, so the server issues no pickup code for them.
  const demo = job.chargeable === false;
  // A 3D print stays on the build plate; resuming tells the printer the plate is clear.
  const plate = job.spec.outputType === "3d";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!done) return;
    const ok = await act(
      `${job.id}-prepare`,
      async () => {
        await api(`/owner/jobs/${job.id}/prepare`, { removed: true, labeled: true, stored: true, cleared: true });
        if (!resume || !job.machineId) return;
        // Preparing pauses the machine; resume it with the settings it has now.
        const dash = await api<Dashboard>("/owner/dashboard");
        const m = dash.machines.find((x) => x.id === job.machineId);
        if (m?.paused && !m.activeJobId)
          await api(`/owner/machines/${m.id}`, { paused: false, inspected: true, cleared: true }, "PATCH", { headers: { "If-Match": `"${m.settingsFingerprint}"` } });
      },
      `${demo ? "Handed off." : "Ready for pickup. The customer has their pickup code."} ${resume ? "The machine takes the next order." : "Resume the machine when you are ready."}`,
    );
    if (ok) setDone(false);
  };
  return (
    <form className="sl-review" onSubmit={submit}>
      <h5>{plate ? "Take the print off the plate" : demo ? "Take it off and hand it over" : "Prepare this item for collection"}</h5>
      {plate && <p className="sl-fine">The printer finished and waits with the print on the build plate. The next order starts once you clear it.</p>}
      <label className="sl-check">
        <input type="checkbox" checked={done} disabled={Boolean(busy)} onChange={(e) => setDone(e.target.checked)} />
        <span>{plate ? "I took the print off, labeled and stored it, and the build plate is clear." : "I removed and labeled the item, stored it safely, and cleared the machine."}</span>
      </label>
      <label className="sl-check">
        <input type="checkbox" checked={resume} disabled={Boolean(busy)} onChange={(e) => setResume(e.target.checked)} />
        <span>Then take the next order on this machine.</span>
      </label>
      <div className="sl-actions">
        <button className="sl-btn solid" type="submit" disabled={!done || Boolean(busy)}>
          {busy === `${job.id}-prepare` ? "Saving…" : plate && resume ? "Printed fine · approve and free the printer" : demo ? "Done · hand it over" : "Mark ready for pickup"}
        </button>
      </div>
    </form>
  );
}

function ReviewForm({ job, busy, act }: { job: OwnerJob; busy: string; act: Act }) {
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [reason, setReason] = useState("");
  const unclearArt = job.spec.permission === "unclear" && !job.attemptId;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act(`${job.id}-review`, () => api(`/owner/jobs/${job.id}/review`, { result, reason }), "Decision recorded.");
    if (ok) setReason("");
  };
  return (
    <form className="sl-review" onSubmit={submit}>
      <h5>{unclearArt ? "Confirm the artwork permission" : "Record your decision"}</h5>
      <p className="sl-fine">
        {unclearArt
          ? "Confirm the customer may print this artwork. Declined artwork cancels this unpaid order."
          : "Inspect the print and the machine first. Your reason stays in the order history."}
      </p>
      <div className="sl-form-grid">
        <label className="sl-field">
          <span className="sl-label">Result</span>
          <select className="sl-input" value={result} disabled={Boolean(busy)} onChange={(e) => setResult(e.target.value as "pass" | "fail")}>
            <option value="pass">{unclearArt ? "Allow artwork" : "Pass · output is there"}</option>
            <option value="fail">{unclearArt ? "Decline artwork" : "Fail · output missing or unusable"}</option>
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-label">Reason (8+ characters)</span>
          <input className="sl-input" required minLength={8} maxLength={1000} value={reason} disabled={Boolean(busy)} onChange={(e) => setReason(e.target.value)} placeholder="What you checked" />
        </label>
      </div>
      <div className="sl-actions">
        <button className="sl-btn solid" type="submit" disabled={reason.trim().length < 8 || Boolean(busy)}>
          {busy === `${job.id}-review` ? "Saving…" : "Record decision"}
        </button>
      </div>
    </form>
  );
}

function ClearForm({ job, busy, act }: { job: OwnerJob; busy: string; act: Act }) {
  const [inspected, setInspected] = useState(false);
  const [reason, setReason] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act(
      `${job.id}-clear`,
      () => api(`/owner/jobs/${job.id}/clear`, { inspected: true, cleared: true, reason }),
      "Execution cleared. The machine stays paused until you resume it.",
    );
    if (ok) {
      setInspected(false);
      setReason("");
    }
  };
  return (
    <form className="sl-review" onSubmit={submit}>
      <h5>Clear the failed run</h5>
      <p className="sl-fine">Inspect the machine before clearing it. This keeps the machine paused; resuming is a separate step.</p>
      <label className="sl-check">
        <input type="checkbox" checked={inspected} disabled={Boolean(busy)} onChange={(e) => setInspected(e.target.checked)} />
        <span>I inspected and cleared the output area.</span>
      </label>
      <label className="sl-field">
        <span className="sl-label">What you did (8+ characters)</span>
        <input className="sl-input" required minLength={8} maxLength={1000} value={reason} disabled={Boolean(busy)} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="sl-actions">
        <button className="sl-btn" type="submit" disabled={!inspected || reason.trim().length < 8 || Boolean(busy)}>
          {busy === `${job.id}-clear` ? "Clearing…" : "Clear and keep paused"}
        </button>
      </div>
    </form>
  );
}

function PickupForm({ job, busy, act, now }: { job: OwnerJob; busy: string; act: Act; now: number }) {
  const [code, setCode] = useState("");
  const expiresAt = job.pickup?.expiresAt;
  const expired = !!expiresAt && Date.parse(expiresAt) <= now;
  if (expired && expiresAt) {
    return (
      <div className="sl-review">
        <h5>Pickup code expired</h5>
        <p className="sl-fine">Issue a new code for the customer. The old one no longer works.</p>
        <div className="sl-actions">
          <button
            className="sl-btn"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(
                `${job.id}-renew-pickup`,
                () => api(`/owner/jobs/${job.id}/renew-pickup`, { idempotencyKey: newKey(), expectedVersion: job.version, expectedExpiresAt: expiresAt }),
                "New pickup code issued.",
              )
            }
          >
            {busy === `${job.id}-renew-pickup` ? "Issuing…" : "Issue a new pickup code"}
          </button>
        </div>
      </div>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act(`${job.id}-redeem`, () => api(`/owner/jobs/${job.id}/redeem`, { code }), "Handed over. Order collected.");
    if (ok) setCode("");
  };
  return (
    <form className="sl-review" onSubmit={submit}>
      <h5>Hand over to the customer</h5>
      <label className="sl-field">
        <span className="sl-label">Pickup code from the customer</span>
        <input className="sl-input sl-code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} disabled={Boolean(busy)} onChange={(e) => setCode(e.target.value)} />
      </label>
      <div className="sl-actions">
        <button className="sl-btn solid" type="submit" disabled={!code.trim() || Boolean(busy)}>
          {busy === `${job.id}-redeem` ? "Checking…" : "Hand over"}
        </button>
      </div>
    </form>
  );
}

function StopButton({ job, busy, act }: { job: OwnerJob; busy: string; act: Act }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm)
    return (
      <div className="sl-actions">
        <button className="sl-btn ghost sl-stop" type="button" onClick={() => setConfirm(true)}>
          Stop this print
        </button>
      </div>
    );
  return (
    <div className="sl-review">
      <p className="sl-fine">This asks the machine to stop. It does not prove the machine has stopped.</p>
      <div className="sl-actions">
        <button className="sl-btn danger" type="button" disabled={Boolean(busy)} onClick={() => void act(`${job.id}-abort`, () => api(`/owner/jobs/${job.id}/abort`, {}), "Stop requested.").then(() => setConfirm(false))}>
          {busy === `${job.id}-abort` ? "Requesting…" : "Confirm stop request"}
        </button>
        <button className="sl-btn ghost" type="button" onClick={() => setConfirm(false)}>
          Keep printing
        </button>
      </div>
    </div>
  );
}
