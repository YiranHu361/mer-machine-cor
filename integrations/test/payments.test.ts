import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex, verifyTypedData } from 'viem';
import { BaseSepoliaPaymentAdapter, MockPaymentAdapter, BASE_SEPOLIA_USDC, decodeX402PaymentSignature, x402PaymentResponseHeader, type PaymentOperation, type PaymentReceipt } from '../src/payments.js';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
const treasury='0x0000000000000000000000000000000000000011';
const payer='0x0000000000000000000000000000000000000022';
const owner='0x0000000000000000000000000000000000000033';
const hash='0x'+'12'.repeat(32);
const abi=parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const recoveryAbi=parseAbi(['event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)','event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)']);
const nonce='0x'+'ab'.repeat(32);
function op(): PaymentOperation { return {jobId:'job-1',operationId:'collect-1',quote:{id:'quote-1',totalCents:25,ownerCents:20,platformCents:5,expiresAt:new Date(Date.now()+60_000).toISOString()}}; }
function log(from:Hex=payer,to:Hex=treasury,value=250000n) { return {address:BASE_SEPOLIA_USDC,topics:encodeEventTopics({abi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])}; }
function authorizationLog(eventName:'AuthorizationUsed'|'AuthorizationCanceled'='AuthorizationUsed',authorizer:Hex=payer,authorizationNonce:Hex=nonce as Hex) {
 return {address:BASE_SEPOLIA_USDC,topics:encodeEventTopics({abi:recoveryAbi,eventName,args:{authorizer,nonce:authorizationNonce}}),data:'0x',transactionHash:hash,blockNumber:5n};
}
function unknownReceipt():PaymentReceipt {
 return {mode:'testnet',kind:'collection',status:'pending',reference:`x402:84532:${payer}:${nonce}`,payer,payee:treasury,amountCents:25,authorization:{nonce,validBefore:String(Math.floor(Date.now()/1000)+60),fromBlock:'4'}};
}
function setup(overrides:any={}) {
  let settlements=0;
  const rpc={getChainId:async()=>84532,getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log()]}),getBlockNumber:async()=>6n,getBlock:async({blockNumber}:any)=>({number:blockNumber,timestamp:BigInt(Math.floor(Date.now()/1000))}),readContract:async()=>false,getLogs:async()=>[],...overrides.rpc};
  const facilitator={verify:async()=>({isValid:true}),settle:async()=>{settlements++;return {success:true,transaction:hash,network:'eip155:84532'};},getSupported:async()=>({kinds:[]}),...overrides.facilitator};
  const adapter=new BaseSepoliaPaymentAdapter({treasuryAddress:treasury,rpcUrl:'http://127.0.0.1:9999',resourceOrigin:'http://127.0.0.1:8787',publicClient:rpc,facilitator,...overrides.options});
  return {adapter,settlements:()=>settlements};
}
async function payload(adapter:BaseSepoliaPaymentAdapter, operation:PaymentOperation) {
 const c=await adapter.challenge(operation);
 operation.payload={x402Version:2,resource:c.body.resource,accepted:c.body.accepts[0],payload:{signature:'0xtest-facilitator-only',authorization:{from:payer,to:treasury,value:'250000',validAfter:'0',validBefore:String(Math.min(Math.floor(Date.parse(operation.quote.expiresAt)/1000),Math.floor(Date.now()/1000)+c.body.accepts[0].maxTimeoutSeconds)),nonce:'0x'+'ab'.repeat(32)}}};
 return operation;
}
test('mock receipts are explicitly labeled and deterministic',async()=>{
 const adapter=new MockPaymentAdapter();const a=await adapter.collect(op());assert.equal(a.mode,'mock');assert.equal(a.reference,(await adapter.collect(op())).reference);assert.equal(a.transactionHash,undefined);
});
test('challenge pins testnet, USDC and precise cents',async()=>{
 const {adapter}=setup();const c=await adapter.challenge(op());assert.equal(c.status,402);assert.equal(c.body.accepts[0].network,'eip155:84532');assert.equal(c.body.accepts[0].asset,BASE_SEPOLIA_USDC);assert.equal(c.body.accepts[0].amount,'250000');assert.ok(c.body.accepts[0].maxTimeoutSeconds<=60);assert.deepEqual(JSON.parse(Buffer.from(c.headers['PAYMENT-REQUIRED'],'base64').toString()),c.body);
});
test('signature verification alone is never a confirmed collection',async()=>{
 const {adapter}=setup({facilitator:{settle:async()=>{throw new Error('lost response');}}});
 const result=await adapter.collect(await payload(adapter,op()));assert.equal(result.status,'pending');assert.equal(result.transactionHash,undefined);
});
test('collection confirms only exact onchain token transfer',async()=>{
 const {adapter}=setup();const result=await adapter.collect(await payload(adapter,op()));assert.equal(result.status,'confirmed');assert.equal(result.transactionHash,hash);assert.equal(result.payer,payer);
});
test('successful unrelated transaction cannot fund a job',async()=>{
 const {adapter}=setup({rpc:{getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log(payer,owner)]})}});
 const result=await adapter.collect(await payload(adapter,op()));assert.equal(result.status,'failed');
});
test('settled transaction remains pending until receipt/confirmations',async()=>{
 const {adapter}=setup({rpc:{getBlockNumber:async()=>5n}});const result=await adapter.collect(await payload(adapter,op()));assert.equal(result.status,'pending');assert.equal(result.transactionHash,hash);
});
test('mismatched quote, resource or chain is rejected before settlement',async()=>{
 const {adapter,settlements}=setup();const operation=await payload(adapter,op());(operation.payload as any).accepted.amount='1';await assert.rejects(()=>adapter.collect(operation),/MISMATCH/);assert.equal(settlements(),0);
 const other=setup({rpc:{getChainId:async()=>8453}}).adapter;await assert.rejects(()=>other.collect(op()),/WRONG_CHAIN/);
});
test('unknown collection reconciliation never resubmits authorization',async()=>{
 const {adapter,settlements}=setup();const receipt:PaymentReceipt={mode:'testnet',status:'pending',reference:'unknown',kind:'collection'};assert.equal((await adapter.reconcile({...op(),receipt})).status,'pending');assert.equal(settlements(),0);
});
test('release stores signed hash before broadcast and checks exact transfer',async()=>{
 const events:string[]=[];
 const wallet={account:{address:treasury},prepareTransactionRequest:async()=>({}),signTransaction:async()=>('0x01')};
 const {adapter}=setup({options:{walletClient:wallet},rpc:{sendRawTransaction:async()=>{events.push('broadcast');},getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log(treasury,owner,200000n)]})}});
 const result=await adapter.release({...op(),ownerAddress:owner,onSubmitted:async receipt=>{assert.ok(receipt.transactionHash);events.push('durable');}});assert.deepEqual(events,['durable','broadcast']);assert.equal(result.status,'confirmed');assert.equal(result.amountCents,20);
});

