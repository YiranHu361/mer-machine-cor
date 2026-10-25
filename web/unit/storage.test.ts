import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
const fresh = () => import(`../src/storage.ts?fixture=${crypto.randomUUID()}`);
function fixture() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
function browser(local = fixture(), session = fixture()) {
  const value = { localStorage: local, sessionStorage: session };
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  return value;
}
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});
test("storage getter failures never escape and retain in-page selections", async () => {
  const s = await fresh();
  const w = browser();
  Object.defineProperty(w, "localStorage", {
    get: () => {
      throw new DOMException("Denied", "SecurityError");
    },
  });
  assert.equal(s.readStoredValue("local", "selection"), null);
  assert.equal(s.writeStoredValue("local", "selection", "job-one"), false);
  assert.equal(s.readStoredValue("local", "selection"), "job-one");
  assert.equal(s.removeStoredValue("local", "selection"), false);
  assert.equal(s.readStoredValue("local", "selection"), null);
  assert.equal(s.getStorageStatus().local, "unavailable");
});
test("quota failures preserve memory values and failed removals tombstone stale private selection", async () => {
  const s = await fresh();
  const local = fixture();
  local.setItem("selection", "old-private-job");
  browser(local);
  assert.equal(s.readStoredValue("local", "selection"), "old-private-job");
  local.setItem = () => {
    throw new DOMException("Full", "QuotaExceededError");
  };
  local.removeItem = () => {
    throw new DOMException("Denied", "SecurityError");
  };
  assert.equal(s.writeStoredValue("local", "selection", "new-job"), false);
  assert.equal(s.readStoredValue("local", "selection"), "new-job");
  assert.equal(s.removeStoredValue("local", "selection"), false);
  assert.equal(s.readStoredValue("local", "selection"), null);
  assert.equal(local.getItem("selection"), "old-private-job");
  assert.equal(s.getStorageStatus().local, "unavailable");
});
test("silent writes cannot be mistaken for durable payment checkpoints", async () => {
  const s = await fresh();
  const session = fixture();
  session.setItem = () => {};
  browser(fixture(), session);
  assert.equal(s.writeStoredValue("session", "payment", "stable-key"), false);
  assert.equal(s.readStoredValue("session", "payment"), "stable-key");
  assert.equal(s.getStorageStatus().session, "unavailable");
});
test("checkout keys survive a fresh module with unavailable storage and change with quote", async () => {
  const w = browser();
  Object.defineProperty(w, "sessionStorage", {
    get: () => {
      throw new DOMException("Denied", "SecurityError");
    },
  });
  const job = { id: "job-one", quote: { id: "quote-one", version: 1 } };
  const first = (await fresh()).getCheckoutKey(job);
  const second = (await fresh()).getCheckoutKey(job);
  assert.equal(first, second);
  assert.ok(first.length >= 8 && first.length <= 200);
  assert.notEqual(
    (await fresh()).getCheckoutKey({
      ...job,
      quote: { id: "quote-two", version: 1 },
    }),
    first,
  );
});
test("server and legacy saved checkout keys are retained", async () => {
  const s = await fresh();
  const session = fixture();
  browser(fixture(), session);
  const job = { id: "job-one", quote: { id: "quote-one", version: 1 } };
  session.setItem(
    "fabyn-checkout-job-one-quote-one-1",
    "legacy-checkout-key",
  );
  assert.equal(s.getCheckoutKey(job), "legacy-checkout-key");
  assert.equal(
    s.getCheckoutKey({ ...job, checkoutKey: "server-checkout-key" }),
    "server-checkout-key",
  );
});
test("availability has stable subscribed snapshots and only verified writes recover from quota failure", async () => {
  const s = await fresh();
  const local = fixture();
  browser(local);
  let updates = 0;
  const unsubscribe = s.subscribeStorageStatus(() => updates++);
  const initial = s.getStorageStatus();
  assert.equal(s.getStorageStatus(), initial);
  local.setItem = () => {
    throw new DOMException("Full", "QuotaExceededError");
  };
  s.writeStoredValue("local", "selection", "job-one");
  await Promise.resolve();
  assert.equal(updates, 1);
  assert.notEqual(s.getStorageStatus(), initial);
  s.readStoredValue("local", "other");
  assert.equal(s.getStorageStatus().local, "unavailable");
  browser();
  assert.equal(s.writeStoredValue("local", "selection", "job-two"), true);
  await Promise.resolve();
  assert.equal(s.getStorageStatus().local, "available");
  assert.equal(updates, 2);
  unsubscribe();
});
