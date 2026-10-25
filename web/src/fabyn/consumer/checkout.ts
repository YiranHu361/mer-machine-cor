/* Paying for a confirmed proposal.

   mock      → POST /orders/:id/confirm; the page says "demo payment".
   testnet   → the Fabyn wallet by default: POST /orders/:id/test-wallet-pay,
               the server signs the x402 payment with its own Base Sepolia test
               payer (no key ever reaches the browser) and returns the order
               with the transaction hash.
             → "use my own wallet" only when the browser has one: the x402
               challenge and signed retry in web/src/wallet.ts.
   Every path sends the same idempotency key for one offer, so a retry replays
   instead of paying twice. */

import { api, ApiError } from "../../api";
import { getCheckoutKey } from "../../storage";
import type { OrderView } from "./model";

export type PayMethod = "demo" | "fabyn_wallet" | "own_wallet";

export interface PaymentConfig {
  mode: "mock" | "testnet";
  builtInWallet: { available: boolean; address: string | null };
}

export async function paymentConfig(): Promise<PaymentConfig> {
  try {
    const c = await api<any>("/payments/config");
    return {
      mode: c?.mode === "testnet" ? "testnet" : "mock",
      builtInWallet: { available: !!c?.builtInWallet?.available, address: c?.builtInWallet?.address ?? null },
    };
  } catch {
    // an older backend: the plan's own payment mode decides, without the built-in wallet
    return { mode: "mock", builtInWallet: { available: false, address: null } };
  }
}

export const hasBrowserWallet = () =>
  typeof window !== "undefined" && !!(window as Window & { ethereum?: unknown }).ethereum;

/** Whether this offer takes real test money, or confirms with a demo payment. */
export const isTestnet = (o: OrderView) => o.plan?.paymentMode === "testnet" && (o.plan?.payableCents ?? 0) > 0;

function body(o: OrderView, idempotencyKey: string) {
  return {
    offerId: o.offer!.id,
    planVersion: o.plan!.version,
    planDigest: o.plan!.digest,
    permission: true,
    consent: { payment: true, production: true },
    idempotencyKey,
  };
}

export async function payOrder(o: OrderView, method: PayMethod): Promise<OrderView> {
  const idempotencyKey = getCheckoutKey({ id: o.id, quote: { id: o.offer!.id, version: o.plan!.version } });
  if (method === "own_wallet") {
    const { checkoutWithWallet } = await import("../../wallet");
    const result = await checkoutWithWallet<{ order: OrderView }>({
      jobId: o.id,
      quote: { id: o.offer!.id, totalCents: o.plan!.payableCents, expiresAt: o.offer!.expiresAt },
      order: { planVersion: o.plan!.version, planDigest: o.plan!.digest },
      idempotencyKey,
    });
    return result.order;
  }
  const path = method === "fabyn_wallet" ? `/orders/${o.id}/test-wallet-pay` : `/orders/${o.id}/confirm`;
  const { order } = await api<{ order: OrderView }>(path, body(o, idempotencyKey));
  return order;
}

/** Wallet problems in words a person can act on; null means use the general error text. */
export function walletMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === "TEST_WALLET_UNAVAILABLE") return "The Fabyn wallet is not set up on this server. Nothing was charged.";
  if (e.code === "TEST_WALLET_REFUSED") return "The Fabyn wallet could not sign this payment. Nothing was charged; try again in a moment.";
  if (e.code === "PAYMENT_REQUIRED" || e.status === 402) return "The payment was not accepted. Nothing was charged; try again.";
  return null;
}

export const receiptUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
