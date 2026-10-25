import { Actions, ErrorLine, JobTiles, TitleBlock, type ScreenProps } from "./Screens";
import { clockTime, courierProgress, estimateJob, makingStartedAt, tripMinutes, walkMinutes } from "./estimate";
import { orderTitle, phaseOf } from "./phase";
import { chooseDelivery, stopWork } from "./orders";
import { PLACE, PLACE_SHORT, type OrderView } from "./model";
import { receiptUrl } from "./checkout";
import { SFMap, BOUNDS, PALACE, areaLabel, boundsAround, distanceKm, formatKm, inBounds, type LatLng, type MapPin } from "../shared/map";
import { deliveryChoice, deliveryFor, spotOf, useStreetRoute, useWhere, type StreetRoute } from "./location";

/* Steps 7–8: printing on the machine, then delivery or pickup. The progress
   is an estimate (estimate.ts); the job states, the pickup code, the payment
   receipt, the pickup-or-delivery choice and the maker's courier are the
   saved order. */

function HandoffChoice({ onPick, reach, busy }: { onPick: (mode: "delivery" | "pickup") => void; reach: { ok: boolean; why: string }; busy: boolean }) {
  return (
    <fieldset className="cs-choice">
      <legend>How do you get it?</legend>
      {!reach.ok && <p className="cs-note">{reach.why}</p>}
      <div className="cs-choice-row">
        <button type="button" className="cs-btn" disabled={!reach.ok || busy} onClick={() => onPick("delivery")}>
          deliver to me
        </button>
        <button type="button" className="cs-btn" disabled={busy} onClick={() => onPick("pickup")}>
          I&apos;ll pick it up
        </button>
      </div>
    </fieldset>
  );
}

function Receipt({ order }: { order: ScreenProps["order"] }) {
  const pay = order.makeIntent?.payment;
  if (pay?.transactionHash)
    return (
      <p className="cs-receipt">
        paid · Base Sepolia test USDC ·{" "}
        <a href={receiptUrl(pay.transactionHash)} target="_blank" rel="noreferrer">
          receipt on BaseScan ↗
        </a>
        <code>{pay.transactionHash.slice(0, 10)}…{pay.transactionHash.slice(-6)}</code>
      </p>
    );
  if (order.plan?.paymentMode === "mock") return <p className="cs-receipt">demo payment · nothing charged</p>;
  return null;
}

const youLabel = (spot: LatLng, label?: string) =>
  inBounds(spot, BOUNDS.city) ? `you · ${label ?? areaLabel(spot)}` : `you · ${formatKm(distanceKm(spot, PALACE))} away`;

const handoffPins = (spot: LatLng | null, highlight = false, label?: string): MapPin[] => [
  { id: "palace", at: PALACE, label: `Lucas · ${PALACE.short}`, tone: highlight ? "match" : "place", showLabel: true, labelAt: "right" },
  ...(spot ? [{ id: "home", at: spot, label: youLabel(spot, label), tone: "home" as const, showLabel: true, labelAt: "left" as const }] : []),
];

/** Frame the machine, the person and the route; someone outside the city gets an edge marker on an SF map. */
const frameFor = (spot: LatLng | null, route: StreetRoute | null) =>
  boundsAround([PALACE, ...(spot ? [spot] : []), ...(route?.path ?? [])], {
    minKm: spot && !inBounds(spot, BOUNDS.city) ? 7 : 1.6,
  });

/** The saved choice, the spot it goes to, its street route and the courier, if the maker called one. */
function useDelivery(order: OrderView, now: number) {
  const where = useWhere();
  const browserSpot = spotOf(where);
  const d = order.delivery;
  // a delivery goes to the spot saved on the order; until then the browser's spot is the person's
  const delivery = d?.mode === "delivery" && !!d.to;
  const spot: LatLng | null = delivery ? { lat: d.to!.lat, lng: d.to!.lng } : browserSpot;
  const place = delivery ? d.to!.label : spot ? areaLabel(spot) : "";
  const route = useStreetRoute(PALACE, delivery ? spot : null);
  // the route for a delivery not chosen yet, to save its length with the choice
  const reach = deliveryFor(browserSpot);
  const pickRoute = useStreetRoute(PALACE, !delivery && reach.ok ? browserSpot : null);
  // until the street route loads, a ride of about 1.3 times the straight line
  const km = d?.km ?? route?.km ?? (spot ? distanceKm(PALACE, spot) * 1.3 : 0);
  const courier = delivery ? d.courier ?? null : null;
  const ride = courier ? courierProgress(courier, now) : null;
  return { where, d, spot, place, reach, delivery, route, pickRoute, km, courier, ride };
}

