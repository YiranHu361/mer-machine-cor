// Jobs grouped into the orders a customer placed. One order can put items on
// several machines; the seller hands the order over (or sends it out) as one.
import { finished, intakeOf, jobTitle, needsMaker, onLine, recovered, viaAgent, waitingPickup } from "./status";
import type { OwnerJob } from "./data";

export type OrderFilter = "active" | "ready" | "done" | "all";

export interface SellerOrder {
  key: string;
  orderId?: string;
  jobs: OwnerJob[];
  title: string;
  intake: { label: string; detail: string };
  viaAgent: boolean;
  createdAt: string;
  updatedAt: string;
  /** Every item is made (or handed over). */
  made: boolean;
  /** Something on it is waiting for the seller. */
  needsYou: boolean;
  /** Made and not yet collected or handed off. */
  ready: boolean;
  done: boolean;
  cancelled: boolean;
  totalCents: number;
  ownerCents: number;
}

const MADE = (j: OwnerJob) => j.productionState === "produced";

/** A finished order nobody recorded a hand-off for is taken as handed over after this long. */
const STALE_MS = 6 * 3600000;

const collected = (j: OwnerJob) => j.productionState === "cancelled" || recovered(j) || j.fulfillmentState === "collected";

/**
 * `sentOut` holds the orders that left with a courier or were collected at the
 * table (see deliveries.ts). An order taken off its machine without a pickup
 * code is still waiting to go out until then.
 */
export function groupOrders(jobs: OwnerJob[], sentOut: ReadonlySet<string> = new Set(), now = Date.now()): SellerOrder[] {
  const byKey = new Map<string, OwnerJob[]>();
  for (const j of jobs) {
    const key = j.orderId ?? j.id;
    byKey.set(key, [...(byKey.get(key) ?? []), j]);
  }
  const orders: SellerOrder[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const live = sorted.filter((j) => j.productionState !== "cancelled");
    const cancelled = live.length === 0;
    const made = live.length > 0 && live.every(MADE);
    const updatedAt = sorted.reduce((m, j) => (j.updatedAt > m ? j.updatedAt : m), sorted[0].updatedAt);
    const offMachine = sorted.every((j) => finished(j) || waitingPickup(j));
    const done = cancelled || sorted.every(collected) || (offMachine && (sentOut.has(key) || now - Date.parse(updatedAt) > STALE_MS));
    const ready = made && !done;
    const titles = [...new Set(live.map(jobTitle))];
    orders.push({
      key,
      orderId: sorted[0].orderId,
      jobs: sorted,
      title: titles.length > 1 ? `${titles[0]} + ${titles.length - 1} more` : titles[0] ?? jobTitle(sorted[0]),
      intake: intakeOf(sorted[0]),
      viaAgent: sorted.some(viaAgent),
      createdAt: sorted[0].createdAt,
      updatedAt,
      made,
      needsYou: sorted.some(needsMaker),
      ready,
      done,
      cancelled,
      totalCents: live.reduce((s, j) => s + (j.quote?.totalCents ?? 0), 0),
      ownerCents: live.reduce((s, j) => s + (j.economics?.ownerNetCents ?? j.quote?.ownerCents ?? 0), 0),
    });
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function matchesFilter(o: SellerOrder, f: OrderFilter): boolean {
  if (f === "all") return true;
  if (f === "done") return o.done;
  if (f === "ready") return o.ready;
  return !o.done && !o.ready && o.jobs.some(onLine);
}

/** A short order number customers and couriers can read out. */
export function shortId(o: SellerOrder): string {
  return (o.orderId ?? o.key).replace(/^ord_/, "").slice(-6).toUpperCase();
}
