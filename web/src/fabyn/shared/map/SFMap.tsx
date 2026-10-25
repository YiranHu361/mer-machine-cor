import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import "./map.css";
import {
  HOODS,
  OTHER_LAND,
  PARKS,
  SF_SHORE,
  STREETS,
  pointAlong,
  type LatLng,
} from "./world";

/* A dark, flat San Francisco drawn as SVG from real coordinates. No tiles, no
   network. Pins, an optional route and a moving marker go on top. */

export type PinTone =
  | "match" // the machine that fits and is free: orange, pulsing
  | "place" // a place of ours (the Palace machines) that is not the current match
  | "home" // the person
  | "busy"
  | "offline"
  | "far"
  | "type" // makes something else
  | "courier";

export interface MapPin {
  id: string;
  at: LatLng;
  label: string;
  /** second line under the label */
  sub?: string;
  tone: PinTone;
  /** clickable: calls onSelect(id) */
  interactive?: boolean;
  /** draw the label even when not selected */
  showLabel?: boolean;
  /** where the label sits; by default right, or left near the east edge. A label that
     would run off the map moves below the pin and stays inside. */
  labelAt?: "left" | "right" | "above" | "below";
}

export interface Bounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

export const BOUNDS: Record<"city" | "north" | "palace", Bounds> = {
  /** the whole city */
  city: { north: 37.8125, south: 37.706, west: -122.516, east: -122.378 },
  /** Marina, Cow Hollow, Presidio edge: deliveries from the Palace */
  north: { north: 37.8085, south: 37.7905, west: -122.4605, east: -122.4255 },
  /** close around the Palace */
  palace: { north: 37.8075, south: 37.796, west: -122.4575, east: -122.438 },
};

export interface SFMapProps {
  pins: MapPin[];
  /** a path drawn dashed, with the travelled part in orange */
  route?: LatLng[];
  /** 0..1 along the route; draws the moving marker */
  progress?: number;
  /** label next to the moving marker */
  markerLabel?: string;
  bounds?: Bounds;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** accessible name of the whole map */
  label: string;
  className?: string;
  /** neighbourhood names; on by default for the city view */
  hoods?: boolean;
}

const W = 1000;

function projector(b: Bounds) {
  const lat0 = ((b.north + b.south) / 2) * (Math.PI / 180);
  const k = W / ((b.east - b.west) * Math.cos(lat0));
  const H = (b.north - b.south) * k;
  const xy = (p: LatLng): [number, number] => [(p.lng - b.west) * Math.cos(lat0) * k, (b.north - p.lat) * k];
  return { xy, H, k };
}

const d = (pts: [number, number][], close = false) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + (close ? " Z" : "");

