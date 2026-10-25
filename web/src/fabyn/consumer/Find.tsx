import { useEffect, useState } from "react";
import { Stage3D } from "./Stage3D";
import { Actions, ErrorLine, TitleBlock, ToolList, usePaced, waitItem, type ScreenProps } from "./Screens";
import { findCalls, kindForWait, mainProcess, matchedMachine, requestShort } from "./phase";
import { KIND_OF_PROCESS, LABEL_OF_PROCESS, MACHINE_NAME, MATCH_OF_PROCESS } from "./model";
import { STATUS_TEXT, type LiveMachine } from "./machines";
import { SFMap, BOUNDS, PALACE, WORLD_MACHINES, areaLabel, distanceKm, fitFor, formatKm, inBounds, inSanFrancisco, PROCESS_LABEL, type MapPin, type Fit } from "../shared/map";
import { askLocation, deliveryFor, placeText, setLocation, spotOf, useWhere, whyNoSpot, type Where } from "./location";

/* Steps 1–3: the agent reads the request and matches a machine type, the map
   of San Francisco shows every maker and why only one can take it, then the
   matched machine itself. */

function MatchLine({ order }: { order: ScreenProps["order"] }) {
  const process = mainProcess(order);
  if (!process) return null;
  return (
    <p className="cs-match" aria-label={`${LABEL_OF_PROCESS[process]} needs a ${MATCH_OF_PROCESS[process]}`}>
      <span>{LABEL_OF_PROCESS[process]}</span>
      <i aria-hidden="true">→</i>
      <b>{MATCH_OF_PROCESS[process]}</b>
    </p>
  );
}

/* ---------- 1: understand ---------- */

export function UnderstandStep({ order, machines, fresh, go, onNew }: ScreenProps) {
  const calls = findCalls(order, machines, spotOf(useWhere()));
  const { shown, settled } = usePaced(calls, !fresh);
  useEffect(() => {
    if (settled) go("map");
  }, [settled, go]);
  const kind = shown >= 2 ? kindForWait(order) : null;
  const item = shown >= 2 ? waitItem(order) : null;
  const current = calls[shown]?.fn.replace(/_/g, " ") ?? "opening the map";
  return (
    <section className="cs-stage-screen" aria-labelledby="cs-understand">
      <div className="cs-stage-grid">
        <div>
          <ToolList calls={calls} shown={shown} />
          {shown >= 2 && <MatchLine order={order} />}
        </div>
        <div className="cs-stage-box">
          <Stage3D
            machine={kind}
            item={item}
            progress={null}
            loop={!kind}
            parked
            focus={!!kind}
            label={kind ? `the ${LABEL_OF_PROCESS[mainProcess(order) ?? "sticker_print"]} machine type the agent matched` : "reading your request"}
          />
        </div>
      </div>
      <TitleBlock id="cs-understand" kicker="understand" title={`“${requestShort(order).slice(0, 60)}”`} sub={`${current} · nothing is ordered until you confirm`} />
      <Actions>
        <button className="cs-btn cs-btn-quiet" onClick={onNew}>
          start over
        </button>
      </Actions>
    </section>
  );
}

/* ---------- 2: the map ---------- */

const TONE: Record<Fit, MapPin["tone"]> = { free: "far", busy: "busy", offline: "offline", far: "far", type: "type" };
const FIT_ORDER: Record<Fit, number> = { free: 0, busy: 1, far: 2, offline: 3, type: 4 };

/** One line about the person's spot: asking, found, set, or why not, with what to do next. */
function SpotLine({ where, picking, onPick, onCancel }: { where: Where; picking: boolean; onPick: () => void; onCancel: () => void }) {
  const spot = spotOf(where);
  if (picking)
    return (
      <p className="cs-spot is-picking" role="status">
        <span>Tap the map where you are.</span>
        <button className="cs-link" onClick={onCancel}>
          cancel
        </button>
      </p>
    );
  if (where.state === "idle" || where.state === "asking")
    return (
      <p className="cs-spot" role="status">
        <span>Finding where you are… fabyn uses it to measure distances and plan delivery; it stays in this tab.</span>
      </p>
    );
  if (spot) {
    const p = placeText(spot);
    return (
      <p className="cs-spot is-found" role="status">
        <span>
          {where.state === "found" ? "you're" : "you set your spot"} {inSanFrancisco(spot) ? "in " : ""}
          <b>{p.area}</b> · {formatKm(p.km)} from the {PALACE.short}
          {where.state === "found" && where.accuracyM > 0 ? ` · ±${where.accuracyM >= 1000 ? formatKm(where.accuracyM / 1000) : `${where.accuracyM} m`}` : ""}
        </span>
        <button className="cs-link" onClick={onPick}>
          {where.state === "found" ? "not right? set it on the map" : "move it"}
        </button>
      </p>
    );
  }
  return (
    <p className="cs-spot is-missing" role="status">
      <span>
        {whyNoSpot(where)} Tap the map where you are, or pick it up at the {PALACE.short}.
      </span>
      {(where.state === "denied" || (where.state === "unavailable" && (where.why === "timeout" || where.why === "error"))) && (
        <button className="cs-link" onClick={askLocation}>
          try again
        </button>
      )}
    </p>
  );
}