test('authorization must be active and bounded by the exact quote expiry',async()=>{
 for (const [field,value] of [['validAfter',String(Math.floor(Date.now()/1000)+30)],['validBefore',String(Math.floor(Date.now()/1000)-1)],['validBefore',String(Math.floor(Date.now()/1000)+600)],['validBefore','invalid']] as const) {
  const {adapter,settlements}=setup();const operation=await payload(adapter,op());(operation.payload as any).payload.authorization[field]=value;await assert.rejects(()=>adapter.collect(operation),/AUTHORIZATION_WINDOW/);assert.equal(settlements(),0);
 }
 const {adapter}=setup();const operation=await payload(adapter,op());operation.quote.expiresAt='invalid';await assert.rejects(()=>adapter.collect(operation),/QUOTE_EXPIRED/);
});

test('official x402 EVM signer interoperates with quote challenge and EIP3009 policy offline',async()=>{
 const signer=privateKeyToAccount(('0x'+'0'.repeat(63)+'1') as Hex);
 const client=new x402Client().register('eip155:84532',new ExactEvmScheme(signer));
 const {adapter}=setup({rpc:{getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log(signer.address)]})},facilitator:{verify:async(payment:any)=>{
  const a=payment.payload.authorization;
  const isValid=await verifyTypedData({address:signer.address,domain:{name:'USDC',version:'2',chainId:84532,verifyingContract:BASE_SEPOLIA_USDC},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:payment.payload.signature});
  return {isValid};
 }}});
 const operation=op();operation.payload=await client.createPaymentPayload((await adapter.challenge(operation)).body);
 const result=await adapter.collect(operation);assert.equal(result.status,'confirmed');assert.equal(result.payer,signer.address);
});

test('standard x402 header codecs round-trip payload and emit only confirmed settlement',async()=>{
 const {adapter}=setup();const operation=await payload(adapter,op());
 const encoded=Buffer.from(JSON.stringify(operation.payload)).toString('base64');assert.deepEqual(decodeX402PaymentSignature(encoded),operation.payload);assert.throws(()=>decodeX402PaymentSignature('invalid'),/INVALID_PAYMENT_SIGNATURE_HEADER/);
 const receipt=await adapter.collect(operation);const header=x402PaymentResponseHeader(receipt);assert.ok(header);
 assert.deepEqual(JSON.parse(Buffer.from(header!,'base64').toString()),{success:true,transaction:hash,network:'eip155:84532',payer,amount:'250000'});
 assert.equal(x402PaymentResponseHeader({...receipt,status:'pending'}),undefined);assert.equal(x402PaymentResponseHeader({...receipt,mode:'mock'}),undefined);assert.equal(x402PaymentResponseHeader({...receipt,kind:'release'}),undefined);
});

