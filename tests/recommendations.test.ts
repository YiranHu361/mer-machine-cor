import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { initialState, now, type Machine } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { SqliteStore, mutate } from "../server/store.ts";
import {
  recommendImages,
  type RecommendationDependencies,
} from "../server/recommendations.ts";

const graphic = execFileSync(resolve("node/.venv/bin/python"), [
  "-c",
  "from PIL import Image,ImageDraw;import sys,io;im=Image.new('RGB',(512,512),'white');d=ImageDraw.Draw(im);d.rectangle((100,100,410,410),outline='black',width=30);d.line((50,256,460,256),fill='black',width=12);b=io.BytesIO();im.save(b,'PNG');sys.stdout.buffer.write(b.getvalue())",
]);
const photo = execFileSync(resolve("node/.venv/bin/python"), [
  "-c",
  "from PIL import Image;import sys,io;im=Image.new('RGB',(512,384));im.putdata([(x%256,y%256,(x+y)%256) for y in range(384) for x in range(512)]);b=io.BytesIO();im.save(b,'PNG');sys.stdout.buffer.write(b.getvalue())",
]);
const local: RecommendationDependencies = { visionConfigured: false };
const graphicAnalysis = async () => ({
  kind: "graphic" as const,
  colorful: false,
  images: [{ width: 512, height: 512 }],
});
const draft = {
  outputType: "sticker" as const,
  widthMm: 53,
  heightMm: 53,
  quantity: 1,
  material: "thermal-paper",
  crop: "contain" as const,
  questions: [],
  contentReview: "clear" as const,
  reason: "Simple dark line artwork on white",
  provider: "claude" as const,
  model: "offline-fixture",
};

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fabrary-recommendations-"));
  const store = new SqliteStore(join(dir, "state.sqlite"), initialState());
  let sideEffects = 0;
  const payment = new MockPayment();
  for (const method of ["collect", "transfer", "reconcile"] as const)
    payment[method] = async () => {
      sideEffects++;
      throw Error("No payment in image recommendations");
    };
  const service = new Service(
    store,
    {
      token() {
        sideEffects++;
        throw Error("No device authorization in image recommendations");
      },
      async call() {
        sideEffects++;
        throw Error("No device operation in image recommendations");
      },
    },
    payment,
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret: "private-offline-recommendations",
      quoteMs: 120000,
      pickupMs: 60000,
      ownerCode: "offline-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:1",
    },
  );
  for (const [name, bytes, width, height] of [
    ["graphic", graphic, 512, 512],
    ["photo", photo, 512, 384],
  ] as const) {
    const path = join(dir, name + ".png");
    writeFileSync(path, bytes);
    await mutate(store, (s) => {
      s.assets[name] = {
        id: name,
        ownerId: "requester",
        path,
        url: "/assets/" + name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mime: "image/png",
        width,
        height,
        createdAt: now(),
      };
    });
  }
  await mutate(store, (s) => {
    for (const m of Object.values(s.machines))
      Object.assign(m, {
        calibrated: true,
        listed: true,
        ready: true,
        paused: false,
      });
  });
  return {
    dir,
    store,
    service,
    sideEffects: () => sideEffects,
    files: () => readdirSync(dir).sort(),
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("pictures alone use actual local analysis to choose a current graphic or photo machine without writes", async () => {
  const f = await fixture();
  try {
    const before = await f.store.read(),
      files = f.files();
    for (const [assetId, type, machine] of [
      ["graphic", "sticker", "phomemo_01"],
      ["photo", "instax", "instax_01"],
    ] as const) {
      const result = await recommendImages(
        f.service,
        "requester",
        { assetIds: [assetId] },
        local,
      );
      assert.equal(result.status, "recommended");
      assert.equal(result.provider, "local_analysis");
      assert.equal(result.spec!.outputType, type);
      assert.equal(result.spec!.recommendedMachineId, machine);
      assert.equal(result.machine!.id, machine);
      assert.deepEqual(result.spec!.assetIds, [assetId]);
      assert.equal(result.spec!.quantity, 1);
      assert.equal(result.spec!.permission, "unclear");
      assert.equal(result.spec!.crop, "contain");
      assert.match(result.notice!, /not semantic|tonal|color/i);
      assert.match(result.notice!, /simulation/i);
      for (const field of ["ownerId", "ownerAddress", "nodeUrl", "path"])
        assert.equal(field in result.machine!, false);
    }
    assert.deepEqual(await f.store.read(), before);
    assert.deepEqual(f.files(), files);
    assert.equal(f.sideEffects(), 0);
  } finally {
    f.close();
  }
});

test("a suitable unavailable photo machine never silently falls back to a ready monochrome device", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.machines.instax_01.paused = true;
    });
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["photo"] },
      local,
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.machine, null);
    assert.equal(result.spec!.outputType, "instax");
    assert.match(result.reason, /monochrome print was not substituted/);
    assert.equal(result.spec!.recommendedMachineId, undefined);
  } finally {
    f.close();
  }
});

