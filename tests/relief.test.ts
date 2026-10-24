import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROCESS_IDS,
  PROCESS_SHEETS,
  REAL_CAPABLE_PROCESSES,
  RELIEF_CATALOG,
  addMachine,
  advance,
  applyOutage,
  cancelJobs,
  counters,
  createEngine,
  generateNetwork,
  mulberry32,
  pointInPolygon,
  priceCents,
  reliefQuantities,
  restoreAll,
  scheduleJobs,
  setTimeScale,
  simulatedSeconds,
  splitQuantity,
  unstartedJobs,
  type EngineEvent,
  type EngineState,
  type NetworkMachine,
  type ProcessId,
  type ScheduleItem,
  type SplitCandidate,
  type TimeScale,
} from "../server/relief/index.ts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function candidate(
  id: string,
  overrides: Partial<SplitCandidate> = {},
): SplitCandidate {
  return {
    id,
    process: "sticker_print",
    availableAtSeconds: 0,
    setupSeconds: 0,
    secondsPerUnit: 1,
    capacityUnits: 1000,
    maxAssignments: null,
    real: false,
    ...overrides,
  };
}

function job(
  id: string,
  machineId: string,
  plannedStartSeconds: number,
  durationSeconds: number,
  quantity = 10,
): ScheduleItem {
  return {
    id,
    orderId: "order_relief",
    assignmentId: `asg_${id}`,
    machineId,
    quantity,
    process: "laser_cut",
    plannedStartSeconds,
    durationSeconds,
  };
}

type MachineStatus = Pick<NetworkMachine, "id" | "status">;
const online = (...ids: string[]): MachineStatus[] =>
  ids.map((id) => ({ id, status: "online" }));
const brief = (events: EngineEvent[]) =>
  events.map((e) => `${e.type}:${e.jobId}@${e.atMs}`);

test("catalog has ten items across ten processes, seven simulation-only", () => {
  assert.equal(PROCESS_IDS.length, 10);
  assert.equal(RELIEF_CATALOG.length, 10);
  assert.deepEqual(
    new Set(RELIEF_CATALOG.map((item) => item.process)),
    new Set(PROCESS_IDS),
  );
  assert.equal(new Set(RELIEF_CATALOG.map((item) => item.id)).size, 10);
  assert.deepEqual(REAL_CAPABLE_PROCESSES, [
    "sticker_print",
    "photo_print",
    "fdm_print",
  ]);
  const simulationOnly = PROCESS_IDS.filter(
    (p) => !REAL_CAPABLE_PROCESSES.includes(p),
  );
  assert.equal(simulationOnly.length, 7);
  const expected: Record<string, ProcessId> = {
    "cot-labels": "sticker_print",
    "found-pet-cards": "photo_print",
    "tarp-clips": "fdm_print",
    "privacy-partitions": "cnc_route",
    "wayfinding-signs": "laser_cut",
    "floor-decals": "vinyl_cut",
    "posters-maps": "large_format_print",
    "intake-forms": "document_print",
    "blanket-hems": "sewing",
    "volunteer-vests": "heat_press",
  };
  assert.deepEqual(
    Object.fromEntries(RELIEF_CATALOG.map((i) => [i.id, i.process])),
    expected,
  );
  for (const item of RELIEF_CATALOG) {
    assert.ok(Number.isInteger(item.chunkSize) && item.chunkSize >= 1);
    assert.ok(item.perHundredPeople > 0);
    assert.equal(item.unit, PROCESS_SHEETS[item.process].unit);
  }
  for (const process of PROCESS_IDS) {
    const sheet = PROCESS_SHEETS[process];
    assert.equal(sheet.process, process);
    assert.equal(sheet.basis, "assumption");
    assert.deepEqual(sheet.sources, []);
    assert.equal(
      sheet.note,
      "Assumption pending a sourced, checked spec sheet.",
    );
    assert.ok(sheet.setupSeconds >= 0 && sheet.secondsPerUnit > 0);
    assert.ok(sheet.materialPerUnit > 0 && sheet.materialUnit.length > 0);
  }
});

test("reliefQuantities gives deterministic integers with a floor of one", () => {
  const forShelter = reliefQuantities(300);
  assert.deepEqual(forShelter, {
    "cot-labels": 600,
    "found-pet-cards": 30,
    "tarp-clips": 120,
    "privacy-partitions": 30,
    "wayfinding-signs": 24,
    "floor-decals": 60,
    "posters-maps": 30,
    "intake-forms": 1200,
    "blanket-hems": 150,
    "volunteer-vests": 30,
  });
  assert.deepEqual(reliefQuantities(300), forShelter);
  for (const headCount of [1, 7, 99, 110, 333, 10000]) {
    const quantities = reliefQuantities(headCount);
    for (const item of RELIEF_CATALOG) {
      const value = quantities[item.id]!;
      assert.ok(Number.isInteger(value) && value >= 1);
      assert.equal(
        value,
        Math.max(1, Math.ceil((headCount * item.perHundredPeople) / 100)),
      );
    }
  }
  // 110 / 100 × 10 is 11.000000000000002 in floating point; integer math gives 11.
  assert.equal(reliefQuantities(110)["found-pet-cards"], 11);
  assert.equal(reliefQuantities(1)["privacy-partitions"], 1);
  for (const bad of [0, -5, 10001, 2.5, Number.NaN]) {
    assert.throws(() => reliefQuantities(bad), RangeError);
  }
});

