import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { State } from "./model.ts";
import type { Store } from "./store.ts";

/**
 * The app's authoritative state in Convex (FABYN_STORE=convex), through
 * convex/state.ts. The JSON is split into chunks below the 1 MiB document
 * limit and written with one compare-and-set mutation. Changes made by any
 * writer reach subscribe() through a Convex subscription on the version, or by
 * polling when the websocket cannot connect.
 */
export interface StateClient {
  query(name: "version" | "read", args: { secret: string }): Promise<any>;
  mutation(
    name: "compareAndSet",
    args: { secret: string; expectedVersion: number; chunks: string[] },
  ): Promise<boolean>;
  /** Live version updates; absent or throwing means poll instead. */
  watch?(
    args: { secret: string },
    onVersion: (version: number) => void,
  ): () => void;
  close?(): void | Promise<void>;
}

// Characters per chunk: even at 4 bytes per character this stays under 1 MiB.
const CHUNK = 200_000;

export function splitChunks(json: string, size = CHUNK) {
  const chunks: string[] = [];
  for (let i = 0; i < json.length; ) {
    let end = Math.min(i + size, json.length);
    // Never split a surrogate pair: Convex strings must stay valid Unicode.
    const code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xd800 && code <= 0xdbff) end--;
    chunks.push(json.slice(i, end));
    i = end;
  }
  return chunks.length ? chunks : [""];
}

export class ConvexStore implements Store {
  private listeners = new Set<() => void>();
  private stopWatch: (() => void) | undefined;
  private poll: NodeJS.Timeout | undefined;
  private lastVersion = -1;
  constructor(
    private readonly client: StateClient,
    private readonly secret: string,
    private readonly options: { pollMs?: number } = {},
  ) {}

  /** Connects, seeds an empty deployment with the initial state, and starts watching. */
  static async connect(
    url: string,
    secret: string,
    initial: State,
    options: { pollMs?: number } = {},
  ) {
    if (!secret)
      throw new Error(
        "FABYN_PUBLISH_SECRET is required for the Convex store; it guards the state.",
      );
    const http = new ConvexHttpClient(url);
    let live: ConvexClient | undefined;
    const client: StateClient = {
      query: (name, args) => http.query(anyApi.state[name], args),
      mutation: (name, args) => http.mutation(anyApi.state[name], args),
      watch: (args, onVersion) => {
        live ??= new ConvexClient(url);
        return live.onUpdate(anyApi.state.version, args, (v: number) =>
          onVersion(v),
        );
      },
      close: () => live?.close(),
    };
    const store = new ConvexStore(client, secret, options);
    await store.init(initial);
    return store;
  }

  async init(initial: State) {
    const first = await this.read(initial);
    if (first.version === 0) await this.compareAndSet(0, initial);
    this.startWatching();
  }

  async read(initial?: State) {
    const r = await this.client.query("read", { secret: this.secret });
    if (!r) {
      if (initial) return { version: 0, data: structuredClone(initial) };
      throw new Error("CONVEX_STATE_EMPTY: the Convex store was never seeded.");
    }
    return {
      version: Number(r.version),
      data: JSON.parse((r.chunks as string[]).join("")) as State,
    };
  }

  async compareAndSet(version: number, data: State) {
    const ok = await this.client.mutation("compareAndSet", {
      secret: this.secret,
      expectedVersion: version,
      chunks: splitChunks(JSON.stringify(data)),
    });
    // Our own commit notifies at once; the subscription catches everyone else's.
    if (ok) this.changed(version + 1);
    return ok;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  close() {
    this.stopWatch?.();
    if (this.poll) clearInterval(this.poll);
    this.listeners.clear();
    return this.client.close?.();
  }

  private changed(version: number) {
    if (version === this.lastVersion) return;
    this.lastVersion = version;
    // One disconnected consumer must not suppress the remaining consumers.
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {}
    }
  }

  private startWatching() {
    try {
      if (this.client.watch) {
        this.stopWatch = this.client.watch({ secret: this.secret }, (v) =>
          this.changed(v),
        );
        return;
      }
    } catch {}
    this.poll = setInterval(
      () =>
        void this.client
          .query("version", { secret: this.secret })
          .then((v) => this.changed(Number(v)))
          .catch(() => {}),
      this.options.pollMs ?? 1000,
    );
    this.poll.unref();
  }
}
