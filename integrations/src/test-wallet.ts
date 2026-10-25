import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';
import { getAddress, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC } from './payments.js';

/** What the requester approved: the challenge must ask for exactly this. */
export interface ExpectedTestPayment {
  totalCents: number;
  offerId: string;
  planDigest: string;
  /** e.g. /api/orders/ord_1/pay */
  path: string;
  expiresAt: string;
}
/**
 * The built-in Base Sepolia test wallet, so a demo needs no browser wallet.
 * It signs only exact USDC payments on Base Sepolia (84532) to the configured
 * treasury, for the approved quote, and never above maxCents.
 */
export interface TestWallet {
  readonly address: string;
  pay(challenge: PaymentRequired, expected: ExpectedTestPayment): Promise<PaymentPayload>;
}
type Signer = ConstructorParameters<typeof ExactEvmScheme>[0];

/** The same checks the browser wallet makes (web/src/wallet.ts), plus the payee. */
export function checkTestChallenge(challenge: PaymentRequired, expected: ExpectedTestPayment, treasury: string, maxCents: number) {
  if (challenge?.x402Version !== 2 || !Array.isArray(challenge.accepts) || challenge.accepts.length !== 1) throw new Error('TEST_WALLET_UNSUPPORTED_CHALLENGE');
  const accepted = challenge.accepts[0];
  if (accepted?.scheme !== 'exact' || accepted.network !== BASE_SEPOLIA_NETWORK || String(accepted.asset).toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) throw new Error('TEST_WALLET_BASE_SEPOLIA_USDC_ONLY');
  if (!Number.isSafeInteger(expected.totalCents) || expected.totalCents < 1 || expected.totalCents > maxCents) throw new Error('TEST_WALLET_AMOUNT_OUT_OF_RANGE');
  if (accepted.amount !== (BigInt(expected.totalCents) * 10_000n).toString()) throw new Error('TEST_WALLET_AMOUNT_MISMATCH');
  if (!isAddress(accepted.payTo) || getAddress(accepted.payTo) !== getAddress(treasury)) throw new Error('TEST_WALLET_PAYEE_MISMATCH');
  let resource: URL;
  try { resource = new URL(challenge.resource?.url ?? ''); } catch { throw new Error('TEST_WALLET_RESOURCE_MISMATCH'); }
  if (resource.pathname !== expected.path || resource.searchParams.get('offer') !== expected.offerId || resource.searchParams.get('plan') !== expected.planDigest) throw new Error('TEST_WALLET_RESOURCE_MISMATCH');
  const remaining = Math.floor((Date.parse(expected.expiresAt) - Date.now()) / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 1 || accepted.maxTimeoutSeconds > Math.min(300, remaining)) throw new Error('TEST_WALLET_QUOTE_EXPIRED');
  return accepted;
}

export class BaseSepoliaTestWallet implements TestWallet {
  readonly address: string;
  constructor(private readonly signer: Signer, private readonly treasury: string, private readonly maxCents: number) {
    this.address = getAddress(signer.address);
  }
  async pay(challenge: PaymentRequired, expected: ExpectedTestPayment) {
    const accepted = checkTestChallenge(challenge, expected, this.treasury, this.maxCents);
    const client = x402Client.fromConfig({
      schemes: [{ network: BASE_SEPOLIA_NETWORK, client: new ExactEvmScheme(this.signer) }],
      // The SDK defaults to $1; allow exactly the checked amount, in test USDC only.
      spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: BASE_SEPOLIA_NETWORK, asset: BASE_SEPOLIA_USDC, maxAmountPerPayment: accepted.amount }] },
    });
    return client.createPaymentPayload(challenge);
  }
}

/**
 * The wallet from FABYN_TEST_PAYER_PRIVATE_KEY, only in testnet payment mode
 * with a treasury configured. Errors never carry the key.
 */
export function createTestWallet(env: NodeJS.ProcessEnv = process.env): TestWallet | undefined {
  if (env.FABYN_PAYMENT_MODE !== 'testnet' || !env.FABYN_TREASURY_ADDRESS || !isAddress(env.FABYN_TREASURY_ADDRESS)) return undefined;
  const key = env.FABYN_TEST_PAYER_PRIVATE_KEY;
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('FABYN_TEST_PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.');
  let signer: Signer;
  try { signer = privateKeyToAccount(key as Hex); } catch { throw new Error('FABYN_TEST_PAYER_PRIVATE_KEY is not a valid private key.'); }
  const maxCents = Number(env.FABYN_TEST_WALLET_MAX_CENTS ?? 2000);
  if (!Number.isSafeInteger(maxCents) || maxCents < 1) throw new Error('FABYN_TEST_WALLET_MAX_CENTS must be a positive whole number of cents.');
  return new BaseSepoliaTestWallet(signer, env.FABYN_TREASURY_ADDRESS, maxCents);
}