test("generateNetwork is deterministic, labeled simulated and covers every process", () => {
  const a = generateNetwork(2026);
  assert.equal(JSON.stringify(a), JSON.stringify(generateNetwork(2026)));
  assert.notEqual(JSON.stringify(a), JSON.stringify(generateNetwork(2027)));
  assert.deepEqual(clone(a), a);
  assert.equal(a.length, 150);
  const ids = a.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids);
  const perProcess = new Map<ProcessId, number>();
  for (const machine of a) {
    perProcess.set(machine.process, (perProcess.get(machine.process) ?? 0) + 1);
    assert.match(machine.id, new RegExp(`^m_sim_${machine.process}_\\d{3}$`));
    assert.equal(machine.simulated, true);
    assert.equal(machine.executionMode, "simulation");
    assert.equal(machine.owner, "Simulated network");
    assert.equal(machine.addedBy, "seed");
    assert.equal(machine.status, "online");
    assert.match(machine.displayName, /^Simulated /);
    assert.match(machine.location.label, /^Simulated · /);
    const { lat, lng } = machine.location;
    assert.ok(lat >= 37.7 && lat <= 37.9, `${machine.id} lat ${lat}`);
    assert.ok(lng >= -122.52 && lng <= -122.15, `${machine.id} lng ${lng}`);
    const sheet = PROCESS_SHEETS[machine.process];
    const { setupSeconds, secondsPerUnit } = machine.timeModel;
    assert.ok(
      setupSeconds >= Math.floor(sheet.setupSeconds * 0.8) &&
        setupSeconds <= Math.ceil(sheet.setupSeconds * 1.2),
    );
    assert.ok(
      secondsPerUnit >= sheet.secondsPerUnit * 0.8 - 0.05 &&
        secondsPerUnit <= sheet.secondsPerUnit * 1.2 + 0.05,
    );
    for (const cents of Object.values(machine.priceCard)) {
      assert.ok(Number.isInteger(cents) && cents >= 1);
    }
    assert.ok(
      Number.isInteger(machine.capacityUnits) && machine.capacityUnits >= 1,
    );
  }
  assert.equal(perProcess.size, 10);
  for (const process of PROCESS_IDS) {
    assert.ok(perProcess.get(process)! >= 8, process);
  }

  const minimal = generateNetwork(1, 80);
  assert.equal(minimal.length, 80);
  for (const process of PROCESS_IDS) {
    assert.equal(minimal.filter((m) => m.process === process).length, 8);
  }
  assert.equal(generateNetwork(1, 97).length, 97);
  assert.throws(() => generateNetwork(1, 79), RangeError);
  assert.throws(() => generateNetwork(1, 100.5), RangeError);
  assert.throws(() => generateNetwork(1.5), TypeError);
});

test("pointInPolygon uses ray casting on [lat, lng] points", () => {
  const square: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
  assert.equal(pointInPolygon(5, -1, square), false);
  // An L shape: the notch at the top right is outside.
  const ell: [number, number][] = [
    [0, 0],
    [0, 10],
    [5, 10],
    [5, 5],
    [10, 5],
    [10, 0],
  ];
  assert.equal(pointInPolygon(2, 8, ell), true);
  assert.equal(pointInPolygon(8, 2, ell), true);
  assert.equal(pointInPolygon(8, 8, ell), false);
  assert.throws(
    () =>
      pointInPolygon(1, 1, [
        [0, 0],
        [1, 1],
      ]),
    RangeError,
  );
});

test("applyOutage only takes online machines inside the polygon offline", () => {
  const machines = generateNetwork(11);
  const oakland: [number, number][] = [
    [37.78, -122.28],
    [37.835, -122.28],
    [37.835, -122.2],
    [37.78, -122.2],
  ];
  const inside = machines.filter((m) =>
    pointInPolygon(m.location.lat, m.location.lng, oakland),
  );
  assert.ok(inside.length >= 2, "fixture needs machines in Oakland");
  inside[0]!.status = "offline";
  const affected = applyOutage(machines, oakland);
  assert.deepEqual(
    affected,
    inside.slice(1).map((m) => m.id),
  );
  for (const machine of machines) {
    const isInside = inside.includes(machine);
    assert.equal(machine.status, isInside ? "offline" : "online");
  }
  assert.deepEqual(applyOutage(machines, oakland), []);
  restoreAll(machines);
  assert.ok(machines.every((m) => m.status === "online"));
});

