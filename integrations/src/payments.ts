import { createHash } from 'node:crypto';
import { HTTPFacilitatorClient, decodePaymentSignatureHeader, encodePaymentResponseHeader, type FacilitatorClient } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements, PaymentRequired } from '@x402/core/types';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, parseAbi, parseAbiItem, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

export const BASE_SEPOLIA_NETWORK = 'eip155:84532' as const;
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const tokenAbi = parseAbi(['function transfer(address to, uint256 value) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);
const authorizationAbi = parseAbi(['function authorizationState(address authorizer, bytes32 nonce) view returns (bool)']);
const authorizationUsed = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');
const authorizationCanceled = parseAbiItem('event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)');
export interface PaymentQuote { id: string; totalCents: number; ownerCents: number; platformCents: number; expiresAt: string }
export interface PaymentReceipt {
  status: 'pending'|'confirmed'|'failed'; reference: string; mode: 'mock'|'testnet';
  transactionHash?: string; reason?: string; payer?: string; payee?: string; amountCents?: number;
  kind?: 'collection'|'release'|'refund'; blockNumber?: string;
  /** Recovery data only: never retain a signature that could submit another payment. */
  authorization?: { nonce: string; validBefore: string; fromBlock: string; searchFromBlock?: string };
  settlementError?: { code: string; httpStatus?: number };
}
export interface PaymentOperation {
  jobId: string; operationId: string; quote: PaymentQuote; payload?: unknown;
  /** Server-generated route binding for whole-order payments. Never taken from the payer. */
  resourcePath?: string;
  requesterAddress?: string; ownerAddress?: string; receipt?: PaymentReceipt;
  createdAt?: string;
  onSubmitted?: (receipt: PaymentReceipt) => Promise<void>;
}
export interface PaymentChallenge { status: 402; headers: Record<string,string>; body: PaymentRequired }
export interface PaymentAdapter {
  readonly mode: 'mock'|'testnet';
  challenge(op: PaymentOperation): Promise<PaymentChallenge>;
  collect(op: PaymentOperation): Promise<PaymentReceipt>;
  release(op: PaymentOperation): Promise<PaymentReceipt>;
  refund(op: PaymentOperation): Promise<PaymentReceipt>;
  reconcile(op: PaymentOperation): Promise<PaymentReceipt>;
}
/** Decode the standard x402 v2 PAYMENT-SIGNATURE header, never a success claim. */
export function decodeX402PaymentSignature(header: string): PaymentPayload {
  if (!header || header.length > 128_000) throw new Error('INVALID_PAYMENT_SIGNATURE_HEADER');
  try { return decodePaymentSignatureHeader(header); }
  catch { throw new Error('INVALID_PAYMENT_SIGNATURE_HEADER'); }
}
/** Return the standard settlement header only for a confirmed testnet collection. */
export function x402PaymentResponseHeader(receipt: PaymentReceipt): string | undefined {
  if (receipt.mode !== 'testnet' || receipt.kind !== 'collection' || receipt.status !== 'confirmed' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash ?? '') || !receipt.payer || receipt.amountCents === undefined) return undefined;
  return encodePaymentResponseHeader({success:true,transaction:receipt.transactionHash!,network:BASE_SEPOLIA_NETWORK,payer:receipt.payer,amount:cents(receipt.amountCents).toString()});
}
function cents(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_INTEGER_CENTS');
  return BigInt(value) * 10_000n; // USDC has six decimals; every cent is exactly 10,000 units.
}
function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = 'mock' as const;
  async challenge(op: PaymentOperation): Promise<PaymentChallenge> {
    return {status:402,headers:{},body:{x402Version:2,resource:{url:`mock://fabyn/${op.jobId}`},accepts:[],error:'Explicit mock adapter; no blockchain payment'}};
  }
  private receipt(op: PaymentOperation, kind: 'collection'|'release'|'refund'): PaymentReceipt {
    return {mode:this.mode,kind,status:'confirmed',reference:`mock:${kind}:${fingerprint([op.jobId,op.operationId])}`,amountCents:kind==='release'?op.quote.ownerCents:op.quote.totalCents};
  }
  async collect(op: PaymentOperation) { return this.receipt(op,'collection'); }
  async release(op: PaymentOperation) { return this.receipt(op,'release'); }
  async refund(op: PaymentOperation) { return this.receipt(op,'refund'); }
  async reconcile(op: PaymentOperation) {
    if (!op.receipt) throw new Error('RECEIPT_REQUIRED');
    return op.receipt;
  }
}
export interface BaseSepoliaOptions {
  treasuryAddress: string; rpcUrl: string; resourceOrigin: string;
  treasuryPrivateKey?: Hex; facilitatorUrl?: string; facilitator?: FacilitatorClient;
  publicClient?: any; walletClient?: any; confirmations?: number;
}
export class BaseSepoliaPaymentAdapter implements PaymentAdapter {
  readonly mode = 'testnet' as const;
  private readonly facilitator: FacilitatorClient;
  private readonly rpc: any;
  private readonly wallet: any;
  private readonly treasury: Hex;
  constructor(private readonly options: BaseSepoliaOptions) {
    this.treasury = getAddress(options.treasuryAddress);
    this.rpc = options.publicClient ?? createPublicClient({chain:baseSepolia,transport:http(options.rpcUrl,{timeout:15_000,retryCount:0})});
    const account = options.treasuryPrivateKey ? privateKeyToAccount(options.treasuryPrivateKey) : undefined;
    if (account && account.address.toLowerCase() !== this.treasury.toLowerCase()) throw new Error('TREASURY_KEY_ADDRESS_MISMATCH');
    this.wallet = options.walletClient ?? (account ? createWalletClient({chain:baseSepolia,account,transport:http(options.rpcUrl,{timeout:15_000,retryCount:0})}) : undefined);
    this.facilitator = options.facilitator ?? new HTTPFacilitatorClient({url:options.facilitatorUrl ?? 'https://x402.org/facilitator',timeoutMs:30_000});
    if (new URL(options.resourceOrigin).protocol !== 'https:' && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(options.resourceOrigin)) throw new Error('RESOURCE_ORIGIN_HTTPS_REQUIRED');
  }
  private async checkChain() {
    if (await this.rpc.getChainId() !== 84532) throw new Error('WRONG_CHAIN: only Base Sepolia 84532 is authorized');
  }
  private requirements(op: PaymentOperation, maxTimeoutSeconds = 300): PaymentRequirements {
    if (op.quote.ownerCents + op.quote.platformCents !== op.quote.totalCents) throw new Error('QUOTE_SUM_MISMATCH');
    return {scheme:'exact',network:BASE_SEPOLIA_NETWORK,asset:BASE_SEPOLIA_USDC,amount:cents(op.quote.totalCents).toString(),payTo:this.treasury,maxTimeoutSeconds,extra:{name:'USDC',version:'2'}};
  }
  private resource(op: PaymentOperation) {
    return new URL(op.resourcePath ?? `/api/jobs/${encodeURIComponent(op.jobId)}/checkout?quote=${encodeURIComponent(op.quote.id)}`,this.options.resourceOrigin).href;
  }
  async challenge(op: PaymentOperation): Promise<PaymentChallenge> {
    const expiry = Date.parse(op.quote.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() + 1000) throw new Error('QUOTE_EXPIRED');
    const timeout = Math.max(1, Math.min(300, Math.floor((expiry - Date.now()) / 1000) - 2));
    const body: PaymentRequired = {x402Version:2,resource:{url:this.resource(op),description:`Fabyn approved quote ${op.quote.id}`,mimeType:'application/json'},accepts:[this.requirements(op, timeout)]};
    return {status:402,headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify(body)).toString('base64'),'Access-Control-Expose-Headers':'PAYMENT-REQUIRED, PAYMENT-RESPONSE'},body};
  }
  async collect(op: PaymentOperation): Promise<PaymentReceipt> {
    if (op.receipt) return this.reconcile(op);
    await this.checkChain();
    const quoteExpiry = Date.parse(op.quote.expiresAt);
    if (!Number.isFinite(quoteExpiry) || quoteExpiry <= Date.now()) throw new Error('QUOTE_EXPIRED');
    const payload = (typeof op.payload==='string' ? JSON.parse(Buffer.from(op.payload,'base64').toString('utf8')) : op.payload) as PaymentPayload;
    const acceptedTimeout = payload?.accepted?.maxTimeoutSeconds;
    if (!Number.isInteger(acceptedTimeout) || acceptedTimeout < 1 || acceptedTimeout > 300) throw new Error('INVALID_AUTHORIZATION_WINDOW');
    const requirements = this.requirements(op, acceptedTimeout);
    if (!payload || payload.x402Version!==2 || canonical(payload.accepted)!==canonical(requirements) || payload.resource?.url!==this.resource(op)) throw new Error('PAYMENT_REQUIREMENTS_MISMATCH');
    const auth = payload.payload?.authorization as any;
    if (!auth || getAddress(auth.to)!==this.treasury || String(auth.value)!==requirements.amount || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) throw new Error('INVALID_AUTHORIZATION');
    if (!/^\d+$/.test(String(auth.validAfter)) || !/^\d+$/.test(String(auth.validBefore))) throw new Error('INVALID_AUTHORIZATION_WINDOW');
    const nowSeconds = BigInt(Math.floor(Date.now()/1000));
    const validAfter = BigInt(auth.validAfter), validBefore = BigInt(auth.validBefore);
    if (validAfter > nowSeconds || validBefore <= nowSeconds || validBefore > BigInt(Math.floor(quoteExpiry/1000)) || validBefore > nowSeconds + BigInt(requirements.maxTimeoutSeconds)) throw new Error('INVALID_AUTHORIZATION_WINDOW: authorization must be active and expire within this quote');
    const payer = getAddress(auth.from);
    if (op.requesterAddress && getAddress(op.requesterAddress)!==payer) throw new Error('PAYER_MISMATCH');
    const reference = `x402:84532:${payer.toLowerCase()}:${auth.nonce.toLowerCase()}`;
    const fromBlock = await this.rpc.getBlockNumber({cacheTime:0});
    const pending: PaymentReceipt = {mode:this.mode,kind:'collection',status:'pending',reference,payer,payee:this.treasury,amountCents:op.quote.totalCents,authorization:{nonce:auth.nonce,validBefore:String(validBefore),fromBlock:String(fromBlock)}};
    const verified = await this.facilitator.verify(payload,requirements);
    if (!verified.isValid) return {...pending,status:'failed',reason:verified.invalidReason ?? 'Facilitator rejected authorization'};
    // Durable caller records this nonce before settle, preventing signature reuse
    // across jobs and preserving an indeterminate result after a lost response.
    await op.onSubmitted?.(pending);
    let settled;
    try {
      settled = await this.facilitator.settle(payload,requirements);
    } catch (error: any) {
      // The SDK can throw a structured rejection that still contains a known
      // transaction. Preserve it, and retain safe diagnostics across recovery.
      const code = /^[a-z0-9_-]{1,80}$/i.test(error?.errorReason ?? '') ? error.errorReason : 'facilitator_response_unavailable';
      pending.settlementError = {code,...(Number.isInteger(error?.statusCode) ? {httpStatus:error.statusCode} : {})};
      console.warn(`[x402] ${op.operationId}: ${code}${pending.settlementError.httpStatus ? ` (HTTP ${pending.settlementError.httpStatus})` : ''}`);
      if (error?.network === BASE_SEPOLIA_NETWORK && /^0x[0-9a-f]{64}$/i.test(error?.transaction ?? ''))
        settled = {network:error.network,transaction:error.transaction};
      else
        return {...pending,reason:'Settlement response unavailable; authorization may have settled. Reconcile, never submit a new payment automatically.'};
    }
    if (settled.network!==BASE_SEPOLIA_NETWORK) return {...pending,status:'pending',reason:'Facilitator returned unexpected network; operator reconciliation required'};
    if (!settled.transaction || !/^0x[0-9a-fA-F]{64}$/.test(settled.transaction)) return {...pending,status:'pending',settlementError:{code:/^[a-z0-9_-]{1,80}$/i.test(settled.errorReason ?? '') ? settled.errorReason! : 'facilitator_missing_transaction'},reason:'Settlement returned no transaction; checking the original authorization'};
    const submitted = {...pending,transactionHash:settled.transaction};
    try { await op.onSubmitted?.(submitted); }
    catch {
      // The settlement already happened. Preserve its known hash even if the
      // second checkpoint fails so the caller can persist/reconcile this exact
      // transaction rather than replace it with an unknowable nonce record.
      return {...submitted,reason:'Settlement transaction is known but its durable checkpoint was unavailable; preserve and reconcile this transaction hash before further payment actions'};
    }
    return this.confirm(submitted);
  }
  async release(op: PaymentOperation) { return this.transfer(op,'release'); }
  async refund(op: PaymentOperation) { return this.transfer(op,'refund'); }
  private async transfer(op: PaymentOperation, kind: 'release'|'refund'): Promise<PaymentReceipt> {
    if (op.receipt) return this.reconcile(op);
    await this.checkChain();
    if (!this.wallet) throw new Error('TREASURY_PRIVATE_KEY_REQUIRED: release/refund need funded Base Sepolia treasury signer');
    const payeeRaw = kind==='release' ? op.ownerAddress : op.requesterAddress;
    if (!payeeRaw) throw new Error(kind==='release' ? 'OWNER_ADDRESS_REQUIRED' : 'REQUESTER_ADDRESS_REQUIRED');
    const payee = getAddress(payeeRaw);
    const amountCents = kind==='release' ? op.quote.ownerCents : op.quote.totalCents;
    const pending: PaymentReceipt = {mode:this.mode,kind,status:'pending',reference:`base-sepolia:${kind}:${op.operationId}`,payer:this.treasury,payee,amountCents};
    // Sign locally so its hash can be durably saved BEFORE broadcast. Replaying the
    // identical raw transaction is safe; a new nonce is never created by reconcile.
    const transaction = await this.wallet.prepareTransactionRequest({account:this.wallet.account,chain:baseSepolia,to:BASE_SEPOLIA_USDC,data:encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[payee,cents(amountCents)]})});
    const raw = await this.wallet.signTransaction(transaction);
    const transactionHash = keccak256(raw);
    const submitted = {...pending,transactionHash};
    await op.onSubmitted?.(submitted);
    try { await this.rpc.sendRawTransaction({serializedTransaction:raw}); }
    catch { return {...submitted,reason:'Broadcast response unavailable; reconcile this transaction hash before any retry'}; }
    return this.confirm(submitted);
  }
  async reconcile(op: PaymentOperation): Promise<PaymentReceipt> {
    if (!op.receipt) throw new Error('RECEIPT_REQUIRED: reconciliation never creates another payment');
    await this.checkChain();
    if (op.receipt.status!=='pending') return op.receipt;
    if (!op.receipt.transactionHash) return this.recoverCollection(op);
    return this.confirm(op.receipt);
  }
  /** Resolve a lost facilitator response using only the original authorization. */
  private async recoverCollection(op: PaymentOperation): Promise<PaymentReceipt> {
    const receipt = op.receipt!;
    const reference = /^x402:84532:(0x[0-9a-f]{40}):(0x[0-9a-f]{64})$/i.exec(receipt.reference);
    const nonce = receipt.authorization?.nonce ?? reference?.[2];
    const expiry = receipt.authorization?.validBefore ?? String(Math.floor(Date.parse(op.quote.expiresAt) / 1000));
    if (receipt.kind !== 'collection' || !receipt.payer || !nonce || !/^0x[0-9a-f]{64}$/i.test(nonce) || !/^\d+$/.test(expiry) || (reference && reference[1].toLowerCase() !== receipt.payer.toLowerCase()))
      return {...receipt,reason:'The saved test payment needs workshop review; no replacement payment will be sent.'};
    let recovered = receipt;
    try {
      // Use a confirmed block's clock and state, not the server clock or an
      // unconfirmed head, before concluding that no transfer can arrive later.
      const head = BigInt(await this.rpc.getBlockNumber({cacheTime:0}));
      const confirmations = BigInt(this.options.confirmations ?? 2);
      const blockNumber = head >= confirmations - 1n ? head - (confirmations - 1n) : 0n;
      const block = await this.rpc.getBlock({blockNumber});
      const used = await this.rpc.readContract({
        address:BASE_SEPOLIA_USDC,abi:authorizationAbi,functionName:'authorizationState',
        args:[receipt.payer,nonce],blockNumber,
      });
      if (used === false) {
        if (BigInt(block.timestamp) >= BigInt(expiry))
          return {...receipt,status:'failed',reason:'Test payment expired without a transfer. Nothing was charged. Start a new order to try again.'};
        return {...receipt,reason:'The test payment has not settled. Checking the original authorization; no replacement payment will be sent.'};
      }
      if (used !== true) throw new Error('INVALID_AUTHORIZATION_STATE');
      const fromBlock = BigInt(receipt.authorization?.searchFromBlock ?? receipt.authorization?.fromBlock ?? await this.legacyRecoveryBlock(op, blockNumber));
      const authorization = receipt.authorization ?? {nonce,validBefore:expiry,fromBlock:String(fromBlock)};
      recovered = {...receipt,authorization};
      if (fromBlock > blockNumber)
        return {...recovered,reason:'Waiting for the test payment receipt to become available.'};
      // Bounded log ranges work with public RPC limits. Save progress when an
      // old payment needs several pages; fresh payments normally need one.
      const toBlock = fromBlock + 999n < blockNumber ? fromBlock + 999n : blockNumber;
      const events = [authorizationUsed, authorizationCanceled];
      const [usedLogs, canceledLogs] = await Promise.all(events.map(event => this.rpc.getLogs({
        address:BASE_SEPOLIA_USDC,event,args:{authorizer:receipt.payer,nonce},
        fromBlock,toBlock,strict:true,
      })));
      const matches = (log: any, event: typeof authorizationUsed | typeof authorizationCanceled) => {
        if (log.removed || log.address?.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) return false;
        try {
          const decoded = decodeEventLog({abi:[event],data:log.data,topics:log.topics});
          return decoded.eventName === event.name && decoded.args.authorizer.toLowerCase() === receipt.payer!.toLowerCase() && decoded.args.nonce.toLowerCase() === nonce.toLowerCase();
        } catch { return false; }
      };
      const transaction = usedLogs.find((log: any) => matches(log, authorizationUsed) && /^0x[0-9a-f]{64}$/i.test(log.transactionHash ?? ''))?.transactionHash;
      if (transaction) {
        recovered = {...recovered,transactionHash:transaction};
        await op.onSubmitted?.(recovered);
        // A used nonce alone is not payment: still require the exact successful
        // USDC transfer, payer, payee, amount and confirmation count.
        return this.confirm(recovered);
      }
      if (canceledLogs.some((log: any) => matches(log, authorizationCanceled)))
        return {...recovered,status:'failed',reason:'Test payment authorization was canceled without a transfer. Nothing was charged.'};
      return {
        ...recovered,
        authorization:{...authorization,searchFromBlock:String(toBlock < blockNumber ? toBlock + 1n : fromBlock)},
        reason:'Recovering the original test payment receipt; no replacement payment will be sent.',
      };
    } catch {
      return {...recovered,reason:'The test payment network is unavailable. The saved payment will be checked again; do not pay again yet.'};
    }
  }
  /** Older receipts saved the nonce in their reference but no starting block. */
  private async legacyRecoveryBlock(op: PaymentOperation, head: bigint): Promise<string> {
    const time = Date.parse(op.createdAt ?? op.quote.expiresAt);
    if (!Number.isFinite(time)) throw new Error('RECOVERY_TIME_REQUIRED');
    // The accepted authorization window is at most 300 seconds. Start before
    // the recorded operation to include any settlement near that boundary.
    const before = BigInt(Math.max(0, Math.floor(time / 1000) - 300));
    let low = 0n, high = head;
    while (low < high) {
      const middle = (low + high + 1n) / 2n;
      const block = await this.rpc.getBlock({blockNumber:middle});
      if (BigInt(block.timestamp) <= before) low = middle;
      else high = middle - 1n;
    }
    return String(low);
  }
  private async confirm(receipt: PaymentReceipt): Promise<PaymentReceipt> {
    try {
      const tx = await this.rpc.getTransactionReceipt({hash:receipt.transactionHash as Hex});
      if (tx.status!=='success') return {...receipt,status:'failed',reason:'Onchain transaction reverted'};
      const current = await this.rpc.getBlockNumber({cacheTime:0});
      if (BigInt(current) - BigInt(tx.blockNumber) + 1n < BigInt(this.options.confirmations ?? 2)) return {...receipt,status:'pending',reason:'Waiting for Base Sepolia confirmations'};
      const matching = tx.logs.some((log:any) => {
        if (log.address.toLowerCase()!==BASE_SEPOLIA_USDC.toLowerCase()) return false;
        try {
          const event = decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics});
          return event.eventName==='Transfer' && event.args.from.toLowerCase()===receipt.payer?.toLowerCase() && event.args.to.toLowerCase()===receipt.payee?.toLowerCase() && event.args.value===cents(receipt.amountCents!);
        } catch { return false; }
      });
      if (!matching) return {...receipt,status:'failed',reason:'Confirmed transaction does not contain the exact expected USDC transfer'};
      return {...receipt,status:'confirmed',blockNumber:String(tx.blockNumber),reason:undefined};
    } catch { return {...receipt,status:'pending',reason:'Transaction not yet confirmed or RPC unavailable'}; }
  }
}
export function createPaymentAdapter(env: NodeJS.ProcessEnv = process.env): PaymentAdapter {
  if ((env.FABYN_PAYMENT_MODE ?? 'mock')==='mock') return new MockPaymentAdapter();
  if (env.FABYN_PAYMENT_MODE!=='testnet') throw new Error('PAYMENT_MODE_INVALID');
  const missing = ['FABYN_TREASURY_ADDRESS','FABYN_BASE_SEPOLIA_RPC','FABYN_PUBLIC_ORIGIN'].filter(name=>!env[name]);
  if (missing.length) throw new Error(`X402_BLOCKED: missing ${missing.join(', ')}`);
  return new BaseSepoliaPaymentAdapter({treasuryAddress:env.FABYN_TREASURY_ADDRESS!,rpcUrl:env.FABYN_BASE_SEPOLIA_RPC!,resourceOrigin:env.FABYN_PUBLIC_ORIGIN!,treasuryPrivateKey:env.FABYN_TREASURY_PRIVATE_KEY as Hex|undefined,facilitatorUrl:env.FABYN_X402_FACILITATOR});
}
