// Every order in the workshop: where it came from, what it is, which machine
// makes each item, its state and progress, and the actions it needs now.
import { useMemo, useState } from "react";
import { JobActions, type Act } from "./JobActions";
import { estimateAll, formatEta } from "./estimate";
import { groupOrders, matchesFilter, shortId, type OrderFilter, type SellerOrder } from "./orderGroups";
import { deliveriesOf, handoffKind, sentOut, type OrderDelivery } from "./deliveries";
import { jobStateLabel, jobTitle, stopReason } from "./status";
import type { Dashboard, OwnerJob } from "./data";
import { money } from "./data";

const HANDOFF_NOTE = {
  awaiting_courier: "The customer asked for delivery.",
  courier: "With a courier.",
  pickup: "Pickup at your table.",
} as const;

const FILTERS: { id: OrderFilter; label: string }[] = [
  { id: "active", label: "Making" },
  { id: "ready", label: "Ready" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

export function Orders({ dash, busy, act, now, onDeliver }: { dash: Dashboard; busy: string; act: Act; now: number; onDeliver: () => void }) {
  const [filter, setFilter] = useState<OrderFilter>("active");
  const deliveries = deliveriesOf(dash);
  const sent = useMemo(() => sentOut(deliveries, now), [deliveries, now]);
  const orders = useMemo(() => groupOrders(dash.jobs, sent, now), [dash.jobs, sent, now]);
  const estimates = useMemo(() => estimateAll(dash.machines, dash.jobs, now), [dash.machines, dash.jobs, now]);
  const shown = orders.filter((o) => matchesFilter(o, filter));
  const count = (f: OrderFilter) => orders.filter((o) => matchesFilter(o, f)).length;
  return (
    <section aria-labelledby="sl-orders-title">
      <header className="sl-section-head">
        <p className="sl-kicker">orders · {orders.length} in total</p>
        <h2 id="sl-orders-title" className="sl-h2">
          Every order, where it came from, and what it needs.
        </h2>
        <p className="sl-lede">Orders come from the fabyn site and from chats with the Fabyn agent on ASI:One. Each item goes to the machine that fits it.</p>
      </header>
      <div className="sl-filters" role="tablist" aria-label="Show orders">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="sl-filter" onClick={() => setFilter(f.id)}>
            {f.label} <span>{count(f.id)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <div className="sl-panel">
          <p className="sl-fine">
            {filter === "active"
              ? "Nothing is being made right now. New orders show up here within seconds."
              : filter === "ready"
                ? "No finished orders are waiting to go out."
                : "No orders here yet."}
          </p>
        </div>
      )}
      <ul className="sl-orders">
        {shown.map((o) => (
          <OrderCard key={o.key} order={o} delivery={deliveries[o.key]} dash={dash} estimates={estimates} busy={busy} act={act} now={now} onDeliver={onDeliver} />
        ))}
      </ul>
    </section>
  );
}

function OrderCard({
  order: o,
  delivery,
  dash,
  estimates,
  busy,
  act,
  now,
  onDeliver,
}: {
  order: SellerOrder;
  delivery?: OrderDelivery;
  dash: Dashboard;
  estimates: Map<string, { percent: number | null; etaSeconds: number | null }>;
  busy: string;
  act: Act;
  now: number;
  onDeliver: () => void;
}) {
  const preview = o.jobs.find((j) => j.artifact?.previewUrl)?.artifact?.previewUrl;
  const machines = new Set(o.jobs.map((j) => j.machineId).filter(Boolean)).size;
  return (
    <li className={`sl-order${o.needsYou ? " needs" : ""}`}>
      <div className="sl-order-thumb">{preview ? <img src={preview} alt={`Preview of ${o.title}`} /> : <span aria-hidden="true">▢</span>}</div>
      <div className="sl-order-main">
        <header className="sl-order-head">
          <h3 className="sl-h3">{o.title}</h3>
          <span className="sl-order-id">#{shortId(o)}</span>
        </header>
        <p className="sl-chips">
          <span className="from" title={o.intake.detail}>
            from · {o.intake.label}
          </span>
          {o.viaAgent && <span className="agent">via ASI:One</span>}
          <span>
            {o.jobs.length} item{o.jobs.length === 1 ? "" : "s"}
            {machines > 1 ? ` on ${machines} machines` : ""}
          </span>
          <span>{new Date(o.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          {o.totalCents > 0 && <span>{money(o.totalCents)}</span>}
        </p>
        <ul className="sl-order-items">
          {o.jobs.map((j) => (
            <ItemRow key={j.id} job={j} dash={dash} est={estimates.get(j.id)} busy={busy} act={act} now={now} />
          ))}
        </ul>
        {o.ready && (
          <div className="sl-actions">
            <span className="sl-fine">{HANDOFF_NOTE[handoffKind(delivery)]}</span>
            <button className="sl-btn" type="button" onClick={onDeliver}>
              {handoffKind(delivery) === "awaiting_courier" ? "Call a courier" : "Open delivery"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function ItemRow({ job, dash, est, busy, act, now }: { job: OwnerJob; dash: Dashboard; est?: { percent: number | null; etaSeconds: number | null }; busy: string; act: Act; now: number }) {
  const machine = dash.machines.find((m) => m.id === job.machineId);
  const state = jobStateLabel(job);
  const why = stopReason(job);
  return (
    <li className={`sl-item tone-${state.tone}`}>
      <p className={`sl-jobstate tone-${state.tone}`}>
        <i aria-hidden="true" />
        {state.text}
      </p>
      <p className="sl-item-line">
        <b>{jobTitle(job)}</b>
        <span>{machine ? `${machine.name} · ${machine.model}` : "Waiting for a machine"}</span>
      </p>
      {why && <p className="sl-why">{why}</p>}
      {est && est.percent !== null && est.percent < 100 && (
        <div className="sl-progress">
          <div className="sl-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={est.percent} aria-label={`Progress for ${jobTitle(job)}`}>
            <span style={{ width: `${est.percent}%` }} />
          </div>
          <p className="sl-fine">
            {est.percent}%{est.etaSeconds ? ` · ${formatEta(est.etaSeconds)} · estimate` : ""}
          </p>
        </div>
      )}
      <JobActions job={job} machine={machine} busy={busy} act={act} now={now} />
    </li>
  );
}
