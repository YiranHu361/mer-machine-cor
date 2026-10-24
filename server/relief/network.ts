/**
 * Deterministic simulated machine network for Relief. Every machine here is
 * simulated, estimate-only and never charged; nothing in this file is physical.
 * Randomness comes only from a seeded mulberry32 generator.
 */
import {
  PROCESS_IDS,
  PROCESS_SHEETS,
  isProcessId,
  type ProcessId,
} from "./catalog.ts";

export interface NetworkMachine {
  id: string;
  process: ProcessId;
  displayName: string;
  owner: "Simulated network";
  simulated: true;
  executionMode: "simulation";
  location: { lat: number; lng: number; label: string };
  timeModel: { setupSeconds: number; secondsPerUnit: number };
  priceCard: {
    materialCentsPerUnit: number;
    unitCents: number;
    timeCentsPerMinute: number;
    minimumCents: number;
  };
  capacityUnits: number;
  status: "online" | "offline";
  addedBy: "seed" | "demo";
}

/** Standard mulberry32: a small, fast, seeded PRNG returning values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MACHINE_NOUN: Record<ProcessId, string> = {
  sticker_print: "label printer",
  photo_print: "photo printer",
  fdm_print: "FDM 3D printer",
  laser_cut: "laser cutter",
  cnc_route: "CNC router",
  vinyl_cut: "vinyl cutter",
  large_format_print: "large-format printer",
  document_print: "document printer",
  sewing: "sewing machine",
  heat_press: "heat press",
};

/** Base price cards in integer cents (assumptions, like the process sheets). */
const BASE_PRICE: Record<ProcessId, NetworkMachine["priceCard"]> = {
  sticker_print: {
    materialCentsPerUnit: 40,
    unitCents: 5,
    timeCentsPerMinute: 10,
    minimumCents: 200,
  },
  photo_print: {
    materialCentsPerUnit: 70,
    unitCents: 10,
    timeCentsPerMinute: 10,
    minimumCents: 300,
  },
  fdm_print: {
    materialCentsPerUnit: 3,
    unitCents: 20,
    timeCentsPerMinute: 5,
    minimumCents: 300,
  },
  laser_cut: {
    materialCentsPerUnit: 4000,
    unitCents: 50,
    timeCentsPerMinute: 60,
    minimumCents: 1000,
  },
  cnc_route: {
    materialCentsPerUnit: 6000,
    unitCents: 200,
    timeCentsPerMinute: 80,
    minimumCents: 2500,
  },
  vinyl_cut: {
    materialCentsPerUnit: 1500,
    unitCents: 20,
    timeCentsPerMinute: 20,
    minimumCents: 500,
  },
  large_format_print: {
    materialCentsPerUnit: 800,
    unitCents: 50,
    timeCentsPerMinute: 30,
    minimumCents: 800,
  },
  document_print: {
    materialCentsPerUnit: 2,
    unitCents: 1,
    timeCentsPerMinute: 5,
    minimumCents: 100,
  },
  sewing: {
    materialCentsPerUnit: 800,
    unitCents: 50,
    timeCentsPerMinute: 30,
    minimumCents: 800,
  },
  heat_press: {
    materialCentsPerUnit: 2000,
    unitCents: 300,
    timeCentsPerMinute: 20,
    minimumCents: 800,
  },
};

/** Base media remaining per machine, in output units. */
const BASE_CAPACITY: Record<ProcessId, number> = {
  sticker_print: 400,
  photo_print: 40,
  fdm_print: 60,
  laser_cut: 30,
  cnc_route: 8,
  vinyl_cut: 80,
  large_format_print: 40,
  document_print: 1500,
  sewing: 60,
  heat_press: 40,
};

/** Integer weights for spreading machines beyond the eight-per-process floor. */
const PROCESS_WEIGHT: Record<ProcessId, number> = {
  sticker_print: 8,
  photo_print: 6,
  fdm_print: 8,
  laser_cut: 4,
  cnc_route: 3,
  vinyl_cut: 4,
  large_format_print: 8,
  document_print: 12,
  sewing: 6,
  heat_press: 4,
};

