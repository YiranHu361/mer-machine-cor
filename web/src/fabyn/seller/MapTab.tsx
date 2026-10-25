// The workshop on the San Francisco map: Lucas's machines at the Palace of Fine
// Arts, where finished orders are headed, couriers out on delivery, and the
// other makers around the city for context.
import { useMemo, useState } from "react";
import { BOUNDS, PALACE, PROCESS_LABEL, SFMap, WORLD_MACHINES, formatKm, pointAlong, type MapPin } from "../shared/map";
import { PHASE_TEXT } from "./estimate";
import { customerOf, groupOrders, orderName, shortId } from "./orderGroups";
import { machineStatus, MACHINE_LABEL } from "./status";
import { courierEstimate, frameAround, tripKm, useStreetRoute, type OrderDelivery } from "./deliveries";
import type { Dashboard } from "./data";
import { MAKER } from "./data";
import type { LiveMachine } from "./live";

const KIND_LABEL = { individual: "people", makerspace: "makerspaces", "small factory": "small factories", factory: "factories" } as const;

export function MapTab({ dash, live, handoffs, now }: { dash: Dashboard; live: LiveMachine[]; handoffs: Record<string, OrderDelivery>; now: number }) {
  const [view, setView] = useState<"deliveries" | "city">("deliveries");
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useMemo(() => groupOrders(dash.jobs), [dash.jobs]);
  const workshop = live.find((m) => m.location)?.location ?? { lat: PALACE.lat, lng: PALACE.lng, label: PALACE.label };
  const out = orders
    .map((o) => ({ o, d: handoffs[o.key] }))
    .filter((x): x is { o: (typeof orders)[number]; d: OrderDelivery & { courier: NonNullable<OrderDelivery["courier"]>; to: NonNullable<OrderDelivery["to"]> } } => !!x.d?.courier && !!x.d.to)
    .map(({ o, d }) => ({ o, d, est: courierEstimate(d.courier, now), courier: d.courier, calledAt: Date.parse(d.courier.calledAt) }))
    .filter((x) => x.est.phase !== "delivered" || now - x.calledAt < 3 * 3600000);
  const moving = out.filter((x) => x.est.phase !== "delivered").sort((a, b) => b.calledAt - a.calledAt);
  const lead = moving[0];
  const leadRoute = useStreetRoute(workshop, lead?.d.to);
  const statuses = dash.machines.map((m) => machineStatus(m, dash.connectors.find((c) => c.machineId === m.id), dash.jobs).key);
  const free = statuses.filter((k) => k === "available").length;
  const pins: MapPin[] = [
    {
      id: "workshop",
      at: workshop,
      label: `${MAKER.name}’s workshop`,
      sub: `${dash.machines.length} machines · ${free} free`,
      tone: "match",
      interactive: true,
      showLabel: true,
    },
    ...out.map((x) => ({
      id: `home-${x.o.key}`,
      at: x.d.to,
      label: `${customerOf(x.o, "Customer")} · ${x.d.to.label}`,
      sub: `#${shortId(x.o)} · ${PHASE_TEXT[x.est.phase]}`,
      tone: "home" as const,
      interactive: true,
      showLabel: x === lead,
    })),
    ...moving.slice(1).map((x) => ({
      id: `courier-${x.o.key}`,
      at: x.est.phase === "on_the_way" ? pointAlong([workshop, x.d.to], x.est.routeFraction) : workshop,
      label: `${x.courier.name} · ${x.courier.vehicle}`,
      sub: `#${shortId(x.o)} · ${PHASE_TEXT[x.est.phase]}`,
      tone: "courier" as const,
    })),
    ...(view === "city"
      ? WORLD_MACHINES.map((w) => ({
          id: w.id,
          at: w.at,
          label: w.owner,
          sub: `${w.model} · ${PROCESS_LABEL[w.process]} · ${w.status === "busy" ? `busy, ${w.queue ?? 0} ahead` : w.status}`,
          tone: (w.status === "offline" ? "offline" : w.status === "busy" ? "busy" : "type") as MapPin["tone"],
          interactive: true,
        }))
      : []),
  ];
  const picked = selected ? WORLD_MACHINES.find((w) => w.id === selected) : undefined;
  const byKind = WORLD_MACHINES.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.kind]: (acc[w.kind] ?? 0) + w.count }), {});
  return (
    <section aria-labelledby="sl-map-title">
      <header className="sl-section-head">
        <p className="sl-kicker">map · {workshop.label}</p>
        <h2 id="sl-map-title" className="sl-h2">
          Your machines on the map, and where your orders are going.
        </h2>
        <p className="sl-lede">People nearby order from the closest free machine that can make their thing. Couriers take finished orders from your table to their door.</p>
      </header>
      <div className="sl-filters" role="tablist" aria-label="Map view">
        <button type="button" role="tab" aria-selected={view === "deliveries"} className="sl-filter" onClick={() => setView("deliveries")}>
          Deliveries <span>{moving.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === "city"} className="sl-filter" onClick={() => setView("city")}>
          The whole city <span>{WORLD_MACHINES.length + 1}</span>
        </button>
      </div>
      <div className="sl-map-layout">
        <div className="sl-map-frame">
          <SFMap
            pins={pins}
            route={lead ? leadRoute : undefined}
            progress={lead ? lead.est.routeFraction : undefined}
            markerLabel={lead ? `${lead.courier.name} · ${lead.courier.vehicle}` : undefined}
            bounds={view === "city" ? BOUNDS.city : out.length ? frameAround([workshop, ...out.map((x) => x.d.to)]) : BOUNDS.north}
            selectedId={selected}
            onSelect={(id) => setSelected((s) => (s === id ? null : id))}
            label={view === "city" ? "Map of San Francisco with Lucas's workshop and other makers" : "Map of deliveries from the Palace of Fine Arts"}
          />
        </div>
        <aside className="sl-map-side">
          <div className="sl-panel">
            <h3 className="sl-h3">{MAKER.name}’s workshop</h3>
            <p className="sl-fine">{workshop.label}</p>
            <ul className="sl-map-machines">
              {dash.machines.map((m, i) => {
                const l = live.find((x) => x.id === m.id);
                return (
                  <li key={m.id}>
                    <span className={`sl-state is-${statuses[i]}`}>
                      <i aria-hidden="true" />
                      {MACHINE_LABEL[statuses[i]]}
                    </span>
                    <b>{m.name}</b>
                    <span className="sl-fine">{l?.current ? `Making: ${l.current.title}` : l?.queue?.length ? `${l.queue.length} queued` : m.model}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="sl-panel">
            <h3 className="sl-h3">Out for delivery</h3>
            {moving.length === 0 ? (
              <p className="sl-fine">No courier is out right now. Call one from the Delivery tab when an order is ready.</p>
            ) : (
              <ul className="sl-map-couriers">
                {moving.map((x) => (
                  <li key={x.o.key}>
                    <b>
                      {x.courier.name} · {x.courier.vehicle}
                    </b>
                    <span className="sl-fine">
                      #{shortId(x.o)} {orderName(x.o)} · {PHASE_TEXT[x.est.phase]} · to {x.d.to.label}
                      {tripKm(x.d, workshop) ? ` (${formatKm(tripKm(x.d, workshop)!)})` : ""} · drop-off in {x.est.dropoffMin} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {view === "city" && (
            <div className="sl-panel">
              <h3 className="sl-h3">{picked ? picked.owner : "Other makers around SF"}</h3>
              {picked ? (
                <p className="sl-fine">
                  {picked.kind} in {picked.hood} · {picked.model} · {PROCESS_LABEL[picked.process]} ·{" "}
                  {picked.status === "busy" ? `busy, ${picked.queue ?? 0} ahead, free in about ${picked.nextFreeMin ?? 0} min` : picked.status}
                </p>
              ) : (
                <p className="sl-fine">
                  {Object.entries(byKind)
                    .map(([k, n]) => `${n} machines run by ${KIND_LABEL[k as keyof typeof KIND_LABEL]}`)
                    .join(" · ")}
                  . Sellers can be one person with an idle printer or a factory with spare lines.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
