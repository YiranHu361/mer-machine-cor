import { finished, intakeOf, jobTitle, machineStatus, MACHINE_LABEL, needsMaker, onLine } from "./status";
import { money, MAKER, type Dashboard } from "./data";

const QUEUED = ["requested", "specified", "approved", "quoted", "authorized", "payment_confirmed"];

export function Overview({ dash, onGo }: { dash: Dashboard; onGo: (tab: "machines" | "add") => void }) {
  const { machines, jobs, connectors, ledger } = dash;
  const statusOf = (id: string) => {
    const m = machines.find((x) => x.id === id)!;
    return machineStatus(m, connectors.find((c) => c.machineId === m.id), jobs).key;
  };
  const keys = machines.map((m) => statusOf(m.id));
  const online = keys.filter((k) => k !== "offline").length;
  const printing = jobs.filter((j) => ["dispatched", "running", "verifying"].includes(j.productionState)).length;
  const queued = jobs.filter((j) => onLine(j) && QUEUED.includes(j.productionState)).length;
  const needYou = jobs.filter(needsMaker).length + machines.filter((m) => !m.calibrated).length;
  const collected = ledger.filter((e) => e.kind === "collection" && e.status !== "failed").reduce((sum, e) => sum + e.amountCents, 0);
  const paidOut = ledger.filter((e) => e.kind === "release" && (e.status === "confirmed" || e.status === "pending")).reduce((sum, e) => sum + e.amountCents, 0);
  const share = jobs.filter((j) => j.quote && !["cancelled"].includes(j.productionState)).reduce((sum, j) => sum + (j.quote?.ownerCents ?? 0), 0);
  const paymentLabel = ledger.some((e) => e.mode === "testnet") ? "testnet payment" : "demo payment";
  const attention = machines.filter((m, i) => keys[i] === "attention");
  const made = jobs.filter((j) => j.productionState === "produced").length;
  // Which way each order came in: a typed name, the customer's own photo, or a picked preview.
  const paths = new Map<string, number>();
  for (const j of jobs.filter((x) => x.productionState !== "cancelled")) {
    const label = intakeOf(j).label;
    paths.set(label, (paths.get(label) ?? 0) + 1);
  }
  const busiest = Math.max(1, ...paths.values());
  return (
    <section aria-labelledby="sl-overview-title" className="sl-overview">
      <div className="sl-hero">
        <p className="sl-kicker">{MAKER.name}’s workshop · {MAKER.place}</p>
        <h2 id="sl-overview-title" className="sl-h2">
          {machines.length} machine{machines.length === 1 ? "" : "s"} on the map, {online} online.
        </h2>
        <p className="sl-lede">
          Orders from people nearby land on the machine they fit. Check each finished piece, hand it over, and the machine takes the next job.
        </p>
      </div>
      <ul className="sl-strip" aria-label="Machines at a glance">
        {machines.map((m, i) => {
          const current = jobs.find((j) => j.id === m.activeJobId) ?? jobs.find((j) => j.machineId === m.id && onLine(j));
          return (
            <li key={m.id}>
              <button type="button" className={`sl-strip-item is-${keys[i]}`} onClick={() => onGo("machines")}>
                <span className={`sl-state is-${keys[i]}`}>
                  <i aria-hidden="true" />
                  {MACHINE_LABEL[keys[i]]}
                </span>
                <span className="sl-strip-name">{m.name}</span>
                <span className="sl-strip-model">{m.model}</span>
                <span className="sl-strip-now">{current && !finished(current) ? jobTitle(current) : "Ready for the next order"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <dl className="sl-stats">
        <div>
          <dt>machines online</dt>
          <dd>
            {online}
            <span> of {machines.length}</span>
          </dd>
        </div>
        <div>
          <dt>printing now</dt>
          <dd>{printing}</dd>
        </div>
        <div>
          <dt>queued</dt>
          <dd>{queued}</dd>
        </div>
        <div>
          <dt>made</dt>
          <dd>{made}</dd>
        </div>
        <div className={needYou ? "warn" : ""}>
          <dt>needs you</dt>
          <dd>{needYou}</dd>
        </div>
      </dl>
      <div className="sl-two">
        <div className="sl-panel">
          <h3 className="sl-h3">Earnings</h3>
          <dl className="sl-money">
            <div>
              <dt>Collected from orders</dt>
              <dd>{money(collected)}</dd>
            </div>
            <div>
              <dt>Paid out to you</dt>
              <dd>{money(paidOut)}</dd>
            </div>
            <div>
              <dt>Your share on orders so far</dt>
              <dd>{money(share)}</dd>
            </div>
          </dl>
          <p className="sl-fine">Figures from the workshop ledger · {paymentLabel}.</p>
        </div>
        <div className="sl-panel">
          <h3 className="sl-h3">Where you are</h3>
          <p className="sl-place">{MAKER.place}</p>
          <p className="sl-fine">Machines show up on the map as spare capacity near people who order. Collection happens at the table you set.</p>
          <p className="sl-fine">One person with an idle printer or a factory with spare lines: every machine gets its own queue here.</p>
          <div className="sl-actions">
            <button className="sl-btn" type="button" onClick={() => onGo("machines")}>
              Open the machines
            </button>
            <button className="sl-btn ghost" type="button" onClick={() => onGo("add")}>
              Add a machine
            </button>
          </div>
        </div>
      </div>
      {paths.size > 0 && (
        <div className="sl-panel">
          <h3 className="sl-h3">Where orders came from</h3>
          <ul className="sl-paths">
            {[...paths.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="sl-paths-bar" aria-hidden="true">
                  <i style={{ width: `${(n / busiest) * 100}%` }} />
                </span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {attention.length > 0 && (
        <div className="sl-notice" role="status">
          {attention.map((m) => m.name).join(", ")} {attention.length === 1 ? "needs" : "need"} a look.{" "}
          <button className="sl-link" type="button" onClick={() => onGo("machines")}>
            Go to the machines
          </button>
        </div>
      )}
    </section>
  );
}
