import { useCallback, useEffect, useRef, useState } from "react";
import "./consumer.css";
import { go, ROUTES } from "../shared/nav";
import { Entry } from "./Entry";
import { MyOrders } from "./MyOrders";
import { useOrder } from "./useOrder";
import { describeError, ensureSession } from "./orders";
import { readProfile, type Profile } from "./profile";
import { phaseOf, toolCalls, type Phase } from "./phase";
import type { OrderView } from "./model";
import {
  DraftsScreen,
  MakingScreen,
  NoticeScreen,
  ProposalScreen,
  ReadyScreen,
  UnderstandScreen,
  type Pace,
  type ScreenProps,
} from "./Screens";
import { Stage3D } from "./Stage3D";

/* The consumer side of fabyn at /fabyn/order. Every visit starts on the input
   box. The current order lives in memory only; a reload starts over, and
   "my orders" is the way back to earlier orders. */

type View = { kind: "entry" } | { kind: "order"; id: string } | { kind: "orders" };

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

function OrderScreen({
  id,
  initial,
  onNew,
}: {
  id: string;
  initial: OrderView | null;
  onNew: () => void;
}) {
  const { order, setOrder, error, reload } = useOrder(id, { initial });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // a new order shows its tool calls one by one; so does the rest of the plan after a design is picked
  const [pace, setPace] = useState<Pace | null>(initial ? { start: Date.now(), from: 0 } : null);
  const endPace = useCallback(() => setPace(null), []);
  const prevPhase = useRef<Phase | null>(null);
  const draftsDone = useRef(0);
  const phase = order ? phaseOf(order) : null;
  useEffect(() => {
    if (!order || !phase) return;
    if (phase === "drafts") draftsDone.current = toolCalls(order).filter((c) => c.done).length;
    if (prevPhase.current === "drafts" && (phase === "understand" || phase === "proposal"))
      setPace({ start: Date.now(), from: draftsDone.current });
    prevPhase.current = phase;
  }, [order, phase]);
  const run = useCallback(
    async (name: string, fn: () => Promise<OrderView>) => {
      setBusy(name);
      setActionError("");
      try {
        setOrder(await fn());
      } catch (e) {
        const d = describeError(e);
        if (d.unknown) {
          setActionError(
            "The result is unknown; the order may still have changed. We refreshed it. Nothing was made twice.",
          );
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
  if (!order)
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
  };
  if (pace && (phase === "understand" || phase === "drafts" || phase === "proposal"))
    return <UnderstandScreen {...props} pace={pace} onPaced={endPace} />;
  switch (phase) {
    case "understand":
      return <UnderstandScreen {...props} />;
    case "drafts":
      return <DraftsScreen {...props} />;
    case "proposal":
      return <ProposalScreen {...props} />;
    case "making":
      return <MakingScreen {...props} />;
    case "ready":
      return <ReadyScreen {...props} />;
    default:
      return <NoticeScreen {...props} phase={phase ?? "failed"} />;
  }
}

export default function ConsumerApp() {
  const [view, setView] = useState<View>({ kind: "entry" });
  const [initial, setInitial] = useState<OrderView | null>(null);
  const [profile] = useState<Profile>(readProfile);
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    ensureSession().catch((e) => setSessionError(describeError(e).message));
  }, []);
  const newOrder = () => {
    setInitial(null);
    setView({ kind: "entry" });
  };
  return (
    <div className="cs-app">
      <header className="cs-top">
        <button className="cs-brand" onClick={newOrder} aria-label="fabyn, start a new order">
          <Mark />
          <span>fabyn</span>
        </button>
        <nav className="cs-nav" aria-label="Consumer">
          <button
            className="cs-link"
            aria-current={view.kind === "orders" ? "page" : undefined}
            onClick={() => setView({ kind: "orders" })}
          >
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
          <button className="cs-link cs-seller" onClick={() => go(ROUTES.seller)}>
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
              setView({ kind: "order", id: order.id });
            }}
          />
        )}
        {view.kind === "order" && (
          <OrderScreen key={view.id} id={view.id} initial={initial} onNew={newOrder} />
        )}
        {view.kind === "orders" && (
          <MyOrders
            onNew={newOrder}
            onOpen={(id) => {
              setInitial(null);
              setView({ kind: "order", id });
            }}
          />
        )}
      </main>
      <footer className="cs-foot">
        <span>fabyn · spare machines, made nearby</span>
        <button className="cs-link" onClick={() => go(ROUTES.seller)}>
          see the seller side →
        </button>
      </footer>
    </div>
  );
}