export function MapStep({ order, machines, go, error }: ScreenProps) {
  const process = mainProcess(order);
  const match = matchedMachine(order, machines);
  const where = useWhere();
  const spot = spotOf(where);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // the browser is asked here, when distances start to matter, never on page load
  useEffect(() => {
    if (where.state === "idle") askLocation();
    // once, when the map first shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tapToSet = picking || (!spot && (where.state === "denied" || where.state === "unavailable"));
  // distances are from the person; until they have a spot, from the Palace, and the list says so
  const from = spot ?? PALACE;
  const world = WORLD_MACHINES.map((m) => ({ m, ...fitFor(m, process, from) })).sort(
    (a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || a.km - b.km,
  );
  const sameType = world.filter((w) => w.fit !== "type");
  const otherType = world.filter((w) => w.fit === "type");
  const matchKm = spot && match ? distanceKm(spot, match.at) : null;
  const free = match?.status === "available";
  const delivery = deliveryFor(spot, match?.at ?? PALACE);
  const youLabel = spot ? (inBounds(spot, BOUNDS.city) ? `you · ${areaLabel(spot)}` : `you · ${formatKm(distanceKm(spot, PALACE))} away`) : "";
  const pins: MapPin[] = [
    ...world.map((w) => ({
      id: w.m.id,
      at: w.m.at,
      label: w.m.owner,
      sub: `${w.m.model} · ${w.note} · ${formatKm(w.km)}`,
      tone: TONE[w.fit],
    })),
    ...(spot ? [{ id: "home", at: spot, label: youLabel, tone: "home" as const, showLabel: true, labelAt: "right" as const }] : []),
    ...(match
      ? [
          {
            id: match.id,
            at: match.at,
            label: `${match.owner} · ${PALACE.short}`,
            sub: `${MACHINE_NAME[match.id] ?? match.model} · ${STATUS_TEXT[match.status]}${matchKm !== null ? ` · ${formatKm(matchKm)}` : ""}`,
            tone: free ? ("match" as const) : ("place" as const),
            interactive: true,
            showLabel: true,
            labelAt: "left" as const,
          },
        ]
      : []),
  ];
  return (
    <section className="cs-map-screen" aria-labelledby="cs-map-title">
      <TitleBlock
        id="cs-map-title"
        kicker="nearby · san francisco"
        title={match ? `${WORLD_MACHINES.length + 1} makers nearby. One fits.` : "Looking for machines nearby"}
        sub={
          match
            ? `${process ? `A ${LABEL_OF_PROCESS[process]} needs a ${PROCESS_LABEL[process]}. ` : ""}Select ${match.owner}'s machine at the ${PALACE.short} to see it.`
            : "Getting the machines that are on right now…"
        }
      />
      <MatchLine order={order} />
      <SpotLine where={where} picking={picking} onPick={() => setPicking(true)} onCancel={() => setPicking(false)} />
      <div className="cs-map-grid">
        <div className="cs-map-box">
          <SFMap
            pins={pins}
            bounds={BOUNDS.city}
            selectedId={selected}
            onSelect={(id) => setSelected(id)}
            onPick={
              tapToSet
                ? (at) => {
                    setLocation(at);
                    setPicking(false);
                  }
                : undefined
            }
            label={`Map of San Francisco with ${WORLD_MACHINES.length + 1} makers. Only ${match?.owner ?? "the Palace"}'s machine can take this order.${tapToSet ? " Tap the map to set where you are." : ""}`}
          />
          <ul className="cs-legend" aria-label="Map key">
            <li className="is-match">fits and free</li>
            <li className="is-busy">busy</li>
            <li className="is-far">too far</li>
            <li className="is-type">wrong type</li>
            <li className="is-offline">offline</li>
          </ul>
        </div>
        <div className="cs-map-side">
          {match ? (
            <button
              className={`cs-maker is-match ${selected === match.id ? "is-on" : ""}`}
              aria-pressed={selected === match.id}
              onClick={() => setSelected(match.id)}
            >
              <span className="cs-maker-name">
                {match.owner} · {PALACE.short}
              </span>
              <span className="cs-maker-sub">
                {MACHINE_NAME[match.id] ?? match.model} · {STATUS_TEXT[match.status]}
                {match.queue && match.queue.length ? ` · ${match.queue.length} waiting` : ""}
              </span>
              <span className="cs-maker-km">{matchKm !== null ? formatKm(matchKm) : "—"}</span>
            </button>
          ) : (
            <p className="cs-note">{machines ? "No machine of ours makes this right now." : "Loading the machines…"}</p>
          )}
          <p className="cs-fine cs-deliver-line">
            {delivery.ok ? `Delivery by e-bike reaches you; pickup at the ${PALACE.short} works too.` : delivery.why}
          </p>
          <p className="cs-kicker cs-side-kicker">can&apos;t take it now{spot ? "" : ` · distances from the ${PALACE.short}`}</p>
          <ul className="cs-makers" aria-label="Makers of the same type that cannot take it">
            {sameType.map((w) => (
              <li key={w.m.id} className={`cs-maker is-${TONE[w.fit]}`}>
                <span className="cs-maker-name">{w.m.owner}</span>
                <span className="cs-maker-sub">
                  {w.m.model} · {w.m.hood} · {w.fit === "far" ? "free, but too far" : w.fit === "free" ? "free · view only, not taking fabyn orders" : w.note}
                </span>
                <span className="cs-maker-km">{formatKm(w.km)}</span>
              </li>
            ))}
          </ul>
          {otherType.length > 0 && (
            <details className="cs-other">
              <summary>
                {otherType.length} more make{otherType.length === 1 ? "s" : ""} something else
              </summary>
              <ul className="cs-makers">
                {otherType.map((w) => (
                  <li key={w.m.id} className="cs-maker is-type">
                    <span className="cs-maker-name">{w.m.owner}</span>
                    <span className="cs-maker-sub">
                      {PROCESS_LABEL[w.m.process]} · {w.m.hood}
                    </span>
                    <span className="cs-maker-km">{formatKm(w.km)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="cs-fine">Other makers on the map are shown for context; orders go to the Palace of Fine Arts machines, at any distance.</p>
        </div>
      </div>
      <ErrorLine text={error} />
      <Actions>
        <button className="cs-btn cs-btn-main" disabled={!match || selected !== match.id} onClick={() => go("machine")}>
          {match && selected === match.id ? `see ${match.owner}'s machine` : "select the orange machine"}
        </button>
      </Actions>
    </section>
  );
}

/* ---------- 3: the machine ---------- */

const minutesAgo = (iso: string | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 1 ? "started just now" : `started ${m} min ago`;
};

export function MachineFacts({ m, now }: { m: LiveMachine; now: number }) {
  const spot = spotOf(useWhere());
  return (
    <dl className="cs-facts cs-facts-tight">
      <div>
        <dt>owner</dt>
        <dd>{m.owner}</dd>
      </div>
      <div>
        <dt>model</dt>
        <dd>{MACHINE_NAME[m.id] ?? m.model}</dd>
      </div>
      <div>
        <dt>type</dt>
        <dd>{m.process ? MATCH_OF_PROCESS[m.process] : "—"}</dd>
      </div>
      <div>
        <dt>where</dt>
        <dd>
          {PALACE.short}
          {spot ? ` · ${formatKm(distanceKm(spot, m.at))} from you` : ""}
        </dd>
      </div>
      <div>
        <dt>now</dt>
        <dd>
          {m.current ? (
            <>
              printing {m.current.title}
              {m.current.startedAt && <small> · {minutesAgo(m.current.startedAt, now)}</small>}
            </>
          ) : m.status === "available" ? (
            "free, nothing printing"
          ) : (
            STATUS_TEXT[m.status]
          )}
        </dd>
      </div>
    </dl>
  );
}

export function MachineStep({ order, machines, go, now }: ScreenProps) {
  const m = matchedMachine(order, machines);
  if (!m)
    return (
      <section className="cs-notice">
        <TitleBlock title="Getting the machine" sub="One moment while we reach the Palace of Fine Arts machines." />
      </section>
    );
  const kind = m.process ? KIND_OF_PROCESS[m.process] : kindForWait(order);
  const printing = !!m.current;
  return (
    <section className="cs-proposal" aria-labelledby="cs-machine-title">
      <div className="cs-stage-box cs-stage-box-tall">
        <Stage3D
          machine={kind}
          item={null}
          progress={null}
          loop={printing}
          label={`${MACHINE_NAME[m.id] ?? m.model} at the ${PALACE.short}, ${STATUS_TEXT[m.status]}`}
        />
      </div>
      <div className="cs-proposal-body">
        <TitleBlock id="cs-machine-title" kicker={`machine · ${m.owner}'s`} title={MACHINE_NAME[m.id] ?? m.model} />
        <MachineFacts m={m} now={now} />
        <div className="cs-queue-mini">
          <p className="cs-kicker">queue</p>
          {m.queue === null ? (
            <p className="cs-note">{m.owner} has not shared this machine&apos;s queue.</p>
          ) : m.queue.length === 0 ? (
            <p className="cs-note">Nothing waiting. Your print would be next.</p>
          ) : (
            <ol className="cs-queue">
              {m.queue.map((q, i) => (
                <li key={i}>
                  <span className="cs-queue-n">{i + 1}</span>
                  <span>{q.title}</span>
                  {q.source === "asi1" && <small>via ASI:One</small>}
                </li>
              ))}
            </ol>
          )}
        </div>
        <Actions>
          <button className="cs-btn cs-btn-main" onClick={() => go("preview")}>
            see your preview
          </button>
          <button className="cs-btn cs-btn-quiet" onClick={() => go("map")}>
            back to the map
          </button>
        </Actions>
      </div>
    </section>
  );
}