test("addMachine appends the next free id with deterministic sheet values", () => {
  const machines = generateNetwork(3);
  const lasers = machines.filter((m) => m.process === "laser_cut").length;
  const added = addMachine(machines, "laser_cut", 37.8, -122.25);
  assert.equal(
    added.id,
    `m_sim_laser_cut_${String(lasers + 1).padStart(3, "0")}`,
  );
  assert.equal(machines.length, 151);
  assert.equal(machines.at(-1), added);
  assert.equal(added.addedBy, "demo");
  assert.equal(added.status, "online");
  assert.equal(added.simulated, true);
  assert.equal(added.executionMode, "simulation");
  assert.equal(added.location.label, "Simulated · Oakland");
  assert.deepEqual(added.timeModel, {
    setupSeconds: PROCESS_SHEETS.laser_cut.setupSeconds,
    secondsPerUnit: PROCESS_SHEETS.laser_cut.secondsPerUnit,
  });
  assert.deepEqual(
    addMachine(generateNetwork(3), "laser_cut", 37.8, -122.25),
    added,
  );
  // A gap left by a removed machine is never reused: ids stay unique.
  const removed = machines.findIndex((m) => m.id === "m_sim_laser_cut_002");
  machines.splice(removed, 1);
  assert.equal(
    addMachine(machines, "laser_cut", 0, 0).id,
    `m_sim_laser_cut_${String(lasers + 2).padStart(3, "0")}`,
  );
  assert.equal(
    addMachine(machines, "sewing", 37.87, -122.27).location.label,
    "Simulated · Berkeley",
  );
  assert.equal(
    addMachine([], "heat_press", 37.7, -122.3).id,
    "m_sim_heat_press_001",
  );
  assert.throws(
    () => addMachine(machines, "welding" as ProcessId, 37.8, -122.25),
    TypeError,
  );
  assert.throws(
    () => addMachine(machines, "sewing", Number.NaN, -122.25),
    RangeError,
  );
  assert.throws(() => addMachine(machines, "sewing", 91, 0), RangeError);
  assert.throws(
    () => addMachine(machines, "sewing", 37.8, "x" as unknown as number),
    RangeError,
  );
});

test("splitQuantity conserves quantity and honors limits across seeded cases", () => {
  const rng = mulberry32(424242);
  const int = (min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));
  const processes: ProcessId[] = ["sticker_print", "laser_cut"];
  for (let round = 0; round < 400; round++) {
    const quantity = int(0, 1500);
    const chunkSize = int(1, 80);
    const candidates: SplitCandidate[] = [];
    const count = int(0, 10);
    for (let i = 0; i < count; i++) {
      const roll = rng();
      candidates.push({
        id: `c${int(0, 99_999)}_${i}`,
        process: rng() < 0.85 ? processes[0]! : processes[1]!,
        availableAtSeconds: int(0, 900),
        setupSeconds: int(0, 300),
        secondsPerUnit: int(1, 120) / 4,
        capacityUnits: int(0, 400),
        maxAssignments:
          roll < 0.6 ? null : roll < 0.75 ? 0 : roll < 0.9 ? 1 : int(2, 4),
        real: rng() < 0.2,
      });
    }
    const process = processes[0]!;
    const result = splitQuantity(quantity, chunkSize, candidates, process);
    assert.deepEqual(
      splitQuantity(quantity, chunkSize, clone(candidates), process),
      result,
      "deterministic",
    );
    const total = result.allocations.reduce((s, a) => s + a.quantity, 0);
    assert.equal(total + result.unallocated, quantity, "conservation");
    assert.ok(result.unallocated >= 0);

    const matching = candidates.filter((c) => c.process === process);
    for (const c of matching) {
      const mine = result.allocations
        .filter((a) => a.machineId === c.id)
        .sort((x, y) => x.startSeconds - y.startSeconds);
      const used = mine.reduce((s, a) => s + a.quantity, 0);
      const limit = c.real
        ? Math.min(c.maxAssignments ?? 1, 1)
        : c.maxAssignments;
      assert.ok(used <= c.capacityUnits, "capacity");
      if (limit === null) assert.ok(mine.length <= 1, "queued machines merge");
      else assert.ok(mine.length <= limit, "maxAssignments");
      let freeAt = c.availableAtSeconds;
      for (const a of mine) {
        assert.ok(Number.isInteger(a.quantity) && a.quantity >= 1);
        assert.equal(a.real, c.real);
        assert.ok(a.startSeconds >= freeAt - 1e-9, "no overlap");
        assert.ok(
          Math.abs(
            a.finishSeconds -
              (a.startSeconds + c.setupSeconds + a.quantity * c.secondsPerUnit),
          ) < 1e-6,
          "setup paid once per allocation",
        );
        if (limit !== null) assert.ok(a.quantity <= chunkSize, "one chunk");
        freeAt = a.finishSeconds;
      }
      if (result.unallocated > 0) {
        assert.ok(
          used === c.capacityUnits || (limit !== null && mine.length === limit),
          "leftover only when every candidate is saturated",
        );
      }
    }
    const ids = new Set(matching.map((c) => c.id));
    assert.ok(result.allocations.every((a) => ids.has(a.machineId)));
    if (matching.every((c) => c.maxAssignments === null && !c.real)) {
      const capacity = matching.reduce((s, c) => s + c.capacityUnits, 0);
      assert.equal(result.unallocated, Math.max(0, quantity - capacity));
    }
  }
});

