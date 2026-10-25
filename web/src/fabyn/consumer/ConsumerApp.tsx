import { useCallback, useEffect, useRef, useState } from "react";
import "./consumer.css";
import { go as goRoute, ROUTES } from "../shared/nav";
import { Entry } from "./Entry";
import { MyOrders } from "./MyOrders";
import { useOrder } from "./useOrder";
import { useMachines } from "./machines";
import { describeError, ensureSession } from "./orders";
import { readProfile, type Profile } from "./profile";
import { phaseOf } from "./phase";
import type { OrderView } from "./model";
import { NoticeScreen, type ScreenProps } from "./Screens";
import { MachineStep, MapStep, UnderstandStep } from "./Find";
import { CheckoutStep, PreviewStep, QueueStep } from "./Order";
import { HandoffStep, PrintingStep } from "./After";
import { NOTICE_PHASES, STEPS, effectiveStep, stepForPhase, stepIndex, type Step } from "./steps";
import { Stage3D } from "./Stage3D";

/* The consumer side of fabyn at /fabyn/order. Every visit starts on the input
   box. The current order lives in memory only; a reload starts over, and
   "my orders" is the way back to earlier orders. */

type View = { kind: "entry" } | { kind: "order"; id: string; fresh: boolean } | { kind: "orders" };

function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cs-mark">
      <defs>
        <clipPath id="cs-mk">
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <g clipPath="url(#cs-mk)" style={{ fill: "var(--acc)" }}>
        <rect x="0" y="8.4" width="24" height="2.1" rx="1" />
        <rect x="0" y="11.5" width="24" height="2.1" rx="1" />
        <rect x="0" y="14.6" width="24" height="2.1" rx="1" />
        <rect x="0" y="17.7" width="24" height="2.1" rx="1" />
        <rect x="0" y="20.8" width="24" height="2.1" rx="1" />
      </g>
      <circle cx="12" cy="12" r="11" style={{ fill: "none", stroke: "var(--acc)", strokeOpacity: 0.5, strokeWidth: 0.8 }} />
    </svg>
  );
}