test('failed initial durable collection checkpoint cannot submit a settlement',async()=>{
 const {adapter,settlements}=setup();
 const operation=await payload(adapter,op());
 operation.onSubmitted=async()=>{throw new Error('fixture store offline');};
 await assert.rejects(()=>adapter.collect(operation),/fixture store offline/);
 assert.equal(settlements(),0);
});

test('lost second collection checkpoint preserves the known settlement hash',async()=>{
 const {adapter,settlements}=setup();
 const operation=await payload(adapter,op());
 let checkpoints=0;
 operation.onSubmitted=async receipt=>{if(++checkpoints===2){assert.equal(receipt.transactionHash,hash);throw new Error('fixture store offline');}};
 const result=await adapter.collect(operation);
 assert.equal(result.status,'pending');
 assert.equal(result.transactionHash,hash);
 assert.match(result.reason!,/durable checkpoint/);
 assert.equal(settlements(),1);
});

test('failed release checkpoint cannot broadcast and unknown broadcast keeps exact hash',async()=>{
 let broadcasts=0;
 const wallet={account:{address:treasury},prepareTransactionRequest:async()=>({}),signTransaction:async()=>('0x01')};
 const {adapter}=setup({options:{walletClient:wallet},rpc:{sendRawTransaction:async()=>{broadcasts++;throw new Error('fixture lost broadcast response');}}});
 await assert.rejects(()=>adapter.release({...op(),ownerAddress:owner,onSubmitted:async()=>{throw new Error('fixture store offline');}}),/fixture store offline/);
 assert.equal(broadcasts,0);
 const submitted=await adapter.release({...op(),ownerAddress:owner});
 assert.equal(submitted.status,'pending');assert.match(submitted.transactionHash!,/^0x[0-9a-f]{64}$/);assert.equal(broadcasts,1);
});

test('collection durably records recovery bounds before settlement, without retaining a signature',async()=>{
 const {adapter}=setup();
 const operation=await payload(adapter,op());
 const checkpoints:PaymentReceipt[]=[];
 operation.onSubmitted=async receipt=>{checkpoints.push(receipt);};
 await adapter.collect(operation);
 assert.equal(checkpoints[0].authorization?.nonce,nonce);
 assert.equal(checkpoints[0].authorization?.validBefore,(operation.payload as any).payload.authorization.validBefore);
 assert.equal(checkpoints[0].authorization?.fromBlock,'6');
 assert.doesNotMatch(JSON.stringify(checkpoints),/0xtest-facilitator-only/);
});

test('lost-response recovery finds the original transaction and checks its exact transfer, never settling again',async()=>{
 const checkedBlocks:bigint[]=[];
 const queries:any[]=[];
 const checkpoints:PaymentReceipt[]=[];
 const {adapter,settlements}=setup({rpc:{
  readContract:async({blockNumber}:any)=>{checkedBlocks.push(blockNumber);return true;},
  getLogs:async(query:any)=>{queries.push(query);return query.event.name==='AuthorizationUsed'?[authorizationLog()]:[];},
 }});
 const result=await adapter.reconcile({...op(),receipt:unknownReceipt(),onSubmitted:async receipt=>{checkpoints.push(receipt);}});
 assert.equal(result.status,'confirmed');
 assert.equal(result.transactionHash,hash);
 assert.equal(settlements(),0);
 assert.equal(checkpoints[0].transactionHash,hash);
 assert.deepEqual(checkedBlocks,[5n]);
 assert.ok(queries.every(q=>q.address===BASE_SEPOLIA_USDC&&q.args.authorizer===payer&&q.args.nonce===nonce&&q.fromBlock===4n&&q.toBlock===5n));
});

test('a used authorization with an unrelated transfer cannot fund an order',async()=>{
 const {adapter}=setup({rpc:{readContract:async()=>true,getLogs:async(q:any)=>q.event.name==='AuthorizationUsed'?[authorizationLog()]:[],getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log(payer,owner)]})}});
 const result=await adapter.reconcile({...op(),receipt:unknownReceipt()});
 assert.equal(result.status,'failed');
 assert.match(result.reason!,/exact expected USDC transfer/);
});

test('unused authorizations remain pending while valid and expire using confirmed chain time',async()=>{
 const receipt=unknownReceipt();
 const expiry=BigInt(receipt.authorization!.validBefore);
 let chainTime=expiry-1n;
 const {adapter,settlements}=setup({rpc:{getBlock:async()=>({timestamp:chainTime})}});
 assert.equal((await adapter.reconcile({...op(),receipt})).status,'pending');
 chainTime=expiry;
 const result=await adapter.reconcile({...op(),receipt});
 assert.equal(result.status,'failed');
 assert.match(result.reason!,/expired without a transfer/);
 assert.equal(settlements(),0);
});