test("splitQuantity picks the earliest finish, breaks ties by id and merges chunks", () => {
  const tie = splitQuantity(10, 10, [candidate("b"), candidate("a")]);
  assert.deepEqual(tie.allocations, [
    {
      machineId: "a",
      quantity: 10,
      startSeconds: 0,
      finishSeconds: 10,
      real: false,
    },
  ]);
  assert.deepEqual(
    splitQuantity(20, 10, [candidate("b"), candidate("a")]).allocations.map(
      (a) => [a.machineId, a.quantity],
    ),
    [
      ["a", 10],
      ["b", 10],
    ],
  );

  // fast finishes chunks at 10, 20, …; slow's first chunk finishes at 50.
  // At 50 the tie goes to "fast"; slow then takes one chunk.
  const race = splitQuantity(100, 10, [
    candidate("slow", { secondsPerUnit: 5 }),
    candidate("fast", { secondsPerUnit: 1 }),
  ]);
  assert.deepEqual(race, {
    allocations: [
      {
        machineId: "fast",
        quantity: 90,
        startSeconds: 0,
        finishSeconds: 90,
        real: false,
      },
      {
        machineId: "slow",
        quantity: 10,
        startSeconds: 0,
        finishSeconds: 50,
        real: false,
      },
    ],
    unallocated: 0,
  });

  const merged = splitQuantity(35, 10, [
    candidate("solo", {
      availableAtSeconds: 100,
      setupSeconds: 30,
      secondsPerUnit: 2,
    }),
  ]);
  assert.deepEqual(merged.allocations, [
    {
      machineId: "solo",
      quantity: 35,
      startSeconds: 100,
      finishSeconds: 200,
      real: false,
    },
  ]);
  assert.deepEqual(splitQuantity(0, 5, [candidate("a")]), {
    allocations: [],
    unallocated: 0,
  });
});

test("splitQuantity gives real and bounded machines one chunk per assignment", () => {
  const withReal = splitQuantity(50, 10, [
    candidate("q", { secondsPerUnit: 3 }),
    candidate("r", { secondsPerUnit: 1, maxAssignments: 1, real: true }),
  ]);
  assert.deepEqual(withReal.allocations, [
    {
      machineId: "q",
      quantity: 40,
      startSeconds: 0,
      finishSeconds: 120,
      real: false,
    },
    {
      machineId: "r",
      quantity: 10,
      startSeconds: 0,
      finishSeconds: 10,
      real: true,
    },
  ]);
  // A real machine has no queue even if the caller forgot to cap it.
  assert.deepEqual(
    splitQuantity(50, 10, [
      candidate("q", { secondsPerUnit: 3 }),
      candidate("r", { secondsPerUnit: 1, real: true }),
    ]),
    withReal,
  );
  const bounded = splitQuantity(50, 10, [
    candidate("b2", { setupSeconds: 5, maxAssignments: 2 }),
  ]);
  assert.deepEqual(bounded, {
    allocations: [
      {
        machineId: "b2",
        quantity: 10,
        startSeconds: 0,
        finishSeconds: 15,
        real: false,
      },
      {
        machineId: "b2",
        quantity: 10,
        startSeconds: 15,
        finishSeconds: 30,
        real: false,
      },
    ],
    unallocated: 30,
  });
  assert.deepEqual(
    splitQuantity(5, 10, [candidate("z", { maxAssignments: 0 })]),
    { allocations: [], unallocated: 5 },
  );
});

test("splitQuantity respects capacity and reports what cannot be placed", () => {
  const short = splitQuantity(40, 10, [candidate("a", { capacityUnits: 25 })]);
  assert.deepEqual(
    short.allocations.map((a) => a.quantity),
    [25],
  );
  assert.equal(short.unallocated, 15);
  // Two machines of 15: whole chunks first, then the leftover fills each one.
  const exact = splitQuantity(30, 10, [
    candidate("a", { capacityUnits: 15 }),
    candidate("b", { capacityUnits: 15 }),
  ]);
  assert.deepEqual(
    exact.allocations.map((a) => [a.machineId, a.quantity]),
    [
      ["a", 15],
      ["b", 15],
    ],
  );
  assert.equal(exact.unallocated, 0);
  assert.deepEqual(splitQuantity(12, 4, []), {
    allocations: [],
    unallocated: 12,
  });
});

