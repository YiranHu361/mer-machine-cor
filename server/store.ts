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
      for (const fn of this.listeners) fn();
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
): Promise<T> {
  for (let retry = 0; retry < 25; retry++) {
    const s = await store.read();
    const result = fn(s.data);
    if (await store.compareAndSet(s.version, s.data)) return result;
  }
  throw new Error(
    "Concurrent state changes exceeded retry limit; retry the request.",
  );
}
