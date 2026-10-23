import { schema, table, t, SenderError } from 'spacetimedb/server';

const config = table({ public: false }, { id: t.u32().primaryKey(), owner: t.identity() });
const appState = table({ public: false }, {
  id: t.u32().primaryKey(), version: t.u64(), json: t.string(), lastWrite: t.string(),
});
const db = schema({ config, appState });
export default db;

export const init = db.init(ctx => {
  ctx.db.config.insert({ id: 1, owner: ctx.sender });
});

// Only the identity that published this database may see the full application state.
// Browser and agent clients go through the application authorization boundary.
export const backendState = db.view({ public: true }, t.array(appState.rowType), ctx => {
  const owner = ctx.db.config.id.find(1)?.owner;
  return owner?.isEqual(ctx.sender) ? [...ctx.db.appState.iter()] : [];
});

export const compareAndSet = db.reducer({
  expectedVersion: t.u64(), json: t.string(), writeId: t.string(),
}, (ctx, { expectedVersion, json, writeId }) => {
  if (!ctx.db.config.id.find(1)?.owner.isEqual(ctx.sender)) throw new SenderError('FORBIDDEN');
  if (json.length > 8 * 1024 * 1024) throw new SenderError('STATE_TOO_LARGE');
  try { JSON.parse(json); } catch { throw new SenderError('INVALID_JSON'); }
  const current = ctx.db.appState.id.find(1);
  if ((current?.version ?? 0n) !== expectedVersion) throw new SenderError('CONFLICT');
  const next = { id: 1, version: expectedVersion + 1n, json, lastWrite: writeId };
  if (current) ctx.db.appState.id.update(next); else ctx.db.appState.insert(next);
});