test("splitQuantity ignores candidates of another process", () => {
  const mixed = [
    candidate("b", { process: "sticker_print", secondsPerUnit: 9 }),
    candidate("a", { process: "laser_cut", secondsPerUnit: 1 }),
  ];
  for (const result of [
    splitQuantity(30, 10, mixed, "sticker_print"),
    splitQuantity(30, 10, mixed),
  ]) {
    assert.deepEqual(
      result.allocations.map((a) => a.machineId),
      ["b"],
    );
    assert.equal(result.unallocated, 0);
  }
  assert.deepEqual(
    splitQuantity(30, 10, mixed, "laser_cut").allocations.map(
      (a) => a.machineId,
    ),
    ["a"],
  );
  assert.equal(splitQuantity(30, 10, mixed, "sewing").unallocated, 30);
});

test("splitQuantity validates its inputs", () => {
  assert.throws(() => splitQuantity(-1, 5, []), RangeError);
  assert.throws(() => splitQuantity(1.5, 5, []), RangeError);
  assert.throws(() => splitQuantity(5, 0, []), RangeError);
  assert.throws(() => splitQuantity(5, 2.5, []), RangeError);
  assert.throws(
    () => splitQuantity(5, 5, [candidate("a"), candidate("a")]),
    RangeError,
  );
  assert.throws(
    () => splitQuantity(5, 5, [candidate("a", { maxAssignments: -1 })]),
    RangeError,
  );
  assert.throws(
    () => splitQuantity(5, 5, [candidate("a", { capacityUnits: 2.5 })]),
    RangeError,
  );
  assert.throws(
    () => splitQuantity(5, 5, [candidate("a", { secondsPerUnit: Number.NaN })]),
    RangeError,
  );
});

test("priceCents uses integer cents and applies the minimum as a separate term", () => {
  const card = {
    materialCentsPerUnit: 40,
    unitCents: 5,
    timeCentsPerMinute: 10,
    minimumCents: 200,
  };
  const big = priceCents(card, 100, 0.04, 0.1);
  assert.deepEqual(big, {
    ownerCents: 760,
    terms: [
      { label: "Material", cents: 160 },
      { label: "Per-unit handling", cents: 500 },
      { label: "Machine time", cents: 100 },
    ],
  });
  const small = priceCents(card, 1, 0.04, 0.1);
  assert.equal(small.ownerCents, 200);
  assert.deepEqual(small.terms.at(-1), { label: "Minimum price", cents: 192 });
  for (const result of [big, small]) {
    assert.equal(
      result.terms.reduce((s, t) => s + t.cents, 0),
      result.ownerCents,
    );
    assert.ok(result.terms.every((t) => Number.isInteger(t.cents)));
  }
  // 3 × 0.1 × 5 is 1.5000000000000002 in floating point; half-cents round up.
  const half = priceCents(
    { ...card, materialCentsPerUnit: 5, minimumCents: 0 },
    3,
    0.1,
    0,
  );
  assert.deepEqual(half.terms[0], { label: "Material", cents: 2 });
  assert.equal(half.ownerCents, 17);
  const machine = generateNetwork(9)[0]!;
  const sheet = PROCESS_SHEETS[machine.process];
  const estimate = priceCents(
    machine.priceCard,
    7,
    sheet.materialPerUnit,
    machine.timeModel.secondsPerUnit / 60,
  );
  assert.ok(Number.isInteger(estimate.ownerCents));
  assert.ok(estimate.ownerCents >= machine.priceCard.minimumCents);
  assert.equal(priceCents(card, 0, 1, 1).ownerCents, 0);
  assert.throws(
    () => priceCents({ ...card, unitCents: 1.5 }, 1, 1, 1),
    RangeError,
  );
  assert.throws(() => priceCents(card, -1, 1, 1), RangeError);
  assert.throws(() => priceCents(card, 1, -1, 1), RangeError);
});

test("engine starts, progresses and finishes jobs at time scales 1, 10 and 60", () => {
  const epoch = 1_000_000;
  for (const scale of [1, 10, 60] as TimeScale[]) {
    const engine = createEngine(epoch, scale);
    assert.equal(engine.timeScale, scale);
    scheduleJobs(engine, [job("j", "m1", 0, 120)]);
    const machines = online("m1");
    const ms = (sim: number) => epoch + (sim * 1000) / scale;
    assert.deepEqual(advance(engine, machines, epoch), [
      {
        type: "sim_job.started",
        jobId: "j",
        machineId: "m1",
        atMs: epoch,
        progress: 0,
      },
    ]);
    assert.deepEqual(advance(engine, machines, ms(60)), [
      {
        type: "sim_job.progress",
        jobId: "j",
        machineId: "m1",
        atMs: ms(60),
        progress: 0.5,
      },
    ]);
    assert.deepEqual(advance(engine, machines, ms(66)), [], "same 10% step");
    assert.equal(engine.jobs.j!.status, "running");
    assert.deepEqual(advance(engine, machines, ms(120) + 5000), [
      {
        type: "sim_job.done",
        jobId: "j",
        machineId: "m1",
        atMs: ms(120),
        progress: 1,
      },
    ]);
    assert.equal(engine.jobs.j!.startedAtMs, epoch);
    assert.equal(engine.jobs.j!.doneAtMs, ms(120));
    assert.equal(engine.jobs.j!.progress, 1);
    assert.deepEqual(advance(engine, machines, ms(500)), []);
  }
  assert.throws(() => createEngine(0, 5 as TimeScale), RangeError);
  assert.throws(() => createEngine(Number.NaN), TypeError);
  assert.equal(createEngine(0).timeScale, 10);
});

