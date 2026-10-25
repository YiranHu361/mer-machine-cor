import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";
import { Service } from "../server/service.ts";
import { initialState } from "../server/model.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import { MockPayment } from "../server/payments.ts";
import { HttpNode } from "../server/node-client.ts";

test(
  "repeated live-dashboard connections release subscriptions and reject expired sessions",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "fabyn-realtime-"));
    const initial = initialState();
    initial.sessions.fixture = {
      id: "fixture_requester",
      role: "requester",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    initial.sessions.expired = {
      id: "expired_requester",
      role: "requester",
      expiresAt: "2000-01-01T00:00:00Z",
    };
    const store = new SqliteStore(join(dir, "state.sqlite"), initial);
    const service = new Service(
      store,
      new HttpNode("http://127.0.0.1:1", "fixture-node-key", "fixture-secret"),
      new MockPayment(),
      {
        mode: "simulation",
        paymentMode: "mock",
        storeMode: "sqlite-development",
        assetOrigin: "http://127.0.0.1:1/assets",
        secret: "fixture-secret",
        quoteMs: 1000,
        pickupMs: 1000,
        ownerCode: "fixture-owner",
        dataDir: dir,
        nodeUrl: "http://127.0.0.1:1",
      },
    );
    const server = createApp(service).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/events`;
    const controllers: AbortController[] = [];
    async function subscriptions(expected: number) {
      const until = Date.now() + 2000;
      while (store.listeners.size !== expected && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        store.listeners.size,
        expected,
        "live subscriptions must match open connections",
      );
    }
    try {
      assert.equal((await fetch(url)).status, 401);
      assert.equal(
        (await fetch(url, { headers: { Cookie: "fabyn_session=expired" } }))
          .status,
        401,
      );
      for (let cycle = 0; cycle < 3; cycle++) {
        const active = await Promise.all(
          Array.from({ length: 12 }, async () => {
            const controller = new AbortController();
            controllers.push(controller);
            const response = await fetch(url, {
              headers: { Cookie: "fabyn_session=fixture" },
              signal: controller.signal,
            });
            assert.equal(response.status, 200);
            assert.match(
              response.headers.get("content-type") || "",
              /text\/event-stream/,
            );
            const reader = response.body!.getReader();
            const first = await reader.read();
            assert.equal(
              new TextDecoder().decode(first.value),
              "event: refresh\ndata: {}\n\n",
            );
            return { controller, reader };
          }),
        );
        await subscriptions(12);
        await mutate(store, (state) => {
          state.machines.phomemo_01.reason = `Reconnect fixture ${cycle}`;
        });
        for (const { reader } of active) {
          const event = await reader.read();
          assert.equal(
            new TextDecoder().decode(event.value),
            "event: refresh\ndata: {}\n\n",
          );
        }
        for (const { controller } of active) controller.abort();
        await subscriptions(0);
      }
    } finally {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
