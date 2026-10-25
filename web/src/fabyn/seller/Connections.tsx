// Real printers: the producer side's Python, its hub, one program per printer,
// each printer's link and our machine counters on the hub. Every light comes
// from the local probe or a timestamped producer report, with the time it was
// checked; each missing piece has one step to fix it. Steps that start programs
// or save codes work only on the Mac that runs fabyn.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../../api";
import type { Act } from "./JobActions";
import { checkedAgo } from "./printers";
import "./connections.css";

type Light = "ok" | "warn" | "bad" | "unknown";
interface Row {
  light: Light;
  detail: string;
  checkedAt: string | null;
  expiresAt?: string;
}
interface StepState {
  key: string;
  running: boolean;
  startedAt: string;
  ok?: boolean;
  detail: string;
  log: string[];
}
interface MachineConn {
  ours: string;
  theirs: string;
  name: string;
  link: "ble" | "lan";
  threeD: boolean;
  host?: string;
  program: Row & { running: boolean; online: boolean; startedHere: boolean };
  device: Row;
  accessCode?: { present: boolean; fromEnvName: string | null };
  orders: Row & { onHub: boolean; known: boolean };
}
interface MvpStatus {
  cloud?: boolean;
  local: boolean;
  app: Row & { realMachines: boolean };
  python: Row & { ready: boolean };
  hub: Row & { url: string; running: boolean; startedHere: boolean };
  machines: MachineConn[];
  actions: Record<string, StepState>;
}

const LIGHT_TEXT: Record<Light, string> = { ok: "ready", warn: "starting", bad: "not ready", unknown: "not checked" };
/** Of a row's steps, the one started last, so its result shows under the row. */
const latest = (actions: Record<string, StepState>, keys: string[]) =>
  keys.filter((k) => actions[k]).sort((a, b) => actions[b].startedAt.localeCompare(actions[a].startedAt))[0] ?? keys[0];

