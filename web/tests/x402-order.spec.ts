import { test, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

// Entirely offline API and wallet. This test cannot reach a device or a facilitator.
test("Pay & make signs the approved testnet order and shows confirmation and a transaction link", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const tx = "0x" + "ab".repeat(32);
  const payer = privateKeyToAccount(
    ("0x" + "0".repeat(63) + "1") as `0x${string}`,
  );
  let signedPosts = 0;
  const requests: any[] = [];
  const order: any = {
    id: "order_x402_browser",
    experience: "best_single",
    status: "proposed",
    draft: {
      revision: 1,
      requestText: "A test sticker",
      photoAssetIds: [],
      stage: "proposed",
    },
    plan: {
      version: 1,
      digest: "approved-plan",
      paymentMode: "testnet",
      payableCents: 1,
      simulatedEstimateCents: 0,
      collectionPoint: "Demo table",
      readyEstimateMinutes: 1,
      status: "proposed",
      items: [
        {
          id: "item",
          name: "Test sticker",
          why: "A test print",
          quantity: 1,
          source: "requested",
          design: { kind: "svg" },
        },
      ],
      assignments: [
        {
          id: "assignment",
          itemId: "item",
          machineName: "Test printer",
          machineSource: "registry",
          executionMode: "hardware",
          chargeable: true,
          quantity: 1,
          previewUrl:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="black"/%3E%3C/svg%3E',
          price: {
            totalCents: 1,
            terms: [{ label: "Test payment", cents: 1 }],
          },
        },
      ],
    },
    offer: {
      id: "offer_x402",
      planVersion: 1,
      planDigest: "approved-plan",
      expiresAt: new Date(Date.now() + 120000).toISOString(),
    },
    suggestions: [],
    events: [],
  };
  await page.exposeFunction("signTestPayment", (data: string) =>
    payer.signTypedData(JSON.parse(data)),
  );
  await page.addInitScript(
    ({ address }) => {
      (window as any).ethereum = {
        request: async ({ method, params }: any) => {
          if (method === "eth_chainId") return "0x14a34";
          if (method === "eth_requestAccounts") return [address];
          if (method === "eth_signTypedData_v4")
            return (window as any).signTestPayment(params[1]);
          throw new Error(`Unexpected wallet request: ${method}`);
        },
      };
    },
    { address: payer.address },
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (path === "/api/health")
      return json({
        mode: "simulation",
        paymentMode: "testnet",
        store: "offline-browser-fixture",
      });
    if (path === "/api/session")
      return json({ role: "requester", id: "test_requester" });
    if (path === "/api/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": offline\n\n",
      });
    if (path === `/api/orders/${order.id}`) return json({ order });
    if (path === `/api/orders/${order.id}/pay`) {
      requests.push(route.request().postDataJSON());
      const signature = route.request().headers()["payment-signature"];
      if (!signature)
        return json(
          {
            x402Version: 2,
            resource: {
              url: `http://127.0.0.1:4329/api/orders/${order.id}/pay?offer=${order.offer.id}&plan=${order.plan.digest}`,
            },
            accepts: [
              {
                scheme: "exact",
                network: "eip155:84532",
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                amount: "10000",
                payTo: "0x2222222222222222222222222222222222222222",
                maxTimeoutSeconds: 90,
                extra: { name: "USDC", version: "2" },
              },
            ],
          },
          402,
        );
      signedPosts++;
      const payload = JSON.parse(Buffer.from(signature, "base64").toString());
      expect(payload.payload.authorization.value).toBe("10000");
      order.makeIntent = {
        status: "payment_pending",
        payment: { status: "pending", transactionHash: tx },
      };
      order.plan.status = "approved";
      return json({ order });
    }
    return route.abort();
  });
  await page.goto(`/make?order=${order.id}`);
  const pay = page.getByRole("button", { name: "Pay $0.01 & make" });
  await expect(pay).toBeDisabled();
  await page
    .getByLabel("I own these pictures or have permission to make this design")
    .check();
  await pay.click();
  await expect(
    page.getByText("Waiting for test payment confirmation.", { exact: true }),
  ).toBeVisible();
  expect(signedPosts).toBe(1);
  expect(requests[0]).toEqual(requests[1]);
  order.makeIntent.payment.status = "confirmed";
  order.makeIntent.status = "submitted";
  order.plan.status = "in_progress";
  await expect(
    page.getByRole("link", {
      name: "Test payment confirmed · view transaction",
    }),
  ).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${tx}`);
  await page.reload();
  await expect(
    page.getByRole("link", {
      name: "Test payment confirmed · view transaction",
    }),
  ).toBeVisible();
  expect(signedPosts).toBe(1);
  expect(pageErrors).toEqual([]);
});
