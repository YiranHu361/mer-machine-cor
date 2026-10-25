// Getting finished orders to people. The customer chooses pickup or delivery on
// their side; here the seller calls the courier for a delivery, or hands a pickup
// over at the table. Both are saved on the order, so the customer sees the same
// courier and times. The courier is display-only (see deliveries.ts); the hand-off
// steps on the order itself (take it off, mark ready, redeem a code) are real.
import { useMemo } from "react";
import { api } from "../../api";
import { PALACE, SFMap, formatKm } from "../shared/map";
import { JobActions, type Act } from "./JobActions";
import { clockIn, PHASE_TEXT } from "./estimate";
import { courierEstimate, deliveriesOf, frameAround, handoffKind, sentOut, tripKm, useStreetRoute, type OrderDelivery } from "./deliveries";
import { groupOrders, shortId, type SellerOrder } from "./orderGroups";
import { jobStateLabel, jobTitle, needsHandling, waitingPickup } from "./status";
import { MAKER, type Dashboard } from "./data";

const RECENT_MS = 6 * 3600000;

/** When the order left: handed over, dropped off, or its last change. */
function leftAt(o: SellerOrder, d: OrderDelivery | undefined): number {
  const at = d?.handedOverAt ?? d?.courier?.arriveAt;
  return at ? Date.parse(at) : Date.parse(o.updatedAt);
}

