import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import {
  checkoutWithWallet,
  validateChallenge,
  BASE_SEPOLIA_USDC,
  type WalletProvider,
} from "../src/wallet.ts";
import { cancelUnsubmittedWalletAuthorization } from "../src/storage.ts";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storageFixture(), sessionStorage: storageFixture() },
  });
  cancelUnsubmittedWalletAuthorization(context());
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

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
test("an ignored wallet network switch cannot reach signing", async () => {
  const methods: string[] = [];
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        fetcher: required,
        provider: {
          request: async ({ method }) => {
            methods.push(method);
            if (method === "eth_requestAccounts") return [offline.address];
            if (method === "eth_chainId") return "0x1";
            if (method === "wallet_switchEthereumChain") return null;
            throw new Error("No signing is allowed on the wrong network");
          },
        },
      }),
    /wallet has not switched to Base Sepolia/,
  );
  assert.deepEqual(methods, [
    "eth_requestAccounts",
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});
test("checkout asks the wallet to add and select Base Sepolia before signing", async () => {
  const methods: string[] = [];
  let chain = "0x1",
    added = false;
  const signer = provider();
  const wallet: WalletProvider = {
    request: async (args) => {
      methods.push(args.method);
      if (args.method === "eth_chainId") return chain;
      if (args.method === "wallet_switchEthereumChain") {
        assert.deepEqual(args.params, [{ chainId: "0x14a34" }]);
        if (!added)
          throw Object.assign(new Error("unknown network"), { code: 4902 });
        chain = "0x14a34";
        return null;
      }
      if (args.method === "wallet_addEthereumChain") {
        const network = args.params![0] as any;
        assert.equal(network.chainId, "0x14a34");
        assert.deepEqual(network.rpcUrls, ["https://sepolia.base.org"]);
        added = true;
        return null;
      }
      return signer.request(args);
    },
  };
  const fetcher = (async (_path, init) =>
    new Headers(init?.headers).has("PAYMENT-SIGNATURE")
      ? response({ job: { paymentState: "held" } })
      : response(challenge(), 402)) as typeof fetch;
  const result = await checkoutWithWallet<any>(context(), {
    provider: wallet,
    fetcher,
  });
  assert.equal(result.job.paymentState, "held");
  assert.ok(
    methods.indexOf("wallet_addEthereumChain") <
      methods.indexOf("eth_signTypedData_v4"),
  );
});
test("declining a testnet switch never signs or submits a payment", async () => {
  let signs = 0;
  const signer = provider();
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        fetcher: required,
        provider: {
          request: async (args) => {
            if (args.method === "eth_chainId") return "0x1";
            if (args.method === "wallet_switchEthereumChain")
              throw Object.assign(new Error("declined"), { code: 4001 });
            if (args.method === "eth_signTypedData_v4") signs++;
            return signer.request(args);
          },
        },
      }),
    /Wallet approval was declined/,
  );
  assert.equal(signs, 0);
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
test("a signed response body timeout retains its authorization and cannot request another signature", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signedPosts = 0,
    signatures = 0;
  let entered!: () => void;
  const signedStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const actual = provider();
  const observed: WalletProvider = {
    request: async (args) => {
      if (args.method === "eth_signTypedData_v4") signatures++;
      return actual.request(args);
    },
  };
  const fetcher = (async (_path, init) => {
    if (!(init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"])
      return response(challenge(), 402);
    signedPosts++;
    entered();
    return {
      json: () => new Promise(() => {}),
      ok: true,
      status: 200,
    } as Response;
  }) as typeof fetch;
  const pending = checkoutWithWallet(context(), {
    provider: observed,
    fetcher,
  });
  const failed = assert.rejects(
    pending,
    /Retry this same order.*saved checkout/,
  );
  await signedStarted;
  t.mock.timers.tick(180_001);
  await failed;
  await assert.rejects(
    checkoutWithWallet(context(), { provider: observed, fetcher }),
    /authorization.*already|reconcile|reconciliation/i,
  );
  assert.equal(signatures, 1);
  assert.equal(signedPosts, 1);
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

test("unavailable, quota-limited, or silent session storage blocks signatures and signed submissions", async () => {
  for (const failure of ["getter", "quota", "silent-write"] as const) {
    const value = { sessionStorage: storageFixture() };
    Object.defineProperty(globalThis, "window", { configurable: true, value });
    cancelUnsubmittedWalletAuthorization(context());
    if (failure === "getter")
      Object.defineProperty(value, "sessionStorage", {
        get: () => {
          throw new DOMException("Denied", "SecurityError");
        },
      });
    else
      value.sessionStorage.setItem =
        failure === "quota"
          ? () => {
              throw new DOMException("Full", "QuotaExceededError");
            }
          : () => {};
    let signatures = 0;
    let signedPosts = 0;
    const actual = provider();
    await assert.rejects(
      () =>
        checkoutWithWallet(context(), {
          provider: {
            request: async (args) => {
              if (args.method === "eth_signTypedData_v4") signatures++;
              return actual.request(args);
            },
          },
          fetcher: (async (_path, init) => {
            if (new Headers(init?.headers).has("PAYMENT-SIGNATURE"))
              signedPosts++;
            return response(challenge(), 402);
          }) as typeof fetch,
        }),
      /Browser storage is unavailable.*No payment was signed or submitted/,
    );
    assert.equal(signatures, 0);
    assert.equal(signedPosts, 0);
  }
});
test("an ambiguous signed retry cannot request another authorization when API still returns 402", async () => {
  let signatures = 0;
  let signedPosts = 0;
  const actual = provider();
  const options = {
    provider: {
      request: async (args: Parameters<WalletProvider["request"]>[0]) => {
        if (args.method === "eth_signTypedData_v4") signatures++;
        return actual.request(args);
      },
    },
    fetcher: (async (_path, init) => {
      if (new Headers(init?.headers).has("PAYMENT-SIGNATURE")) {
        signedPosts++;
        throw new TypeError("fixture lost response");
      }
      return response(challenge(), 402);
    }) as typeof fetch,
  };
  await assert.rejects(
    () => checkoutWithWallet(context(), options),
    /Retry this same order/,
  );
  await assert.rejects(
    () => checkoutWithWallet(context(), options),
    /earlier wallet authorization may still be pending/,
  );
  assert.equal(signatures, 1);
  assert.equal(signedPosts, 1);
});
test("a saved ambiguous authorization allows server reconciliation without wallet access", async () => {
  let calls = 0;
  await assert.rejects(() =>
    checkoutWithWallet(context(), {
      provider: provider(),
      fetcher: (async (_path, init) => {
        if (new Headers(init?.headers).has("PAYMENT-SIGNATURE"))
          throw new TypeError("fixture lost response");
        return response(challenge(), 402);
      }) as typeof fetch,
    }),
  );
  const result = await checkoutWithWallet<{ job: { paymentState: string } }>(
    context(),
    {
      provider: {
        request: async () => {
          calls++;
          throw new Error("must not call wallet");
        },
      },
      fetcher: (async () =>
        response({
          job: { paymentState: "collection_pending" },
        })) as typeof fetch,
    },
  );
  assert.equal(result.job.paymentState, "collection_pending");
  assert.equal(calls, 0);
});

test("concurrent checkout requests cannot ask for two signatures while one wallet approval is open", async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signatures = 0;
  const actual = provider();
  const options = {
    provider: {
      request: async (args: Parameters<WalletProvider["request"]>[0]) => {
        if (args.method === "eth_signTypedData_v4") {
          signatures++;
          entered();
          await gate;
        }
        return actual.request(args);
      },
    },
    fetcher: (async (_path, init) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE")
        ? response({ job: { paymentState: "held" } })
        : response(challenge(), 402)) as typeof fetch,
  };
  const first = checkoutWithWallet(context(), options);
  await waiting;
  await assert.rejects(
    () => checkoutWithWallet(context(), options),
    /earlier wallet authorization may still be pending/,
  );
  release();
  await first;
  assert.equal(signatures, 1);
});

test("declining the signature before submission clears its checkpoint and permits an explicit retry", async () => {
  const fetcher = (async (_path, init) =>
    new Headers(init?.headers).has("PAYMENT-SIGNATURE")
      ? response({ job: { paymentState: "held" } })
      : response(challenge(), 402)) as typeof fetch;
  await assert.rejects(
    () =>
      checkoutWithWallet(context(), {
        fetcher,
        provider: provider({
          eth_signTypedData_v4: Object.assign(new Error("Declined"), {
            code: 4001,
          }),
        }),
      }),
    /Wallet approval was declined/,
  );
  const result = await checkoutWithWallet<{ job: { paymentState: string } }>(
    context(),
    { fetcher, provider: provider() },
  );
  assert.equal(result.job.paymentState, "held");
});

test("cleared session storage cannot erase an ambiguous authorization claim in the open page", async () => {
  let signatures = 0;
  const actual = provider();
  const options = {
    provider: {
      request: async (args: Parameters<WalletProvider["request"]>[0]) => {
        if (args.method === "eth_signTypedData_v4") signatures++;
        return actual.request(args);
      },
    },
    fetcher: (async (_path, init) => {
      if (new Headers(init?.headers).has("PAYMENT-SIGNATURE"))
        throw new TypeError("fixture lost response");
      return response(challenge(), 402);
    }) as typeof fetch,
  };
  await assert.rejects(
    () => checkoutWithWallet(context(), options),
    /Retry this same order/,
  );
  // A browser privacy control/eviction removes persisted entries while this
  // document remains open. Do not let null storage create another signature.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storageFixture(), sessionStorage: storageFixture() },
  });
  await assert.rejects(
    () => checkoutWithWallet(context(), options),
    /earlier wallet authorization may still be pending/,
  );
  assert.equal(signatures, 1);
});

