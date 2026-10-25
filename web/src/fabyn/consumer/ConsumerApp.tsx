import { useCallback, useEffect, useState } from "react";
import "./consumer.css";
import { go as goRoute, ROUTES } from "../shared/nav";
import { Entry } from "./Entry";
import { MyOrders } from "./MyOrders";
import { describeError, ensureSession } from "./orders";
import { readProfile, type Profile } from "./profile";
import type { OrderView } from "./model";
import { Mark, OrderThread } from "./Chat";

/* The consumer side of fabyn at /fabyn/order. Every visit starts on the chat
   box. The current order lives in memory and its thread in this tab; a reload
   starts over, and "my orders" is the way back to earlier orders. */

type View = { kind: "entry" } | { kind: "order"; id: string; fresh: boolean } | { kind: "orders" };

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
          <OrderThread key={view.id} id={view.id} fresh={view.fresh} initial={initial} profile={profile} onNew={newOrder} onOrders={myOrders} />
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
