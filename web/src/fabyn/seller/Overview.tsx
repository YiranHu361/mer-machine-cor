// The whole workshop on one screen: machines, what is being made, what is ready
// to go out, money and supplies, each linking to its own tab.
import { groupOrders } from "./orderGroups";
import { finished, intakeOf, jobTitle, machineStatus, MACHINE_LABEL, needsMaker, onLine, supplyOf, viaAgent } from "./status";
import { money, MAKER, type Dashboard } from "./data";
import { sentOut, type Handoff } from "./deliveries";
import { usePaymentConfig } from "./live";
import type { Tab } from "./SellerApp";

const QUEUED = ["requested", "specified", "approved", "quoted", "authorized", "payment_confirmed"];

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function Overview({ dash, handoffs, now, onGo }: { dash: Dashboard; handoffs: Record<string, Handoff>; now: number; onGo: (tab: Tab) => void }) {
  const { machines, jobs, connectors, ledger } = dash;
  const keys = machines.map((m) => machineStatus(m, connectors.find((c) => c.machineId === m.id), jobs).key);
  const online = keys.filter((k) => k !== "offline").length;
  const printing = jobs.filter((j) => ["dispatched", "running", "verifying"].includes(j.productionState)).length;
  const queued = jobs.filter((j) => onLine(j) && QUEUED.includes(j.productionState)).length;
  const needYou = jobs.filter(needsMaker).length + machines.filter((m) => !m.calibrated).length;
  const live = ledger.filter((e) => e.status !== "failed");
  const collected = live.filter((e) => e.kind === "collection");
  const sum = (rows: typeof ledger) => rows.reduce((s, e) => s + e.amountCents, 0);
  const today = sum(collected.filter((e) => Date.parse(e.createdAt) >= startOfDay(now)));
  const paidOut = sum(live.filter((e) => e.kind === "release"));
  const pending = sum(ledger.filter((e) => e.status === "pending" || e.status === "submitting"));
  const payments = usePaymentConfig();
  const testnet = payments ? payments.mode === "testnet" : ledger.some((e) => e.mode === "testnet");
  const paymentLabel = testnet ? "x402 test USDC on Base Sepolia" : "test checkout, nothing charged";
  const attention = machines.filter((_, i) => keys[i] === "attention");
  const orders = groupOrders(jobs, sentOut(handoffs, now), now);
  const toSend = orders.filter((o) => o.ready && !handoffs[o.key]).length;
  const withCourier = orders.filter((o) => !o.done && handoffs[o.key]?.mode === "courier").length;
  const atTable = orders.filter((o) => !o.done && handoffs[o.key]?.mode === "pickup").length;
  const low = machines.filter((m) => m.mediaRemaining < supplyOf(m).capacity * 0.2);
  // Which way each order came in: a typed name, the customer's own photo, a picked design, or the ASI:One agent.
  const paths = new Map<string, number>();
  for (const j of jobs.filter((x) => x.productionState !== "cancelled")) {
    const label = viaAgent(j) ? "via ASI:One" : intakeOf(j).label;
    paths.set(label, (paths.get(label) ?? 0) + 1);
  }
  const busiest = Math.max(1, ...paths.values());
  return (
    <section aria-labelledby="sl-overview-title" className="sl-overview">
      <div className="sl-hero">
        <p className="sl-kicker">
          {MAKER.name}’s workshop · {MAKER.place}
        </p>
        <h2 id="sl-overview-title" className="sl-h2">
          {machines.length} machine{machines.length === 1 ? "" : "s"} on the map, {online} online.
        </h2>
        <p className="sl-lede">
          Orders from people nearby land on the machine they fit. Take each finished piece off, send it out or keep it for pickup, and the machine takes the next job.
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
        <div className={toSend ? "warn" : ""}>
          <dt>ready to send out</dt>
          <dd>{toSend}</dd>
        </div>
        <div className={needYou ? "warn" : ""}>
          <dt>needs you</dt>
          <dd>{needYou}</dd>
        </div>
      </dl>
      {attention.length > 0 && (
        <div className="sl-notice sl-notice-inline" role="status">
          {attention.map((m) => m.name).join(", ")} {attention.length === 1 ? "needs" : "need"} a look.{" "}
          <button className="sl-link" type="button" onClick={() => onGo("machines")}>
            Go to the machines
          </button>
        </div>
      )}
      <div className="sl-three">
        <div className="sl-panel">
          <h3 className="sl-h3">Income</h3>
          <dl className="sl-money">
            <div>
              <dt>Today</dt>
              <dd>{money(today)}</dd>
            </div>
            <div>
              <dt>Collected, all time</dt>
              <dd>{money(sum(collected))}</dd>
            </div>
            <div>
              <dt>Paid out to you</dt>
              <dd>{money(paidOut)}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{money(pending)}</dd>
            </div>
          </dl>
          <p className="sl-fine">From the workshop ledger · {paymentLabel}.</p>
          <button className="sl-link" type="button" onClick={() => onGo("income")}>
            Open income
          </button>
        </div>
        <div className="sl-panel">
          <h3 className="sl-h3">Delivery</h3>
          <dl className="sl-money">
            <div>
              <dt>Waiting to go out</dt>
              <dd>{toSend}</dd>
            </div>
            <div>
              <dt>With a courier</dt>
              <dd>{withCourier}</dd>
            </div>
            <div>
              <dt>At the table for pickup</dt>
              <dd>{atTable}</dd>
            </div>
          </dl>
          <div className="sl-link-row">
            <button className="sl-link" type="button" onClick={() => onGo("delivery")}>
              Open delivery
            </button>
            <button className="sl-link" type="button" onClick={() => onGo("map")}>
              See the map
            </button>
          </div>
        </div>
        <div className="sl-panel">
          <h3 className="sl-h3">Supplies</h3>
          {low.length === 0 ? (
            <p className="sl-fine">Every machine is stocked.</p>
          ) : (
            <ul className="sl-plain sl-low">
              {low.map((m) => (
                <li key={m.id}>
                  <b>{m.name}</b>: {m.mediaRemaining} {supplyOf(m).unit}
                </li>
              ))}
            </ul>
          )}
          <button className="sl-link" type="button" onClick={() => onGo("supplies")}>
            {low.length ? "Refill now" : "Open supplies"}
          </button>
        </div>
      </div>
      <div className="sl-two">
        <div className="sl-panel">
          <h3 className="sl-h3">Where orders came from</h3>
          {paths.size === 0 ? (
            <p className="sl-fine">No orders yet. They come from the fabyn site and from the Fabyn agent on ASI:One.</p>
          ) : (
            <ul className="sl-paths">
              {[...paths.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, n]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="sl-paths-bar" aria-hidden="true">
                      <i style={{ width: `${(n / busiest) * 100}%` }} />
                    </span>
                    <b>{n}</b>
                  </li>
                ))}
            </ul>
          )}
          <button className="sl-link" type="button" onClick={() => onGo("orders")}>
            Open orders
          </button>
        </div>
        <div className="sl-panel">
          <h3 className="sl-h3">Who sells on fabyn</h3>
          <p className="sl-place">{MAKER.place}</p>
          <p className="sl-fine">
            Sellers can be one person with an idle printer, a makerspace, or a factory with spare lines. Each machine shows up on the map as spare capacity near the people who order, and gets its own queue here.
          </p>
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
    </section>
  );
}
