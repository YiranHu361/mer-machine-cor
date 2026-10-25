// The workshop on the San Francisco map: Lucas's machines at the Palace of Fine
// Arts, where finished orders are headed, couriers out on delivery, and the
// other makers around the city for context.
import { useMemo, useState } from "react";
import { BOUNDS, HOME, PALACE, PROCESS_LABEL, ROUTE_PALACE_TO_HOME, SFMap, WORLD_MACHINES, formatKm, pathLengthKm, pointAlong, type MapPin } from "../shared/map";
import { courierEstimate, courierFor, PHASE_TEXT } from "./estimate";
import { groupOrders, shortId } from "./orderGroups";
import { machineStatus, MACHINE_LABEL } from "./status";
import type { Handoff } from "./deliveries";
import type { Dashboard } from "./data";
import { MAKER } from "./data";
import type { LiveMachine } from "./live";

const KIND_LABEL = { individual: "people", makerspace: "makerspaces", "small factory": "small factories", factory: "factories" } as const;

export function MapTab({ dash, live, handoffs, now }: { dash: Dashboard; live: LiveMachine[]; handoffs: Record<string, Handoff>; now: number }) {
  const [view, setView] = useState<"deliveries" | "city">("deliveries");
  const [selected, setSelected] = useState<string | null>(null);
  const tripKm = pathLengthKm(ROUTE_PALACE_TO_HOME);
  const orders = useMemo(() => groupOrders(dash.jobs), [dash.jobs]);
  const out = orders
    .map((o) => ({ o, h: handoffs[o.key] }))
    .filter((x): x is { o: (typeof orders)[number]; h: Extract<Handoff, { mode: "courier" }> } => x.h?.mode === "courier")
    .map(({ o, h }) => ({ o, h, est: courierEstimate(h.at, tripKm, now), courier: courierFor(o.key) }))
    .filter((x) => x.est.phase !== "delivered" || now - x.h.at < 3 * 3600000);
  const moving = out.filter((x) => x.est.phase !== "delivered").sort((a, b) => b.h.at - a.h.at);
  const lead = moving[0];
  const workshop = live.find((m) => m.location)?.location ?? { lat: PALACE.lat, lng: PALACE.lng, label: PALACE.label };
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
    ...(out.length
      ? [{ id: "home", at: HOME, label: `${HOME.person} · ${HOME.short}`, sub: `${out.length} order${out.length === 1 ? "" : "s"} headed here`, tone: "home" as const, interactive: true, showLabel: true }]
      : []),
    ...moving.slice(1).map((x) => ({
      id: `courier-${x.o.key}`,
      at: x.est.phase === "on_the_way" ? pointAlong(ROUTE_PALACE_TO_HOME, x.est.routeFraction) : workshop,
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
            route={lead ? ROUTE_PALACE_TO_HOME : undefined}
            progress={lead ? lead.est.routeFraction : undefined}
            markerLabel={lead ? `${lead.courier.name} · ${lead.courier.vehicle}` : undefined}
            bounds={view === "city" ? BOUNDS.city : BOUNDS.north}
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
                      #{shortId(x.o)} {x.o.title} · {PHASE_TEXT[x.est.phase]} · drop-off in {x.est.dropoffMin} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="sl-fine">
              Trip from the Palace to {HOME.short}: {formatKm(tripKm)}.
            </p>
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
