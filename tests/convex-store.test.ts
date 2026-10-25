import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../server/model.ts";
import { mutate } from "../server/store.ts";
import {
  ConvexStore,
  splitChunks,
  type StateClient,
} from "../server/convex-store.ts";

/** convex/state.ts in memory: one versioned document in chunks, compare-and-set. */
class FakeDeployment implements StateClient {
  version = 0;
  chunks: string[] | null = null;
  writes: string[][] = [];
  watchers = new Set<(v: number) => void>();
  live = true;
  async query(name: "version" | "read", args: { secret: string }) {
    assert.equal(args.secret, "hub-secret");
    if (name === "version") return this.version;
    return this.chunks && { version: this.version, chunks: [...this.chunks] };
  }
  async mutation(
    _name: "compareAndSet",
    args: { secret: string; expectedVersion: number; chunks: string[] },
  ) {
    assert.equal(args.secret, "hub-secret");
    if (args.expectedVersion !== this.version) return false;
    this.chunks = args.chunks;
    this.writes.push(args.chunks);
    this.version++;
    for (const fn of this.watchers) fn(this.version);
    return true;
  }
  get watch() {
    if (!this.live) return undefined;
    return (_args: { secret: string }, fn: (v: number) => void) => {
      this.watchers.add(fn);
      fn(this.version);
      return () => this.watchers.delete(fn);
    };
  }
  /** Another writer (a second app instance) commits a change. */
  async external(change: (s: any) => void) {
    const s = JSON.parse(this.chunks!.join(""));
    change(s);
    await this.mutation("compareAndSet", {
      secret: "hub-secret",
      expectedVersion: this.version,
      chunks: [JSON.stringify(s)],
    });
  }
}

test("the Convex store seeds an empty deployment once and reads it back", async () => {
  const d = new FakeDeployment();
  const store = new ConvexStore(d, "hub-secret");
  await store.init(initialState());
  assert.equal(d.version, 1);
  const first = await store.read();
  assert.equal(first.version, 1);
  assert.deepEqual(Object.keys(first.data.machines).sort(), [
    "bambu_01",
    "instax_01",
    "phomemo_01",
  ]);
  // A restart against the same deployment keeps what is there.
  const again = new ConvexStore(d, "hub-secret");
  await again.init(initialState());
  assert.equal(d.version, 1);
  store.close();
  again.close();
});

test("a stale write is refused and mutate retries against the new version", async () => {
  const d = new FakeDeployment();
  const store = new ConvexStore(d, "hub-secret");
  await store.init(initialState());
  const { version, data } = await store.read();
  await d.external((s) => {
    s.machines.bambu_01.reason = "Someone else wrote first";
  });
  data.machines.bambu_01.reason = "Lost update";
  assert.equal(await store.compareAndSet(version, data), false);
  await mutate(store, (s) => {
    s.machines.phomemo_01.mediaRemaining = 42;
  });
  const now = await store.read();
  assert.equal(now.data.machines.bambu_01.reason, "Someone else wrote first");
  assert.equal(now.data.machines.phomemo_01.mediaRemaining, 42);
  store.close();
});

test("large state is written in chunks under the document limit, without splitting a character", async () => {
  const text = "a".repeat(9) + "😀" + "b".repeat(9);
  const chunks = splitChunks(text, 10);
  assert.equal(chunks.join(""), text);
  for (const c of chunks) {
    assert.ok(c.length <= 10);
    const last = c.charCodeAt(c.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), "no lone high surrogate");
  }
  const d = new FakeDeployment();
  const store = new ConvexStore(d, "hub-secret");
  await store.init(initialState());
  await mutate(store, (s) => {
    s.machines.bambu_01.reason = "x".repeat(450_000);
  });
  const last = d.writes.at(-1)!;
  assert.ok(last.length >= 3, `expected several chunks, got ${last.length}`);
  for (const c of last) assert.ok(c.length * 4 < 1024 * 1024);
  assert.equal((await store.read()).data.machines.bambu_01.reason.length, 450_000);
  store.close();
});

test("subscribers hear their own commits and other writers' commits", async () => {
  const d = new FakeDeployment();
  const store = new ConvexStore(d, "hub-secret");
  await store.init(initialState());
  let heard = 0;
  store.subscribe(() => heard++);
  await mutate(store, (s) => {
    s.machines.bambu_01.mediaRemaining = 10;
  });
  assert.equal(heard, 1, "own commit notifies once");
  await d.external((s) => {
    s.machines.bambu_01.mediaRemaining = 9;
  });
  assert.equal(heard, 2, "another writer's commit arrives through the subscription");
  store.close();
});

test("without a live connection the store polls the version", async () => {
  const d = new FakeDeployment();
  d.live = false;
  const store = new ConvexStore(d, "hub-secret", { pollMs: 10 });
  await store.init(initialState());
  let heard = 0;
  store.subscribe(() => heard++);
  await d.external((s) => {
    s.machines.instax_01.mediaRemaining = 3;
  });
  for (let i = 0; i < 50 && !heard; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(heard >= 1);
  store.close();
});

test("the Convex store refuses to start without the hub secret", async () => {
  await assert.rejects(
    ConvexStore.connect("http://127.0.0.1:9", "", initialState()),
    /FABYN_PUBLISH_SECRET/,
  );
});
