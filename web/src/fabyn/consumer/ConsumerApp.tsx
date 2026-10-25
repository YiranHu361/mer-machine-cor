import { useCallback, useEffect, useState } from "react";
import "./consumer.css";
import { go as goRoute, ROUTES } from "../shared/nav";
import { Entry } from "./Entry";
import { MyOrders } from "./MyOrders";
import { describeError, ensureSession } from "./orders";
import { readProfile, type Profile } from "./profile";
import type { OrderView } from "./model";
import { Mark, OrderThread } from "./Chat";
import { activeConversation, rememberConversation } from "./conversation";

/* The consumer side of fabyn at /fabyn/order. Every visit starts on the
   conversation with fabyn. The conversation is kept on the server and this tab
   remembers which one is open, so a reload picks it up again (and its order,
   once one was chosen); "new order" starts a fresh conversation, and "my
   orders" is the way back to earlier orders. */

type View = { kind: "entry" } | { kind: "order"; id: string; fresh: boolean } | { kind: "orders" };

export default function ConsumerApp() {
  const [view, setView] = useState<View>({ kind: "entry" });
  const [initial, setInitial] = useState<OrderView | null>(null);
  // the conversation this tab had open before a reload, read once
  const [resume] = useState(activeConversation);
  const [entryKey, setEntryKey] = useState(0);
  const [profile] = useState<Profile>(readProfile);
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    ensureSession().catch((e) => setSessionError(describeError(e).message));
  }, []);
  const newOrder = useCallback(() => {
    rememberConversation(null);
    setInitial(null);
    setEntryKey((k) => k + 1);
    setView({ kind: "entry" });
  }, []);
  const openOrder = useCallback((order: OrderView, fresh: boolean) => {
    setInitial(order);
    setView({ kind: "order", id: order.id, fresh });
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
          <Entry key={entryKey} profile={profile} resume={entryKey === 0 ? resume : null} onCreated={openOrder} />
        )}
        {view.kind === "order" && (
          <OrderThread
            key={view.id}
            id={view.id}
            fresh={view.fresh}
            initial={initial}
            profile={profile}
            onNew={newOrder}
            onOrders={myOrders}
            onSwitch={(order) => openOrder(order, true)}
          />
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
