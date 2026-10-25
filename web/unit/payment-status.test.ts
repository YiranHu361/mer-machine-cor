import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentNotice } from "../src/fabyn/consumer/payment-status.ts";

test("a lost settlement receipt explains recovery and stops the normal confirmation animation", () => {
  const notice = paymentNotice({ status: "pending" });
  assert.equal(notice.title, "Recovering your test payment");
  assert.equal(notice.waiting, false);
  assert.match(notice.body, /don’t pay again/);
  assert.doesNotMatch(notice.body, /Nothing was charged/);
});

test("a known transaction stays in confirmation until the saved payment resolves", () => {
  const notice = paymentNotice({ status: "pending", transactionHash: "0x123" });
  assert.equal(notice.waiting, true);
  assert.match(notice.body, /Base Sepolia/);
});

test("only a proven unused expiry says nothing was charged", () => {
  const expired = paymentNotice({ status: "failed", reason: "Test payment expired without a transfer. Nothing was charged." });
  assert.equal(expired.title, "Test payment expired");
  assert.match(expired.body, /Nothing was charged or printed/);
  assert.match(expired.body, /Start a new order/);
  assert.doesNotMatch(paymentNotice({ status: "failed", reason: "RPC error" }).body, /Nothing was charged/);
});