test("saved lifecycle, mode, hours, stock, policy and reservations all constrain recommendations", async () => {
  const changes: Array<(machine: Machine) => void> = [
    (m) => {
      m.calibrated = false;
    },
    (m) => {
      m.paired = false;
    },
    (m) => {
      m.configured = false;
    },
    (m) => {
      m.listed = false;
    },
    (m) => {
      m.ready = false;
    },
    (m) => {
      m.paused = true;
    },
    (m) => {
      m.mode = "hardware";
    },
    (m) => {
      m.mediaRemaining = 0;
    },
    (m) => {
      m.policy.authorizedArtwork = false;
    },
    (m) => {
      m.policy.maxQuantity = 0;
    },
    (m) => {
      m.policyReconciliationRequired = true;
    },
    (m) => {
      m.activeJobId = "other-attempt";
    },
    (m) => {
      m.reservation = {
        jobId: "other-order",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    },
    (m) => {
      const h = new Date().getUTCHours();
      m.hours = { start: (h + 1) % 24, end: (h + 1) % 24 };
    },
    (m) => {
      m.material = "different-media";
    },
  ];
  for (const change of changes) {
    const f = await fixture();
    try {
      await mutate(f.store, (s) => change(s.machines.phomemo_01));
      const before = await f.store.read();
      const result = await recommendImages(
        f.service,
        "requester",
        { assetIds: ["graphic"] },
        { ...local, analyze: graphicAnalysis },
      );
      assert.equal(result.status, "unavailable");
      assert.equal(result.machine, null);
      assert.deepEqual(await f.store.read(), before);
    } finally {
      f.close();
    }
  }
});

test("expired reservations are read as expired without deleting them or creating a new reservation", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.reservation = {
        jobId: "expired",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
    });
    const before = await f.store.read();
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      { ...local, analyze: graphicAnalysis },
    );
    assert.equal(result.status, "recommended");
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});

test("a short optional note remains supported while the saved production intent stays valid", async () => {
  const f = await fixture();
  try {
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"], intent: "猫" },
      { ...local, analyze: graphicAnalysis },
    );
    assert.equal(result.status, "recommended");
    assert.equal(result.spec!.intent, "Print: 猫");
  } finally {
    f.close();
  }
});

test("malformed or injected vision output never selects a fabricated machine or authorizes rights/3D", async () => {
  const f = await fixture();
  try {
    const malformed = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async () => ({ machineId: "__proto__" }) as any,
        analyze: graphicAnalysis,
      },
    );
    assert.equal(malformed.provider, "local_analysis");
    assert.equal(malformed.machine!.id, "phomemo_01");
    assert.match(malformed.notice!, /unavailable/);
    const injected = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async () =>
          ({
            ...draft,
            machineId: "invented",
            widthMm: 999,
            heightMm: 999,
            quantity: 99,
            material: "unsafe",
            permission: "authorized",
          }) as any,
      },
    );
    assert.equal(injected.provider, "claude");
    assert.equal(injected.machine!.id, "phomemo_01");
    // The invented size falls back to the M02 Pro's printable width, not the roll.
    assert.equal(injected.spec!.widthMm, 48);
    assert.equal(injected.spec!.heightMm, 48);
    assert.equal(injected.spec!.quantity, 1);
    assert.equal(injected.spec!.material, "thermal-paper");
    assert.equal(injected.spec!.permission, "unclear");
    const threeD = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async () => ({ ...draft, outputType: "3d" }),
      },
    );
    assert.equal(threeD.status, "needs_clarification");
    assert.equal(threeD.spec, null);
    assert.equal(threeD.machine, null);
    const requested = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"], intent: "Make a 3D sculpture" },
      local,
    );
    assert.equal(requested.status, "needs_clarification");
    assert.equal(requested.spec, null);
    assert.equal(f.sideEffects(), 0);
  } finally {
    f.close();
  }
});

test("vision receives only sanitized current database capabilities and its generated machine ID is ignored", async () => {
  const f = await fixture();
  try {
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.nodeUrl = "http://private.invalid";
      s.machines.phomemo_01.ownerAddress = "private";
    });
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async (input) => {
          const text = JSON.stringify(input.capabilities);
          assert.equal(text.includes("private"), false);
          assert(input.capabilities.some((m) => m.id === "phomemo_01"));
          assert.equal(input.images.length, 1);
          assert.equal(input.intent, undefined);
          return draft;
        },
      },
    );
    assert.equal(result.status, "recommended");
    assert.equal(result.machine!.id, "phomemo_01");
  } finally {
    f.close();
  }
});

