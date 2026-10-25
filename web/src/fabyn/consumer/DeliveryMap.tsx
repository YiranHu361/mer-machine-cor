import { useEffect, useRef, useState } from "react";
import { mmss } from "./estimate";
import { PLACE_SHORT } from "./model";

/* Delivery tracking is display-only: a stylised map drawn here (no tiles, no
   network), a courier and an ETA countdown. The courier, the address and the
   timing are demo values; nothing is dispatched. */

const START = { x: 214, y: 186 };
const END = { x: 440, y: 300 };
const PATH = `M ${START.x} ${START.y} Q 330 96 ${END.x} ${END.y}`;
const STEPS = [
  { at: 0, label: "packed at " + PLACE_SHORT.toLowerCase() },
  { at: 0.18, label: "courier picked it up" },
  { at: 0.5, label: "on the way" },
  { at: 0.9, label: "arriving" },
  { at: 1, label: "delivered" },
];
const DEMO_SECONDS_PER_REAL = 3;
const TOTAL_ROUTE_SECONDS = 14 * 60;

export function DeliveryMap({ orderId }: { orderId: string }) {
  const [elapsed, setElapsed] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);
  const [dot, setDot] = useState({ x: START.x, y: START.y });
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(t);
  }, [orderId]);
  const frac = Math.min(1, (elapsed * DEMO_SECONDS_PER_REAL) / TOTAL_ROUTE_SECONDS);
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const p = el.getPointAtLength(el.getTotalLength() * frac);
    setDot({ x: p.x, y: p.y });
  }, [frac]);
  const step = [...STEPS].reverse().find((s) => frac >= s.at) ?? STEPS[0];
  const left = Math.max(0, TOTAL_ROUTE_SECONDS - elapsed * DEMO_SECONDS_PER_REAL);

  return (
    <section className="cs-delivery" aria-labelledby="cs-delivery-title">
      <h2 id="cs-delivery-title" className="cs-h2">
        delivery to henry
      </h2>
      <div className="cs-map-wrap">
        <svg viewBox="0 0 640 420" className="cs-map" role="img" aria-label="Map of the route from the Palace of Fine Arts to Henry">
          <rect width="640" height="420" fill="#08080a" />
          {/* bay and ocean, stylised */}
          <path d="M0 0 H640 V70 Q520 40 470 110 Q420 170 360 160 Q300 150 250 210 Q200 260 120 250 Q40 240 0 300Z" fill="#0d1116" />
          {/* land */}
          <path
            d="M250 210 Q300 150 360 160 Q420 170 470 110 Q520 40 640 70 V420 H180 Q210 330 250 210Z"
            fill="#131315"
            stroke="#2a2a2d"
          />
          {[
            "M300 260 L420 240 L520 300",
            "M240 330 L360 300 L470 360",
            "M330 190 L330 420",
            "M420 120 L430 240 L470 360",
          ].map((d) => (
            <path key={d} d={d} fill="none" stroke="#24242a" strokeWidth="1" />
          ))}
          <path d={PATH} fill="none" stroke="#2a2a2d" strokeWidth="2" strokeDasharray="2 6" />
          <path ref={pathRef} d={PATH} fill="none" stroke="#FF5B1F" strokeWidth="2" opacity="0.9" />
          <circle cx={START.x} cy={START.y} r="5" fill="#F0F0EC" />
          <text x={START.x - 10} y={START.y - 14} fill="#8E8E8A" fontSize="13" fontFamily="Martian Mono, monospace" textAnchor="end">
            palace of fine arts
          </text>
          <circle cx={END.x} cy={END.y} r="7" fill="none" stroke="#FF5B1F" strokeWidth="2" />
          <circle cx={END.x} cy={END.y} r="3" fill="#FF5B1F" />
          <text x={END.x + 12} y={END.y + 5} fill="#F0F0EC" fontSize="13" fontFamily="Martian Mono, monospace">
            henry · delivery
          </text>
          <circle cx={dot.x} cy={dot.y} r="9" fill="#FF5B1F" opacity="0.2" className="cs-pulse" />
          <circle cx={dot.x} cy={dot.y} r="5" fill="#FF5B1F" />
        </svg>
      </div>
      <dl className="cs-facts cs-facts-tight">
        <div>
          <dt>eta</dt>
          <dd>{frac >= 1 ? "arrived" : mmss(left)}</dd>
        </div>
        <div>
          <dt>courier</dt>
          <dd>Maya R. (demo courier)</dd>
        </div>
        <div>
          <dt>status</dt>
          <dd>{step.label}</dd>
        </div>
      </dl>
      <ol className="cs-steps" aria-label="Delivery steps">
        {STEPS.map((s) => (
          <li key={s.label} className={frac >= s.at ? "is-done" : undefined} aria-current={step.label === s.label ? "step" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