/** The eight steps, with the open one marked. Steps already passed can be opened again. */
function StepRail({ current, reached, confirmed, onPick }: { current: Step; reached: number; confirmed: boolean; onPick: (s: Step) => void }) {
  const at = stepIndex(current);
  return (
    <nav className="cs-rail" aria-label="Order steps">
      <ol>
        {STEPS.map((s, i) => {
          const before = i < stepIndex("checkout");
          const open = i !== at && i <= reached && s.id !== "understand" && (confirmed ? !before && s.id !== "checkout" : before || s.id === "queue");
          const state = i === at ? "now" : i < at ? "done" : "todo";
          return (
            <li key={s.id} className={`is-${state}`}>
              {open ? (
                <button className="cs-rail-step" onClick={() => onPick(s.id)}>
                  <span>{i + 1}</span>
                  {s.label}
                </button>
              ) : (
                <span className="cs-rail-step" aria-current={state === "now" ? "step" : undefined}>
                  <span>{i + 1}</span>
                  {s.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function OrderScreen({
  id,
  fresh,
  initial,
  onNew,
  onOrders,
}: {
  id: string;
  fresh: boolean;
  initial: OrderView | null;
  onNew: () => void;
  onOrders: () => void;
}) {
  const { order, setOrder, error, reload } = useOrder(id, { initial });
  const { machines } = useMachines(4000);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [step, setStep] = useState<Step | null>(fresh ? "understand" : null);
  const [reached, setReached] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = order ? phaseOf(order) : null;
  // an order opened from "my orders" picks up where it is
  useEffect(() => {
    if (step === null && phase) setStep(stepForPhase(phase));
  }, [step, phase]);
  const shown = step && phase ? effectiveStep(step, phase) : null;
  useEffect(() => {
    if (shown) setReached((r) => Math.max(r, stepIndex(shown)));
    if (shown && step && shown !== step) setStep(shown);
  }, [shown, step]);
  // once Lucas hands it over, printing moves on to the delivery or pickup
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== "ready" && phase === "ready" && step === "printing") setStep("handoff");
    prevPhase.current = phase;
  }, [phase, step]);
  const goStep = useCallback((s: Step) => {
    setActionError("");
    setStep(s);
    window.scrollTo?.({ top: 0 });
  }, []);
  const run = useCallback(
    async (name: string, fn: () => Promise<OrderView>) => {
      setBusy(name);
      setActionError("");
      try {
        setOrder(await fn());
      } catch (e) {
        const d = describeError(e);
        if (d.unknown) {
          setActionError("The result is unknown; the order may still have changed. We refreshed it. Nothing was made twice.");
          await reload();
        } else if (["STALE_DRAFT", "STALE_CHOICE", "STALE_SUGGESTION", "STALE_OFFER", "OFFER_EXPIRED", "PLAN_CHANGED"].includes(d.code)) {
          setActionError("This changed while you were looking. Here is the latest.");
          await reload();
        } else if (d.code === "ROUNDS_EXHAUSTED") {
          setActionError("That was the last round of drafts. Pick one, or change the request.");
          await reload();
        } else {
          setActionError(d.message);
        }
      } finally {
        setBusy("");
      }
    },
    [reload, setOrder],
  );
  if (!order || !shown || !phase)
    return (
      <section className="cs-loading" aria-live="polite">
        <Stage3D machine={null} item={null} progress={null} loop label="getting your order" className="cs-notice-stage" />
        <p className="cs-note">{error ? `Could not load the order: ${error}` : "Getting your order…"}</p>
        {error && (
          <button className="cs-btn" onClick={() => void reload()}>
            try again
          </button>
        )}
      </section>
    );
  const props: ScreenProps = {
    order,
    setOrder,
    reload,
    busy,
    run,
    error: actionError || error,
    now,
    onNew,
    onOrders,
    go: goStep,
    machines,
    fresh,
  };
  const notice = NOTICE_PHASES.includes(phase) || phase === "partial" || phase === "needs_review" || phase === "payment";
  const confirmed = !!order.makeIntent;
  return (
    <>
      <StepRail current={shown} reached={reached} confirmed={confirmed} onPick={goStep} />
      {notice ? (
        <NoticeScreen {...props} phase={phase} />
      ) : shown === "understand" ? (
        <UnderstandStep {...props} />
      ) : shown === "map" ? (
        <MapStep {...props} />
      ) : shown === "machine" ? (
        <MachineStep {...props} />
      ) : shown === "preview" ? (
        <PreviewStep key={`${order.draft.revision}`} {...props} />
      ) : shown === "queue" ? (
        <QueueStep {...props} />
      ) : shown === "checkout" ? (
        <CheckoutStep key={order.offer?.id} {...props} />
      ) : shown === "printing" ? (
        <PrintingStep {...props} />
      ) : (
        <HandoffStep {...props} />
      )}
    </>
  );
}

export default function ConsumerApp() {
  const [view, setView] = useState<View>({ kind: "entry" });
  const [initial, setInitial] = useState<OrderView | null>(null);
  const [profile] = useState<Profile>(readProfile);
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    ensureSession().catch((e) => setSessionError(describeError(e).message));
  }, []);
  const newOrder = useCallback(() => {
    setInitial(null);
    setView({ kind: "entry" });
  }, []);
  const myOrders = useCallback(() => setView({ kind: "orders" }), []);
  return (
    <div className="cs-app">
      <header className="cs-top">
        <button className="cs-brand" onClick={newOrder} aria-label="fabyn, start a new order">
          <Mark />
          <span>fabyn</span>
        </button>
        <nav className="cs-nav" aria-label="Consumer">
          <button className="cs-link" aria-current={view.kind === "orders" ? "page" : undefined} onClick={myOrders}>
            my orders
          </button>
          {view.kind !== "entry" && (
            <button className="cs-link" onClick={newOrder}>
              new order
            </button>
          )}
          <span className="cs-profile" title="Your name on this browser">
            {profile.name}
          </span>
          <button className="cs-link cs-seller" onClick={() => goRoute(ROUTES.seller)}>
            seller side →
          </button>
        </nav>
      </header>
      <main className="cs-main">
        {sessionError && (
          <p role="alert" className="cs-error">
            {sessionError}
          </p>
        )}
        {view.kind === "entry" && (
          <Entry
            profile={profile}
            onCreated={(order) => {
              setInitial(order);
              setView({ kind: "order", id: order.id, fresh: true });
            }}
          />
        )}
        {view.kind === "order" && (
          <OrderScreen key={view.id} id={view.id} fresh={view.fresh} initial={initial} onNew={newOrder} onOrders={myOrders} />
        )}
        {view.kind === "orders" && (
          <MyOrders
            onNew={newOrder}
            onOpen={(id) => {
              setInitial(null);
              setView({ kind: "order", id, fresh: false });
            }}
          />
        )}
      </main>
      <footer className="cs-foot">
        <span>fabyn · spare machines, made nearby</span>
        <button className="cs-link" onClick={() => goRoute(ROUTES.seller)}>
          see the seller side →
        </button>
      </footer>
    </div>
  );
}