interface Region {
  label: string;
  weight: number;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Land-ish boxes in San Francisco and the East Bay. */
const REGIONS: readonly Region[] = [
  {
    label: "Oakland",
    weight: 6,
    latMin: 37.785,
    latMax: 37.83,
    lngMin: -122.275,
    lngMax: -122.205,
  },
  {
    label: "East Oakland",
    weight: 3,
    latMin: 37.755,
    latMax: 37.785,
    lngMin: -122.205,
    lngMax: -122.165,
  },
  {
    label: "San Francisco",
    weight: 5,
    latMin: 37.725,
    latMax: 37.785,
    lngMin: -122.495,
    lngMax: -122.405,
  },
  {
    label: "Berkeley",
    weight: 4,
    latMin: 37.855,
    latMax: 37.885,
    lngMin: -122.295,
    lngMax: -122.25,
  },
  {
    label: "Emeryville",
    weight: 1,
    latMin: 37.832,
    latMax: 37.848,
    lngMin: -122.295,
    lngMax: -122.282,
  },
  {
    label: "Alameda",
    weight: 2,
    latMin: 37.765,
    latMax: 37.778,
    lngMin: -122.265,
    lngMax: -122.235,
  },
  {
    label: "Piedmont",
    weight: 1,
    latMin: 37.818,
    latMax: 37.83,
    lngMin: -122.24,
    lngMax: -122.22,
  },
  {
    label: "San Leandro",
    weight: 2,
    latMin: 37.705,
    latMax: 37.73,
    lngMin: -122.17,
    lngMax: -122.15,
  },
  {
    label: "Albany",
    weight: 1,
    latMin: 37.883,
    latMax: 37.893,
    lngMin: -122.3,
    lngMax: -122.285,
  },
];
const REGION_WEIGHT_TOTAL = REGIONS.reduce((sum, r) => sum + r.weight, 0);

const MIN_PER_PROCESS = 8;
const MAX_NETWORK = 10000;

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const label = (place: string) => `Simulated · ${place}`;
const machineId = (process: ProcessId, index: number) =>
  `m_sim_${process}_${String(index).padStart(3, "0")}`;
const displayName = (process: ProcessId, index: number, place: string) =>
  `Simulated ${MACHINE_NOUN[process]} ${String(index).padStart(3, "0")} · ${place}`;

function idIndex(id: string, process: ProcessId): number | null {
  const prefix = `m_sim_${process}_`;
  if (!id.startsWith(prefix)) return null;
  const digits = id.slice(prefix.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

function compareMachines(a: NetworkMachine, b: NetworkMachine) {
  if (a.process !== b.process) return a.process < b.process ? -1 : 1;
  const ai = idIndex(a.id, a.process) ?? 0;
  const bi = idIndex(b.id, b.process) ?? 0;
  if (ai !== bi) return ai - bi;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickRegion(rng: () => number): Region {
  let ticket = rng() * REGION_WEIGHT_TOTAL;
  for (const region of REGIONS) {
    if (ticket < region.weight) return region;
    ticket -= region.weight;
  }
  return REGIONS[REGIONS.length - 1]!;
}

function regionAt(lat: number, lng: number): Region | undefined {
  return REGIONS.find(
    (r) =>
      lat >= r.latMin && lat <= r.latMax && lng >= r.lngMin && lng <= r.lngMax,
  );
}

/** Eight per process, then the remainder by integer weight (largest remainder). */
function machineCounts(count: number): Record<ProcessId, number> {
  const extra = count - MIN_PER_PROCESS * PROCESS_IDS.length;
  const totalWeight = PROCESS_IDS.reduce((s, p) => s + PROCESS_WEIGHT[p], 0);
  const counts = {} as Record<ProcessId, number>;
  const remainders: { process: ProcessId; order: number; rest: number }[] = [];
  let assigned = 0;
  PROCESS_IDS.forEach((process, order) => {
    const share = extra * PROCESS_WEIGHT[process];
    const whole = Math.floor(share / totalWeight);
    counts[process] = MIN_PER_PROCESS + whole;
    assigned += whole;
    remainders.push({ process, order, rest: share % totalWeight });
  });
  remainders.sort((a, b) => b.rest - a.rest || a.order - b.order);
  for (let i = 0; i < extra - assigned; i++) {
    counts[remainders[i]!.process] += 1;
  }
  return counts;
}

/**
 * Deterministic simulated network: every process present with at least eight
 * machines, exactly `count` machines in total, sorted by process then index.
 */
export function generateNetwork(seed: number, count = 150): NetworkMachine[] {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError("seed must be a safe integer.");
  }
  if (
    !Number.isInteger(count) ||
    count < MIN_PER_PROCESS * PROCESS_IDS.length ||
    count > MAX_NETWORK
  ) {
    throw new RangeError(
      `count must be an integer from ${MIN_PER_PROCESS * PROCESS_IDS.length} to ${MAX_NETWORK}.`,
    );
  }
  const rng = mulberry32(seed);
  const jitter = () => 0.8 + 0.4 * rng();
  const counts = machineCounts(count);
  const machines: NetworkMachine[] = [];
  for (const process of PROCESS_IDS) {
    const sheet = PROCESS_SHEETS[process];
    const price = BASE_PRICE[process];
    for (let index = 1; index <= counts[process]; index++) {
      const region = pickRegion(rng);
      const lat = round(
        region.latMin + rng() * (region.latMax - region.latMin),
        5,
      );
      const lng = round(
        region.lngMin + rng() * (region.lngMax - region.lngMin),
        5,
      );
      machines.push({
        id: machineId(process, index),
        process,
        displayName: displayName(process, index, region.label),
        owner: "Simulated network",
        simulated: true,
        executionMode: "simulation",
        location: { lat, lng, label: label(region.label) },
        timeModel: {
          setupSeconds: Math.max(0, Math.round(sheet.setupSeconds * jitter())),
          secondsPerUnit: Math.max(
            0.1,
            round(sheet.secondsPerUnit * jitter(), 1),
          ),
        },
        priceCard: {
          materialCentsPerUnit: Math.max(
            1,
            Math.round(price.materialCentsPerUnit * jitter()),
          ),
          unitCents: Math.max(1, Math.round(price.unitCents * jitter())),
          timeCentsPerMinute: Math.max(
            1,
            Math.round(price.timeCentsPerMinute * jitter()),
          ),
          minimumCents: Math.max(1, Math.round(price.minimumCents * jitter())),
        },
        capacityUnits: Math.max(
          1,
          Math.round(BASE_CAPACITY[process] * (0.5 + rng())),
        ),
        status: "online",
        addedBy: "seed",
      });
    }
  }
  return machines.sort(compareMachines);
}

/**
 * Appends a demo machine with sheet/base values (no randomness) and returns it.
 * Its index is one past the highest existing index for that process.
 */
export function addMachine(
  machines: NetworkMachine[],
  process: ProcessId,
  lat: number,
  lng: number,
): NetworkMachine {
  if (!isProcessId(process)) {
    throw new TypeError(`Unknown process: ${String(process)}`);
  }
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new RangeError("lat must be a finite number from -90 to 90.");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new RangeError("lng must be a finite number from -180 to 180.");
  }
  let highest = 0;
  for (const machine of machines) {
    const index = idIndex(machine.id, process);
    if (index !== null && index > highest) highest = index;
  }
  const index = highest + 1;
  const place = regionAt(lat, lng)?.label ?? "Demo location";
  const sheet = PROCESS_SHEETS[process];
  const machine: NetworkMachine = {
    id: machineId(process, index),
    process,
    displayName: displayName(process, index, place),
    owner: "Simulated network",
    simulated: true,
    executionMode: "simulation",
    location: { lat, lng, label: label(place) },
    timeModel: {
      setupSeconds: sheet.setupSeconds,
      secondsPerUnit: sheet.secondsPerUnit,
    },
    priceCard: { ...BASE_PRICE[process] },
    capacityUnits: BASE_CAPACITY[process],
    status: "online",
    addedBy: "demo",
  };
  machines.push(machine);
  return machine;
}

function validatePolygon(polygon: [number, number][]) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new RangeError("polygon needs at least three [lat, lng] points.");
  }
  for (const point of polygon) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      throw new TypeError("polygon points must be finite [lat, lng] pairs.");
    }
  }
}

/** Ray casting with lng as x and lat as y; polygon points are [lat, lng]. */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][],
): boolean {
  validatePolygon(polygon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new TypeError("lat and lng must be finite numbers.");
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i]!;
    const [latJ, lngJ] = polygon[j]!;
    if (
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Sets online simulated machines inside the polygon offline; returns their ids. */
export function applyOutage(
  machines: NetworkMachine[],
  polygon: [number, number][],
): string[] {
  validatePolygon(polygon);
  const affected: string[] = [];
  for (const machine of machines) {
    if (
      machine.simulated === true &&
      machine.status === "online" &&
      pointInPolygon(machine.location.lat, machine.location.lng, polygon)
    ) {
      machine.status = "offline";
      affected.push(machine.id);
    }
  }
  return affected;
}

export function restoreAll(machines: NetworkMachine[]): void {
  for (const machine of machines) machine.status = "online";
}