test('server time alone cannot fail a payment while the confirmed chain clock is behind',async()=>{
 const receipt=unknownReceipt();
 receipt.authorization!.validBefore=String(Math.floor(Date.now()/1000)-60);
 const {adapter}=setup({rpc:{getBlock:async()=>({timestamp:BigInt(receipt.authorization!.validBefore)-1n})}});
 assert.equal((await adapter.reconcile({...op(),receipt})).status,'pending');
});

test('older saved receipts recover their nonce from the reference and safely expire after the quote',async()=>{
 const receipt=unknownReceipt();
 delete receipt.authorization;
 const operation=op();
 operation.quote.expiresAt=new Date(Date.now()-1000).toISOString();
 const {adapter}=setup();
 const result=await adapter.reconcile({...operation,receipt});
 assert.equal(result.status,'failed');
 assert.match(result.reason!,/expired without a transfer/);
});

test('older used authorizations search from the operation time and recover the exact transaction',async()=>{
 const receipt=unknownReceipt();
 delete receipt.authorization;
 const {adapter}=setup({rpc:{readContract:async()=>true,getLogs:async(q:any)=>q.event.name==='AuthorizationUsed'?[authorizationLog()]:[]}});
 const result=await adapter.reconcile({...op(),createdAt:new Date().toISOString(),receipt});
 assert.equal(result.status,'confirmed');
 assert.ok(result.authorization);
 assert.equal(result.transactionHash,hash);
});

test('RPC errors and incomplete event results stay pending and do not cause another charge',async()=>{
 for(const failure of ['state','logs','missing_event'] as const){
  const {adapter,settlements}=setup({rpc:{readContract:async()=>{if(failure==='state')throw new Error('offline');return true;},getLogs:async()=>{if(failure==='logs')throw new Error('offline');return [];}}});
  const result=await adapter.reconcile({...op(),receipt:unknownReceipt()});
  assert.equal(result.status,'pending',failure);
  assert.equal(settlements(),0);
 }
});

test('wrong authorization events are ignored, canceled authorizations end without payment',async()=>{
 const wrong=setup({rpc:{readContract:async()=>true,getLogs:async(q:any)=>q.event.name==='AuthorizationUsed'?[authorizationLog('AuthorizationUsed',owner)]:[]}});
 assert.equal((await wrong.adapter.reconcile({...op(),receipt:unknownReceipt()})).status,'pending');
 const canceled=setup({rpc:{readContract:async()=>true,getLogs:async(q:any)=>q.event.name==='AuthorizationCanceled'?[authorizationLog('AuthorizationCanceled')]:[]}});
 assert.equal((await canceled.adapter.reconcile({...op(),receipt:unknownReceipt()})).status,'failed');
});

test('recovery scans bounded log pages and saves progress for old transactions',async()=>{
 const queries:any[]=[];
 const {adapter}=setup({rpc:{getBlockNumber:async()=>3005n,readContract:async()=>true,getLogs:async(q:any)=>{queries.push(q);return [];}}});
 const receipt=unknownReceipt();
 receipt.authorization!.fromBlock='1';
 let result=await adapter.reconcile({...op(),receipt});
 assert.equal(result.status,'pending');
 assert.equal(result.authorization!.searchFromBlock,'1001');
 result=await adapter.reconcile({...op(),receipt:result});
 assert.equal(result.authorization!.searchFromBlock,'2001');
 assert.deepEqual(queries.map(q=>[q.fromBlock,q.toBlock]),[[1n,1000n],[1n,1000n],[1001n,2000n],[1001n,2000n]]);
});

test('structured settlement errors retain diagnostics and any known hash for reconciliation',async()=>{
 const error=Object.assign(new Error('internal details must not be stored'),{errorReason:'transaction_failed',statusCode:500,network:'eip155:84532',transaction:hash});
 const {adapter}=setup({facilitator:{settle:async()=>{throw error;}}});
 const result=await adapter.collect(await payload(adapter,op()));
 assert.equal(result.status,'confirmed');
 assert.equal(result.transactionHash,hash);
 assert.deepEqual(result.settlementError,{code:'transaction_failed',httpStatus:500});
 assert.doesNotMatch(JSON.stringify(result),/internal details/);
});

test('recovered transaction hash survives a failed recovery checkpoint',async()=>{
 const {adapter}=setup({rpc:{readContract:async()=>true,getLogs:async(q:any)=>q.event.name==='AuthorizationUsed'?[authorizationLog()]:[]}});
 const result=await adapter.reconcile({...op(),receipt:unknownReceipt(),onSubmitted:async()=>{throw new Error('store unavailable');}});
 assert.equal(result.status,'pending');
 assert.equal(result.transactionHash,hash);
});