test("vision content uncertainty cannot be cleared by rights confirmation or local pixel fallback", async () => {
  const f = await fixture();
  try {
    let localCalls = 0;
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async () => ({
          ...draft,
          contentReview: "review",
          questions: [],
        }),
        analyze: async () => {
          localCalls++;
          return graphicAnalysis();
        },
      },
    );
    assert.equal(result.status, "needs_clarification");
    assert.equal(result.spec, null);
    assert.equal(result.machine, null);
    assert.equal(result.provider, "claude");
    assert.equal(localCalls, 0);
    assert.match(result.questions[0], /owner review/);
    const unsupported = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        visionConfigured: true,
        vision: async () => {
          throw Error("CLAUDE_UNSUPPORTED_RECOMMENDATION");
        },
        analyze: async () => {
          localCalls++;
          return graphicAnalysis();
        },
      },
    );
    assert.equal(unsupported.status, "needs_clarification");
    assert.equal(unsupported.spec, null);
    assert.equal(localCalls, 0);
  } finally {
    f.close();
  }
});

test("availability and artwork ownership are reread after asynchronous analysis", async () => {
  const f = await fixture();
  try {
    const result = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      {
        ...local,
        analyze: async () => {
          await mutate(f.store, (s) => {
            s.machines.phomemo_01.paused = true;
          });
          return graphicAnalysis();
        },
      },
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.machine, null);
    await assert.rejects(
      recommendImages(
        f.service,
        "requester",
        { assetIds: ["graphic"] },
        {
          ...local,
          analyze: async () => {
            await mutate(f.store, (s) => {
              s.assets.graphic.ownerId = "other";
            });
            return graphicAnalysis();
          },
        },
      ),
      { code: "ASSET_ACCESS" },
    );
  } finally {
    f.close();
  }
});

test("an ambiguous local result can be clarified by one explicit format choice without semantic or color claims", async () => {
  const f = await fixture();
  try {
    const deps = {
      ...local,
      analyze: async () => ({
        kind: "ambiguous" as const,
        colorful: true,
        images: [{ width: 512, height: 512 }],
      }),
    };
    const first = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      deps,
    );
    assert.equal(first.status, "needs_clarification");
    assert.match(first.questions[0], /black-and-white sticker/);
    for (const [intent, output] of [
      ["black-and-white sticker", "sticker"],
      ["color photo", "instax"],
    ] as const) {
      const next = await recommendImages(
        f.service,
        "requester",
        { assetIds: ["graphic"], intent },
        deps,
      );
      assert.equal(next.status, "recommended");
      assert.equal(next.spec!.outputType, output);
      assert.equal(next.spec!.permission, "unclear");
      assert.match(next.reason, /You chose/);
      if (output === "sticker")
        assert.match(
          next.notice!,
          /color and continuous tones will be converted/,
        );
    }
    for (const intent of [
      "black-and-white sticker and color photo",
      "color sticker",
      "a sticker",
      "make a 3D model",
    ]) {
      const next = await recommendImages(
        f.service,
        "requester",
        { assetIds: ["graphic"], intent },
        deps,
      );
      assert.equal(next.status, "needs_clarification");
      assert.equal(next.spec, null);
      assert.equal(next.machine, null);
    }
  } finally {
    f.close();
  }
});

test("recommendation API validates requester ownership, image-only inputs and malformed bodies before analysis", async () => {
  const f = await fixture();
  try {
    let analyzed = 0;
    const app = createApp(f.service, undefined, {
      recommendations: {
        ...local,
        analyze: async () => {
          analyzed++;
          return graphicAnalysis();
        },
      },
    });
    await request(app)
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(401);
    const owner = request.agent(app);
    await owner
      .post("/api/session")
      .send({ role: "owner", accessCode: "offline-owner" })
      .expect(200);
    await owner
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(403);
    const client = request.agent(app);
    const login = await client
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    await client
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(403);
    await mutate(f.store, (s) => {
      s.assets.graphic.ownerId = login.body.id;
    });
    const before = await f.store.read();
    for (const body of [
      {},
      { assetIds: [] },
      { assetIds: ["graphic", "graphic"] },
      { assetIds: ["__proto__"] },
      { assetIds: ["graphic"], note: "not supported" },
      { assetIds: ["graphic"], intent: 3 },
      { assetIds: ["graphic"], intent: "a".repeat(2001) },
    ]) {
      const response = await client.post("/api/recommendations").send(body);
      assert([403, 422].includes(response.status));
    }
    assert.equal(analyzed, 0);
    assert.deepEqual(await f.store.read(), before);
    const result = await client
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(200);
    assert.equal(result.body.spec.recommendedMachineId, "phomemo_01");
    assert.equal(analyzed, 1);
    assert.deepEqual(await f.store.read(), before);
  } finally {
    f.close();
  }
});

