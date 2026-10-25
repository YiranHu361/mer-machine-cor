// Supplies (耗材) per machine, in each machine's own units, with a refill that
// saves the new amount to the machine's settings.
import { useState } from "react";
import { api } from "../../api";
import type { Act } from "./JobActions";
import type { Dashboard, OwnerMachine } from "./data";
import { supplyOf } from "./status";

const LOW = 0.2;

export function Supplies({ dash, busy, act }: { dash: Dashboard; busy: string; act: Act }) {
  const low = dash.machines.filter((m) => m.mediaRemaining / Math.max(supplyOf(m).capacity, m.mediaRemaining) < LOW);
  return (
    <section aria-labelledby="sl-supplies-title">
      <header className="sl-section-head">
        <p className="sl-kicker">supplies · {low.length ? `${low.length} running low` : "all stocked"}</p>
        <h2 id="sl-supplies-title" className="sl-h2">
          What each machine has left.
        </h2>
        <p className="sl-lede">Each finished piece uses up what it is made of. A machine with nothing left stops taking orders until you refill it.</p>
      </header>
      <ul className="sl-supplies">
        {dash.machines.map((m) => (
          <SupplyCard key={m.id} machine={m} busy={busy} act={act} queued={dash.jobs.filter((j) => j.machineId === m.id && !["produced", "cancelled", "failed"].includes(j.productionState)).length} />
        ))}
      </ul>
    </section>
  );
}

function SupplyCard({ machine: m, busy, act, queued }: { machine: OwnerMachine; busy: string; act: Act; queued: number }) {
  const supply = supplyOf(m);
  const capacity = Math.max(supply.capacity, m.mediaRemaining);
  const fraction = Math.min(1, m.mediaRemaining / capacity);
  const isLow = fraction < LOW;
  const empty = m.mediaRemaining === 0;
  const [amount, setAmount] = useState(String(supply.capacity));
  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 0 && value <= 10000;
  const save = (to: number, done: string) =>
    act(`${m.id}-supply`, () => api(`/owner/machines/${m.id}`, { mediaRemaining: to }, "PATCH", { headers: { "If-Match": `"${m.settingsFingerprint}"` } }), done);
  return (
    <li className={`sl-supply${isLow ? " low" : ""}`}>
      <header className="sl-machine-head">
        <h3 className="sl-h3">{m.name}</h3>
        <span className={`sl-state ${empty ? "is-attention" : isLow ? "is-attention" : "is-available"}`}>
          <i aria-hidden="true" />
          {empty ? "Empty" : isLow ? "Running low" : "Stocked"}
        </span>
      </header>
      <p className="sl-fine">
        {m.model} · {supply.noun}
      </p>
      <p className="sl-supply-num">
        {m.mediaRemaining}
        <span> {supply.unit}</span>
      </p>
      <div className="sl-track" role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={m.mediaRemaining} aria-label={`${supply.noun} left on ${m.name}`}>
        <span style={{ width: `${fraction * 100}%` }} className={isLow ? "low" : ""} />
      </div>
      <p className="sl-fine">
        {queued > 0 ? `${queued} order${queued === 1 ? "" : "s"} queued on it.` : "Nothing queued on it."} {isLow && !empty ? `Refill soon: ${supply.refill.toLowerCase()}.` : ""}
        {empty ? `It takes no new orders until you ${supply.refill.toLowerCase()}.` : ""}
      </p>
      <form
        className="sl-supply-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save(value, `${m.name} now has ${value} ${supply.unit}.`);
        }}
      >
        <button
          className={`sl-btn ${isLow ? "solid" : ""}`}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void save(supply.capacity, `${supply.refill} done. ${m.name} is full.`)}
        >
          {busy === `${m.id}-supply` ? "Saving…" : `${supply.refill} · ${supply.capacity}`}
        </button>
        <label className="sl-field sl-supply-set">
          <span className="sl-label">Or set the amount</span>
          <span className="sl-inline">
            <input className="sl-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!valid} />
            <button className="sl-btn ghost" type="submit" disabled={!valid || Boolean(busy)}>
              Save
            </button>
          </span>
        </label>
      </form>
    </li>
  );
}
