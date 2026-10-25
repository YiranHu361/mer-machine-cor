import { useCallback, useEffect, useState } from "react";
import { Actions, ErrorLine, JobTiles, TitleBlock, type ScreenProps } from "./Screens";
import { estimateJob, makingStartedAt, rideProgress, walkMinutes, COURIER, RIDE_SECONDS, mmss } from "./estimate";
import { orderTitle, phaseOf } from "./phase";
import { stopWork } from "./orders";
import { PLACE, PLACE_SHORT } from "./model";
import { receiptUrl } from "./checkout";
import { readHandoff, saveHandoff, type Handoff } from "./profile";
import { SFMap, BOUNDS, HOME, PALACE, ROUTE_PALACE_TO_HOME, distanceKm, pathLengthKm, formatKm, type MapPin } from "../shared/map";

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

function HandoffChoice({ onPick }: { onPick: (mode: Handoff["mode"]) => void }) {
  return (
    <fieldset className="cs-choice">
      <legend>How do you get it?</legend>
      <div className="cs-choice-row">
        <button type="button" className="cs-btn" onClick={() => onPick("delivery")}>
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

const homePins = (extra: MapPin[] = [], highlight = false): MapPin[] => [
  { id: "palace", at: PALACE, label: `Lucas · ${PALACE.short}`, tone: highlight ? "match" : "place", showLabel: true, labelAt: "right" },
  { id: "home", at: HOME, label: `you · ${HOME.short}`, tone: "home", showLabel: true, labelAt: "left" },
  ...extra,
];

/* ---------- 7: printing ---------- */

export function PrintingStep({ order, now, run, busy, error, go, onOrders }: ScreenProps) {
  const plan = order.plan!;
  const [handoff, setHandoff] = useHandoff(order.id);
  const startedAt = makingStartedAt(order.events);
  const states = plan.assignments.map((a) => estimateJob(a, { now, startedAt, readyEstimateMinutes: plan.readyEstimateMinutes }).state);
  const printed = states.every((s) => s === "handover" || s === "finished");
  const cancellable = ["approved", "in_progress"].includes(plan.status) && !printed;
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
          <SFMap pins={homePins()} route={handoff?.mode === "delivery" ? ROUTE_PALACE_TO_HOME : undefined} bounds={BOUNDS.north} hoods label="Map from the Palace of Fine Arts to you" />
          {handoff ? (
            <p className="cs-note">
              {handoff.mode === "delivery"
                ? `${COURIER.name} (${COURIER.vehicle}) brings it to ${HOME.short} once Lucas hands it over: ${formatKm(pathLengthKm(ROUTE_PALACE_TO_HOME))}, about ${Math.round(RIDE_SECONDS / 60)} min.`
                : `You collect it from Lucas at the ${PLACE_SHORT}.`}
            </p>
          ) : (
            <HandoffChoice onPick={(mode) => setHandoff({ mode })} />
          )}
        </aside>
      </div>
      <ErrorLine text={error} />
      <Actions>
        <button className={`cs-btn ${printed ? "cs-btn-main" : ""}`} onClick={() => go("handoff")}>
          {handoff?.mode === "pickup" ? "pickup details" : "follow the delivery"}
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
  const ready = phaseOf(order) === "ready";
  const codes = plan.assignments.map((a) => a.child?.pickupCode).filter(Boolean) as string[];
  // the ride starts the first time this browser sees the order handed over
  useEffect(() => {
    if (ready && handoff?.mode === "delivery" && !handoff.rideStartedAt) setHandoff({ ...handoff, rideStartedAt: Date.now() });
  }, [ready, handoff, setHandoff]);
  if (!handoff)
    return (
      <section className="cs-ready" aria-labelledby="cs-ready-title">
        <TitleBlock id="cs-ready-title" kicker="get it" title={orderTitle(order)} sub="Choose how you get it." />
        <HandoffChoice onPick={(mode) => setHandoff({ mode })} />
      </section>
    );
  const delivery = handoff.mode === "delivery";
  const ride = rideProgress(delivery && ready ? handoff.rideStartedAt ?? null : null, now);
  const km = formatKm(pathLengthKm(ROUTE_PALACE_TO_HOME));
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
      <TitleBlock id="cs-ready-title" kicker={delivery ? "get it · delivery" : "get it · pickup"} title={title} sub={`${orderTitle(order)} · ${delivery ? `${PALACE.short} → ${HOME.label}` : PLACE}`} />
      <div className="cs-handoff-grid">
        <SFMap
          pins={homePins([], !delivery)}
          route={delivery ? ROUTE_PALACE_TO_HOME : undefined}
          progress={delivery ? ride.t : undefined}
          markerLabel={delivery ? `${COURIER.name.split(" ")[0]} · ${COURIER.vehicle}` : undefined}
          bounds={BOUNDS.north}
          hoods
          label={delivery ? `Route from the ${PALACE.short} to ${HOME.label}` : `Map around the ${PALACE.short}`}
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
                  Lyon St → Lombard St → Fillmore St · {km}
                </dd>
              </div>
              <div>
                <dt>arrives</dt>
                <dd aria-live="polite">
                  {!ready
                    ? `about ${Math.round(RIDE_SECONDS / 60)} min after Lucas hands it over`
                    : ride.arrived
                      ? `here · ${HOME.label}`
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
              <div>
                <dt>from you</dt>
                <dd>
                  {formatKm(distanceKm(HOME, PALACE))} · about {walkMinutes(distanceKm(HOME, PALACE))} min on foot
                </dd>
              </div>
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
          <button className="cs-link" onClick={() => setHandoff({ mode: delivery ? "pickup" : "delivery" })}>
            {delivery ? "pick it up instead" : "have it delivered instead"}
          </button>
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