test("whole-order checkout binds the offer and plan digest and replays the exact consent with the signed payment", async () => {
  const c = {
    ...context(),
    quote: { ...context().quote, totalCents: 175 },
    jobId: "order_wallet",
    order: { planVersion: 3, planDigest: "approved-plan-digest" },
  };
  const required = challenge();
  required.accepts[0].amount = "1750000";
  required.resource.url = `http://127.0.0.1:4318/api/orders/${c.jobId}/pay?offer=${c.quote.id}&plan=${c.order.planDigest}`;
  for (const resource of [
    required.resource.url.replace("approved-plan-digest", "different-plan"),
    required.resource.url.replace("quote_browser", "other-offer"),
  ]) {
    assert.throws(
      () => validateChallenge({ ...required, resource: { url: resource } }, c),
      /different order or quote/,
    );
  }
  const calls: { path: string; body: any; signature: string | null }[] = [];
  const fetcher = (async (path, init) => {
    const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    calls.push({
      path: String(path),
      body: JSON.parse(String(init?.body)),
      signature,
    });
    return signature
      ? response({ order: { makeIntent: { payment: { status: "pending" } } } })
      : response(required, 402);
  }) as typeof fetch;
  const result = await checkoutWithWallet<any>(c, {
    fetcher,
    provider: provider(),
  });
  assert.equal(result.order.makeIntent.payment.status, "pending");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, `/api/orders/${c.jobId}/pay`);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body, {
    idempotencyKey: c.idempotencyKey,
    offerId: c.quote.id,
    planVersion: 3,
    planDigest: c.order.planDigest,
    permission: true,
    consent: { payment: true, production: true },
  });
  assert.equal(
    JSON.parse(Buffer.from(calls[1].signature!, "base64").toString()).resource
      .url,
    required.resource.url,
  );
});
