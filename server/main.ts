import "dotenv/config";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { initialState } from "./model.ts";
import { SqliteStore, type Store } from "./store.ts";
import { HttpNode } from "./node-client.ts";
import { ConnectorRelay, RoutingNode } from "./connectors.ts";
import { ProducerHubNode } from "./producer-hub.ts";
import { Service, type Config } from "./service.ts";
import { createApp } from "./app.ts";
import { Orchestrator } from "./orchestration/orchestrator.ts";
import { IntegratedPayment } from "./external.ts";
import { loadCatalog } from "./catalog.ts";
import { mutate } from "./store.ts";
import { ConvexPublisher, convexUrl, mirrorState } from "./convex-publish.ts";
import { ConvexStore } from "./convex-store.ts";
import { createTestWallet } from "../integrations/src/test-wallet.ts";
const dataDir = resolve(process.env.FABYN_DATA_DIR ?? ".data");
await mkdir(dataDir, { recursive: true });
const configPath = join(dataDir, "local-credentials.json");
let credentials: { ownerCode: string; nodeKey: string; secret: string };
try {
  credentials = JSON.parse(await readFile(configPath, "utf8"));
} catch {
  credentials = {
    ownerCode: randomBytes(16).toString("hex"),
    nodeKey: randomBytes(32).toString("hex"),
    secret: randomBytes(32).toString("hex"),
  };
  await writeFile(configPath, JSON.stringify(credentials), { mode: 0o600 });
}
process.env.FABYN_NODE_KEY ??= credentials.nodeKey;
process.env.FABYN_TOKEN_SECRET ??= credentials.secret;
const port = Number(process.env.PORT ?? 4318);
const mode = process.env.FABYN_MODE ?? "simulation";
if (!["simulation", "hardware"].includes(mode))
  throw new Error("FABYN_MODE must be simulation or hardware.");
const storeMode = process.env.FABYN_STORE ?? "sqlite-development";
let store: Store;
if (storeMode === "spacetimedb") {
  const { connectSpacetimeStore } =
    await import("../integrations/src/spacetime-store.ts");
  const external = await connectSpacetimeStore({
    uri: process.env.FABYN_SPACETIME_URI ?? "ws://127.0.0.1:3002",
    database: process.env.FABYN_SPACETIME_DATABASE ?? "fabyn-app",
    token: process.env.FABYN_SPACETIME_TOKEN ?? "",
    initialState: initialState(),
  });
  store = {
    read: () => external.read(),
    compareAndSet: (v, d) => external.compareAndSet(v, d),
    subscribe: (fn) => external.subscribe(() => fn()),
    close: () => external.close(),
  };
} else if (storeMode === "convex") {
  // Convex holds the authoritative state as well as the live read model.
  const url = convexUrl();
  if (!url)
    throw new Error(
      "FABYN_STORE=convex needs CONVEX_URL or CONVEX_DEPLOY_KEY in .env.",
    );
  store = await ConvexStore.connect(
    url,
    process.env.FABYN_PUBLISH_SECRET ?? "",
    initialState(),
  );
} else if (storeMode === "sqlite-development")
  store = new SqliteStore(join(dataDir, "app.sqlite"), initialState());
else throw new Error("Unsupported store; no silent persistence fallback.");
const config: Config = {
  mode: mode as Config["mode"],
  paymentMode: (process.env.FABYN_PAYMENT_MODE ??
    "mock") as Config["paymentMode"],
  storeMode,
  assetOrigin: `http://127.0.0.1:${port}/assets`,
  secret: process.env.FABYN_TOKEN_SECRET,
  quoteMs: 120000,
  pickupMs: 86400000,
  ownerCode: process.env.FABYN_OWNER_CODE ?? credentials.ownerCode,
  dataDir,
  nodeUrl: process.env.FABYN_NODE_URL ?? "http://127.0.0.1:8788",
};
// Mixed plans (for example real machines beside simulated ones) list both modes.
const allowedModes = (process.env.FABYN_ALLOWED_MODES ?? mode)
  .split(",")
  .map((value) => value.trim());
if (
  !allowedModes.length ||
  allowedModes.some((value) => !["simulation", "hardware"].includes(value))
)
  throw new Error("FABYN_ALLOWED_MODES lists simulation and/or hardware.");
config.allowedModes = allowedModes as Config["mode"][];
config.autoPrepareHubPrints = process.env.FABYN_AUTO_PREPARE_PRINTS === "1";
const catalog = await loadCatalog(process.env.FABYN_CATALOG_FILE, dataDir);
config.catalog = catalog.models;
if (catalog.assets.length)
  await mutate(store, (s) => {
    for (const asset of catalog.assets) s.assets[asset.id] = asset;
  });
// Directly configured nodes use HTTP; machines set up with a connector use the relay.
const service = new Service(
  store,
  new RoutingNode(
    new HttpNode(config.nodeUrl, process.env.FABYN_NODE_KEY, config.secret),
    new ConnectorRelay(),
    config.secret,
    // Machines the owner switches to the producer side's hub print through it.
    process.env.FABYN_PRODUCER_HUB_URL
      ? new ProducerHubNode(process.env.FABYN_PRODUCER_HUB_URL)
      : undefined,
  ),
  new IntegratedPayment(store),
  config,
);
const orchestrator = new Orchestrator(service);
// Convex is the live read model screens subscribe to; the store stays authoritative.
const liveUrl = convexUrl();
const stopMirror =
  liveUrl && process.env.FABYN_PUBLISH_SECRET
    ? mirrorState(
        store,
        ConvexPublisher.connect(liveUrl, process.env.FABYN_PUBLISH_SECRET),
      )
    : undefined;
// Signs Base Sepolia test payments for demos without a browser wallet.
const testWallet = createTestWallet();
const app = createApp(service, undefined, { orchestrator, testWallet });
// Loopback by default. Set FABYN_HOST to accept connectors from other computers.
const host = process.env.FABYN_HOST ?? "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(
    `Fabyn http://${host}:${port} (${mode}, ${storeMode}, ${config.paymentMode}, live view ${stopMirror ? liveUrl : "off"}, test wallet ${testWallet ? testWallet.address : "off"}). Owner access is in ${configPath}; credentials are never printed.`,
  ),
);
const tick = setInterval(
  () =>
    void Promise.all([service.tick(), orchestrator.tick()]).catch((e) =>
      console.error(
        "Background reconciliation failed; existing attempts remain recorded.",
      ),
    ),
  1500,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    clearInterval(tick);
    stopMirror?.();
    server.close(
      () => void Promise.resolve(store.close()).then(() => process.exit(0)),
    );
    setTimeout(() => process.exit(0), 2000).unref();
  });
