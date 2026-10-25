import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { initialState } from "../server/model.ts";
import { MockPayment } from "../server/payments.ts";
import { Service } from "../server/service.ts";
import { SqliteStore } from "../server/store.ts";
import { UI_REDIRECTS, UI_ROUTES, uiRedirect } from "../shared/ui-routes.ts";

test("retired UI entry points redirect without intercepting the owner API or built assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fabyn-ui-routing-"));
  const web = join(directory, "web");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(
    join(web, "index.html"),
    '<div id="root">current Fabyn UI</div>',
  );
  await writeFile(join(web, "assets", "index.js"), "// current Fabyn bundle");
  const store = new SqliteStore(
    join(directory, "state.sqlite"),
    initialState(),
  );
  const service = new Service(
    store,
    {
      async call() {
        throw new Error("UI requests must not call a machine");
      },
      token() {
        throw new Error("UI requests must not dispatch work");
      },
    },
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "test",
      secret: "ui-routing-test",
      ownerCode: "test-owner",
      dataDir: directory,
      nodeUrl: "http://127.0.0.1:9",
      assetOrigin: "http://127.0.0.1:4318/assets",
      quoteMs: 120000,
      pickupMs: 10000,
    },
  );
  const app = createApp(service, web);
  try {
    for (const [source, destination] of Object.entries(UI_REDIRECTS)) {
      for (const path of source === "/" ? [source] : [source, source + "/"]) {
        const response = await request(app)
          .get(path + "?from=bookmark&next=a%2Fb")
          .expect(308);
        assert.equal(
          response.headers.location,
          destination + "?from=bookmark&next=a%2Fb",
        );
        assert.equal(uiRedirect(path), destination);
      }
    }
    for (const path of Object.values(UI_ROUTES)) {
      const response = await request(app).get(path).expect(200);
      assert.match(response.text, /current Fabyn UI/);
      assert.equal(uiRedirect(path), undefined);
    }
    await request(app)
      .get("/assets/index.js")
      .expect(200, "// current Fabyn bundle");
    await request(app).get("/api/owner/dashboard").expect(401);
    assert.equal(uiRedirect("/api/owner/dashboard"), undefined);
    assert.equal(uiRedirect("/toString"), undefined);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Vercel redirects match local routes and run ahead of the SPA rewrite", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    config.redirects,
    Object.entries(UI_REDIRECTS).map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    })),
  );
  assert.ok(
    config.rewrites.some(
      (route: { destination: string }) => route.destination === "/index.html",
    ),
  );
});