/** Save pickup or delivery on the order through the shared action runner. */
function useChoose(order: OrderView, run: ScreenProps["run"], info: ReturnType<typeof useDelivery>) {
  return (mode: "delivery" | "pickup") => {
    const choice = deliveryChoice(mode, info.where, mode === "delivery" ? info.pickRoute : null);
    if (choice) void run("delivery", () => chooseDelivery(order, choice));
  };
}

/* ---------- 7: printing ---------- */

export function PrintingStep({ order, now, run, busy, error, go, onOrders }: ScreenProps) {
  const plan = order.plan!;
  const info = useDelivery(order, now);
  const { d, spot, place, reach, delivery, route, km, courier } = info;
  const choose = useChoose(order, run, info);
  const startedAt = makingStartedAt(order.events);
  const states = plan.assignments.map((a) => estimateJob(a, { now, startedAt, readyEstimateMinutes: plan.readyEstimateMinutes }).state);
  const printed = states.every((s) => s === "handover" || s === "finished");
  const cancellable = ["approved", "in_progress"].includes(plan.status) && states.some((s) => s === "queued");
  return (
    <section className="cs-making" aria-labelledby="cs-making-title">
      <TitleBlock
        id="cs-making-title"
        kicker="printing · palace of fine arts"
        title={orderTitle(order)}
        sub={
          printed
            ? "Printed. Lucas is taking it off the machine and getting it ready for you."
            : `Printing on Lucas's machine at the ${PLACE_SHORT}. You can leave this page; my orders keeps it.`
        }
      />
      <Receipt order={order} />
      <div className="cs-print-grid">
        <JobTiles order={order} now={now} />
        <aside className="cs-print-side" aria-label="How you get it">
          <SFMap
            pins={handoffPins(spot, !delivery, place)}
            route={delivery ? route?.path : undefined}
            bounds={frameFor(spot, delivery ? route : null)}
            hoods
            label={`Map from the ${PALACE.short}${spot ? " to you" : ""}`}
          />
          {d ? (
            <p className="cs-note">
              {delivery && spot
                ? courier
                  ? `${courier.name} (${courier.vehicle}) is coming for it: picks it up about ${clockTime(courier.pickupAt)}, at your door in ${place} about ${clockTime(courier.arriveAt)}.`
                  : `A courier brings it to you in ${place}: ${formatKm(km)}${route?.streets ? " over the streets" : ""}, about ${Math.round(tripMinutes(km))} min. Lucas calls one as soon as it's made.`
                : `You collect it from Lucas at the ${PLACE_SHORT}.`}
            </p>
          ) : (
            <HandoffChoice reach={reach} busy={!!busy} onPick={choose} />
          )}
        </aside>
      </div>
      <ErrorLine text={error} />
      <Actions>
        <button className={`cs-btn ${printed ? "cs-btn-main" : ""}`} onClick={() => go("handoff")}>
          {delivery ? "follow the delivery" : "pickup details"}
        </button>
        {cancellable && (
          <button className="cs-btn cs-btn-quiet" disabled={!!busy} onClick={() => void run("cancel", () => stopWork(order))}>
            stop work that has not started
          </button>
        )}
        <button className="cs-btn cs-btn-quiet" onClick={onOrders}>
          my orders
        </button>
      </Actions>
    </section>
  );
}

/* ---------- 8: get it ---------- */

