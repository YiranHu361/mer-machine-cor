import { useCallback, useEffect, useState } from "react";
import { Actions, ErrorLine, JobTiles, TitleBlock, type ScreenProps } from "./Screens";
import { estimateJob, makingStartedAt, rideProgress, rideSecondsFor, walkMinutes, COURIER, mmss } from "./estimate";
import { orderTitle, phaseOf } from "./phase";
import { stopWork } from "./orders";
import { PLACE, PLACE_SHORT } from "./model";
import { receiptUrl } from "./checkout";
import { readHandoff, saveHandoff, type Handoff } from "./profile";
import { SFMap, BOUNDS, PALACE, areaLabel, boundsAround, distanceKm, formatKm, inBounds, type LatLng, type MapPin } from "../shared/map";
import { deliveryFor, spotOf, useStreetRoute, useWhere, type StreetRoute } from "./location";

/* Steps 7–8: printing on the machine, then delivery or pickup. The progress
   and the courier ride are estimates (estimate.ts); the job states, the
   pickup code and the payment receipt are the saved order. */

function useHandoff(id: string) {
  const [h, setH] = useState<Handoff | null>(() => readHandoff(id));
  const set = useCallback(
    (next: Handoff) => {
      saveHandoff(id, next);
      setH(next);
    },
    [id],
  );
  return [h, set] as const;
}

