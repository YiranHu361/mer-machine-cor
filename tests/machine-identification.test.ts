import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import { Service } from "../server/service.ts";
import { MockPayment } from "../server/payments.ts";
import { HttpNode } from "../server/node-client.ts";
import { createApp } from "../server/app.ts";
import type {
  IdentificationDependencies,
  MachineIdentification,
} from "../server/machine-identification.ts";
import type {
  MachineReading,
  MachineReadingInput,
} from "../integrations/src/claude.ts";

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("label photo fixture"),
]);
const reading = (over: Partial<MachineReading> = {}): MachineReading => ({
  brand: "Phomemo",
  machineModel: "M02 Pro",
  labelText: "Phomemo M02 Pro Mini Printer",
  readable: true,
  reason: "The model is printed on the base label.",
  provider: "claude",
  model: "fixture-model",
  ...over,
});
async function fixture(dependencies: IdentificationDependencies) {
  const dir = mkdtempSync(join(tmpdir(), "fabyn-identify-"));
  const secret = "isolated-identification-secret";
  const service = new Service(
    new SqliteStore(join(dir, "state.sqlite"), initialState()),
    new HttpNode("http://127.0.0.1:9", "unused-node-key", secret),
    new MockPayment(),
    {
      mode: "simulation",
      paymentMode: "mock",
      storeMode: "sqlite-development",
      assetOrigin: "http://127.0.0.1:4318/assets",
      secret,
      quoteMs: 120000,
      pickupMs: 10000,
      ownerCode: "isolated-identification-owner",
      dataDir: dir,
      nodeUrl: "http://127.0.0.1:9",
    },
  );
  const app = createApp(service, undefined, { identification: dependencies });
  const owner = request.agent(app);
  await owner
    .post("/api/session")
    .send({ role: "owner", accessCode: "isolated-identification-owner" })
    .expect(200);
  return { app, owner, service };
}
const identify = async (
  owner: request.Agent,
  description: string,
  photo?: Buffer,
  expected = 200,
) => {
  let call = owner
    .post("/api/owner/machine-identification")
    .field("description", description);
  if (photo)
    call = call.attach("photo", photo, {
      filename: "label.png",
      contentType: "image/png",
    });
  const response = await call.expect(expected);
  return response.body.identification as MachineIdentification;
};

test("typed names are matched by fixed rules without calling Claude", async () => {
  let reads = 0;
  const { owner } = await fixture({
    configured: true,
    read: async () => {
      reads++;
      throw new Error("must not call");
    },
  });
  const supported = await identify(owner, "phomemo m02pro");
  assert.equal(supported.status, "supported");
  assert.equal(supported.model, "phomemo-m02pro");
  assert.equal(supported.provider, "local");
  for (const [text, status, model] of [
    ["Instax mini Link 3", "supported", "instax-mini-link-3"],
    ["Bambu Lab A1 mini", "supported", "bambu-a1-mini"],
    ["Phomemo M02S", "unsupported", undefined],
    ["instax mini link 2", "unsupported", undefined],
    ["Phomemo M02", "unclear", undefined],
    ["Bambu Lab A1", "unclear", undefined],
    ["Cricut Maker 3", "unsupported", undefined],
    ["my sticker printer", "unclear", undefined],
    ["M02 Pro and A1 mini", "unclear", undefined],
  ] as const) {
    const result = await identify(owner, text);
    assert.equal(result.status, status, text);
    assert.equal(result.model, model, text);
  }
  assert.equal(reads, 0);
});

