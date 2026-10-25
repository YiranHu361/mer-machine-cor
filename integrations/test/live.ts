import { appendFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { BaseSepoliaPaymentAdapter, type PaymentOperation, type PaymentReceipt } from '../src/payments.js';
const collectionOnly=process.argv.includes('--collection-only');
const required=['FABRARY_RUN_LIVE_PAYMENTS','FABRARY_TREASURY_ADDRESS','FABRARY_BASE_SEPOLIA_RPC','FABRARY_PUBLIC_ORIGIN','FABRARY_TEST_PAYER_PRIVATE_KEY',...(!collectionOnly?['FABRARY_TREASURY_PRIVATE_KEY','FABRARY_OWNER_WALLET']:[])];
const missing=required.filter(k=>!process.env[k]);
if (missing.length || process.env.FABRARY_RUN_LIVE_PAYMENTS!=='1') {
 console.log(JSON.stringify({status:'BLOCKED',integration:collectionOnly?'x402 Base Sepolia one-cent demo payment':'x402 Base Sepolia actual collection, release and refund',missing,reason:collectionOnly?'Configure a disposable payer with free test USDC and a receiving address. No real money or treasury private key is needed. No transaction submitted.':'Explicit opt-in plus testnet-funded payer, treasury signer and owner wallet are required. No transaction submitted.'}));process.exit(2);
}
const env=process.env;
const payer=privateKeyToAccount(env.FABRARY_TEST_PAYER_PRIVATE_KEY as Hex);
const client=new x402Client().register('eip155:84532',new ExactEvmScheme(payer));
const adapter=new BaseSepoliaPaymentAdapter({treasuryAddress:env.FABRARY_TREASURY_ADDRESS!,treasuryPrivateKey:collectionOnly?undefined:env.FABRARY_TREASURY_PRIVATE_KEY as Hex,rpcUrl:env.FABRARY_BASE_SEPOLIA_RPC!,resourceOrigin:env.FABRARY_PUBLIC_ORIGIN!,facilitatorUrl:env.FABRARY_X402_FACILITATOR});
const journal=env.FABRARY_LIVE_RECEIPTS_PATH??'/tmp/fabrary-live-payment-receipts.jsonl';
async function record(receipt:PaymentReceipt) { appendFileSync(journal,JSON.stringify({...receipt,at:new Date().toISOString()})+'\n',{mode:0o600}); }
async function confirmed(op:PaymentOperation, receipt:PaymentReceipt):Promise<PaymentReceipt> {
 await record(receipt);
 for(let i=0;receipt.status==='pending'&&i<60;i++) { await new Promise(r=>setTimeout(r,1000));receipt=await adapter.reconcile({...op,receipt}); }
 await record(receipt);
 if(receipt.status!=='confirmed')throw new Error(`Live acceptance incomplete: ${receipt.status}; see private receipt journal ${journal}`);
 return receipt;
}
async function collect(suffix:string) {
 const jobId='live-'+Date.now()+'-'+suffix;
 const operation:PaymentOperation={jobId,operationId:jobId+'-collect',quote:{id:jobId+'-quote',totalCents:1,ownerCents:1,platformCents:0,expiresAt:new Date(Date.now()+240_000).toISOString()},requesterAddress:payer.address,ownerAddress:env.FABRARY_OWNER_WALLET,onSubmitted:record};
 const challenge=await adapter.challenge(operation);
 const payload=await client.createPaymentPayload(challenge.body);
 const receipt=await confirmed(operation,await adapter.collect({...operation,payload}));return {operation,receipt};
}
if (collectionOnly) {
 const demo=await collect('demo');
 console.log(JSON.stringify({status:'PASS',network:'Base Sepolia (testnet only)',amount:'0.01 test USDC',transactionHash:demo.receipt.transactionHash,explorer:`https://sepolia.basescan.org/tx/${demo.receipt.transactionHash}`,journal}));
 process.exit(0);
}
// Two distinct one-cent testnet collections demonstrate mutually exclusive release
// and refund outcomes. No real network, real USDC or token purchasing path exists.
const released=await collect('release');
const releaseOp={...released.operation,operationId:released.operation.jobId+'-release'};
const release=await confirmed(releaseOp,await adapter.release(releaseOp));
const refunded=await collect('refund');
const refundOp={...refunded.operation,operationId:refunded.operation.jobId+'-refund'};
const refund=await confirmed(refundOp,await adapter.refund(refundOp));
console.log(JSON.stringify({status:'PASS',network:'Base Sepolia',collection:released.receipt.transactionHash,release:release.transactionHash,refundCollection:refunded.receipt.transactionHash,refund:refund.transactionHash,journal}));