function HandoffChoice({ onPick, reach }: { onPick: (mode: Handoff["mode"]) => void; reach: { ok: boolean; why: string } }) {
  return (
    <fieldset className="cs-choice">
      <legend>How do you get it?</legend>
      {!reach.ok && <p className="cs-note">{reach.why}</p>}
      <div className="cs-choice-row">
        <button type="button" className="cs-btn" disabled={!reach.ok} onClick={() => onPick("delivery")}>
          deliver to me
        </button>
        <button type="button" className="cs-btn" onClick={() => onPick("pickup")}>
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

const youLabel = (spot: LatLng) =>
  inBounds(spot, BOUNDS.city) ? `you · ${areaLabel(spot)}` : `you · ${formatKm(distanceKm(spot, PALACE))} away`;

const handoffPins = (spot: LatLng | null, highlight = false): MapPin[] => [
  { id: "palace", at: PALACE, label: `Lucas · ${PALACE.short}`, tone: highlight ? "match" : "place", showLabel: true, labelAt: "right" },
  ...(spot ? [{ id: "home", at: spot, label: youLabel(spot), tone: "home" as const, showLabel: true, labelAt: "left" as const }] : []),
];

/** Frame the machine, the person and the route; someone outside the city gets an edge marker on an SF map. */
const frameFor = (spot: LatLng | null, route: StreetRoute | null) =>
  boundsAround([PALACE, ...(spot ? [spot] : []), ...(route?.path ?? [])], {
    minKm: spot && !inBounds(spot, BOUNDS.city) ? 7 : 1.6,
  });

/** Delivery is on only when chosen and the person's real spot is within the courier's reach. */
function useDelivery(handoff: Handoff | null) {
  const spot = spotOf(useWhere());
  const reach = deliveryFor(spot);
  const delivery = handoff?.mode === "delivery" && reach.ok && !!spot;
  const route = useStreetRoute(PALACE, delivery ? spot : null);
  // until the street route loads, a ride of about 1.3 times the straight line
  const km = route?.km ?? (spot ? distanceKm(PALACE, spot) * 1.3 : 0);
  return { spot, reach, delivery, route, km, rideSeconds: rideSecondsFor(km) };
}

/* ---------- 7: printing ---------- */

export function PrintingStep({ order, now, run, busy, error, go, onOrders }: ScreenProps) {
  const plan = order.plan!;
  const [handoff, setHandoff] = useHandoff(order.id);
  const { spot, reach, delivery, route, km, rideSeconds } = useDelivery(handoff);
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
            pins={handoffPins(spot, !delivery)}
            route={delivery ? route?.path : undefined}
            bounds={frameFor(spot, delivery ? route : null)}
            hoods
            label={`Map from the ${PALACE.short}${spot ? " to you" : ""}`}
          />
          {handoff ? (
            <p className="cs-note">
              {delivery && spot
                ? `${COURIER.name} (${COURIER.vehicle}) brings it to you in ${areaLabel(spot)} once Lucas hands it over: ${formatKm(km)}${route?.streets ? " over the streets" : ""}, about ${Math.round(rideSeconds / 60)} min.`
                : `You collect it from Lucas at the ${PLACE_SHORT}.${handoff.mode === "delivery" && !reach.ok ? ` ${reach.why}` : ""}`}
            </p>
          ) : (
            <HandoffChoice reach={reach} onPick={(mode) => setHandoff({ mode })} />
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

export function HandoffStep({ order, now, onNew, onOrders, go }: ScreenProps) {
  const plan = order.plan!;
  const [handoff, setHandoff] = useHandoff(order.id);
  const { spot, reach, delivery, route, rideSeconds } = useDelivery(handoff);
  const ready = phaseOf(order) === "ready";
  const codes = plan.assignments.map((a) => a.child?.pickupCode).filter(Boolean) as string[];
  // the ride starts the first time this browser sees the order handed over
  useEffect(() => {
    if (ready && delivery && handoff && !handoff.rideStartedAt) setHandoff({ ...handoff, rideStartedAt: Date.now() });
  }, [ready, delivery, handoff, setHandoff]);
  if (!handoff)
    return (
      <section className="cs-ready" aria-labelledby="cs-ready-title">
        <TitleBlock id="cs-ready-title" kicker="get it" title={orderTitle(order)} sub="Choose how you get it." />
        <HandoffChoice reach={reach} onPick={(mode) => setHandoff({ mode })} />
      </section>
    );
  const ride = rideProgress(delivery && ready ? handoff.rideStartedAt ?? null : null, now, rideSeconds);
  const walkKm = spot ? distanceKm(spot, PALACE) : null;
  const title = delivery
    ? !ready
      ? "Waiting for Lucas to hand it over"
      : ride.arrived
        ? `${COURIER.name.split(" ")[0]} is outside`
        : `On its way · ${mmss(ride.etaSeconds)}`
    : ready
      ? "Ready to collect"
      : "Almost ready to collect";
  return (
    <section className="cs-ready" aria-labelledby="cs-ready-title">
      <TitleBlock id="cs-ready-title" kicker={delivery ? "get it · delivery" : "get it · pickup"} title={title} sub={`${orderTitle(order)} · ${delivery && spot ? `${PALACE.short} → you in ${areaLabel(spot)}` : PLACE}`} />
      <div className="cs-handoff-grid">
        <SFMap
          pins={handoffPins(spot, !delivery)}
          route={delivery ? route?.path : undefined}
          progress={delivery && route ? ride.t : undefined}
          markerLabel={delivery ? `${COURIER.name.split(" ")[0]} · ${COURIER.vehicle}` : undefined}
          bounds={frameFor(spot, delivery ? route : null)}
          hoods
          label={delivery ? `Route from the ${PALACE.short} to you` : `Map around the ${PALACE.short}`}
        />
        <div className="cs-handoff-body">
          {delivery ? (
            <dl className="cs-facts cs-facts-tight">
              <div>
                <dt>courier</dt>
                <dd>
                  {COURIER.name} · {COURIER.vehicle}
                </dd>
              </div>
              <div>
                <dt>contact</dt>
                <dd>{COURIER.contact}</dd>
              </div>
              <div>
                <dt>route</dt>
                <dd>
                  {route ? `${formatKm(route.km)} ${route.streets ? "over the streets" : "in a straight line (the street route did not load)"}` : "working out the route…"}
                </dd>
              </div>
              <div>
                <dt>arrives</dt>
                <dd aria-live="polite">
                  {!ready
                    ? `about ${Math.round(rideSeconds / 60)} min after Lucas hands it over`
                    : ride.arrived
                      ? `here · ${spot ? areaLabel(spot) : "your spot"}`
                      : `in about ${mmss(ride.etaSeconds)}`}
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
              <p>No pickup code for this print. {delivery ? `${COURIER.name.split(" ")[0]} hands it to you directly.` : "Show this screen at the table and Lucas hands it over."}</p>
            ) : (
              <p>Lucas has not handed it over yet. {delivery ? "The ride starts" : "A pickup code shows here"} as soon as he does.</p>
            )}
          </div>
          {handoff.mode === "delivery" && !reach.ok && <p className="cs-note">{reach.why}</p>}
          {(delivery || reach.ok) && (
            <button className="cs-link" onClick={() => setHandoff({ mode: delivery ? "pickup" : "delivery" })}>
              {delivery ? "pick it up instead" : "have it delivered instead"}
            </button>
          )}
        </div>
      </div>
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
