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
function op(): PaymentOperation { return {jobId:'job-1',operationId:'collect-1',quote:{id:'quote-1',totalCents:25,ownerCents:20,platformCents:5,expiresAt:new Date(Date.now()+60_000).toISOString()}}; }
function log(from:Hex=payer,to:Hex=treasury,value=250000n) { return {address:BASE_SEPOLIA_USDC,topics:encodeEventTopics({abi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])}; }
function setup(overrides:any={}) {
  let settlements=0;
  const rpc={getChainId:async()=>84532,getTransactionReceipt:async()=>({status:'success',blockNumber:5n,logs:[log()]}),getBlockNumber:async()=>6n,...overrides.rpc};
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
