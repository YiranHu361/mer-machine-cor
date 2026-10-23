import { randomUUID } from 'node:crypto';
import { DbConnection } from './module_bindings/index.js';

export interface StoreSnapshot<T> { version: number; data: T }
export interface AuthoritativeStore<T> {
  read(): Promise<StoreSnapshot<T>>;
  compareAndSet(expectedVersion: number, data: T): Promise<boolean>;
  subscribe(callback: (snapshot: StoreSnapshot<T>) => void): () => void;
  close(): Promise<void>;
}
export interface SpacetimeStoreOptions<T> {
  uri: string; database: string; token: string; initialState: T; timeoutMs?: number;
}

export async function connectSpacetimeStore<T>(options: SpacetimeStoreOptions<T>): Promise<AuthoritativeStore<T>> {
  if (!options.token) throw new Error('SPACETIME_TOKEN_REQUIRED: use the publishing identity token, never a browser token');
  const timeoutMs = options.timeoutMs ?? 15_000;
  let connected = false;
  let closed = false;
  const listeners = new Set<(snapshot: StoreSnapshot<T>) => void>();
  let connection!: DbConnection;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { connection?.disconnect(); reject(new Error('SPACETIME_CONNECT_TIMEOUT')); }, timeoutMs);
    connection = DbConnection.builder().withUri(options.uri).withDatabaseName(options.database)
      .withToken(options.token)
      .onConnect(conn => {
        connected = true;
        conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(); })
          .onError(ctx => { clearTimeout(timer); reject(new Error(`SPACETIME_SUBSCRIPTION: ${ctx.event}`)); })
          .subscribe(['SELECT * FROM backend_state']);
      })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(new Error(`SPACETIME_CONNECT: ${error}`)); })
      .onDisconnect(() => { connected = false; })
      .build();
  });
  const read = async (): Promise<StoreSnapshot<T>> => {
    if (closed || !connected) throw new Error('SPACETIME_UNAVAILABLE: authoritative store disconnected');
    const row = [...connection.db.backendState.iter()][0];
    if (!row) return { version: 0, data: structuredClone(options.initialState) };
    if (row.version > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('SPACETIME_VERSION_OVERFLOW');
    return { version: Number(row.version), data: JSON.parse(row.json) as T };
  };
  const notify = () => { void read().then(snapshot => { for (const fn of listeners) { try { fn(structuredClone(snapshot)); } catch { /* A UI subscriber cannot break state commits. */ } } }).catch(() => { /* Disconnection is surfaced by read/CAS. */ }); };
  connection.db.backendState.onInsert(notify);
  connection.db.backendState.onDelete(notify);
  connection.db.backendState.onUpdate(notify);
  const store: AuthoritativeStore<T> = {
    read,
    async compareAndSet(expectedVersion, data) {
      if (closed || !connected) throw new Error('SPACETIME_UNAVAILABLE: authoritative store disconnected');
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('INVALID_STATE_VERSION');
      const writeId = randomUUID();
      try {
        await connection.reducers.compareAndSet({ expectedVersion: BigInt(expectedVersion), json: JSON.stringify(data), writeId });
        return true;
      } catch (error) {
        if (String(error).includes('CONFLICT')) return false;
        throw error;
      }
    },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async close() { closed = true; connected = false; listeners.clear(); connection.disconnect(); },
  };
  // Initialization also proves that the configured identity has write authority. An
  // unauthorized reader sees no rows, but its reducer call fails instead of silently
  // creating a separate development store.
  const first = await read();
  if (first.version === 0) await store.compareAndSet(0, options.initialState);
  return store;
}
