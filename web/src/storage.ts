/** Best-effort browser preferences, with explicit durability for paid actions. */
export type StorageArea = "local" | "session";
export type StorageStatus = Readonly<{
  local: "unknown" | "available" | "unavailable";
  session: "unknown" | "available" | "unavailable";
}>;
let status: StorageStatus = Object.freeze({
  local: "unknown",
  session: "unknown",
});
const listeners = new Set<() => void>();
const remembered: Record<StorageArea, Map<string, string | null>> = {
  local: new Map(),
  session: new Map(),
};
const volatile: Record<StorageArea, Set<string>> = {
  local: new Set(),
  session: new Set(),
};
function mark(
  area: StorageArea,
  next: StorageStatus[StorageArea],
  write = false,
) {
  // A successful read does not prove that a full/private store accepts writes.
  if (next === "available" && status[area] === "unavailable" && !write) return;
  if (status[area] === next) return;
  status = Object.freeze({ ...status, [area]: next });
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}
function browserStorage(area: StorageArea): Storage {
  // Accessing the property itself can throw SecurityError in restricted frames.
  if (typeof window === "undefined")
    throw new Error("Browser storage unavailable");
  return area === "local" ? window.localStorage : window.sessionStorage;
}
export const getStorageStatus = (): StorageStatus => status;
export function subscribeStorageStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function readStoredValue(area: StorageArea, key: string): string | null {
  if (volatile[area].has(key)) return remembered[area].get(key) ?? null;
  try {
    const value = browserStorage(area).getItem(key);
    remembered[area].set(key, value);
    mark(area, "available");
    return value;
  } catch {
    mark(area, "unavailable");
    return remembered[area].get(key) ?? null;
  }
}
/** Returns true only when storage confirms this exact value can be read back. */
export function writeStoredValue(
  area: StorageArea,
  key: string,
  value: string,
): boolean {
  remembered[area].set(key, value);
  try {
    const store = browserStorage(area);
    store.setItem(key, value);
    if (store.getItem(key) !== value)
      throw new Error("Storage write was not retained");
    volatile[area].delete(key);
    mark(area, "available", true);
    return true;
  } catch {
    volatile[area].add(key);
    mark(area, "unavailable");
    return false;
  }
}
export function removeStoredValue(area: StorageArea, key: string): boolean {
  // A tombstone prevents failed removal from restoring a prior identity's item.
  remembered[area].set(key, null);
  try {
    const store = browserStorage(area);
    store.removeItem(key);
    if (store.getItem(key) !== null)
      throw new Error("Storage removal was not retained");
    volatile[area].delete(key);
    mark(area, "available");
    return true;
  } catch {
    volatile[area].add(key);
    mark(area, "unavailable");
    return false;
  }
}

type CheckoutIdentity = {
  id: string;
  quote?: { id: string; version?: number };
  checkoutKey?: string;
};
const validKey = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 200;
/** Existing server/saved keys win; new keys stay stable even across denied storage/reloads. */
export function getCheckoutKey(job: CheckoutIdentity): string {
  if (!job.quote?.id)
    throw new Error("Get a current quote before starting checkout.");
  const slot = `fabrary-checkout-${job.id}-${job.quote.id}-${job.quote.version}`;
  const saved = readStoredValue("session", slot);
  const key = validKey(job.checkoutKey)
    ? job.checkoutKey
    : validKey(saved)
      ? saved
      : `fabrary-checkout-v1:${encodeURIComponent(job.id)}:${encodeURIComponent(job.quote.id)}:${job.quote.version ?? 1}`;
  if (!validKey(key))
    throw new Error(
      "This order reference cannot be saved safely for checkout. Ask the owner to review the order.",
    );
  writeStoredValue("session", slot, key);
  return key;
}

export const WALLET_RETRY_NOTICE =
  "An earlier wallet authorization may still be pending. Refresh this same order to reconcile it before authorizing another payment. If the order remains unpaid, wait for the quote to expire and request a fresh quote.";
type WalletCheckpoint = {
  jobId: string;
  quote: { id: string };
  idempotencyKey: string;
};
const walletSlot = (context: WalletCheckpoint) =>
  `fabrary-wallet-attempt-${encodeURIComponent(context.jobId)}-${encodeURIComponent(context.quote.id)}`;
// Storage can be cleared/evicted while a wallet approval is open. An observed
// attempt stays claimed in this page even if a later storage read returns null.
const walletClaims = new Set<string>();
/** Claim before asking for a signature; ambiguous submissions retain this guard. */
export function beginWalletAuthorization(context: WalletCheckpoint): void {
  const slot = walletSlot(context);
  if (hasWalletAuthorization(context)) throw new Error(WALLET_RETRY_NOTICE);
  if (!writeStoredValue("session", slot, context.idempotencyKey)) {
    // No signing request was made. Retain no false "already signed" marker.
    removeStoredValue("session", slot);
    throw new Error(
      "Browser storage is unavailable, so payment retry details cannot be saved. Allow session storage before approving a wallet payment. No payment was signed or submitted.",
    );
  }
  walletClaims.add(slot);
}
export function hasWalletAuthorization(context: WalletCheckpoint): boolean {
  const slot = walletSlot(context);
  if (walletClaims.has(slot)) return true;
  if (!readStoredValue("session", slot)) return false;
  walletClaims.add(slot);
  return true;
}
/** Only use before any signed payload was submitted, such as wallet rejection. */
export function cancelUnsubmittedWalletAuthorization(
  context: WalletCheckpoint,
): void {
  const slot = walletSlot(context);
  walletClaims.delete(slot);
  removeStoredValue("session", slot);
}