test("only owners identify machines and photos are checked by their bytes", async () => {
  let reads = 0;
  const { app, owner } = await fixture({
    configured: true,
    read: async () => {
      reads++;
      return reading();
    },
  });
  const anonymous = await request(app)
    .post("/api/owner/machine-identification")
    .field("description", "Phomemo M02 Pro");
  assert.ok([401, 403].includes(anonymous.status));
  const requester = request.agent(app);
  await requester.post("/api/session").send({ role: "requester" }).expect(200);
  const refused = await requester
    .post("/api/owner/machine-identification")
    .attach("photo", png, { filename: "label.png", contentType: "image/png" });
  assert.ok([401, 403].includes(refused.status));
  const notImage = await owner
    .post("/api/owner/machine-identification")
    .attach("photo", Buffer.from("not an image"), {
      filename: "label.png",
      contentType: "image/png",
    })
    .expect(422);
  assert.equal(notImage.body.error.code, "PHOTO_TYPE");
  const large = await owner
    .post("/api/owner/machine-identification")
    .attach("photo", Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]), {
      filename: "label.png",
      contentType: "image/png",
    })
    .expect(413);
  assert.equal(large.body.error.code, "PHOTO_TOO_LARGE");
  await owner
    .post("/api/owner/machine-identification")
    .field("description", " ")
    .expect(422);
  await owner
    .post("/api/owner/machine-identification")
    .field("description", "x".repeat(201))
    .expect(422);
  assert.equal(reads, 0);
});

test("Claude reads the photo and fixed code decides what it matches", async () => {
  const inputs: MachineReadingInput[] = [];
  let next: () => Promise<MachineReading> = async () => reading();
  const { owner } = await fixture({
    configured: true,
    read: async (input) => {
      inputs.push(input);
      return next();
    },
  });
  const supported = await identify(owner, "", png);
  assert.deepEqual(
    { ...supported },
    {
      status: "supported",
      model: "phomemo-m02pro",
      modelName: "Phomemo M02Pro",
      seen: "Phomemo M02 Pro",
      source: "photo",
      provider: "claude",
      message:
        "Identified as Phomemo M02Pro from the photo. It's selected below.",
    },
  );
  assert.equal(inputs[0].photo?.mediaType, "image/png");
  assert.ok(png.equals(Buffer.from(inputs[0].photo!.bytes)));
  // Packaging text that lists a supported model cannot stand in for the machine's own model.
  next = async () =>
    reading({
      machineModel: "M02S",
      labelText: "Paper fits M02, M02S, M02 Pro",
    });
  assert.equal((await identify(owner, "", png)).status, "unsupported");
  next = async () =>
    reading({
      brand: null,
      machineModel: null,
      readable: false,
      reason: "The label is blurred.",
    });
  const unreadable = await identify(owner, "", png);
  assert.equal(unreadable.status, "unclear");
  assert.match(unreadable.message, /The label is blurred\./);
  next = async () => {
    throw new Error("CLAUDE_REQUEST_FAILED: HTTP 529");
  };
  const failed = await identify(owner, "", png);
  assert.equal(failed.status, "unclear");
  assert.match(failed.message, /couldn't be read right now/);
  // A failed read never hides what the owner typed.
  const typed = await identify(owner, "Bambu Lab A1 mini", png);
  assert.equal(typed.model, "bambu-a1-mini");
  assert.equal(typed.provider, "local");
});

test("a photo that contradicts the typed model selects nothing", async () => {
  const { owner } = await fixture({
    configured: true,
    read: async () => reading({ machineModel: "M02S" }),
  });
  const conflict = await identify(owner, "Phomemo M02 Pro", png);
  assert.equal(conflict.status, "unclear");
  assert.equal(conflict.model, undefined);
  assert.match(conflict.message, /photo shows Phomemo M02S, but you typed/);
});

test("photos need a configured Claude key while typed names still work", async () => {
  const { owner } = await fixture({
    configured: false,
    read: async () => {
      throw new Error("must not call");
    },
  });
  const blocked = await owner
    .post("/api/owner/machine-identification")
    .attach("photo", png, { filename: "label.png", contentType: "image/png" })
    .expect(409);
  assert.equal(blocked.body.error.code, "VISION_NOT_CONFIGURED");
  assert.equal(
    (await identify(owner, "Instax mini Link 3")).model,
    "instax-mini-link-3",
  );
});
