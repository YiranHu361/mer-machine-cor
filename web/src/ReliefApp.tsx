import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { usd, type OrderView } from "./MakeApp";

/* Relief coordinator: one plan across the team's real machines and the
   simulated network. Simulated work is estimate-only and always labelled. */

type NetworkMachine = {
  id: string;
  process: string;
  displayName: string;
  location: { lat: number; lng: number; label: string };
  status: "online" | "offline";
  addedBy: "seed" | "demo";
};
type Relief = {
  seed: number;
  network: NetworkMachine[];
  engine: {
    timeScale: 1 | 10 | 60;
    jobs: Record<
      string,
      { machineId: string; status: string; orderId: string }
    >;
  };
  outages: { id: string }[];
};
type ReliefOrder = OrderView & {
  counters?: {
    queued: number;
    running: number;
    paused: number;
    done: number;
    cancelled: number;
    unitsDone: number;
    unitsTotal: number;
  };
};
// The demo outage covers most of San Francisco; real machines are never in it.
const SF_OUTAGE: [number, number][] = [
  [37.7, -122.52],
  [37.9, -122.52],
  [37.9, -122.33],
  [37.7, -122.33],
];
const BOUNDS = { latMin: 37.7, latMax: 37.9, lngMin: -122.52, lngMax: -122.15 };
const key = () => `${Date.now().toString(36)}-${crypto.randomUUID()}`;