export function Delivery({ dash, busy, act, now }: { dash: Dashboard; busy: string; act: Act; now: number }) {
  const deliveries = deliveriesOf(dash);
  const sent = useMemo(() => sentOut(deliveries, now), [deliveries, now]);
  const orders = useMemo(() => groupOrders(dash.jobs, sent, now), [dash.jobs, sent, now]);
  const made = orders.filter((o) => o.made && !o.cancelled);
  const kind = (o: SellerOrder) => handoffKind(deliveries[o.key]);
  const waiting = made.filter((o) => !o.done && kind(o) === "awaiting_courier");
  const withCourier = made.filter((o) => !o.done && kind(o) === "courier");
  const atTable = made.filter((o) => !o.done && kind(o) === "pickup");
  const finishedRows = made.filter((o) => o.done && now - leftAt(o, deliveries[o.key]) < RECENT_MS);
  const courier = (o: SellerOrder, body: object, done: string) =>
    act(`${o.key}-courier`, () => api(`/owner/orders/${encodeURIComponent(o.orderId ?? o.key)}/courier`, body), done);
  return (
    <section aria-labelledby="sl-delivery-title">
      <header className="sl-section-head">
        <p className="sl-kicker">delivery · from {MAKER.place}</p>
        <h2 id="sl-delivery-title" className="sl-h2">
          Send it out, or keep it at the table.
        </h2>
        <p className="sl-lede">
          Customers choose delivery or pickup when they order. When a delivery is made, call a courier to take it to them; pickups wait at your table. The customer follows the same courier on their side.
        </p>
      </header>
      <dl className="sl-stats sl-stats-4">
        <div className={waiting.length ? "warn" : ""}>
          <dt>waiting to go out</dt>
          <dd>{waiting.length}</dd>
        </div>
        <div>
          <dt>with a courier</dt>
          <dd>{withCourier.length}</dd>
        </div>
        <div>
          <dt>at the table</dt>
          <dd>{atTable.length}</dd>
        </div>
        <div>
          <dt>delivered or collected</dt>
          <dd>{finishedRows.length}</dd>
        </div>
      </dl>
      <Group title="Waiting to go out" empty="No delivery is waiting. Finished delivery orders show up here.">
        {waiting.map((o) => {
          const d = deliveries[o.key];
          const km = tripKm(d);
          return (
            <li key={o.key} className="sl-delivery">
              <OrderHead o={o} />
              <Handling o={o} dash={dash} busy={busy} act={act} now={now} pickup={false} />
              <p className="sl-fine">
                Going to the customer in {d.to?.label ?? "their neighbourhood"}
                {km ? ` · ${formatKm(km)} away` : ""}.
              </p>
              {o.jobs.some(waitingPickup) && <p className="sl-fine">The customer has a pickup code for this order and shows it to the courier at the door.</p>}
              <div className="sl-actions">
                <button className="sl-btn solid" type="button" disabled={Boolean(busy)} onClick={() => void courier(o, {}, "Courier called. The customer can follow them now.")}>
                  Call a courier
                </button>
              </div>
            </li>
          );
        })}
      </Group>
      <Group title="With a courier" empty="No courier is out right now.">
        {withCourier.map((o) => (
          <CourierCard
            key={o.key}
            o={o}
            d={deliveries[o.key]}
            now={now}
            dash={dash}
            busy={busy}
            act={act}
            onCancel={() => void courier(o, { cancel: true }, "Courier cancelled.")}
          />
        ))}
      </Group>
      <Group title="Pickup at the table" empty="Nothing is set aside for pickup.">
        {atTable.map((o) => (
          <li key={o.key} className="sl-delivery">
            <OrderHead o={o} />
            <PickupNote o={o} chosen={deliveries[o.key]?.mode === "pickup"} now={now} />
            <Handling o={o} dash={dash} busy={busy} act={act} now={now} />
            {o.orderId && !o.jobs.some((j) => needsHandling(j) || waitingPickup(j)) && (
              <div className="sl-actions">
                <button
                  className="sl-btn solid"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void act(`${o.key}-handed`, () => api(`/owner/orders/${encodeURIComponent(o.orderId!)}/handed-over`, {}), "Handed over.")}
                >
                  Handed over to the customer
                </button>
              </div>
            )}
          </li>
        ))}
      </Group>
      {finishedRows.length > 0 && (
        <details className="sl-pickups sl-done">
          <summary>Delivered or collected · {finishedRows.length}</summary>
          <ul className="sl-done-list">
            {finishedRows.map((o) => {
              const d = deliveries[o.key];
              return (
                <li key={o.key}>
                  <span className="sl-thumb sm">{o.jobs[0]?.artifact?.previewUrl ? <img src={o.jobs[0].artifact.previewUrl} alt="" /> : null}</span>
                  <span className="sl-done-title">
                    #{shortId(o)} {o.title}
                  </span>
                  <span className="sl-done-meta">
                    {d?.courier
                      ? `Delivered by ${d.courier.name}${d.to ? ` to ${d.to.label}` : ""}`
                      : d?.handedOverAt || o.jobs.some((j) => j.fulfillmentState === "collected")
                        ? "Collected at the table"
                        : "Handed over"}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="sl-group">
      <h3 className="sl-h4">
        {title} <span>{children.length}</span>
      </h3>
      {children.length === 0 ? <p className="sl-fine">{empty}</p> : <ul className="sl-deliveries">{children}</ul>}
    </div>
  );
}

function OrderHead({ o }: { o: SellerOrder }) {
  const preview = o.jobs.find((j) => j.artifact?.previewUrl)?.artifact?.previewUrl;
  return (
    <div className="sl-delivery-head">
      <span className="sl-thumb">{preview ? <img src={preview} alt={`Preview of ${o.title}`} /> : <span aria-hidden="true">▢</span>}</span>
      <div>
        <h4 className="sl-h3">
          {o.title} <span className="sl-order-id">#{shortId(o)}</span>
        </h4>
        <p className="sl-chips">
          <span className="from">from · {o.intake.label}</span>
          {o.viaAgent && <span className="agent">via ASI:One</span>}
          <span>
            {o.jobs.length} item{o.jobs.length === 1 ? "" : "s"}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Items still on a machine: take them off (or clear the plate) so they are ready to go. */
function Handling({ o, dash, busy, act, now, pickup = true }: { o: SellerOrder; dash: Dashboard; busy: string; act: Act; now: number; pickup?: boolean }) {
  const pending = o.jobs.filter((j) => needsHandling(j) || (pickup && waitingPickup(j)));
  if (!pending.length) return null;
  return (
    <ul className="sl-order-items">
      {pending.map((j) => {
        const state = jobStateLabel(j);
        const machine = dash.machines.find((m) => m.id === j.machineId);
        return (
          <li key={j.id} className={`sl-item tone-${state.tone}`}>
            <p className={`sl-jobstate tone-${state.tone}`}>
              <i aria-hidden="true" />
              {state.text}
            </p>
            <p className="sl-item-line">
              <b>{jobTitle(j)}</b>
              <span>{machine?.name ?? ""}</span>
            </p>
            <JobActions job={j} machine={machine} busy={busy} act={act} now={now} />
          </li>
        );
      })}
    </ul>
  );
}

/** "4:10 PM", "tomorrow 12:24 AM" or "Oct 28, 9:00 AM". */
function until(iso: string, now: number): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date(now))) / 86400000);
  return days === 0 ? time : days === 1 ? `tomorrow ${time}` : `${at.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function PickupNote({ o, chosen, now }: { o: SellerOrder; chosen: boolean; now: number }) {
  return (
    <>
      <p className="sl-fine">{chosen ? "The customer chose to pick it up here." : "The customer has not asked for delivery, so it stays at your table."}</p>
      <CodeNote o={o} now={now} />
    </>
  );
}

function CodeNote({ o, now }: { o: SellerOrder; now: number }) {
  const withCode = o.jobs.find((j) => j.pickup?.expiresAt && !j.pickup.redeemedAt);
  if (withCode?.pickup?.expiresAt) {
    const expired = Date.parse(withCode.pickup.expiresAt) <= now;
    return (
      <p className="sl-note">
        {expired
          ? "The customer’s pickup code has expired. Issue a new one below."
          : `The customer has a pickup code, good until ${until(withCode.pickup.expiresAt, now)}. Ask for it and enter it below to hand the order over.`}
      </p>
    );
  }
  if (o.jobs.some(needsHandling))
    return <p className="sl-note">Take it off the machine first. The customer collects it at your table.</p>;
  return (
    <p className="sl-note">
      No pickup code was issued for this order, because nothing was charged for it. Check the order number #{shortId(o)} with the customer, then mark it handed over.
    </p>
  );
}

function CourierCard({ o, d, now, dash, busy, act, onCancel }: { o: SellerOrder; d: OrderDelivery; now: number; dash: Dashboard; busy: string; act: Act; onCancel: () => void }) {
  const courier = d.courier!;
  const est = courierEstimate(courier, now);
  const route = useStreetRoute(PALACE, d.to);
  const km = tripKm(d);
  const place = d.to?.label ?? "the customer";
  return (
    <li className="sl-delivery courier">
      <OrderHead o={o} />
      <div className="sl-courier">
        <div className="sl-courier-map">
          <SFMap
            pins={[
              { id: "workshop", at: PALACE, label: `${MAKER.name}’s workshop`, tone: "place", showLabel: true },
              ...(d.to ? [{ id: "home", at: d.to, label: `Customer · ${d.to.label}`, tone: "home" as const, showLabel: true }] : []),
            ]}
            route={route}
            progress={est.routeFraction}
            markerLabel={`${courier.name} · ${courier.vehicle}`}
            bounds={frameAround(route ?? [PALACE])}
            label={`Courier route for order ${shortId(o)}`}
            hoods={false}
          />
        </div>
        <div className="sl-courier-info">
          <p className="sl-jobstate tone-blue">
            <i aria-hidden="true" />
            {PHASE_TEXT[est.phase]}
          </p>
          <p className="sl-courier-name">
            {courier.name} <span>· {courier.vehicle}</span>
          </p>
          <dl className="sl-money">
            <div>
              <dt>At your table</dt>
              <dd>{est.pickupMin > 0 ? `${clockIn(est.pickupMin, now)} · ${est.pickupMin} min` : est.phase === "at_workshop" ? "here now" : `picked up ${new Date(courier.pickupAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</dd>
            </div>
            <div>
              <dt>At the customer</dt>
              <dd>
                {new Date(courier.arriveAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {est.dropoffMin} min
              </dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd className="sl-contact">{courier.phone}</dd>
            </div>
          </dl>
          <p className="sl-fine">
            {km ? `${formatKm(km)} to ${place}` : `To ${place}`}. Times are estimates.
          </p>
          {o.jobs.some(waitingPickup) && <p className="sl-fine">The customer has a pickup code for this order and shows it to the courier at the door.</p>}
          {est.phase === "to_workshop" && (
            <div className="sl-actions">
              <button className="sl-btn ghost" type="button" disabled={Boolean(busy)} onClick={onCancel}>
                Cancel the courier
              </button>
            </div>
          )}
        </div>
      </div>
      <Handling o={o} dash={dash} busy={busy} act={act} now={now} pickup={false} />
    </li>
  );
}