test("progress events fire at most once per 10% step", () => {
  const engine = createEngine(0, 60);
  scheduleJobs(engine, [job("j", "m1", 0, 600)]);
  const events: EngineEvent[] = [];
  for (let now = 0; now <= 11_000; now += 50) {
    events.push(...advance(engine, online("m1"), now));
  }
  const steps = events
    .filter((e) => e.type === "sim_job.progress")
    .map((e) => Math.floor(e.progress * 10));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    events.filter((e) => e.type !== "sim_job.progress").map((e) => e.type),
    ["sim_job.started", "sim_job.done"],
  );
});

test("setTimeScale keeps simulated time continuous", () => {
  const engine = createEngine(0, 10);
  scheduleJobs(engine, [job("j", "m1", 0, 200)]);
  advance(engine, online("m1"), 0);
  advance(engine, online("m1"), 5000);
  assert.equal(simulatedSeconds(engine, 5000), 50);
  assert.equal(engine.jobs.j!.progress, 0.25);
  setTimeScale(engine, 60, 5000);
  assert.ok(Math.abs(simulatedSeconds(engine, 5000) - 50) < 1e-9);
  assert.ok(Math.abs(simulatedSeconds(engine, 6000) - 110) < 1e-9);
  advance(engine, online("m1"), 6000);
  assert.ok(Math.abs(engine.jobs.j!.progress - 0.55) < 1e-9);
  const done = advance(engine, online("m1"), 9000);
  assert.deepEqual(brief(done), ["sim_job.done:j@7500"]);
  setTimeScale(engine, 1, 9000);
  assert.ok(Math.abs(simulatedSeconds(engine, 10_000) - 291) < 1e-9);
  assert.throws(() => setTimeScale(engine, 30 as TimeScale, 0), RangeError);
});

test("jobs on one machine run sequentially regardless of advance granularity", () => {
  const items = [
    job("j2", "m1", 0, 40),
    job("j1", "m1", 0, 30),
    job("j3", "m1", 100, 10),
    job("k1", "m2", 5, 20),
  ];
  const once = createEngine(0, 10);
  scheduleJobs(once, items);
  const machines = online("m1", "m2");
  const timeline = [
    "sim_job.started:j1@0",
    "sim_job.started:k1@500",
    "sim_job.done:k1@2500",
    "sim_job.done:j1@3000",
    "sim_job.started:j2@3000",
    "sim_job.done:j2@7000",
    "sim_job.started:j3@10000",
    "sim_job.done:j3@11000",
  ];
  assert.deepEqual(brief(advance(once, machines, 20_000)), timeline);
  const onMachine = Object.values(once.jobs)
    .filter((j) => j.machineId === "m1")
    .sort((a, b) => a.startedAtMs! - b.startedAtMs!);
  for (let i = 1; i < onMachine.length; i++) {
    assert.ok(onMachine[i]!.startedAtMs! >= onMachine[i - 1]!.doneAtMs!);
  }

  const stepped = createEngine(0, 10);
  scheduleJobs(stepped, clone(items));
  const events: EngineEvent[] = [];
  for (let now = 0; now <= 20_000; now += 700) {
    events.push(...advance(stepped, machines, now));
  }
  events.push(...advance(stepped, machines, 20_000));
  assert.deepEqual(stepped, once);
  assert.deepEqual(
    brief(events.filter((e) => e.type !== "sim_job.progress")),
    timeline,
  );
});

