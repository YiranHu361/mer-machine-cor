import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import {
  checkoutWithWallet,
  validateChallenge,
  BASE_SEPOLIA_USDC,
  type WalletProvider,
} from "../src/wallet.ts";

const context = () => ({
  jobId: "job_browser",
  quote: {
    id: "quote_browser",
    totalCents: 75,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  },
  idempotencyKey: "same-checkout-key",
});
const treasury = "0x2222222222222222222222222222222222222222";
const challenge = () => ({
  x402Version: 2,
  resource: {
    url: "http://127.0.0.1:4318/api/jobs/job_browser/checkout?quote=quote_browser",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      asset: BASE_SEPOLIA_USDC,
      amount: "750000",
      payTo: treasury,
      maxTimeoutSeconds: 100,
      extra: { name: "USDC", version: "2" },
    },
  ],
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const required = (async () => response(challenge(), 402)) as typeof fetch;
// This well-known deterministic key is an offline test fixture, never a configured wallet.
const offline = privateKeyToAccount(
  ("0x" + "0".repeat(63) + "1") as `0x${string}`,
);
const provider = (overrides: Record<string, unknown> = {}): WalletProvider => ({
  request: async ({ method, params }) => {
    if (method in overrides) {
      const value = overrides[method];
      if (value instanceof Error) throw value;
      return value;
    }
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_requestAccounts") return [offline.address];
    if (method === "eth_signTypedData_v4")
      return offline.signTypedData(JSON.parse(String(params?.[1])));
    throw new Error(`Unexpected provider request ${method}`);
  },
});

test("only exact approved USDC on Base Sepolia and the bound order/quote can be signed", () => {
  assert.equal(
    validateChallenge(challenge(), context()).accepts[0].amount,
    "750000",
  );
  for (const mutate of [
    (x: any) => (x.accepts[0].network = "eip155:8453"),
    (x: any) => (x.accepts[0].asset = treasury),
    (x: any) => (x.accepts[0].amount = "750001"),
    (x: any) =>
      (x.resource.url = x.resource.url.replace("job_browser", "job_other")),
    (x: any) =>
      (x.resource.url = x.resource.url.replace("quote_browser", "quote_other")),
    (x: any) => (x.accepts[0].maxTimeoutSeconds = 1000),
    (x: any) => (x.accepts[0].asset = undefined),
  ]) {
    const value = challenge();
    mutate(value);
    assert.throws(() => validateChallenge(value, context()));
  }
  assert.throws(
    () =>
      validateChallenge(challenge(), {
        ...context(),
        quote: { ...context().quote, expiresAt: "invalid" },
      }),
    /expired/,
  );
});
test("missing wallet explains how to continue and never fabricates collection", async () => {
  await assert.rejects(
    () => checkoutWithWallet(context(), { fetcher: required }),
    /browser wallet.*No payment was signed or collected/,
  );
});
test("wrong wallet chain is rejected before requesting an account or signature", async () => {
  const methods: string[] = [];
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        fetcher: required,
        provider: {
          request: async ({ method }) => {
            methods.push(method);
            return "0x1";
          },
        },
      }),
    /Switch your wallet to Base Sepolia/,
  );
  assert.deepEqual(methods, ["eth_chainId"]);
});
test("wallet rejection is a recoverable state with no success claim", async () => {
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        fetcher: required,
        provider: provider({
          eth_requestAccounts: Object.assign(new Error("rejected"), {
            code: 4001,
          }),
        }),
      }),
    /Wallet approval was declined/,
  );
});
test("official x402 SDK signs through EIP1193, verifies offline, and repeats the same checkout key", async () => {
  const requests: { body: any; signature?: string }[] = [];
  let signedData: any;
  const wallet = provider();
  const observed: WalletProvider = {
    request: async (args) => {
      if (args.method === "eth_signTypedData_v4")
        signedData = JSON.parse(String(args.params?.[1]));
      return wallet.request(args);
    },
  };
  const fetcher = (async (_path, init) => {
    const signature =
      new Headers(init?.headers).get("PAYMENT-SIGNATURE") || undefined;
    requests.push({ body: JSON.parse(String(init?.body)), signature });
    return signature
      ? response({
          job: { paymentState: "held", productionState: "payment_confirmed" },
        })
      : response(challenge(), 402);
  }) as typeof fetch;
  const result = await checkoutWithWallet<{ job: { paymentState: string } }>(
    context(),
    { fetcher, provider: observed },
  );
  assert.equal(result.job.paymentState, "held");
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((x) => x.body.idempotencyKey),
    ["same-checkout-key", "same-checkout-key"],
  );
  const payload = JSON.parse(
    Buffer.from(requests[1].signature!, "base64").toString(),
  );
  assert.equal(payload.x402Version, 2);
  assert.equal(payload.payload.authorization.value, "750000");
  assert.equal(
    payload.payload.authorization.to.toLowerCase(),
    treasury.toLowerCase(),
  );
  assert.equal(
    payload.payload.authorization.from.toLowerCase(),
    offline.address.toLowerCase(),
  );
  assert.equal(
    await verifyTypedData({
      ...signedData,
      address: offline.address,
      signature: payload.payload.signature,
    }),
    true,
  );
});
test("retry of an existing pending checkout returns its durable state without a new signature", async () => {
  let walletCalls = 0;
  const result = await checkoutWithWallet<{ job: { paymentState: string } }>(
    context(),
    {
      fetcher: (async () =>
        response({
          job: { paymentState: "collection_pending" },
        })) as typeof fetch,
      provider: {
        request: async () => {
          walletCalls++;
          throw new Error("No wallet call expected");
        },
      },
    },
  );
  assert.equal(result.job.paymentState, "collection_pending");
  assert.equal(walletCalls, 0);
});
test("lost response after a signature directs reconciliation of the same checkout", async () => {
  let requests = 0;
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        provider: provider(),
        fetcher: (async () => {
          requests++;
          if (requests === 1) return response(challenge(), 402);
          throw new TypeError("network lost");
        }) as typeof fetch,
      }),
    /Retry this same order.*saved checkout/,
  );
  assert.equal(requests, 2);
});
test("unconfirmed settlement remains pending after wallet authorization", async () => {
  let requests = 0;
  const result = await checkoutWithWallet<{
    job: { paymentState: string; productionState: string };
  }>(context(), {
    provider: provider(),
    fetcher: (async () => {
      requests++;
      return requests === 1
        ? response(challenge(), 402)
        : response({
            job: {
              paymentState: "collection_pending",
              productionState: "quoted",
            },
          });
    }) as typeof fetch,
  });
  assert.equal(result.job.paymentState, "collection_pending");
  assert.equal(result.job.productionState, "quoted");
});
