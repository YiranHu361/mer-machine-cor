// One card per real machine: its 3D model, live state, controls and the queue of
// orders on it. Every control is shown only when the server allows it now.
import { useState } from "react";
import { api } from "../../api";
import { checkPrinter, checkedAgo } from "./printers";
import { MachineViewport } from "./MachineViewport";
import { Connections } from "./Connections";
import { JobActions, type Act } from "./JobActions";
import { estimateJob, formatEta, type JobEstimate } from "./estimate";
import { finished, intakeOf, jobStateLabel, jobTitle, machineStatus, MACHINE_LABEL, needsHandling, needsMaker, onLine, stopReason, supplyOf, viaAgent, waitingPickup, type MachineKey } from "./status";
import type { Connector, OwnerJob, OwnerMachine, PrinterCheck, PrinterStatusRow } from "./data";

const MODE_LABEL = { simulation: "runs on the workshop node", hardware: "connected printer" } as const;
const ORDER_PRIORITY = (j: OwnerJob) => (["dispatched", "running", "verifying"].includes(j.productionState) ? 0 : needsMaker(j) ? 1 : 2);

export function Machines({ machines, jobs, connectors, printers = [], busy, act, now }: { machines: OwnerMachine[]; jobs: OwnerJob[]; connectors: Connector[]; printers?: PrinterStatusRow[]; busy: string; act: Act; now: number }) {
  const connections = <Connections act={act} busy={busy} now={now} />;
  if (machines.length === 0)
    return (
      <>
        {connections}
        <div className="sl-panel">
          <h2 className="sl-h2">No machines yet.</h2>
          <p className="sl-lede">Add a machine to start taking orders.</p>
        </div>
      </>
    );
  return (
    <>
      {connections}
      <div className="sl-machines">
        {machines.map((m) => (
          <MachineCard key={m.id} machine={m} jobs={jobs} connector={connectors.find((c) => c.machineId === m.id)} printer={printers.find((p) => p.id === m.id)} busy={busy} act={act} now={now} />
        ))}
      </div>
    </>
  );
}