test("offline machines pause running jobs, block queued ones and resume later", () => {
  const engine = createEngine(0, 10);
  scheduleJobs(engine, [
    job("a", "m1", 0, 100),
    job("b", "m1", 0, 50),
    job("c", "m2", 0, 10),
    job("d", "m3", 50, 10),
  ]);
  const machines: MachineStatus[] = online("m1", "m2", "m3");
  const set = (id: string, status: NetworkMachine["status"]) => {
    machines.find((m) => m.id === id)!.status = status;
  };
  advance(engine, machines, 0);
  advance(engine, machines, 4000);
  assert.equal(engine.jobs.a!.progress, 0.4);
  assert.equal(engine.jobs.c!.status, "done");

  set("m1", "offline");
  set("m3", "offline");
  assert.deepEqual(advance(engine, machines, 6000), [
    {
      type: "sim_job.paused",
      jobId: "a",
      machineId: "m1",
      atMs: 6000,
      progress: 0.4,
    },
  ]);
  assert.equal(engine.jobs.a!.status, "paused");
  assert.ok(engine.jobs.a!.note);
  assert.deepEqual(advance(engine, machines, 10_000), []);
  assert.equal(engine.jobs.b!.status, "queued");
  assert.equal(engine.jobs.d!.status, "queued", "blocked past its start");
  assert.deepEqual(engine.offlineMachineIds, ["m1", "m3"]);
  assert.deepEqual(counters(engine), {
    queued: 2,
    running: 0,
    paused: 1,
    done: 1,
    cancelled: 0,
    unitsDone: 10,
    unitsTotal: 40,
  });
  // The paused job may have started physically in the story: never offered for
  // reassignment, and never cancellable.
  assert.deepEqual(
    unstartedJobs(engine, ["m1", "m3"]).map((j) => j.id),
    ["b", "d"],
  );
  assert.deepEqual(cancelJobs(engine, ["a"]), []);

  restoreAll(machines as NetworkMachine[]);
  assert.deepEqual(brief(advance(engine, machines, 12_000)), [
    "sim_job.started:a@12000",
    "sim_job.started:d@12000",
  ]);
  assert.equal(engine.jobs.a!.status, "running");
  assert.equal(engine.jobs.a!.progress, 0.4);
  assert.equal(engine.jobs.a!.note, undefined);
  assert.equal(engine.jobs.a!.startedAtMs, 0, "first start is kept");
  assert.equal(engine.jobs.a!.machineId, "m1");
  assert.equal(engine.jobs.d!.startedAtMs, 12_000, "not backdated into outage");
  assert.deepEqual(brief(advance(engine, machines, 18_000)), [
    "sim_job.done:d@13000",
    "sim_job.done:a@18000",
    "sim_job.started:b@18000",
  ]);
  assert.deepEqual(brief(advance(engine, machines, 30_000)), [
    "sim_job.done:b@23000",
  ]);
  assert.deepEqual(counters(engine), {
    queued: 0,
    running: 0,
    paused: 0,
    done: 4,
    cancelled: 0,
    unitsDone: 40,
    unitsTotal: 40,
  });
  assert.deepEqual(engine.offlineMachineIds, []);
});

test("a machine missing from the list is treated as offline", () => {
  const engine = createEngine(0, 60);
  scheduleJobs(engine, [job("x", "ghost", 0, 60)]);
  assert.deepEqual(advance(engine, [], 5000), []);
  assert.equal(engine.jobs.x!.status, "queued");
  assert.deepEqual(engine.offlineMachineIds, ["ghost"]);
});

test("unstartedJobs, cancelJobs and counters only touch never-started work", () => {
  const engine = createEngine(0, 10);
  scheduleJobs(engine, [
    job("run", "m1", 0, 100, 5),
    job("wait", "m1", 0, 100, 7),
    job("fin", "m2", 0, 10, 3),
    job("other", "m3", 999, 10, 2),
  ]);
  const machines = online("m1", "m2", "m3");
  advance(engine, machines, 5000);
  assert.equal(engine.jobs.run!.status, "running");
  assert.equal(engine.jobs.fin!.status, "done");

  const unstarted = unstartedJobs(engine, ["m1", "m2"]);
  assert.deepEqual(
    unstarted.map((j) => j.id),
    ["wait"],
  );
  unstarted[0]!.status = "done";
  assert.equal(engine.jobs.wait!.status, "queued", "returns copies");
  assert.deepEqual(unstartedJobs(engine, []), []);

  assert.deepEqual(
    cancelJobs(engine, ["run", "fin", "wait", "missing", "wait", "toString"]),
    ["wait"],
  );
  assert.equal(engine.jobs.wait!.status, "cancelled");
  assert.equal(engine.jobs.run!.status, "running");
  assert.equal(engine.jobs.fin!.status, "done");
  assert.deepEqual(counters(engine), {
    queued: 1,
    running: 1,
    paused: 0,
    done: 1,
    cancelled: 1,
    unitsDone: 3,
    unitsTotal: 10,
  });
  advance(engine, machines, 60_000);
  assert.equal(engine.jobs.wait!.status, "cancelled", "cancelled never runs");
  assert.equal(engine.jobs.wait!.startedAtMs, null);
  assert.equal(engine.jobs.run!.status, "done");
});