export function HandoffStep({ order, now, run, busy, error, onNew, onOrders, go }: ScreenProps) {
  const plan = order.plan!;
  const info = useDelivery(order, now);
  const { d, spot, place, reach, delivery, route, km, courier, ride } = info;
  const choose = useChoose(order, run, info);
  const ready = phaseOf(order) === "ready";
  const codes = plan.assignments.map((a) => a.child?.pickupCode).filter(Boolean) as string[];
  if (!d)
    return (
      <section className="cs-ready" aria-labelledby="cs-ready-title">
        <TitleBlock id="cs-ready-title" kicker="get it" title={orderTitle(order)} sub="Choose how you get it." />
        <HandoffChoice reach={reach} busy={!!busy} onPick={choose} />
        <ErrorLine text={error} />
      </section>
    );
  const first = courier?.name.split(" ")[0] ?? "";
  const walkKm = spot ? distanceKm(spot, PALACE) : null;
  const title = delivery
    ? !courier
      ? ready
        ? "Waiting for the courier"
        : "Waiting for Lucas to finish it"
      : ride!.phase === "to_workshop"
        ? `${first} is on the way to the workshop`
        : ride!.phase === "on_the_way"
          ? `On its way · about ${ride!.minutesLeft} min`
          : `${first} is outside`
    : d.handedOverAt
      ? "Handed over"
      : ready
        ? "Ready to collect"
        : "Almost ready to collect";
  const kmLeft = ride && route ? route.km * (1 - ride.t) : null;
  return (
    <section className="cs-ready" aria-labelledby="cs-ready-title">
      <TitleBlock id="cs-ready-title" kicker={delivery ? "get it · delivery" : "get it · pickup"} title={title} sub={`${orderTitle(order)} · ${delivery && spot ? `${PALACE.short} → you in ${place}` : PLACE}`} />
      <div className="cs-handoff-grid">
        <SFMap
          pins={handoffPins(spot, !delivery, place)}
          route={delivery ? route?.path : undefined}
          progress={delivery && route && ride ? ride.t : undefined}
          markerLabel={courier ? `${first} · ${courier.vehicle}` : undefined}
          bounds={frameFor(spot, delivery ? route : null)}
          hoods
          label={delivery ? `Route from the ${PALACE.short} to you` : `Map around the ${PALACE.short}`}
        />
        <div className="cs-handoff-body">
          {delivery ? (
            <dl className="cs-facts cs-facts-tight">
              <div>
                <dt>courier</dt>
                <dd>{courier ? `${courier.name} · ${courier.vehicle}` : "Lucas calls one when it's made"}</dd>
              </div>
              {courier && (
                <div>
                  <dt>contact</dt>
                  <dd>
                    {first} · {courier.phone}
                  </dd>
                </div>
              )}
              {courier && (
                <div>
                  <dt>{ride!.phase === "to_workshop" ? "picks it up" : "picked up"}</dt>
                  <dd>
                    {ride!.phase === "to_workshop"
                      ? `about ${clockTime(courier.pickupAt)} at the ${PALACE.short}`
                      : `your order at ${clockTime(courier.pickupAt)}`}
                  </dd>
                </div>
              )}
              <div>
                <dt>route</dt>
                <dd>
                  {route
                    ? `${formatKm(route.km)} ${route.streets ? "over the streets" : "in a straight line (the street route did not load)"}${kmLeft !== null && ride?.phase === "on_the_way" ? ` · ${formatKm(kmLeft)} left` : ""}`
                    : "working out the route…"}
                </dd>
              </div>
              <div>
                <dt>arrives</dt>
                <dd aria-live="polite">
                  {!courier
                    ? `about ${Math.round(tripMinutes(km))} min after it's picked up`
                    : ride!.phase === "delivered"
                      ? `here · ${place}`
                      : `about ${clockTime(courier.arriveAt)} (${ride!.minutesLeft} min)`}
                </dd>
              </div>
            </dl>
          ) : (
            <dl className="cs-facts cs-facts-tight">
              <div>
                <dt>where</dt>
                <dd>{PALACE.short} · 3601 Lyon St</dd>
              </div>
              <div>
                <dt>who</dt>
                <dd>Lucas, at the machines</dd>
              </div>
              {walkKm !== null && (
                <div>
                  <dt>from you</dt>
                  <dd>
                    {formatKm(walkKm)}
                    {walkKm <= 5 ? ` · about ${walkMinutes(walkKm)} min on foot` : ` · from ${areaLabel(spot!)}`}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="cs-code" aria-live="polite">
            {codes.length ? (
              <p>
                {delivery ? "code for the courier" : "pickup code"} <strong>{codes.join(" · ")}</strong>
              </p>
            ) : ready ? (
              <p>No pickup code for this print. {delivery ? "The courier hands it to you directly." : "Show this screen at the table and Lucas hands it over."}</p>
            ) : (
              <p>Lucas has not handed it over yet. {delivery ? "He calls the courier" : "A pickup code shows here"} as soon as it's made.</p>
            )}
          </div>
          {!courier && !d.handedOverAt && (delivery || reach.ok) && (
            <button className="cs-link" disabled={!!busy} onClick={() => choose(delivery ? "pickup" : "delivery")}>
              {delivery ? "pick it up instead" : "have it delivered instead"}
            </button>
          )}
        </div>
      </div>
      <ErrorLine text={error} />
      <Actions>
        <button className="cs-btn cs-btn-main" onClick={onNew}>
          start a new order
        </button>
        <button className="cs-btn" onClick={onOrders}>
          my orders
        </button>
        {!ready && (
          <button className="cs-btn cs-btn-quiet" onClick={() => go("printing")}>
            back to printing
          </button>
        )}
      </Actions>
    </section>
  );
}
