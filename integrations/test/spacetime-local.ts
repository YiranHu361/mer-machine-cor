import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { connectSpacetimeStore } from '../src/spacetime-store.js';
import { DbConnection } from '../src/module_bindings/index.js';
const configPath=process.env.FABRARY_SPACETIME_CONFIG;
if(!configPath||!existsSync(configPath)){console.log(JSON.stringify({status:'BLOCKED',integration:'SpacetimeDB actual local server',missing:['FABRARY_SPACETIME_CONFIG private JSON path to configured running server']}));process.exit(2);}
const config = JSON.parse(readFileSync(configPath,'utf8'));
const initialState = { machines: [], jobs: [], probe: 0 };
const a = await connectSpacetimeStore<typeof initialState>({ ...config, initialState });
const b = await connectSpacetimeStore<typeof initialState>({ ...config, initialState });
try {
  let updates = 0;
  const unsubscribe = b.subscribe(() => { updates++; });
  const before = await a.read();
  assert.equal(await a.compareAndSet(before.version, { ...before.data, probe: before.data.probe + 1 }), true);
  assert.equal(await b.compareAndSet(before.version, { ...before.data, probe: 999 }), false);
  assert.equal((await b.read()).data.probe, before.data.probe + 1);
  assert.ok(updates > 0);
  unsubscribe();
  console.log(JSON.stringify({status:'PASS', integration:'SpacetimeDB 2.13.0 actual local server', assertions:['persisted JSON state','atomic CAS rejects stale version','cross-client live subscription'],version:(await a.read()).version}));
} finally { await a.close(); await b.close(); }

const anonymous = await new Promise<DbConnection>((resolve,reject)=> {
 const conn = DbConnection.builder().withUri(config.uri).withDatabaseName(config.database)
 .onConnect(c=>{ c.subscriptionBuilder().onApplied(()=>resolve(c)).subscribe(['SELECT * FROM backend_state']); })
 .onConnectError((_ctx,error)=>reject(error)).build();
});
try {
 assert.equal([...anonymous.db.backendState.iter()].length,0);
 await assert.rejects(()=>anonymous.reducers.compareAndSet({expectedVersion:0n,json:'{}',writeId:'unauthorized'}),/FORBIDDEN/);
 console.log(JSON.stringify({status:'PASS',assertions:['anonymous cannot read application state','unauthorized mutation rejected by module']}));
} finally { anonymous.disconnect(); }
