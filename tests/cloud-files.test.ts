import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStore, mutate } from "../server/store.ts";
import { initialState } from "../server/model.ts";
import {
  CloudFileStore,
  ConvexFiles,
  digest,
  type FileStorage,
} from "../server/cloud-files.ts";
import fileHttp from "../convex/http.ts";

test("artwork survives a different cloud instance and missing or corrupt cache bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fabyn-cloud-files-"));
  const objects = new Map<string, Buffer>();
  const files: FileStorage = {
    async upload(bytes) {
      const id = digest(bytes);
      objects.set(id, bytes);
      return id;
    },
    async download(id) {
      return objects.get(id)!;
    },
    async url() {
      return "unused";
    },
    async uploadUrl() {
      return "unused";
    },
  };
  const source = new SqliteStore(
    join(directory, "state.sqlite"),
    initialState(),
  );
  const first = new CloudFileStore(
    source,
    files,
    join(directory, "instance-a"),
  );
  try {
    const bytes = Buffer.from("private artwork"),
      path = join(directory, "original");
    await writeFile(path, bytes);
    await mutate(first, (s) => {
      s.assets.artwork = {
        id: "artwork",
        ownerId: "alice",
        path,
        url: "/assets/artwork",
        sha256: digest(bytes),
        mime: "image/png",
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      };
    });
    assert.equal(objects.size, 1);
    await rm(path);
    const second = new CloudFileStore(
      source,
      files,
      join(directory, "instance-b"),
    );
    const saved = (await second.read()).data.assets.artwork;
    assert.deepEqual(await readFile(saved.path), bytes);
    await writeFile(saved.path, "corrupted");
    assert.deepEqual(
      await readFile((await second.read()).data.assets.artwork.path),
      bytes,
    );
    objects.set(saved.storageId!, Buffer.from("corrupt remote object"));
    await rm(saved.path);
    await assert.rejects(second.read(), /checksum mismatch/);
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("private file links expire and reject changes to the file or content type", async () => {
  const previous = process.env.FABYN_PUBLISH_SECRET;
  process.env.FABYN_PUBLISH_SECRET = "test-file-signing-secret";
  const files = new ConvexFiles(
    "https://sample.convex.cloud",
    process.env.FABYN_PUBLISH_SECRET,
  );
  const action = (fileHttp.getRoutes()[0][2] as any)._handler;
  const context = {
    storage: {
      async get(id: string) {
        return id === "storage1" ? new Blob(["large artwork"]) : null;
      },
    },
  };
  try {
    const url = files.signedUrl("storage1", "image/png");
    assert.equal(new URL(url).origin, "https://sample.convex.site");
    const valid = await action(context, new Request(url));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("content-type"), "image/png");
    assert.equal(await valid.text(), "large artwork");
    for (const [key, value] of [
      ["mime", "text/html"],
      ["expires", "1"],
      ["id", "other-file"],
    ]) {
      const tampered = new URL(url);
      tampered.searchParams.set(key, value);
      assert.equal((await action(context, new Request(tampered))).status, 401);
    }
  } finally {
    if (previous === undefined) delete process.env.FABYN_PUBLISH_SECRET;
    else process.env.FABYN_PUBLISH_SECRET = previous;
  }
});