function MachineCard({ machine: m, jobs, connector, printer, busy, act, now }: { machine: OwnerMachine; jobs: OwnerJob[]; connector?: Connector; printer?: PrinterStatusRow; busy: string; act: Act; now: number }) {
  const status = machineStatus(m, connector, jobs);
  const mine = jobs.filter((j) => j.machineId === m.id);
  const line = mine.filter(onLine).sort((a, b) => ORDER_PRIORITY(a) - ORDER_PRIORITY(b) || a.createdAt.localeCompare(b.createdAt));
  const pickups = mine.filter(waitingPickup);
  const done = mine.filter(finished).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  // Each job starts when the one before it on this machine is expected to finish.
  let free = 0;
  const rows = line.map((j) => {
    const est = estimateJob(j, m, free, now);
    free = est.etaSeconds ?? free;
    return { job: j, est };
  });
  const current = line.find((j) => ["dispatched", "running", "verifying"].includes(j.productionState));
  const progress = current ? (estimateJob(current, m, 0, now).percent ?? 0) / 100 : line.some(needsHandling) ? 1 : 0;
  const modeLabel = MODE_LABEL[m.mode];
  const key: MachineKey = status.key;
  return (
    <article className={`sl-machine is-${key}`} aria-labelledby={`sl-m-${m.id}`}>
      <MachineViewport model={m.model} progress={progress} label={`${m.name}, ${m.model}`} />
      <div className="sl-machine-body">
        <header className="sl-machine-head">
          <h3 id={`sl-m-${m.id}`} className="sl-h3">
            {m.name}
          </h3>
          <span className={`sl-state is-${key}`}>
            <i aria-hidden="true" />
            {MACHINE_LABEL[key]}
          </span>
        </header>
        <p className="sl-fine">
          {m.model} · {modeLabel}
          {m.producerHub ? " · through the producer hub" : ""} · {m.mediaRemaining} {supplyOf(m).unit}
        </p>
        <p className="sl-note">{status.note}</p>
        <PrinterCheckRow machine={m} printer={printer} now={now} />
        <MachineControls machine={m} busy={busy} act={act} />
        <section className="sl-queue" aria-label={`Queue on ${m.name}`}>
          <h4 className="sl-h4">
            Queue on this machine <span>{line.length}</span>
          </h4>
          {rows.length === 0 && <p className="sl-fine">Nothing queued. New orders that fit this machine appear here within seconds.</p>}
          <ul className="sl-jobs">
            {rows.map(({ job, est }) => (
              <JobRow key={job.id} job={job} est={est} machine={m} allJobs={jobs} busy={busy} act={act} now={now} />
            ))}
          </ul>
          {pickups.length > 0 && (
            <details className="sl-pickups" open>
              <summary>Waiting for pickup · {pickups.length}</summary>
              <ul className="sl-jobs">
                {pickups.map((job) => (
                  <JobRow key={job.id} job={job} est={{ percent: null, etaSeconds: null }} machine={m} allJobs={jobs} busy={busy} act={act} now={now} />
                ))}
              </ul>
            </details>
          )}
          {done.length > 0 && (
            <details className="sl-pickups sl-done" open>
              <summary>Done on this machine · {done.length}</summary>
              <ul className="sl-done-list">
                {done.map((job) => (
                  <li key={job.id}>
                    <span className="sl-thumb sm">{job.artifact?.previewUrl ? <img src={job.artifact.previewUrl} alt="" /> : null}</span>
                    <span className="sl-done-title">{jobTitle(job)}</span>
                    <span className="sl-done-meta">
                      {intakeOf(job).label} · {jobStateLabel(job).text}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </article>
  );
}

function MachineControls({ machine: m, busy, act }: { machine: OwnerMachine; busy: string; act: Act }) {
  const [inspected, setInspected] = useState(false);
  const headers = { "If-Match": `"${m.settingsFingerprint}"` };
  const patch = (key: string, body: Record<string, unknown>, done: string) => {
    setInspected(false);
    return act(`${m.id}-${key}`, () => api(`/owner/machines/${m.id}`, body, "PATCH", { headers }), done);
  };
  const calibrate = () => act(`${m.id}-calibrate`, () => api(`/owner/machines/${m.id}/calibrate`, { inspected: true }), "Calibrated. Resume it when you are ready.");
  const hasActiveJob = Boolean(m.activeJobId);
  const busyHere = (k: string) => busy === `${m.id}-${k}`;
  return (
    <div className="sl-controls">
      {!m.calibrated && (
        <div className="sl-control-block">
          <p className="sl-fine">Inspect the output area, load media and clear the machine, then confirm calibration.</p>
          {m.mode === "simulation" ? (
            <>
              <label className="sl-check">
                <input type="checkbox" checked={inspected} disabled={Boolean(busy)} onChange={(e) => setInspected(e.target.checked)} />
                <span>I inspected the output area, loaded media and cleared the machine.</span>
              </label>
              <div className="sl-actions">
                <button className="sl-btn" type="button" disabled={!inspected || Boolean(busy)} onClick={() => void calibrate()}>
                  {busyHere("calibrate") ? "Calibrating…" : "Confirm calibration"}
                </button>
              </div>
            </>
          ) : (
            <p className="sl-fine">
              Calibrate this machine at the machine itself, then use Connections to check its status.
            </p>
          )}
        </div>
      )}
      {m.calibrated && !m.paused && (
        <div className="sl-actions">
          <button className="sl-btn" type="button" disabled={Boolean(busy)} onClick={() => void patch("pause", { paused: true }, "Paused. No new orders go to this machine.")}>
            {busyHere("pause") ? "Pausing…" : "Pause"}
          </button>
          <button className="sl-btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void patch("listed", { listed: !m.listed }, m.listed ? "Hidden from new orders." : "Listed for new orders.")}>
            {m.listed ? "Unlist" : "List for orders"}
          </button>
        </div>
      )}
      {m.calibrated && m.paused && hasActiveJob && (
        <div className="sl-control-block">
          <p className="sl-fine">Paused until you finish the job below.</p>
        </div>
      )}
      {m.calibrated && m.paused && !hasActiveJob && (
        <div className="sl-control-block">
          <label className="sl-check">
            <input type="checkbox" checked={inspected} disabled={Boolean(busy)} onChange={(e) => setInspected(e.target.checked)} />
            <span>I inspected the output area and cleared the machine.</span>
          </label>
          <div className="sl-actions">
            <button
              className="sl-btn solid"
              type="button"
              disabled={!inspected || Boolean(busy)}
              onClick={() => void patch("resume", { paused: false, inspected: true, cleared: true }, "Resumed. It takes orders again.")}
            >
              {busyHere("resume") ? "Resuming…" : "Resume taking orders"}
            </button>
            <button className="sl-btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void patch("listed", { listed: !m.listed }, m.listed ? "Hidden from new orders." : "Listed for new orders.")}>
              {m.listed ? "Unlist" : "List for orders"}
            </button>
          </div>
        </div>
      )}
      {m.mediaRemaining < 20 && (
        <div className="sl-actions">
          <button className="sl-btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void patch("media", { mediaRemaining: supplyOf(m).capacity }, `${supplyOf(m).refill} done.`)}>
            {busyHere("media") ? "Saving…" : `${supplyOf(m).refill} · ${supplyOf(m).capacity}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Asks the machine to answer once (printing nothing) and shows what it said. */
function PrinterCheckRow({ machine: m, printer, now }: { machine: OwnerMachine; printer?: PrinterStatusRow; now: number }) {
  const [state, setState] = useState<{ checking: boolean; result: PrinterCheck | null; error: string }>({ checking: false, result: null, error: "" });
  const latest: PrinterCheck | null =
    state.result ?? (printer ? { ok: printer.status === "connected" || printer.status === "busy", detail: printer.detail, checkedAt: printer.checkedAt } : null);
  const run = async () => {
    setState((s) => ({ ...s, checking: true, error: "" }));
    try {
      const result = await checkPrinter(m);
      setState({ checking: false, result, error: "" });
    } catch (error) {
      setState({ checking: false, result: null, error: error instanceof Error ? error.message : "The check did not go through. Try again." });
    }
  };
  return (
    <div className="sl-check-row" aria-live="polite">
      <button className="sl-btn ghost sl-btn-sm" type="button" disabled={state.checking} onClick={() => void run()}>
        {state.checking ? "Checking…" : "Check printer"}
      </button>
      {latest && !state.checking && (
        <span className={`sl-check-result ${latest.ok ? "ok" : "bad"}`}>
          <i aria-hidden="true" />
          {latest.ok ? "Answered" : "No answer"} · {checkedAgo(latest.checkedAt, now)}
          {latest.detail ? <em> · {latest.detail}</em> : null}
        </span>
      )}
      {state.error && <span className="sl-check-result bad">{state.error}</span>}
    </div>
  );
}

function JobRow({ job, est, machine, allJobs, busy, act, now }: { job: OwnerJob; est: JobEstimate; machine: OwnerMachine; allJobs: OwnerJob[]; busy: string; act: Act; now: number }) {
  const intake = intakeOf(job);
  const state = jobStateLabel(job);
  const siblings = job.orderId ? allJobs.filter((j) => j.orderId === job.orderId) : [];
  const siblingMachines = new Set(siblings.map((j) => j.machineId)).size;
  const title = jobTitle(job);
  const why = stopReason(job);
  return (
    <li className={`sl-job tone-${state.tone}`}>
      <div className="sl-thumb">
        {job.artifact?.previewUrl ? <img src={job.artifact.previewUrl} alt={`Preview of ${title}`} /> : <span aria-hidden="true">{machine.outputType === "3d" ? "3D" : "▢"}</span>}
      </div>
      <div className="sl-job-main">
        <p className={`sl-jobstate tone-${state.tone}`}>
          <i aria-hidden="true" />
          {state.text}
        </p>
        <h5>{title}</h5>
        <p className="sl-chips">
          <span className="from" title={intake.detail}>
            from · {intake.label}
          </span>
          {viaAgent(job) && <span className="agent">via ASI:One</span>}
          {job.orderId && (
            <span>
              order {job.orderId.slice(-6)}
              {siblings.length > 1 ? ` · ${siblings.length} items on ${siblingMachines} machine${siblingMachines === 1 ? "" : "s"}` : ""}
            </span>
          )}
        </p>
        {why && <p className="sl-why">{why}</p>}
        {est.percent !== null && <Progress percent={est.percent} eta={est.etaSeconds} label={title} />}
        <JobActions job={job} machine={machine} busy={busy} act={act} now={now} />
      </div>
    </li>
  );
}

function Progress({ percent, eta, label }: { percent: number; eta: number | null; label: string }) {
  return (
    <div className="sl-progress">
      <div className="sl-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`Progress for ${label}`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="sl-fine">
        {percent}%{eta !== null && eta > 0 ? ` · ${formatEta(eta)} · estimate` : eta === 0 ? " · done" : ""}
      </p>
    </div>
  );
}
