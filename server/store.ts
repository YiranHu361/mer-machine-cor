import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { State } from "./model.ts";
export interface Store {
  read(): Promise<{ version: number; data: State }>;
  compareAndSet(version: number, data: State): Promise<boolean>;
  subscribe(fn: () => void): () => void;
  close(): void | Promise<void>;
}
export class SqliteStore implements Store {
  db: DatabaseSync;
  listeners = new Set<() => void>();
  constructor(path: string, initial: State) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, data TEXT NOT NULL);",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO app_state VALUES (1,0,?)")
      .run(JSON.stringify(initial));
  }
  async read() {
    const r = this.db
      .prepare("SELECT version,data FROM app_state WHERE id=1")
      .get() as any;
    return { version: Number(r.version), data: JSON.parse(r.data) as State };
  }
  async compareAndSet(version: number, data: State) {
    const r = this.db
      .prepare(
        "UPDATE app_state SET version=version+1,data=? WHERE id=1 AND version=?",
      )
      .run(JSON.stringify(data), version);
    if (r.changes) {
      // Notifications cannot turn a committed write into an apparent failure.
      // One disconnected consumer must not suppress the remaining consumers.
      for (const fn of [...this.listeners]) {
        try {
          fn();
        } catch {}
      }
      return true;
    }
    return false;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  close() {
    this.db.close();
  }
}
export async function mutate<T>(
  store: Store,
  fn: (state: State) => T,
  options: { onNotCommitted?: () => void | Promise<void> } = {},
): Promise<T> {
  let commitOutcomeUncertain = false;
  try {
    for (let retry = 0; retry < 25; retry++) {
      const s = await store.read();
      const result = fn(s.data);
      let committed;
      try {
        committed = await store.compareAndSet(s.version, s.data);
      } catch (error) {
        // A remote reducer can commit after its response is lost. Neither a
        // thrown write nor a subsequent stale read proves it safe to clean up.
        commitOutcomeUncertain = true;
        throw error;
      }
      if (committed) return result;
    }
    throw new Error(
      "Concurrent state changes exceeded retry limit; retry the request.",
    );
  } catch (error) {
    if (!commitOutcomeUncertain) {
      try {
        await options.onNotCommitted?.();
      } catch {
        // Cleanup is best effort and must preserve the original failure.
      }
    }
    throw error;
  }
}
