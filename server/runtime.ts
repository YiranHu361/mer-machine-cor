import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { CloudProducer } from "./cloud-producer.ts";
import { CloudFileStore, ConvexFiles } from "./cloud-files.ts";
import { machineEvent, jobEvent, planEvent } from "./convex-publish.ts";
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
export async function createRuntime({
  cloud = false,
  background,
}: { cloud?: boolean; background?: (work: Promise<unknown>) => void } = {}) {
  const dataDir = resolve(
    cloud ? "/tmp/fabyn" : (process.env.FABYN_DATA_DIR ?? ".data"),
  );
  if (cloud) {
    for (const name of [
      "CONVEX_URL",
      "FABYN_PUBLISH_SECRET",
      "FABYN_OWNER_CODE",
      "FABYN_TOKEN_SECRET",
      "FABYN_PRODUCER_KEY",
      "FABYN_PUBLIC_ORIGIN",
    ])
      if (!process.env[name])
        throw new Error(`${name} is required for the cloud runtime`);
    if (process.env.FABYN_PRODUCER_KEY!.length < 32)
      throw new Error("FABYN_PRODUCER_KEY must have at least 32 characters");
    if (!/^https:\/\//.test(process.env.FABYN_PUBLIC_ORIGIN!))
      throw new Error("Cloud origin must use HTTPS");
  }
  await mkdir(join(dataDir, "assets"), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const configPath = join(dataDir, "local-credentials.json");
  let credentials: { ownerCode: string; nodeKey: string; secret: string };
  if (cloud)
    credentials = {
      ownerCode: process.env.FABYN_OWNER_CODE!,
      nodeKey: process.env.FABYN_PRODUCER_KEY!,
      secret: process.env.FABYN_TOKEN_SECRET!,
    };
  else
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
  const mode = process.env.FABYN_MODE ?? (cloud ? "hardware" : "simulation");
  if (!["simulation", "hardware"].includes(mode))
    throw new Error("FABYN_MODE must be simulation or hardware.");
  const storeMode = cloud
    ? "convex"
    : (process.env.FABYN_STORE ?? "sqlite-development");
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
      { watch: !cloud },
    );
  } else if (storeMode === "sqlite-development")
    store = new SqliteStore(join(dataDir, "app.sqlite"), initialState());
  else throw new Error("Unsupported store; no silent persistence fallback.");
  const files = cloud
    ? new ConvexFiles(
        process.env.CONVEX_URL!,
        process.env.FABYN_PUBLISH_SECRET!,
      )
    : undefined;
  const metadataStore = store;
  if (files) store = new CloudFileStore(store, files, dataDir);
  const producer = files
    ? new CloudProducer(
        metadataStore,
        files,
        process.env.FABYN_PRODUCER_KEY!,
        dataDir,
      )
    : undefined;
  const config: Config = {
    cloud,
    publicOrigin: process.env.FABYN_PUBLIC_ORIGIN
      ? new URL(process.env.FABYN_PUBLIC_ORIGIN).origin
      : undefined,
    mode: mode as Config["mode"],
    paymentMode: (process.env.FABYN_PAYMENT_MODE ??
      "mock") as Config["paymentMode"],
    storeMode,
    assetOrigin: cloud
      ? `${new URL(process.env.FABYN_PUBLIC_ORIGIN!).origin}/assets`
      : `http://127.0.0.1:${port}/assets`,
    secret: process.env.FABYN_TOKEN_SECRET,
    quoteMs: 120000,
    pickupMs: 86400000,
    ownerCode: process.env.FABYN_OWNER_CODE ?? "",
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
  // In testnet mode simulated machines are paid and picked up like hardware;
  // FABYN_CHARGE_SIMULATED=0 keeps them estimate-only.
  config.chargeSimulated = process.env.FABYN_CHARGE_SIMULATED !== "0";
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
      producer ??
        (process.env.FABYN_PRODUCER_HUB_URL
          ? new ProducerHubNode(process.env.FABYN_PRODUCER_HUB_URL)
          : undefined),
    ),
    new IntegratedPayment(store),
    config,
  );
  const analyze = producer
    ? (assets: import("./model.ts").Asset[]) =>
        producer.rpc(
          "analyze",
          { paths: assets.map((a) => a.path) },
          assets.map((a) => a.path),
        )
    : undefined;
  const orchestrator = new Orchestrator(service, {
    ...(producer
      ? {
          producer: (request: object) => producer.rpc("prepare", request),
          analyze,
          checkPrinter: (machine: import("./model.ts").Machine) =>
            producer.check(machine.producerHub!.machineId),
        }
      : {}),
    background,
  });
  // Convex is the live read model screens subscribe to; the store stays authoritative.
  const liveUrl = convexUrl();
  const stopMirror =
    !cloud && liveUrl && process.env.FABYN_PUBLISH_SECRET
      ? mirrorState(
          store,
          ConvexPublisher.connect(liveUrl, process.env.FABYN_PUBLISH_SECRET),
        )
      : undefined;
  // Signs Base Sepolia test payments for demos without a browser wallet.
  const testWallet = createTestWallet();
  let reconciling: Promise<void> | undefined;
  const publisher =
    cloud && liveUrl
      ? ConvexPublisher.connect(liveUrl, process.env.FABYN_PUBLISH_SECRET!)
      : undefined;
  const producerPublisher =
    cloud && liveUrl
      ? ConvexPublisher.connect(
          liveUrl,
          process.env.FABYN_PUBLISH_SECRET!,
          "producer",
        )
      : undefined;
  const sent = new Map<string, string>();
  const reconcile = () =>
    (reconciling ??= (async () => {
      await service.tick();
      await orchestrator.tick();
      if (publisher) {
        const s = await service.read();
        const emit = (
          key: string,
          type: string,
          data: Record<string, unknown>,
        ) => {
          const body = JSON.stringify(data);
          if (sent.get(key) !== body) {
            publisher.publish(type, data);
            sent.set(key, body);
          }
        };
        for (const m of Object.values(s.machines))
          emit(`machine:${m.id}`, "machine.updated", machineEvent(m));
        for (const o of Object.values(s.orders ?? {}))
          emit(`plan:${o.id}`, "plan.updated", planEvent(o));
        for (const j of Object.values(s.jobs))
          if (j.orderId)
            emit(
              `job:${j.id}`,
              "job.updated",
              jobEvent(j, s.orders?.[j.orderId]),
            );
        if (producerPublisher && producer) {
          for (const m of await producer.machines()) {
            const body = JSON.stringify(m),
              key = `producer-machine:${m.machine_id}`;
            if (sent.get(key) !== body) {
              producerPublisher.publish(
                "machine.updated",
                m as unknown as Record<string, unknown>,
              );
              sent.set(key, body);
            }
          }
          for (const t of Object.values(s.producer?.tasks ?? {}))
            if (t.kind === "run_job" && t.job) {
              const body = JSON.stringify(t.job),
                key = `producer-job:${t.id}`;
              if (sent.get(key) !== body) {
                producerPublisher.publish("job.updated", t.job);
                sent.set(key, body);
              }
            }
          await producerPublisher.flush();
        }
        await publisher.flush();
      }
    })().finally(() => {
      reconciling = undefined;
    }));
  const app = createApp(service, undefined, {
    orchestrator,
    testWallet,
    producer,
    background,
    reconcile,
    recommendations: analyze ? { analyze } : undefined,
  });
  return {
    app,
    service,
    orchestrator,
    store,
    reconcile,
    close: async () => {
      stopMirror?.();
      publisher?.close();
      producerPublisher?.close();
      await store.close();
    },
  };
}