export function ReliefApp({
  session,
}: {
  session: { role: string; id: string } | null;
}) {
  const [relief, setRelief] = useState<Relief | null>(null);
  const [orderId, setOrderId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("order"),
  );
  const [order, setOrder] = useState<ReliefOrder | null>(null);
  const [headCount, setHeadCount] = useState(300);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(false);
  const confirmKey = useRef(key());
  const owner = session?.role === "owner";
  const refresh = useCallback(async () => {
    const r = await api<{ relief: Relief }>("/relief");
    setRelief(r.relief);
    if (orderId)
      setOrder((await api<{ order: ReliefOrder }>(`/orders/${orderId}`)).order);
  }, [orderId]);
  useEffect(() => {
    if (!owner) return;
    void refresh().catch((e) => setError((e as Error).message));
    const timer = setInterval(
      () => void refresh().catch(() => undefined),
      2000,
    );
    return () => clearInterval(timer);
  }, [owner, refresh]);
  if (!owner)
    return (
      <section className="make" aria-labelledby="relief-title">
        <h1 id="relief-title">Relief coordinator</h1>
        <p>
          Sign in at the <a href="/owner">owner workshop</a> first, then come
          back here.
        </p>
      </section>
    );
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const demo = (action: string, body: object = {}) =>
    run(action, async () => {
      setRelief(
        (await api<{ relief: Relief }>(`/relief/demo/${action}`, body)).relief,
      );
    });
  const plan = order?.plan;
  const confirmed = !!order?.makeIntent;
  const team =
    plan?.assignments.filter((a) => a.machineSource === "registry") ?? [];
  const network =
    plan?.assignments.filter((a) => a.machineSource === "network") ?? [];
  const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
  const online =
    relief?.network.filter((m) => m.status === "online").length ?? 0;
  const busyMachines = new Set(
    Object.values(relief?.engine.jobs ?? {})
      .filter((j) => j.status === "running" || j.status === "queued")
      .map((j) => j.machineId),
  );
  const c = order?.counters;
  return (
    <section className="make relief" aria-labelledby="relief-title">
      <h1 id="relief-title">Relief coordinator</h1>
      <p className="lead">
        One plan across the team's real machines and a{" "}
        <strong>simulated</strong> network of {relief?.network.length ?? 150}{" "}
        machines. Simulated work is estimate-only: it is never charged and makes
        nothing physical.
      </p>
      {!order && (
        <form
          className="make-request"
          onSubmit={(e) => {
            e.preventDefault();
            void run("start", async () => {
              const { order } = await api<{ order: ReliefOrder }>(
                "/orders",
                { experience: "relief", headCount },
                "POST",
                { headers: { "Idempotency-Key": key() } },
              );
              history.replaceState(null, "", `/relief?order=${order.id}`);
              confirmKey.current = key();
              setOrderId(order.id);
              setOrder(order);
            });
          }}
        >
          <label htmlFor="relief-heads">People in the shelter</label>
          <input
            id="relief-heads"
            type="number"
            min={1}
            max={10000}
            value={headCount}
            onChange={(e) =>
              setHeadCount(
                Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
              )
            }
          />
          <button
            className="primary"
            type="submit"
            disabled={!!busy}
            aria-busy={busy === "start" || undefined}
          >
            Plan supplies
          </button>
        </form>
      )}
      {order && (
        <p className="make-status" role="status" aria-live="polite">
          {!plan && order.draft.stage !== "unavailable" && (
            <>
              <span className="spinner" aria-hidden="true" /> Planning across
              machines…
            </>
          )}
          {plan && !confirmed && "Check the plan, then confirm."}
          {confirmed &&
            plan &&
            (plan.status === "done"
              ? "All done."
              : `Under way · plan v${plan.version}`)}
        </p>
      )}
      {order?.draft.stage === "unavailable" && (
        <p role="alert">{order.draft.reason}</p>
      )}
      {plan && (
        <div className="make-plan">
          <table className="relief-table">
            <caption className="fine-print">
              Plan version {plan.version}
            </caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantity</th>
                <th scope="col">Team</th>
                <th scope="col">Network</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item) => {
                const mine = plan.assignments.filter(
                  (a) => a.itemId === item.id,
                );
                const sum = (source: string) =>
                  mine
                    .filter((a) => a.machineSource === source)
                    .reduce((t, a) => t + a.quantity, 0);
                return (
                  <tr key={item.id}>
                    <th scope="row">{item.name}</th>
                    <td>{item.quantity}</td>
                    <td>{sum("registry") || "—"}</td>
                    <td>
                      {sum("network") || "—"}
                      {(item as { unallocatedQuantity?: number })
                        .unallocatedQuantity
                        ? ` · ${(item as { unallocatedQuantity?: number }).unallocatedQuantity} waiting`
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <dl className="make-total">
            <div>
              <dt>Team machines</dt>
              <dd>
                {jobs(team.length)} ·{" "}
                {plan.payableCents ? usd(plan.payableCents) : "no payment"}
                {team.some((a) => a.executionMode === "simulation") &&
                  " · simulated devices"}
              </dd>
            </div>
            <div>
              <dt>Simulated network</dt>
              <dd>
                {jobs(network.length)} · {usd(plan.simulatedEstimateCents)}{" "}
                estimate (not charged)
              </dd>
            </div>
            <div>
              <dt>Ready in about</dt>
              <dd>{Math.max(1, plan.readyEstimateMinutes)} simulated min</dd>
            </div>
          </dl>
          {!confirmed && order?.offer && (
            <div className="make-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                />{" "}
                I coordinate this shelter and approve these designs
              </label>
              <p className="fine-print">
                Confirming lets the plan move never-started simulated work to
                another simulated machine of the same kind, within 125% of the
                simulated estimate. Real work never moves.
              </p>
              <button
                className="primary"
                disabled={!permission || !!busy}
                onClick={() =>
                  void run("confirm", async () => {
                    setOrder(
                      (
                        await api<{ order: ReliefOrder }>(
                          `/orders/${order.id}/confirm`,
                          {
                            offerId: order.offer!.id,
                            planVersion: plan.version,
                            planDigest: plan.digest,
                            permission: true,
                            consent: { payment: true, production: true },
                            idempotencyKey: confirmKey.current,
                          },
                        )
                      ).order,
                    );
                  })
                }
              >
                {plan.payableCents
                  ? `Pay ${usd(plan.payableCents)} & start`
                  : "Start"}
              </button>
            </div>
          )}
          {c && (
            <p className="relief-counters" aria-label="Simulated progress">
              <strong>
                {c.unitsDone} / {c.unitsTotal}
              </strong>{" "}
              simulated units done · {c.running} running · {c.queued} queued ·{" "}
              {c.paused} paused
            </p>
          )}
        </div>
      )}
      {relief && (
        <div className="relief-network">
          <h2>Simulated network</h2>
          <p className="fine-print">
            {online} online · {relief.network.length - online} offline · time ×
            {relief.engine.timeScale}
          </p>
          <ul className="relief-legend" aria-hidden="true">
            <li className="is-busy">working</li>
            <li className="is-idle">idle</li>
            <li className="is-offline">offline</li>
          </ul>
          <svg
            viewBox="0 0 370 200"
            role="img"
            aria-label={`${online} of ${relief.network.length} simulated machines online`}
            className="relief-map"
          >
            <rect
              x="0"
              y="0"
              width="370"
              height="200"
              fill="var(--surface-2)"
            />
            {relief.network.map((m) => {
              const x =
                ((m.location.lng - BOUNDS.lngMin) /
                  (BOUNDS.lngMax - BOUNDS.lngMin)) *
                370;
              const y =
                200 -
                ((m.location.lat - BOUNDS.latMin) /
                  (BOUNDS.latMax - BOUNDS.latMin)) *
                  200;
              return (
                <circle
                  key={m.id}
                  cx={x.toFixed(1)}
                  cy={y.toFixed(1)}
                  r={m.addedBy === "demo" ? 5 : 3}
                  className={
                    m.status === "offline"
                      ? "is-offline"
                      : busyMachines.has(m.id)
                        ? "is-busy"
                        : "is-idle"
                  }
                >
                  <title>
                    {m.displayName} · {m.location.label} · {m.status}
                  </title>
                </circle>
              );
            })}
          </svg>
          <div className="relief-controls" aria-label="Demo controls">
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => void demo("outage", { polygon: SF_OUTAGE })}
            >
              Outage: San Francisco
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => void demo("restore")}
            >
              Restore power
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void demo("add_machine", {
                  process: "fdm_print",
                  lat: 37.806,
                  lng: -122.27,
                })
              }
            >
              Add a 3D printer in Oakland
            </button>
            {([1, 10, 60] as const).map((x) => (
              <button
                key={x}
                className="text-button"
                aria-pressed={relief.engine.timeScale === x}
                disabled={!!busy}
                onClick={() => void demo("time_scale", { x })}
              >
                ×{x}
              </button>
            ))}
            <button
              className="text-button subdued"
              disabled={!!busy}
              onClick={() =>
                void demo("reset").then(() => {
                  history.replaceState(null, "", "/relief");
                  setOrderId(null);
                  setOrder(null);
                  setPermission(false);
                })
              }
            >
              Reset the simulation
            </button>
          </div>
        </div>
      )}
      {order && order.events.length > 0 && (
        <details className="relief-events">
          <summary>Events</summary>
          <ol>
            {order.events
              .filter((e) => e.type !== "sim_job.progress")
              .slice(-12)
              .map((e) => (
                <li key={e.seq}>
                  <span className="fine-print">#{e.seq}</span> {e.type}
                </li>
              ))}
          </ol>
        </details>
      )}
      {error && (
        <p role="alert" className="make-error">
          {error}
        </p>
      )}
    </section>
  );
}