test("scheduleJobs rejects duplicates and invalid jobs without partial writes", () => {
  const engine = createEngine(0);
  scheduleJobs(engine, [job("a", "m1", 0, 10)]);
  assert.throws(
    () => scheduleJobs(engine, [job("a", "m1", 0, 10)]),
    RangeError,
  );
  assert.throws(
    () => scheduleJobs(engine, [job("b", "m1", 0, 10), job("b", "m2", 0, 10)]),
    RangeError,
  );
  assert.throws(
    () => scheduleJobs(engine, [job("c", "m1", 0, 10), job("d", "m1", -1, 10)]),
    RangeError,
  );
  assert.throws(
    () =>
      scheduleJobs(engine, [
        { ...job("e", "m1", 0, 10), process: "welding" as ProcessId },
      ]),
    TypeError,
  );
  assert.throws(
    () => scheduleJobs(engine, [{ ...job("f", "m1", 0, 10), quantity: 0 }]),
    RangeError,
  );
  assert.deepEqual(Object.keys(engine.jobs), ["a"]);
  assert.deepEqual(engine.jobs.a, {
    id: "a",
    orderId: "order_relief",
    assignmentId: "asg_a",
    machineId: "m1",
    quantity: 10,
    process: "laser_cut",
    status: "queued",
    plannedStartSeconds: 0,
    durationSeconds: 10,
    startedAtMs: null,
    progress: 0,
    doneAtMs: null,
    startedAtSimSeconds: null,
    runAnchorSimSeconds: null,
    doneAtSimSeconds: null,
  });
});

test("engine state survives a JSON round trip with identical behavior", () => {
  const items = [
    job("a", "m1", 0, 300),
    job("b", "m1", 10, 120),
    job("c", "m2", 30, 500),
    job("d", "m3", 0, 90),
  ];
  const original = createEngine(5_000, 10);
  scheduleJobs(original, items);
  const machines = online("m1", "m2", "m3");
  advance(original, machines, 5_000);
  advance(original, machines, 9_000);
  machines[1]!.status = "offline";
  advance(original, machines, 12_000);

  const copy = clone(original) as EngineState;
  const copyMachines = clone(machines);
  assert.deepEqual(copy, original);

  const script = (engine: EngineState, list: typeof machines) => {
    const log: EngineEvent[] = [];
    log.push(...advance(engine, list, 15_000));
    setTimeScale(engine, 60, 15_000);
    log.push(...advance(engine, list, 16_000));
    list[1]!.status = "online";
    log.push(...advance(engine, list, 17_000));
    setTimeScale(engine, 1, 17_500);
    log.push(...advance(engine, list, 30_000));
    setTimeScale(engine, 60, 30_000);
    log.push(...advance(engine, list, 60_000));
    return log;
  };
  const expected = script(original, machines);
  const actual = script(copy, copyMachines);
  assert.deepEqual(actual, expected);
  assert.deepEqual(copy, original);
  assert.deepEqual(clone(copy), copy);
  assert.equal(counters(copy).done, 4);
});

test("a 300-person relief plan splits onto the simulated network and completes", () => {
  const network = generateNetwork(2026);
  const quantities = reliefQuantities(300);
  const engine = createEngine(0, 60);
  const items: ScheduleItem[] = [];
  let estimateCents = 0;
  for (const entry of RELIEF_CATALOG) {
    const sheet = PROCESS_SHEETS[entry.process];
    const candidates: SplitCandidate[] = network
      .filter((m) => m.process === entry.process && m.status === "online")
      .map((m) => ({
        id: m.id,
        process: m.process,
        availableAtSeconds: 0,
        setupSeconds: m.timeModel.setupSeconds,
        secondsPerUnit: m.timeModel.secondsPerUnit,
        capacityUnits: m.capacityUnits,
        maxAssignments: null,
        real: false,
      }));
    const split = splitQuantity(
      quantities[entry.id]!,
      entry.chunkSize,
      candidates,
      entry.process,
    );
    assert.equal(split.unallocated, 0, entry.id);
    for (const allocation of split.allocations) {
      const machine = network.find((m) => m.id === allocation.machineId)!;
      estimateCents += priceCents(
        machine.priceCard,
        allocation.quantity,
        sheet.materialPerUnit,
        machine.timeModel.secondsPerUnit / 60,
      ).ownerCents;
      items.push({
        id: `job_${entry.id}_${allocation.machineId}`,
        orderId: "order_relief_300",
        assignmentId: `asg_${entry.id}_${allocation.machineId}`,
        machineId: allocation.machineId,
        quantity: allocation.quantity,
        process: entry.process,
        plannedStartSeconds: allocation.startSeconds,
        durationSeconds: allocation.finishSeconds - allocation.startSeconds,
      });
    }
  }
  assert.ok(Number.isInteger(estimateCents) && estimateCents > 0);
  scheduleJobs(engine, items);
  const total = Object.values(quantities).reduce((s, q) => s + q, 0);
  assert.equal(counters(engine).unitsTotal, total);
  advance(engine, network, 0);
  const longest = Math.max(
    ...items.map((i) => i.plannedStartSeconds + i.durationSeconds),
  );
  advance(engine, network, Math.ceil((longest * 1000) / 60) + 1);
  const finished = counters(engine);
  assert.equal(finished.done, items.length);
  assert.equal(finished.unitsDone, total);
});
