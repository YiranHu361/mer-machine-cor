import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentPrinterConnection,
  producerOnline,
  type PrinterConnection,
} from "../../shared/connection-status.ts";

test("a stopped producer expires independently of a working Vercel connection", () => {
  const now = Date.now();
  const seen = new Date(now).toISOString();
  assert.equal(producerOnline(seen, now + 19_999), true);
  assert.equal(producerOnline(seen, now + 20_001), false);
  assert.equal(producerOnline(null, now), false);
  const row: PrinterConnection = {
    id: "bambu_01",
    name: "A1",
    model: "A1 mini",
    makes: "3D prints",
    status: "connected",
    detail: "Printer answered.",
    checkedAt: seen,
    lastSeen: seen,
    linked: false,
  };
  assert.equal(currentPrinterConnection(row, now + 1_000).status, "connected");
  const stopped = currentPrinterConnection(row, now + 21_000);
  assert.equal(stopped.status, "offline");
  assert.equal(stopped.checkedAt, seen);
  assert.equal(stopped.linked, false);
});
