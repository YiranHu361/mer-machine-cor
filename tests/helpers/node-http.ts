import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SqliteStore, mutate } from "../../server/store.ts";
import { initialState, now, type Job } from "../../server/model.ts";
import { Service } from "../../server/service.ts";
import { HttpNode } from "../../server/node-client.ts";
import { MockPayment } from "../../server/payments.ts";

const key = "isolated-cross-language-cancellation-fixture";
export const delay = (ms: number) =>
  new Promise((done) => setTimeout(done, ms));
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
export async function nodeHttpFixture() {
  const dir = await mkdtemp(join(tmpdir(), "fabrary-cancel-http-"));
  const entered = latch(),
    released = latch();
  const artifact = execFileSync(resolve("node/.venv/bin/python"), [
    "-c",
    "from PIL import Image;import io,sys;b=io.BytesIO();Image.new('1',(round(53/25.4*300),round(50/25.4*300)),1).save(b,'PNG');sys.stdout.buffer.write(b.getvalue())",
  ]);
  let fetches = 0;
  const assets = createServer(async (_req, res) => {
    fetches++;
    entered.release();
    await released.promise;
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(artifact);
  });
  assets.listen(0, "127.0.0.1");
  await once(assets, "listening");
  const address = assets.address();
  assert(address && typeof address !== "string");
  const assetOrigin = `http://127.0.0.1:${address.port}/assets`;
  const nodeOrigin = `http://127.0.0.1:${await freePort()}`;
  const machinePath = join(dir, "machines.json");
  await writeFile(
    machinePath,
    JSON.stringify([
      {
        id: "phomemo_01",
        model: "Phomemo M02Pro",
        mode: "simulation",
        simulationSeconds: 0.01,
      },
    ]),
  );
  const child: ChildProcess = spawn(
    resolve("node/.venv/bin/fabrary-node"),
    [],
    {
      env: {
        ...process.env,
        FABRARY_NODE_KEY: key,
        FABRARY_TOKEN_SECRET: key,
        FABRARY_NODE_DATA: join(dir, "node"),
        FABRARY_MACHINES_FILE: machinePath,
        FABRARY_NODE_HOST: "127.0.0.1",
        FABRARY_NODE_PORT: new URL(nodeOrigin).port,
        FABRARY_NODE_URL: nodeOrigin,
        FABRARY_ASSET_ORIGIN: assetOrigin,
      },
      stdio: "ignore",
    },
  );
  const node = new HttpNode(nodeOrigin, key, key);
  const store = new SqliteStore(join(dir, "app.sqlite"), initialState());
  const service = new Service(store, node, new MockPayment(), {
    mode: "simulation",
    paymentMode: "mock",
    storeMode: "sqlite-development",
    assetOrigin,
    secret: key,
    quoteMs: 120000,
    pickupMs: 60000,
    ownerCode: key,
    dataDir: dir,
    nodeUrl: nodeOrigin,
  });
  const close = async () => {
    released.release();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
    assets.closeAllConnections();
    await new Promise<void>((done) => assets.close(() => done()));
    store.close();
    await rm(dir, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(nodeOrigin + "/health", {
          headers: { Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(300),
        });
        if (response.ok) {
          const health = (await response.json()) as any;
          assert.deepEqual(
            health.machines.map((m: any) => m.mode),
            ["simulation"],
          );
          ready = true;
          break;
        }
      } catch {}
      await delay(40);
    }
    assert(ready, "Isolated simulation node failed to start");
    const path = join(dir, "approved.png");
    await writeFile(path, artifact);
    const digest = createHash("sha256").update(artifact).digest("hex");
    await mutate(store, (s) => {
      s.assets.fixture_art = {
        id: "fixture_art",
        ownerId: "requester",
        path,
        url: "/assets/fixture_art",
        sha256: digest,
        mime: "image/png",
        width: 626,
        height: 591,
        createdAt: now(),
      };
      const machine = s.machines.phomemo_01;
      Object.assign(machine, {
        calibrated: true,
        listed: true,
        ready: true,
        paused: false,
        nodeUrl: nodeOrigin,
      });
    });
    return {
      dir,
      service,
      node,
      store,
      entered,
      released,
      close,
      fetches: () => fetches,
      artifact: {
        id: "fixture_art",
        url: "/assets/fixture_art",
        sha256: digest,
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export const spec = {
  assetIds: ["fixture_art"],
  intent: "Explicit isolated simulation cancellation integration",
  outputType: "sticker",
  widthMm: 53,
  heightMm: 50,
  quantity: 1,
  material: "thermal-paper",
  permission: "authorized",
  crop: "contain",
};
export function journal(dir: string) {
  const db = new DatabaseSync(join(dir, "node", "journal.sqlite"), {
    readOnly: true,
  });
  try {
    return {
      attempts: Number(
        (db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as any).n,
      ),
      tombstones: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM cancelled_attempts")
            .get() as any
        ).n,
      ),
    };
  } finally {
    db.close();
  }
}