export function SFMap({
  pins,
  route,
  progress,
  markerLabel,
  bounds = BOUNDS.city,
  selectedId,
  onSelect,
  label,
  className,
  hoods,
}: SFMapProps) {
  const { xy, H } = useMemo(() => projector(bounds), [bounds]);
  // text and markers keep the same size on screen whatever the map's width
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = W / Math.max(240, width);
  const base = useMemo(
    () => ({
      shore: d(SF_SHORE.map(xy), true),
      other: OTHER_LAND.map((s) => d(s.map(xy), true)),
      parks: PARKS.map((p) => ({ name: p.name, d: d(p.shape.map(xy), true) })),
      streets: STREETS.map((s) => ({ name: s.name, d: d(s.path.map(xy)) })),
      hoods: HOODS.map((h) => ({ name: h.name, at: xy(h.at) })),
    }),
    [xy],
  );
  const routePts = route?.map(xy);
  const marker = route && typeof progress === "number" ? xy(pointAlong(route, progress)) : null;
  const travelled =
    route && typeof progress === "number" && progress > 0
      ? (() => {
          // the part of the route already covered
          const steps = 48;
          const pts: [number, number][] = [];
          for (let i = 0; i <= steps; i++) pts.push(xy(pointAlong(route, (progress * i) / steps)));
          return d(pts);
        })()
      : null;
  const showHoods = hoods ?? bounds === BOUNDS.city;
  const key = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  };
  const ordered = [...pins].sort((a, b) => rank(a, selectedId) - rank(b, selectedId));
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H.toFixed(0)}`}
      className={`fm-map ${className ?? ""}`}
      role="group"
      aria-label={label}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width={W} height={H} className="fm-water" />
      {base.other.map((p, i) => (
        <path key={i} d={p} className="fm-land" />
      ))}
      <path d={base.shore} className="fm-land" />
      {base.parks.map((p) => (
        <path key={p.name} d={p.d} className="fm-park" />
      ))}
      {base.streets.map((s) => (
        <path key={s.name} d={s.d} className="fm-street" />
      ))}
      {showHoods &&
        base.hoods.map((h) => (
          <text key={h.name} x={h.at[0]} y={h.at[1]} className="fm-hood" fontSize={10 * scale}>
            {h.name}
          </text>
        ))}
      {routePts && (
        <>
          <path d={d(routePts)} className="fm-route" strokeWidth={3 * scale} strokeDasharray={`${3 * scale} ${7 * scale}`} />
          {travelled && <path d={travelled} className="fm-route-done" strokeWidth={3.5 * scale} />}
        </>
      )}
      {ordered.map((p) => {
        const [x, y] = xy(p.at);
        const selected = p.id === selectedId;
        const r = (p.tone === "match" || p.tone === "home" ? 7 : p.tone === "place" ? 6.5 : 4.5) * scale;
        const labelled = selected || p.showLabel;
        const lab = labelled ? placeLabel(p, x, y, r, scale, H) : null;
        return (
          <g
            key={p.id}
            className={`fm-pin is-${p.tone} ${selected ? "is-selected" : ""} ${p.interactive ? "is-interactive" : ""}`}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            role={p.interactive ? "button" : "img"}
            tabIndex={p.interactive ? 0 : undefined}
            aria-label={`${p.label}${p.sub ? `, ${p.sub}` : ""}`}
            aria-pressed={p.interactive ? selected : undefined}
            onClick={p.interactive ? () => onSelect?.(p.id) : undefined}
            onKeyDown={p.interactive ? key(p.id) : undefined}
          >
            <title>{`${p.label}${p.sub ? ` · ${p.sub}` : ""}`}</title>
            {p.interactive && <circle r={22 * scale} className="fm-hit" />}
            {(p.tone === "match" || selected) && <circle r={r + 8 * scale} className="fm-pulse" />}
            {p.tone === "home" ? (
              <>
                <circle r={r} className="fm-dot" />
                <circle r={2.6 * scale} className="fm-core" />
              </>
            ) : p.tone === "offline" ? (
              <g className="fm-dot">
                <circle r={r} />
                <path d={`M${-r * 0.55} ${-r * 0.55} L${r * 0.55} ${r * 0.55} M${r * 0.55} ${-r * 0.55} L${-r * 0.55} ${r * 0.55}`} />
              </g>
            ) : (
              <circle r={r} className="fm-dot" />
            )}
            {lab && (
              <g transform={`translate(${lab.dx.toFixed(1)} ${lab.dy.toFixed(1)})`} className="fm-label">
                <text fontSize={12.5 * scale} className="fm-label-main" strokeWidth={3.5 * scale}>
                  {p.label}
                </text>
                {p.sub && (
                  <text y={14 * scale} fontSize={10.5 * scale} className="fm-label-sub" strokeWidth={3.5 * scale}>
                    {p.sub}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      {marker && (
        <g className="fm-pin is-courier" transform={`translate(${marker[0].toFixed(1)} ${marker[1].toFixed(1)})`} role="img" aria-label={markerLabel ?? "courier"}>
          <circle r={15 * scale} className="fm-pulse" />
          <circle r={7 * scale} className="fm-dot" />
          {markerLabel && (
            <text
              x={marker[0] > W - 130 * scale ? -12 * scale : 12 * scale}
              y={20 * scale}
              textAnchor={marker[0] > W - 130 * scale ? "end" : "start"}
              fontSize={12.5 * scale}
              className="fm-label-main"
              strokeWidth={3.5 * scale}
            >
              {markerLabel}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

/** Where a pin's label goes, as an offset from the pin; kept inside the map. Widths are
   estimated from the monospace font (about 0.62 em per character). */
function placeLabel(p: MapPin, x: number, y: number, r: number, s: number, H: number) {
  const w = Math.max(p.label.length * 12.5, (p.sub?.length ?? 0) * 10.5) * 0.62 * s;
  const h = (p.sub ? 28 : 14) * s;
  const pad = 6 * s;
  const fits = (start: number) => start >= pad && start + w <= W - pad;
  const side = p.labelAt ?? (x > W * 0.72 ? "left" : "right");
  const clampX = (start: number) => Math.max(pad, Math.min(W - pad - w, start));
  // the baseline of the first line, relative to the pin
  const beside = p.sub ? -3 * s : 4 * s;
  if (side === "left" && fits(x - 12 * s - w)) return { dx: -12 * s - w, dy: beside };
  if (side === "right" && fits(x + 12 * s)) return { dx: 12 * s, dy: beside };
  const above = side === "above" || (side !== "below" && y - r - h - 6 * s > 0);
  const dy = above ? -r - 8 * s - (p.sub ? 14 * s : 0) : r + 16 * s;
  if (!above && y + dy + h > H) return { dx: clampX(x - w / 2) - x, dy: -r - 8 * s - (p.sub ? 14 * s : 0) };
  return { dx: clampX(x - w / 2) - x, dy };
}

function rank(p: MapPin, selectedId?: string | null) {
  if (p.id === selectedId) return 9;
  return { match: 8, home: 7, courier: 7, place: 6, busy: 3, far: 2, type: 1, offline: 1 }[p.tone] ?? 0;
}
