import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, api, requestJson, requestDeadline } from "../src/api.ts";

test("request deadlines allow existing preparation, upload and calibration runtimes", () => {
  assert.equal(requestDeadline("/api/jobs"), 30_000);
  assert.equal(requestDeadline("/api/owner/machines/id/calibration"), 90_000);
  for (const path of [
    "/api/uploads",
    "/api/jobs",
    "/api/intake",
    "/api/jobs/id/checkout",
    "/api/jobs/id/dispatch",
  ])
    assert.equal(requestDeadline(path, "POST"), 180_000);
});

for (const phase of ["headers", "body"] as const)
  test(`a stalled ${phase} is aborted once and reports unknown mutation outcome without retry`, async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const fetcher = (async (_path, init) => {
      calls++;
      signal = init?.signal as AbortSignal;
      if (phase === "headers") return new Promise<Response>(() => {});
      return {
        json: () => new Promise(() => {}),
        status: 200,
        ok: true,
      } as Response;
    }) as typeof fetch;
    await assert.rejects(
      requestJson("/api/jobs", { method: "POST" }, { fetcher, timeoutMs: 5 }),
      (error: unknown) => {
        assert(error instanceof ApiError);
        assert.equal(error.code, "request_timeout");
        assert.equal(error.outcomeUnknown, true);
        assert.match(error.message, /server may still finish/);
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
  });

test("read timeout is bounded without claiming an uncertain mutation", async () => {
  await assert.rejects(
    requestJson(
      "/api/session",
      {},
      {
        fetcher: (() => new Promise<Response>(() => {})) as typeof fetch,
        timeoutMs: 5,
      },
    ),
    (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.outcomeUnknown, false);
      assert.match(error.message, /Refresh/);
      return true;
    },
  );
});

test("successful headers and JSON body clear the deadline and are never aborted later", async () => {
  let signal: AbortSignal | undefined;
  const fetcher = (async (_path, init) => {
    signal = init?.signal as AbortSignal;
    return Response.json({ saved: true });
  }) as typeof fetch;
  const { value } = await requestJson(
    "/api/jobs",
    { method: "POST" },
    { fetcher, timeoutMs: 5 },
  );
  assert.deepEqual(value, { saved: true });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(signal?.aborted, false);
});

test("malformed committed responses and transport errors preserve uncertain outcome without retries", async () => {
  for (const malformed of [true, false]) {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (!malformed) throw new TypeError("Offline fixture");
      return new Response("truncated json", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      requestJson("/api/jobs", { method: "POST" }, { fetcher }),
      (error: unknown) => {
        assert(error instanceof ApiError);
        assert.equal(error.outcomeUnknown, true);
        assert.equal(
          error.code,
          malformed ? "invalid_response" : "disconnected",
        );
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("a mutation server error preserves its details and explicitly reports an uncertain commit", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      {
        error: {
          code: "STORAGE_LOST",
          message: "Storage acknowledgement unavailable.",
        },
      },
      { status: 500 },
    );
  };
  try {
    await assert.rejects(api("/jobs", {}, "post"), (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.outcomeUnknown, true);
      assert.equal(error.code, "STORAGE_LOST");
      assert.match(error.message, /Storage acknowledgement unavailable/);
      assert.match(
        error.message,
        /result is unknown.*Refresh the existing order/,
      );
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
