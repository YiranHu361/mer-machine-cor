import type { Express, Request } from "express";
import { requireThat } from "../model.ts";
import { PROCESS_OUTPUT } from "./matching.ts";
import { PUBLISHED_PROFILES } from "./knowledge.ts";
import type { Orchestrator } from "./orchestrator.ts";

type Actor = { id: string; role: string };

/** Consumer orchestration API; today's job routes keep serving older clients. */
export function registerOrchestrationRoutes(
  app: Express,
  {
    orchestrator,
    actor,
    owner,
  }: {
    orchestrator: Orchestrator;
    actor: (req: Request) => Promise<Actor>;
    owner: (req: Request) => Promise<unknown>;
  },
) {
  const param = (req: Request, name: string) => String(req.params[name]);
  app.post("/api/orders", async (req, res) => {
    const a = await actor(req);
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
      order: await orchestrator.view(await actor(req), param(req, "id")),
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
      await orchestrator.events(await actor(req), param(req, "id"), after),
    );
  });
  app.patch("/api/orders/:id/draft", async (req, res) => {
    res.json({
      order: await orchestrator.editDraft(
        await actor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post("/api/orders/:id/design-choice", async (req, res) => {
    res.json({
      order: await orchestrator.chooseDesign(
        await actor(req),
        param(req, "id"),
        req.body,
      ),
    });
  });
  app.post("/api/orders/:id/more-like-this", async (req, res) => {
    res.json({
      order: await orchestrator.moreLikeThis(
        await actor(req),
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
          await actor(req),
          param(req, "id"),
          param(req, "suggestion"),
          req.body,
        ),
      });
    },
  );
  app.post("/api/orders/:id/confirm", async (req, res) => {
    res.json({
      order: await orchestrator.confirm(
        await actor(req),
        param(req, "id"),
        req.body,
        req.body?.paymentPayload,
      ),
    });
  });
  // Compatibility seam for the shared x402 design: it only reports the accepted intent.
  app.post("/api/orders/:id/pay", async (req, res) => {
    const order = await orchestrator.view(await actor(req), param(req, "id"));
    requireThat(
      order.makeIntent,
      "CONFIRM_FIRST",
      "Confirm the exact offer first; payment follows that confirmation.",
      409,
    );
    res.json({ order });
  });
  app.post("/api/orders/:id/cancel", async (req, res) => {
    res.json({
      order: await orchestrator.cancel(await actor(req), param(req, "id")),
    });
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
