/**
 * Deterministic quantity splitting across machines of one process, and integer
 * price arithmetic. Pure functions; no clocks, no randomness.
 */
import { isProcessId, type ProcessId } from "./catalog.ts";
import type { NetworkMachine } from "./network.ts";

export interface SplitCandidate {
  id: string;
  process: ProcessId;
  availableAtSeconds: number;
  setupSeconds: number;
  secondsPerUnit: number;
  capacityUnits: number;
  maxAssignments: number | null;
  real: boolean;
}

export interface SplitAllocation {
  machineId: string;
  quantity: number;
  startSeconds: number;
  finishSeconds: number;
  real: boolean;
}

interface CandidateState {
  candidate: SplitCandidate;
  /** null means a queued machine: unlimited chunks merged into one allocation. */
  limit: number | null;
  used: number;
  count: number;
  freeAt: number;
  open: SplitAllocation | null;
}

interface HeapEntry {
  state: CandidateState;
  finish: number;
}

const before = (a: HeapEntry, b: HeapEntry) =>
  a.finish < b.finish ||
  (a.finish === b.finish && a.state.candidate.id < b.state.candidate.id);

/** Binary min-heap ordered by (finish of the next chunk, machine id). */
class ChunkHeap {
  private items: HeapEntry[] = [];
  get size() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
  push(entry: HeapEntry) {
    const items = this.items;
    items.push(entry);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }
  pop(): HeapEntry | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && before(items[left]!, items[smallest]!))
          smallest = left;
        if (right < items.length && before(items[right]!, items[smallest]!))
          smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

const finiteAtLeast = (value: unknown, min: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min;

function validateCandidate(c: SplitCandidate) {
  if (typeof c?.id !== "string" || c.id.length === 0) {
    throw new TypeError("Split candidate id must be a non-empty string.");
  }
  if (!isProcessId(c.process)) {
    throw new TypeError(`Split candidate ${c.id} has an unknown process.`);
  }
  if (
    !finiteAtLeast(c.availableAtSeconds, 0) ||
    !finiteAtLeast(c.setupSeconds, 0) ||
    !finiteAtLeast(c.secondsPerUnit, 0)
  ) {
    throw new RangeError(
      `Split candidate ${c.id} needs finite, non-negative times.`,
    );
  }
  if (!Number.isInteger(c.capacityUnits) || c.capacityUnits < 0) {
    throw new RangeError(
      `Split candidate ${c.id} capacityUnits must be a non-negative integer.`,
    );
  }
  if (
    c.maxAssignments !== null &&
    (!Number.isInteger(c.maxAssignments) || c.maxAssignments < 0)
  ) {
    throw new RangeError(
      `Split candidate ${c.id} maxAssignments must be null or a non-negative integer.`,
    );
  }
  if (typeof c.real !== "boolean") {
    throw new TypeError(`Split candidate ${c.id} real must be a boolean.`);
  }
}

function nextFinish(state: CandidateState, size: number): number {
  const { setupSeconds, secondsPerUnit } = state.candidate;
  if (state.open) {
    return (
      state.open.startSeconds +
      setupSeconds +
      (state.open.quantity + size) * secondsPerUnit
    );
  }
  return state.freeAt + setupSeconds + size * secondsPerUnit;
}

const assignable = (state: CandidateState) =>
  state.limit === null || state.count < state.limit;
const canTake = (state: CandidateState, size: number) =>
  assignable(state) && state.candidate.capacityUnits - state.used >= size;

/**
 * Splits `quantity` into chunks of `chunkSize` (the last one may be smaller) and
 * gives each chunk to the candidate that would finish it earliest, ties broken
 * by machine id. Queued machines (maxAssignments null) merge their chunks into
 * one allocation and pay setup once; bounded machines receive one chunk per
 * allocation, up to maxAssignments. Real machines have no queue and are capped
 * at one allocation. When no candidate can take a whole chunk, the chunk shrinks
 * to the largest remaining capacity so usable capacity is never stranded.
 * Candidates of another process (default: the first candidate's) are ignored.
 * Always conserves: sum of allocation quantities + unallocated === quantity.
 */
export function splitQuantity(
  quantity: number,
  chunkSize: number,
  candidates: SplitCandidate[],
  process?: ProcessId,
): { allocations: SplitAllocation[]; unallocated: number } {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError("quantity must be a non-negative integer.");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError("chunkSize must be an integer of at least 1.");
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array.");
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    validateCandidate(candidate);
    if (seen.has(candidate.id)) {
      throw new RangeError(`Duplicate split candidate id: ${candidate.id}`);
    }
    seen.add(candidate.id);
  }
  if (process !== undefined && !isProcessId(process)) {
    throw new TypeError(`Unknown process: ${String(process)}`);
  }
  const target = process ?? candidates[0]?.process;

  const states: CandidateState[] = candidates
    .filter((c) => c.process === target)
    .map((candidate) => ({
      candidate,
      limit: candidate.real
        ? Math.min(candidate.maxAssignments ?? 1, 1)
        : candidate.maxAssignments,
      used: 0,
      count: 0,
      freeAt: candidate.availableAtSeconds,
      open: null,
    }));

  const allocations: SplitAllocation[] = [];
  const heap = new ChunkHeap();
  let heapSize = -1;
  const rebuild = (size: number) => {
    heap.clear();
    for (const state of states) {
      if (canTake(state, size)) {
        heap.push({ state, finish: nextFinish(state, size) });
      }
    }
    heapSize = size;
  };

  let remaining = quantity;
  while (remaining > 0) {
    let size = Math.min(chunkSize, remaining);
    if (size !== heapSize) rebuild(size);
    if (heap.size === 0) {
      // No one can take a whole chunk: shrink it to the largest usable capacity.
      let largest = 0;
      for (const state of states) {
        if (assignable(state)) {
          largest = Math.max(
            largest,
            state.candidate.capacityUnits - state.used,
          );
        }
      }
      if (largest <= 0) break;
      size = Math.min(size, largest);
      rebuild(size);
    }
    const entry = heap.pop()!;
    const { state } = entry;
    const { candidate } = state;
    if (state.limit === null && state.open) {
      state.open.quantity += size;
      state.open.finishSeconds = entry.finish;
    } else {
      const allocation: SplitAllocation = {
        machineId: candidate.id,
        quantity: size,
        startSeconds: state.freeAt,
        finishSeconds: entry.finish,
        real: candidate.real,
      };
      allocations.push(allocation);
      state.count += 1;
      if (state.limit === null) state.open = allocation;
      else state.freeAt = entry.finish;
    }
    state.used += size;
    remaining -= size;
    if (canTake(state, size)) {
      heap.push({ state, finish: nextFinish(state, size) });
    }
  }

  allocations.sort((a, b) =>
    a.machineId !== b.machineId
      ? a.machineId < b.machineId
        ? -1
        : 1
      : a.startSeconds - b.startSeconds,
  );
  return { allocations, unallocated: remaining };
}

