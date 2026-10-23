import "dotenv/config";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { initialState } from "./model.ts";
import { SqliteStore, type Store } from "./store.ts";
import { HttpNode } from "./node-client.ts";
import { Service, type Config } from "./service.ts";
import { createApp } from "./app.ts";
import { IntegratedPayment } from "./external.ts";
import { loadCatalog } from "./catalog.ts";
import { mutate } from "./store.ts";
const dataDir = resolve(process.env.FABRARY_DATA_DIR ?? ".data");
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
process.env.FABRARY_NODE_KEY ??= credentials.nodeKey;
process.env.FABRARY_TOKEN_SECRET ??= credentials.secret;
const port = Number(process.env.PORT ?? 4318);
const mode = process.env.FABRARY_MODE ?? "simulation";
if (!["simulation", "hardware"].includes(mode))
  throw new Error("FABRARY_MODE must be simulation or hardware.");
const storeMode = process.env.FABRARY_STORE ?? "sqlite-development";
let store: Store;
if (storeMode === "spacetimedb") {
  const { connectSpacetimeStore } =
    await import("../integrations/src/spacetime-store.ts");
  const external = await connectSpacetimeStore({
    uri: process.env.FABRARY_SPACETIME_URI ?? "ws://127.0.0.1:3002",
    database: process.env.FABRARY_SPACETIME_DATABASE ?? "fabrary-app",
    token: process.env.FABRARY_SPACETIME_TOKEN ?? "",
    initialState: initialState(),
  });
  store = {
    read: () => external.read(),
    compareAndSet: (v, d) => external.compareAndSet(v, d),
    subscribe: (fn) => external.subscribe(() => fn()),
    close: () => external.close(),
  };
} else if (storeMode === "sqlite-development")
  store = new SqliteStore(join(dataDir, "app.sqlite"), initialState());
else throw new Error("Unsupported store; no silent persistence fallback.");
const config: Config = {
  mode: mode as Config["mode"],
  paymentMode: (process.env.FABRARY_PAYMENT_MODE ??
    "mock") as Config["paymentMode"],
  storeMode,
  assetOrigin: `http://127.0.0.1:${port}/assets`,
  secret: process.env.FABRARY_TOKEN_SECRET,
  quoteMs: 120000,
  pickupMs: 86400000,
  ownerCode: process.env.FABRARY_OWNER_CODE ?? credentials.ownerCode,
  dataDir,
  nodeUrl: process.env.FABRARY_NODE_URL ?? "http://127.0.0.1:8788",
};
const catalog = await loadCatalog(process.env.FABRARY_CATALOG_FILE, dataDir);
config.catalog = catalog.models;
if (catalog.assets.length)
  await mutate(store, (s) => {
    for (const asset of catalog.assets) s.assets[asset.id] = asset;
  });
const service = new Service(
  store,
  new HttpNode(config.nodeUrl, process.env.FABRARY_NODE_KEY, config.secret),
  new IntegratedPayment(store),
  config,
);
const app = createApp(service);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Fabrary http://127.0.0.1:${port} (${mode}, ${storeMode}, ${config.paymentMode}). Owner access is in ${configPath}; credentials are never printed.`,
  ),
);
const tick = setInterval(
  () =>
    void service
      .tick()
      .catch((e) =>
        console.error(
          "Background reconciliation failed; existing attempts remain recorded.",
        ),
      ),
  1500,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    clearInterval(tick);
    server.close(
      () => void Promise.resolve(store.close()).then(() => process.exit(0)),
    );
    setTimeout(() => process.exit(0), 2000).unref();
  });