export function Connections({ act, busy, now }: { act: Act; busy: string; now: number }) {
  const [savedStatus, setStatus] = useState<MvpStatus | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState("");
  const [note, setNote] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const fresh = <T extends Row,>(row: T): T => row.expiresAt && now > Date.parse(row.expiresAt)
    ? { ...row, light: "bad", detail: "Producer offline: no heartbeat in the last 20 seconds." }
    : row;
  const status = savedStatus ? { ...savedStatus,
    python: { ...fresh(savedStatus.python), ready: savedStatus.python.ready && fresh(savedStatus.python).light === "ok" },
    hub: { ...fresh(savedStatus.hub), running: savedStatus.hub.running && fresh(savedStatus.hub).light === "ok" },
    machines: savedStatus.machines.map((m) => ({ ...m,
      program: { ...fresh(m.program), online: m.program.online && fresh(m.program).light === "ok", running: m.program.running && fresh(m.program).light === "ok" },
      device: fresh(m.device),
    })),
  } : null;
  const load = useCallback(async () => {
    try {
      setStatus(await api<MvpStatus>("/owner/mvp/status"));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This app cannot check real printers yet. Update it to the latest version." : e instanceof Error ? e.message : "The connection checks did not answer.");
    }
  }, []);
  const stepping = Boolean(status && Object.values(status.actions).some((a) => a.running));
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), stepping ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [load, stepping]);

  const step = async (name: string, body: Record<string, unknown> = {}, key = name) => {
    setSending(key);
    setNote(null);
    try {
      const r = await api<{ detail?: string }>(`/owner/mvp/steps/${name}`, body);
      if (r.detail) setNote({ key, ok: true, text: r.detail });
    } catch (e) {
      setNote({ key, ok: false, text: e instanceof Error ? e.message : "That step did not start." });
    } finally {
      setSending("");
      await load();
    }
  };

  if (!status)
    return (
      <section className="sl-panel sl-conn" aria-label="Real printer connections">
        <p className="sl-fine" role="status">
          {error || "Checking the real printers…"}
        </p>
      </section>
    );
  const shown = open ?? status.app.realMachines;
  const ready = status.machines.filter((m) => m.program.light === "ok" && m.device.light === "ok" && m.orders.onHub).length;
  const can = (key: string) => status.local && !sending && !busy && !status.actions[key]?.running;
  const shared = { status, now, sending, note, can, step };
  return (
    <section className="sl-panel sl-conn" aria-labelledby="sl-conn-title">
      <header className="sl-conn-head">
        <div>
          <p className="sl-kicker">real printers</p>
          <h2 id="sl-conn-title" className="sl-h2">
            Connections
          </h2>
        </div>
        <p className="sl-conn-sum">
          {ready} of {status.machines.length} printers take orders
          <button className="sl-btn ghost sl-btn-sm" type="button" aria-expanded={shown} onClick={() => setOpen(!shown)}>
            {shown ? "Hide" : "Set up"}
          </button>
        </p>
      </header>
      {error && <p className="sl-error">{error}</p>}
      {shown && (
        <>
          {!status.local && (
            <p className="sl-note unclear" role="note">
              {status.cloud
                ? <>Start <code>npm run producer</code> on the machine computer. Device settings and access codes stay there; this page shows its connection and lets you link tested printers.</>
                : <>Open this page on the Mac that runs fabyn to start programs or save codes. Here you can see the state only.</>}
            </p>
          )}
          <ol className="sl-conn-list">
            <ConnRow title="The app" row={status.app} now={now} />
            <ConnRow title="Printer programs' Python" row={status.python} stepKey={latest(status.actions, ["install-python", "check-python"])} {...shared}>
              {!status.python.ready && (
                <button className="sl-btn solid sl-btn-sm" type="button" disabled={!can("install-python")} onClick={() => void step("install-python")}>
                  Install
                </button>
              )}
              <button className="sl-btn ghost sl-btn-sm" type="button" disabled={!can("check-python")} onClick={() => void step("check-python")}>
                Check again
              </button>
            </ConnRow>
            <ConnRow title="Hub" row={status.hub} stepKey={latest(status.actions, ["start-hub", "stop-hub"])} {...shared}>
              {!status.hub.running && (
                <button className="sl-btn solid sl-btn-sm" type="button" disabled={!can("start-hub") || !status.python.ready} onClick={() => void step("start-hub")}>
                  Start hub
                </button>
              )}
              {!status.hub.running && !status.python.ready && <span className="sl-conn-why">Install Python first.</span>}
              {status.hub.running && status.hub.startedHere && (
                <button className="sl-btn ghost sl-btn-sm" type="button" disabled={!can("stop-hub")} onClick={() => void step("stop-hub")}>
                  Stop hub
                </button>
              )}
            </ConnRow>
          </ol>
          <div className="sl-conn-machines">
            {status.machines.map((m) => (
              <MachineConnections key={m.theirs} machine={m} act={act} reload={load} {...shared} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type Shared = {
  status: MvpStatus;
  now: number;
  sending: string;
  note: { key: string; ok: boolean; text: string } | null;
  can: (key: string) => boolean;
  step: (name: string, body?: Record<string, unknown>, key?: string) => Promise<void>;
};

function MachineConnections({ machine: m, act, reload, ...shared }: { machine: MachineConn; act: Act; reload: () => Promise<void> } & Shared) {
  const { status, now, can, step } = shared;
  const [tested, setTested] = useState(false);
  const [code, setCode] = useState("");
  const startKey = `start-node:${m.theirs}`;
  const findKey = m.link === "lan" ? `find-device:${m.theirs}` : "find-device:ble";
  const testKey = `test-device:${m.theirs}`;
  // Why a step's button is off: the piece before it is not ready yet.
  const startWhy = !status.python.ready ? "Install Python first." : !status.hub.running ? "Start the hub first." : m.link === "lan" && !m.accessCode?.present ? "Save its access code first." : "";
  const testWhy =
    m.link === "ble" && !m.program.online ? "Start its program first; it checks the printer." : m.link === "lan" && !m.program.online && !m.accessCode?.present ? "Save its access code first." : "";
  const saveCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    await step("set-access-code", { machine: m.theirs, code: code.trim() }, `code:${m.theirs}`);
    setCode("");
  };
  const useMachine = async () => {
    await act(`${m.ours}-hub`, () => api(`/owner/machines/${m.ours}/producer-hub`, { producerMachineId: m.theirs, confirmTestPrint: true }), "Orders now go to this printer.");
    setTested(false);
    await reload();
  };
  return (
    <article className="sl-conn-machine" aria-labelledby={`sl-conn-${m.theirs}`}>
      <h3 id={`sl-conn-${m.theirs}`} className="sl-h3">
        {m.name}
      </h3>
      <ol className="sl-conn-list">
        <ConnRow title="Its program" row={m.program} stepKey={latest(status.actions, [startKey, `stop-node:${m.theirs}`])} {...shared}>
          {!m.program.online && !m.program.running && (
            <>
              <button
                className="sl-btn solid sl-btn-sm"
                type="button"
                disabled={!can(startKey) || !status.hub.running || (m.link === "lan" && !m.accessCode?.present)}
                onClick={() => void step("start-node", { machine: m.theirs }, startKey)}
              >
                Start program
              </button>
              {startWhy && <span className="sl-conn-why">{startWhy}</span>}
            </>
          )}
          {m.program.running && m.program.startedHere && (
            <button className="sl-btn ghost sl-btn-sm" type="button" disabled={!can(`stop-node:${m.theirs}`)} onClick={() => void step("stop-node", { machine: m.theirs }, `stop-node:${m.theirs}`)}>
              Stop program
            </button>
          )}
        </ConnRow>
        <ConnRow title={m.link === "lan" ? `Printer on the network${m.host ? ` · ${m.host}` : ""}` : "Printer over Bluetooth"} row={m.device} stepKey={latest(status.actions, [findKey, testKey])} {...shared}>
          <button className="sl-btn ghost sl-btn-sm" type="button" disabled={!can(findKey) || !status.python.ready} onClick={() => void step("find-device", { machine: m.theirs }, findKey)}>
            {m.link === "lan" ? "Find it on the network" : "Find it nearby"}
          </button>
          <button
            className="sl-btn ghost sl-btn-sm"
            type="button"
            disabled={status.cloud ? !m.program.online || Boolean(shared.sending) : !can(testKey) || (m.link === "ble" ? !m.program.online : !m.program.online && (!status.python.ready || !m.accessCode?.present))}
            onClick={() => void step("test-device", { machine: m.theirs }, testKey)}
          >
            Test connection
          </button>
          {testWhy && <span className="sl-conn-why">{testWhy}</span>}
        </ConnRow>
        {m.accessCode && (
          <ConnRow
            title="LAN access code"
            row={{
              light: m.accessCode.present ? "ok" : "bad",
              detail: m.accessCode.present
                ? "Saved for its program in producer-side/.env. It is never shown here."
                : "Missing. Copy it from .env, or type the code on the printer screen (Settings › WLAN).",
              checkedAt: status.app.checkedAt,
            }}
            stepKey={`code:${m.theirs}`}
            {...shared}
          >
            {!m.accessCode.present && m.accessCode.fromEnvName && (
              <button className="sl-btn solid sl-btn-sm" type="button" disabled={!can(`code:${m.theirs}`)} onClick={() => void step("copy-access-code", { machine: m.theirs }, `code:${m.theirs}`)}>
                Use the code from .env
              </button>
            )}
            <form className="sl-conn-form" onSubmit={(e) => void saveCode(e)}>
              <label className="sl-visually-hidden" htmlFor={`sl-code-${m.theirs}`}>
                LAN access code for {m.name}
              </label>
              <input
                id={`sl-code-${m.theirs}`}
                className="sl-input"
                type="password"
                autoComplete="off"
                placeholder={m.accessCode.present ? "replace the code" : "code from the printer"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!status.local}
              />
              <button className="sl-btn ghost sl-btn-sm" type="submit" disabled={!can(`code:${m.theirs}`) || !code.trim()}>
                Save code
              </button>
            </form>
          </ConnRow>
        )}
        <ConnRow title="Orders" row={m.orders} {...shared}>
          {m.orders.known && !m.orders.onHub && status.app.realMachines && (
            <>
              <label className="sl-check">
                <input type="checkbox" checked={tested} onChange={(e) => setTested(e.target.checked)} />
                <span>A test print from this printer came out right.</span>
              </label>
              <button className="sl-btn solid sl-btn-sm" type="button" disabled={!tested || !m.program.online || Boolean(shared.sending)} onClick={() => void useMachine()}>
                Use this printer for orders
              </button>
              {!m.program.online && <span className="sl-conn-why">Start its program first.</span>}
            </>
          )}
        </ConnRow>
      </ol>
    </article>
  );
}

function ConnRow({ title, row, now, stepKey, status, note, children }: { title: string; row: Row; now: number; stepKey?: string; children?: ReactNode } & Partial<Shared>) {
  const state = stepKey ? status?.actions[stepKey] : undefined;
  const said = stepKey && note?.key === stepKey ? note : null;
  return (
    <li className={`sl-conn-row is-${row.light}`}>
      <i className="sl-conn-light" aria-hidden="true" />
      <div className="sl-conn-main">
        <p className="sl-conn-title">
          {title}
          <span className="sl-conn-when">
            {LIGHT_TEXT[row.light]} · {checkedAgo(row.checkedAt, now)}
          </span>
        </p>
        <p className="sl-conn-detail">{row.detail}</p>
        {state && (
          <p className={`sl-conn-step ${state.running ? "" : state.ok ? "ok" : "bad"}`} role="status">
            {state.running ? state.detail : `${state.ok ? "Done" : "Failed"}: ${state.detail}`}
          </p>
        )}
        {state && !state.running && !state.ok && state.log.length > 0 && (
          <details className="sl-conn-logs">
            <summary>Last lines of its log</summary>
            <pre className="sl-conn-log">{state.log.join("\n")}</pre>
          </details>
        )}
        {said && (
          <p className={`sl-conn-step ${said.ok ? "ok" : "bad"}`} role={said.ok ? "status" : "alert"}>
            {said.text}
          </p>
        )}
        {children && <div className="sl-actions">{children}</div>}
      </div>
    </li>
  );
}
