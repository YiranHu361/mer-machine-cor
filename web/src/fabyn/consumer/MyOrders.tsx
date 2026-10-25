import { useEffect, useState } from "react";
import { getOrder } from "./orders";
import { readOrderRefs, type OrderRef } from "./profile";
import { estimateJob, makingStartedAt, mmss } from "./estimate";
import { phaseOf, orderTitle, type Phase } from "./phase";
import { machineLabel, PLACE_SHORT, type OrderView } from "./model";

/* Every order this browser started, polled from the server. Nothing here is
   restored automatically; the list is only reached from the header. */

const PHASE_TEXT: Record<Phase, string> = {
  understand: "getting your order ready",
  drafts: "waiting for you to pick a design",
  proposal: "ready to confirm",
  payment: "checking payment",
  payment_failed: "payment failed, nothing made",
  making: "making",
  ready: "ready to collect",
  partial: "partly finished",
  needs_review: "the maker is checking",
  cancelled: "stopped",
  superseded: "replaced",
  unavailable: "no machine right now",
  failed: "stopped with a problem",
  question: "needs a short answer",
};

export function MyOrders({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [refs, setRefs] = useState<OrderRef[]>([]);
  const [orders, setOrders] = useState<Record<string, OrderView | "gone">>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setRefs(readOrderRefs());
  }, []);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const list = readOrderRefs();
      const results = await Promise.all(
        list.map(async (r) => {
          try {
            return [r.id, await getOrder(r.id)] as const;
          } catch {
            return [r.id, "gone"] as const;
          }
        }),
      );
      if (!alive) return;
      setOrders(Object.fromEntries(results));
      setNow(Date.now());
    };
    void pull();
    const t = setInterval(() => void pull(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <section className="cs-orders" aria-labelledby="cs-orders-title">
      <header className="cs-head">
        <p className="cs-kicker">this browser</p>
        <h1 id="cs-orders-title" className="cs-title cs-title-sm">
          my orders
        </h1>
      </header>
      {refs.length === 0 && (
        <p className="cs-note">No orders yet. Start one and it will show up here with every machine it uses.</p>
      )}
      <ul className="cs-order-list">
        {refs.map((r) => {
          const o = orders[r.id];
          if (!o) return <li key={r.id} className="cs-order-row"><p className="cs-note">loading…</p></li>;
          if (o === "gone")
            return (
              <li key={r.id} className="cs-order-row">
                <p className="cs-note">This order is no longer on the server.</p>
              </li>
            );
          const phase = phaseOf(o);
          const started = makingStartedAt(o.events);
          return (
            <li key={r.id} className="cs-order-row">
              <div className="cs-order-top">
                <div>
                  <p className="cs-order-title">{orderTitle(o)}</p>
                  <p className="cs-fine">{PHASE_TEXT[phase]}</p>
                </div>
                <button className="cs-btn" onClick={() => onOpen(o.id)}>
                  open
                </button>
              </div>
              {o.plan && o.plan.assignments.length > 0 && (
                <ul className="cs-order-jobs">
                  {o.plan.assignments.map((a) => {
                    const p = estimateJob(a, { now, startedAt: started, readyEstimateMinutes: o.plan!.readyEstimateMinutes });
                    return (
                      <li key={a.id}>
                        <span>{machineLabel(a.machineId, a.machineName)}</span>
                        <span className="cs-fine">{PLACE_SHORT}</span>
                        <span>
                          {p.state === "finished" ? "made" : p.state === "checking" ? "checking" : p.state === "failed" ? "not made" : `${p.percent}%`}
                          {p.etaSeconds !== null && p.state === "making" ? ` · ${mmss(p.etaSeconds)}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="cs-actions">
        <button className="cs-btn" onClick={onNew}>
          place another order
        </button>
      </div>
    </section>
  );
}
