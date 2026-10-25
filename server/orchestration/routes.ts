import type { Express, Request, Response } from "express";
import { Problem, requireThat } from "../model.ts";
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  decodeX402PaymentSignature,
  x402PaymentResponseHeader,
} from "../../integrations/src/payments.ts";
import type { TestWallet } from "../../integrations/src/test-wallet.ts";
import { PROCESS_OUTPUT } from "./matching.ts";
import { PUBLISHED_PROFILES } from "./knowledge.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { CloudProducer } from "../cloud-producer.ts";
import { producerConnection } from "../producer-status.ts";
import { printerPairs } from "../mvp-plan.ts";

type Actor = { id: string; role: string };

/** Consumer orchestration API; today's job routes keep serving older clients. */
export function registerOrchestrationRoutes(
  app: Express,
  {
    orchestrator,
    actor,
    owner,
    testWallet,
    producer,
  }: {
    orchestrator: Orchestrator;
    actor: (req: Request) => Promise<Actor>;
    owner: (req: Request) => Promise<unknown>;
    testWallet?: TestWallet;
    producer?: CloudProducer;
  },
) {
  const param = (req: Request, name: string) => String(req.params[name]);
  // A relief order is the coordinator's: its routes use the owner session even
  // when the same browser also holds a requester one.
  const orderActor = async (req: Request): Promise<Actor> => {
    const orders = (await orchestrator.service.read()).orders ?? {};
    const id = param(req, "id");
    return Object.hasOwn(orders, id) && orders[id].experience === "relief"
      ? ((await owner(req)) as Actor)
      : actor(req);
  };
  // The order, with the x402 settlement header once its collection is confirmed.
  const sendOrder = async (res: Response, order: any) => {
    const operation = (await orchestrator.service.read()).operations[
      order.makeIntent?.payment.operationId ?? ""
    ];
    const header =
      operation?.receipt && x402PaymentResponseHeader(operation.receipt);
    if (header) {
      res.setHeader("PAYMENT-RESPONSE", header);
      res.setHeader(
        "Access-Control-Expose-Headers",
        "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
      );
    }
    res.json({ order });
  };
  const walletOn = () =>
    !!testWallet && orchestrator.service.payment.mode === "testnet";
  // Whether each real printer answered its latest check: the site's indicator.
  app.get("/api/printers", async (req, res) => {
    await actor(req);
    res.json({ printers: producer
      ? producerConnection(await orchestrator.service.read()).printers
      : await orchestrator.printerStatus() });
  });
  // The public map and machine detail: titles only, nothing private.
  app.get("/api/machines/live", async (_req, res) => {
    res.json({ machines: await orchestrator.liveMachines() });
  });
  // The owner's "check printer" button: one fresh check of one machine.
  app.post("/api/owner/machines/:id/check", async (req, res) => {
    await owner(req);
    if (producer) {
      const pair = printerPairs().find((p) => p.ours === param(req, "id"));
      requireThat(pair, "MACHINE_NOT_FOUND", "Choose a configured printer.", 404);
      res.json({ ...await producer.check(pair.theirs), checkedAt: new Date().toISOString() });
    } else res.json(await orchestrator.checkNow(param(req, "id")));
  });
  app.post("/api/orders", async (req, res) => {
    const a =
      req.body?.experience === "relief"
        ? ((await owner(req)) as Actor)
        : await actor(req);
    const { order, created } = await orchestrator.createOrder(
      a,
      req.body,
      req.get("Idempotency-Key"),
    );
    res.status(created ? 202 : 200).json({
      order: await orchestrator.view(a, order.id),
    });
  });
  app.get("/api/orders/:id", async (req, res) => {
    res.json({
      order: await orchestrator.view(await orderActor(req), param(req, "id")),
    });
  });
  app.get("/api/orders/:id/events", async (req, res) => {
    const after = Number(req.query.after ?? 0);
    requireThat(
      Number.isSafeInteger(after) && after >= 0,
      "INVALID_CURSOR",
      "Give a non-negative event cursor.",
      422,
    );
    res.json(
      await orchestrator.events(await orderActor(req), param(req, "id"), after),
    );
  });
  app.patch("/api/orders/:id/draft", async (req, res) => {
    res.json({
      order: await orchestrator.editDraft(
        await orderActor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post("/api/orders/:id/design-choice", async (req, res) => {
    res.json({
      order: await orchestrator.chooseDesign(
        await orderActor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post("/api/orders/:id/more-like-this", async (req, res) => {
    res.json({
      order: await orchestrator.moreLikeThis(
        await orderActor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post(
    "/api/orders/:id/alternatives/:suggestion/select",
    async (req, res) => {
      res.json({
        order: await orchestrator.selectAlternative(
          await orderActor(req),
          param(req, "id"),
          param(req, "suggestion"),
          req.body,
        ),
      });
    },
  );
  for (const action of ["confirm", "pay"]) {
    app.post(`/api/orders/:id/${action}`, async (req, res) => {
      const a = await orderActor(req);
      let payload = req.body?.paymentPayload;
      if (req.get("PAYMENT-SIGNATURE")) {
        try {
          payload = decodeX402PaymentSignature(req.get("PAYMENT-SIGNATURE")!);
        } catch {
          throw new Problem(
            "INVALID_PAYMENT_HEADER",
            "The x402 payment signature header is malformed.",
            422,
          );
        }
      }
      await sendOrder(
        res,
        await orchestrator.confirm(a, param(req, "id"), req.body, payload),
      );
    });
  }
  // Which checkout to show: mock, a browser wallet, or the built-in test wallet.
  app.get("/api/payments/config", (_req, res) => {
    res.json({
      mode: orchestrator.service.payment.mode,
      network: BASE_SEPOLIA_NETWORK,
      asset: BASE_SEPOLIA_USDC,
      builtInWallet: walletOn()
        ? { available: true, address: testWallet!.address }
        : { available: false, address: null },
    });
  });
  // Pays with the built-in test wallet: the same challenge and signed retry a
  // browser wallet makes, signed here. Same body as /confirm.
  app.post("/api/orders/:id/test-wallet-pay", async (req, res) => {
    requireThat(
      walletOn(),
      "TEST_WALLET_UNAVAILABLE",
      "The built-in test wallet is off: it needs testnet payment mode, FABYN_TREASURY_ADDRESS and FABYN_TEST_PAYER_PRIVATE_KEY.",
    );
    const a = await orderActor(req),
      id = param(req, "id");
    let challenge: any;
    try {
      // Already paid, or nothing payable: no signature is needed.
      return await sendOrder(res, await orchestrator.confirm(a, id, req.body));
    } catch (e: any) {
      if (!e?.challenge) throw e;
      challenge = e.challenge.body;
    }
    const offer = (await orchestrator.service.read()).orders?.[id]?.offer;
    requireThat(offer, "STALE_OFFER", "This proposal changed. Nothing was charged.");
    let payload;
    try {
      payload = await testWallet!.pay(challenge, {
        totalCents: offer.payableCents,
        offerId: offer.id,
        planDigest: offer.planDigest,
        path: `/api/orders/${encodeURIComponent(id)}/pay`,
        expiresAt: offer.expiresAt,
      });
    } catch (e) {
      const code = String((e as Error)?.message ?? "");
      throw new Problem(
        "TEST_WALLET_REFUSED",
        `The built-in test wallet did not sign (${/^TEST_WALLET_[A-Z_]+$/.test(code) ? code : "signing failed"}). Nothing was charged.`,
        409,
      );
    }
    await sendOrder(res, await orchestrator.confirm(a, id, req.body, payload));
  });
  app.post("/api/orders/:id/cancel", async (req, res) => {
    res.json({
      order: await orchestrator.cancel(await orderActor(req), param(req, "id")),
    });
  });
  // Pickup or delivery: the person's choice, then the owner's courier.
  app.post("/api/orders/:id/delivery", async (req, res) => {
    res.json({
      order: await orchestrator.chooseDelivery(
        await orderActor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post("/api/owner/orders/:id/courier", async (req, res) => {
    await owner(req);
    res.json(await orchestrator.callCourier(param(req, "id"), req.body));
  });
  app.post("/api/owner/orders/:id/handed-over", async (req, res) => {
    await owner(req);
    res.json(await orchestrator.handOver(param(req, "id")));
  });
  app.get("/api/machines/capabilities", async (_req, res) => {
    const s = await orchestrator.service.read();
    res.json({
      machines: Object.values(s.machines).map((m) => ({
        id: m.id,
        name: m.name,
        model: m.model,
        process: Object.entries(PROCESS_OUTPUT).find(
          ([, o]) => o === m.outputType,
        )?.[0],
        mode: m.mode,
        available: m.ready && m.listed && !m.paused && !m.activeJobId,
        profileVersion: PUBLISHED_PROFILES[m.model]?.version ?? null,
      })),
    });
  });
  app.get("/api/relief", async (req, res) => {
    await owner(req);
    const r = await orchestrator.relief();
    const s = await orchestrator.service.read();
    res.json({
      relief: r,
      orders: Object.values(s.orders ?? {})
        .filter((o) => o.experience === "relief")
        .map((o) => ({
          id: o.id,
          status: o.status,
          createdAt: o.createdAt,
          planVersion: o.plan?.version ?? null,
        })),
    });
  });
  app.post("/api/relief/demo/:action", async (req, res) => {
    await owner(req);
    res.json({
      relief: await orchestrator.reliefDemo(param(req, "action"), req.body),
    });
  });
}