/**
 * Integer-cent owner price for a simulated estimate:
 * max(minimumCents, material + per-unit + machine time). Terms sum to ownerCents.
 */
export function priceCents(
  card: NetworkMachine["priceCard"],
  quantity: number,
  materialPerUnit: number,
  minutesPerUnit: number,
): { ownerCents: number; terms: { label: string; cents: number }[] } {
  for (const key of [
    "materialCentsPerUnit",
    "unitCents",
    "timeCentsPerMinute",
    "minimumCents",
  ] as const) {
    if (!Number.isInteger(card?.[key]) || card[key] < 0) {
      throw new RangeError(`priceCard.${key} must be a non-negative integer.`);
    }
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError("quantity must be a non-negative integer.");
  }
  if (!finiteAtLeast(materialPerUnit, 0) || !finiteAtLeast(minutesPerUnit, 0)) {
    throw new RangeError(
      "materialPerUnit and minutesPerUnit must be finite and non-negative.",
    );
  }
  // Round away binary floating-point noise first (e.g. 2.4999999999 → 2.5).
  const cents = (value: number) => Math.round(Math.round(value * 1e6) / 1e6);
  const material = cents(
    quantity * materialPerUnit * card.materialCentsPerUnit,
  );
  const perUnit = quantity * card.unitCents;
  const time = cents(quantity * minutesPerUnit * card.timeCentsPerMinute);
  const terms = [
    { label: "Material", cents: material },
    { label: "Per-unit handling", cents: perUnit },
    { label: "Machine time", cents: time },
  ];
  const subtotal = material + perUnit + time;
  if (quantity === 0) return { ownerCents: 0, terms };
  if (card.minimumCents > subtotal) {
    terms.push({ label: "Minimum price", cents: card.minimumCents - subtotal });
  }
  return { ownerCents: Math.max(card.minimumCents, subtotal), terms };
}
