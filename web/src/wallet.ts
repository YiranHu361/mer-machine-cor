import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  createWalletClient,
  custom,
  isAddress,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  beginWalletAuthorization,
  cancelUnsubmittedWalletAuthorization,
  hasWalletAuthorization,
  WALLET_RETRY_NOTICE,
} from "./storage.ts";

export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type CheckoutQuote = { id: string; totalCents: number; expiresAt: string };
type CheckoutContext = {
  jobId: string;
  quote: CheckoutQuote;
  idempotencyKey: string;
};
export function validateChallenge(
  value: unknown,
  context: CheckoutContext,
): PaymentRequired {
  const challenge = value as PaymentRequired;
  if (
    challenge?.x402Version !== 2 ||
    !Array.isArray(challenge.accepts) ||
    challenge.accepts.length !== 1
  )
    throw new Error(
      "The test payment challenge is unsupported. Ask the owner to check the payment service.",
    );
  const accepted = challenge.accepts[0];
  if (
    !accepted ||
    typeof accepted.asset !== "string" ||
    accepted.scheme !== "exact" ||
    accepted.network !== "eip155:84532" ||
    accepted.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()
  )
    throw new Error(
      "Only USDC test payments on Base Sepolia are supported. No payment was signed.",
    );
  if (
    !Number.isSafeInteger(context.quote.totalCents) ||
    context.quote.totalCents < 1 ||
    accepted.amount !==
      (BigInt(context.quote.totalCents) * 10000n).toString() ||
    !isAddress(accepted.payTo)
  )
    throw new Error(
      "The wallet payment does not match the approved quote. Refresh the quote before paying.",
    );
  let resource: URL;
  try {
    resource = new URL(challenge.resource?.url || "");
  } catch {
    throw new Error("The payment challenge has no valid order reference.");
  }
  if (
    resource.pathname !==
      `/api/jobs/${encodeURIComponent(context.jobId)}/checkout` ||
    resource.searchParams.get("quote") !== context.quote.id
  )
    throw new Error(
      "This payment challenge belongs to a different order or quote. No payment was signed.",
    );
  const remaining = Math.floor(
    (Date.parse(context.quote.expiresAt) - Date.now()) / 1000,
  );
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    !Number.isInteger(accepted.maxTimeoutSeconds) ||
    accepted.maxTimeoutSeconds < 1 ||
    accepted.maxTimeoutSeconds > Math.min(300, remaining)
  )
    throw new Error(
      "This quote or wallet authorization expired. Refresh the quote before paying.",
    );
  return challenge;
}
export async function checkoutWithWallet<T>(
  context: CheckoutContext,
  options: { provider?: WalletProvider; fetcher?: typeof fetch } = {},
): Promise<T> {
  const fetcher = options.fetcher || fetch;
  const path = `/api/jobs/${encodeURIComponent(context.jobId)}/checkout`;
  const request = (headers?: Record<string, string>) =>
    fetcher(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ idempotencyKey: context.idempotencyKey }),
    });
  let response: Response;
  try {
    response = await request();
  } catch {
    throw new Error(
      "The workshop disconnected before checkout returned. Retry this order to reconcile the same checkout.",
    );
  }
  const value = await response.json().catch(() => ({}));
  if (response.status !== 402) {
    if (!response.ok)
      throw new Error(
        value.error?.message ||
          "Testnet checkout could not continue. Payment has not been confirmed.",
      );
    return value as T;
  }
  const challenge = validateChallenge(value, context);
  if (hasWalletAuthorization(context)) throw new Error(WALLET_RETRY_NOTICE);
  const provider =
    options.provider ||
    (typeof window !== "undefined"
      ? (window as Window & { ethereum?: WalletProvider }).ethereum
      : undefined);
  if (!provider)
    throw new Error(
      "Connect a browser wallet with Base Sepolia test USDC, then retry checkout. No payment was signed or collected.",
    );
  try {
    const chain = await provider.request({ method: "eth_chainId" });
    if (typeof chain !== "string" || Number.parseInt(chain, 16) !== 84532)
      throw new Error(
        "Switch your wallet to Base Sepolia (chain 84532), then retry checkout. Production networks are disabled.",
      );
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof account !== "string" || !isAddress(account))
      throw new Error("Choose a Base Sepolia test wallet account to continue.");
    const wallet = createWalletClient({
      account: account as Hex,
      chain: baseSepolia,
      transport: custom(provider as EIP1193Provider),
    });
    const signer = {
      address: account as Hex,
      signTypedData: async (message: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      }) => {
        beginWalletAuthorization(context);
        try {
          return await wallet.signTypedData({
            ...message,
            account: account as Hex,
          } as Parameters<typeof wallet.signTypedData>[0]);
        } catch (error) {
          // Signing failed before any payload could reach our checkout API.
          cancelUnsubmittedWalletAuthorization(context);
          const walletError = error as {
            code?: number;
            name?: string;
            cause?: { code?: number };
          };
          if (
            walletError.code === 4001 ||
            walletError.cause?.code === 4001 ||
            walletError.name === "UserRejectedRequestError"
          )
            throw Object.assign(new Error("Wallet approval was declined."), {
              code: 4001,
            });
          throw new Error(
            "Your wallet could not sign the Base Sepolia test authorization. No payment is confirmed. Check the wallet connection and retry this order.",
          );
        }
      },
    };
    const client = new x402Client().register(
      "eip155:84532",
      new ExactEvmScheme(signer),
    );
    const payload = await client.createPaymentPayload(challenge);
    // The server verifies and settles this authorization. A signature is not collection.
    const signedResponse = await request({
      "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
    });
    const signedValue = await signedResponse.json().catch(() => ({}));
    if (!signedResponse.ok)
      throw new Error(
        signedValue.error?.message ||
          "The signed payment was not confirmed. Retry this order to reconcile the same checkout; do not start another order.",
      );
    return signedValue as T;
  } catch (error) {
    if ((error as { code?: number }).code === 4001)
      throw new Error(
        "Wallet approval was declined. No new payment is confirmed. You can retry this order.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "The connection was lost after wallet approval. Retry this same order to reconcile the saved checkout before signing another payment.",
      );
    throw error;
  }
}