test("recommended device identity survives actual create/approval and quote never silently substitutes a cheaper machine", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service, undefined, {
        recommendations: { ...local, analyze: graphicAnalysis },
      }),
      client = request.agent(app);
    const login = await client
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    await mutate(f.store, (s) => {
      s.assets.graphic.ownerId = login.body.id;
    });
    const recommendation = await client
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(200);
    const input = { ...recommendation.body.spec, permission: "authorized" };
    const creation = await client
      .post("/api/jobs")
      .set("Idempotency-Key", "recommended-image-create")
      .send(input)
      .expect(201);
    const j = creation.body.job;
    assert.equal(j.spec.recommendedMachineId, "phomemo_01");
    await f.service.approve(j.id, {
      specVersion: j.specVersion,
      artifactSha256: j.artifact.sha256,
    });
    await mutate(f.store, (s) => {
      s.machines.cheaper = {
        ...structuredClone(s.machines.phomemo_01),
        id: "cheaper",
        priceCard: { consumables: 0, machine: 0, handling: 0, platform: 0 },
      };
    });
    const quoted = await f.service.quote(j.id);
    assert.equal(quoted.machineId, "phomemo_01");
    await mutate(f.store, (s) => {
      s.machines.phomemo_01.paused = true;
    });
    const before = await f.store.read();
    await assert.rejects(f.service.quote(j.id), {
      code: "RECOMMENDED_MACHINE_UNAVAILABLE",
    });
    assert.deepEqual(await f.store.read(), before);
    assert.equal(f.sideEffects(), 0);
    const changed = { ...input, recommendedMachineId: "cheaper" };
    await client
      .post("/api/jobs")
      .set("Idempotency-Key", "recommended-image-create")
      .send(changed)
      .expect(409);
  } finally {
    f.close();
  }
});

test("with real machines allowed, the picture page recommends the real printer at its own width and its order runs in hardware mode", async () => {
  const f = await fixture();
  try {
    // As npm run mvp sets it up: real machines only, the sticker printer on the hub.
    f.service.config.allowedModes = ["hardware"];
    await mutate(f.store, (s) => {
      Object.assign(s.machines.phomemo_01, {
        mode: "hardware",
        producerHub: { machineId: "m_sticker_01", since: now() },
      });
      // A cheaper simulated sticker machine must not win once both modes are allowed.
      s.machines.cheaper = {
        ...structuredClone(s.machines.phomemo_01),
        id: "cheaper",
        mode: "simulation",
        priceCard: { consumables: 0, machine: 0, handling: 0, platform: 0 },
      };
      delete s.machines.cheaper.producerHub;
    });
    const sticker = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["graphic"] },
      { ...local, analyze: graphicAnalysis },
    );
    assert.equal(sticker.status, "recommended");
    assert.equal(sticker.spec!.recommendedMachineId, "phomemo_01");
    assert.equal(sticker.spec!.widthMm, 48, "the M02 Pro prints 48 mm");
    assert.doesNotMatch(sticker.notice!, /simulation/);
    // The simulated photo printer is not offered when only real machines are allowed.
    const photoPrint = await recommendImages(
      f.service,
      "requester",
      { assetIds: ["photo"] },
      local,
    );
    assert.equal(photoPrint.status, "unavailable");

    f.service.config.allowedModes = ["hardware", "simulation"];
    const app = createApp(f.service, undefined, {
        recommendations: { ...local, analyze: graphicAnalysis },
      }),
      client = request.agent(app);
    const login = await client
      .post("/api/session")
      .send({ role: "requester" })
      .expect(200);
    await mutate(f.store, (s) => {
      s.assets.graphic.ownerId = login.body.id;
    });
    const recommendation = await client
      .post("/api/recommendations")
      .send({ assetIds: ["graphic"] })
      .expect(200);
    assert.equal(
      recommendation.body.spec.recommendedMachineId,
      "phomemo_01",
      "real first, even when a simulated machine is cheaper",
    );
    const creation = await client
      .post("/api/jobs")
      .set("Idempotency-Key", "real-printer-create")
      .send({ ...recommendation.body.spec, permission: "authorized" })
      .expect(201);
    const j = creation.body.job;
    assert.equal((await f.service.job(j.id)).executionMode, "hardware");
    await f.service.approve(j.id, {
      specVersion: j.specVersion,
      artifactSha256: j.artifact.sha256,
    });
    const quoted = await f.service.quote(j.id);
    assert.equal(quoted.machineId, "phomemo_01");
    assert.equal(f.sideEffects(), 0, "nothing was paid for or printed");
  } finally {
    f.close();
  }
});
