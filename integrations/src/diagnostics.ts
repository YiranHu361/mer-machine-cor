export function integrationDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const missing = (keys:string[])=>keys.filter(key=>!env[key]);
  const spacetime = missing(['FABYN_SPACETIME_URI','FABYN_SPACETIME_DATABASE','FABYN_SPACETIME_TOKEN']);
  const collection = missing(['FABYN_TREASURY_ADDRESS','FABYN_BASE_SEPOLIA_RPC','FABYN_PUBLIC_ORIGIN']);
  const transfer = missing(['FABYN_TREASURY_PRIVATE_KEY','FABYN_OWNER_WALLET']);
  const fetch = missing(['FABYN_API_ORIGIN','FABYN_AGENT_SESSION_COOKIE','FABYN_AGENT_ALLOWED_SENDERS','FABYN_AGENT_SEED','ASI1_API_KEY']);
  return {
    claude:{status:env.ANTHROPIC_API_KEY?'CONFIGURED_NOT_PROVEN':'BLOCKED',missing:env.ANTHROPIC_API_KEY?[]:['ANTHROPIC_API_KEY'],model:env.FABYN_CLAUDE_MODEL??'claude-sonnet-5-5',notes:'Image intake suggestions; code gates approval and machine completion. No live API result without key.'},
    spacetime:{status:spacetime.length?'BLOCKED':'CONFIGURED_NOT_PROVEN',missing:spacetime,version:'2.13.0',notes:'Backend uses the publishing identity. Actual server reachability/CAS/subscriptions require test.'},
    x402:{status:collection.length?'BLOCKED':'CONFIGURED_NOT_PROVEN',missing:collection,network:'eip155:84532',asset:'USDC',transferPrerequisites:transfer,notes:'Collection uses facilitator verify AND settlement AND matching confirmed token transfer. Release/refund require treasury test ETH and USDC plus configured recipient addresses.'},
    fetch:{status:fetch.length?'BLOCKED':'CONFIGURED_NOT_PROVEN',missing:fetch,notes:'Local FastMCP tests do not prove Agentverse registration, ASI:One discovery or a remote invocation.'},
  };
}
if (process.argv[1]?.endsWith('diagnostics.ts')) console.log(JSON.stringify(integrationDiagnostics(),null,2));
