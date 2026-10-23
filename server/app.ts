import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { Service } from "./service.ts";
import { createClaudeProvider } from "../integrations/src/claude.ts";
import {
  decodeX402PaymentSignature,
  x402PaymentResponseHeader,
} from "../integrations/src/payments.ts";
import { mutate } from "./store.ts";
import {
  Problem,
  requireThat,
  id,
  now,
  specSchema,
  ownValue,
  record,
  type Asset,
  type Machine,
  type Job,
} from "./model.ts";
const exec = promisify(execFile);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 4, fields: 4 },
});
const machineSchema = z
  .object({
    listed: z.boolean().optional(),
    paused: z.boolean().optional(),
    inspected: z.boolean().optional(),
    cleared: z.boolean().optional(),
    mediaRemaining: z.number().int().min(0).max(10000).optional(),
    material: z.enum(["thermal-paper", "photo-film", "pla"]).optional(),
    priceCard: z
      .object({
        consumables: z.number().int().min(0).max(100000),
        machine: z.number().int().min(0).max(100000),
        handling: z.number().int().min(0).max(100000),
        platform: z.number().int().min(0).max(100000),
      })
      .optional(),
    hours: z
      .object({
        start: z.number().int().min(0).max(23),
        end: z.number().int().min(1).max(24),
      })
      .refine((h) => h.start < h.end)
      .optional(),
    maxJobSeconds: z.number().int().min(1).max(3600).optional(),
    collectionPoint: z.string().trim().min(3).max(150).optional(),
    policy: z
      .object({
        authorizedArtwork: z.boolean(),
        maxQuantity: z.number().int().min(1).max(10),
      })
      .optional(),
    ownerAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .strict();
export function createApp(
  service: Service,
  webDirectory = resolve("web/dist"),
) {
  const app = express();
  app.disable("x-powered-by");
  // Built UI bundles are public; uploaded job artwork stays behind /assets/:id authorization.
  app.use(
    "/assets",
    express.static(join(webDirectory, "assets"), { index: false }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    req.body ??= {};
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      try {
        const origin = new URL(req.headers.origin);
        requireThat(
          ["127.0.0.1", "localhost"].includes(origin.hostname) &&
            [4317, 4318].includes(Number(origin.port)),
          "ORIGIN_REJECTED",
          "This local application only accepts requests from its own interface.",
          403,
        );
      } catch (e) {
        return next(e);
      }
    }
    next();
  });
  const actor = async (req: Request) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("fabrary_session="))
      ?.slice(16);
    const s = await service.read();
    const session = cookie ? ownValue(s.sessions, cookie) : undefined;
    requireThat(
      session && Date.parse(session.expiresAt) > Date.now(),
      "AUTH_REQUIRED",
      "Sign in to continue.",
      401,
    );
    return session;
  };
  const owner = async (req: Request) => {
    const a = await actor(req);
    requireThat(
      a.role === "owner",
      "OWNER_REQUIRED",
      "Owner access is required.",
      403,
    );
    return a;
  };
  const owned = async (req: Request) => {
    const a = await actor(req);
    await service.job(String(req.params.id), a);
    return a;
  };
  const ownerJob = async (req: Request) => {
    const a = await owner(req);
    await service.job(String(req.params.id), a);
    return a;
  };
  const view = (j: Job) => ({
    ...j,
    evidence: j.evidence
      ? {
          ...j.evidence,
          frame: undefined,
          url: j.evidence.url ? `/api/jobs/${j.id}/evidence` : undefined,
        }
      : undefined,
  });
  app.get("/api/health", async (req, res) => {
    try {
      await service.store.read();
    } catch {
      return res.status(503).json({
        mode: service.config.mode,
        paymentMode: service.payment.mode,
        store: service.config.storeMode,
        error: {
          code: "STORE_DISCONNECTED",
          message:
            "The authoritative job store is disconnected. Restore it and restart the backend; do not submit replacement payments or physical jobs.",
        },
      });
    }
    return res.json({
      mode: service.config.mode,
      paymentMode: service.payment.mode,
      store: service.config.storeMode,
      integrations: {
        spacetimedb:
          service.config.storeMode === "spacetimedb"
            ? "connected"
            : "required; isolated development mode",
        fetch: "unverified",
        hardware:
          service.config.mode === "hardware"
            ? "configured; acceptance required"
            : "not configured",
        claude: process.env.ANTHROPIC_API_KEY
          ? "configured; not verified"
          : "not configured",
      },
    });
  });
  app.get("/api/session", async (req, res) => {
    try {
      res.json(await actor(req));
    } catch (error) {
      if (error instanceof Problem && error.code === "AUTH_REQUIRED")
        res.json({ role: null });
      else throw error;
    }
  });
  app.post("/api/session", async (req, res) => {
    const role = req.body.role;
    requireThat(
      ["requester", "owner"].includes(role),
      "INVALID_ROLE",
      "Choose requester or owner access.",
      422,
    );
    if (role === "owner") {
      const provided = String(req.body.accessCode ?? "");
      const providedBytes = Buffer.from(provided),
        expectedBytes = Buffer.from(service.config.ownerCode);
      const valid =
        providedBytes.length === expectedBytes.length &&
        timingSafeEqual(providedBytes, expectedBytes);
      requireThat(
        valid,
        "ACCESS_CODE",
        "The owner access code is incorrect.",
        403,
      );
    }
    const token = randomBytes(32).toString("hex");
    const session = {
      id: role === "owner" ? "team_owner" : id("requester"),
      role,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    await mutate(service.store, (s) => {
      s.sessions[token] = session;
    });
    res
      .cookie("fabrary_session", token, {
        httpOnly: true,
        sameSite: "strict",
        maxAge: 7 * 86400000,
        path: "/",
      })
      .json(session);
  });
  app.delete("/api/session", async (req, res) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("fabrary_session="))
      ?.slice(16);
    if (cookie)
      await mutate(service.store, (s) => {
        delete s.sessions[cookie];
      });
    res.clearCookie("fabrary_session").json({ ok: true });
  });
  app.get("/api/machines", async (req, res) => {
    const { version: revision, data } = await service.store.read();
    res.json({
      revision,
      machines: Object.values(data.machines).map(
        ({ ownerId, nodeUrl, ownerAddress, ...m }) => m,
      ),
    });
  });
  app.post("/api/intake", async (req, res) => {
    const a = await actor(req);
    const input = z
      .object({
        assetIds: z.array(z.string()).min(1).max(4),
        intent: z.string().min(3).max(2000),
      })
      .parse(req.body);
    const state = await service.read();
    const images = [];
    for (const assetId of input.assetIds) {
      const asset = ownValue(state.assets, assetId);
      requireThat(
        asset?.ownerId === a.id,
        "ASSET_ACCESS",
        "Only your uploaded artwork may be analyzed.",
        403,
      );
      images.push({
        bytes: await readFile(asset.path),
        mediaType: asset.mime as "image/png" | "image/jpeg" | "image/webp",
      });
    }
    try {
      res.json({
        draft: await createClaudeProvider().draftIntake({
          intent: input.intent,
          images,
        }),
      });
    } catch (e) {
      throw new Problem(
        "CLAUDE_UNAVAILABLE",
        (e as Error).message.startsWith("CLAUDE_BLOCKED")
          ? "Claude intake is not configured. Enter the supported specification manually."
          : "Claude intake is unavailable. Enter the supported specification manually.",
        503,
      );
    }
  });
  app.get("/api/catalog", (req, res) =>
    res.json({
      models: service.config.catalog ?? [],
      reason: service.config.catalog?.length
        ? "Reviewed prepared models only."
        : "No inspected pre-sliced model configured. Image-to-3D is planned.",
    }),
  );
  app.get("/api/events", async (req, res) => {
    const a = await actor(req);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("event: refresh\ndata: {}\n\n");
    const off = service.store.subscribe(() =>
      res.write("event: refresh\ndata: {}\n\n"),
    );
    const timer = setInterval(() => res.write(": keepalive\n\n"), 25000);
    req.on("close", () => {
      off();
      clearInterval(timer);
    });
  });
  app.post("/api/uploads", upload.array("images", 4), async (req, res) => {
    const a = await actor(req);
    requireThat(
      ["requester", "owner"].includes(a.role),
      "AUTH_REQUIRED",
      "Sign in to upload artwork.",
      403,
    );
    const files = req.files as Express.Multer.File[];
    requireThat(
      files?.length >= 1 && files.length <= 4,
      "UPLOAD_REQUIRED",
      "Upload one to four PNG, JPEG or WebP images.",
      422,
    );
    await mkdir(join(service.config.dataDir, "assets"), { recursive: true });
    const assets: Asset[] = [];
    const stagedPaths: string[] = [];
    try {
      for (const f of files) {
        requireThat(
          ["image/png", "image/jpeg", "image/webp"].includes(f.mimetype),
          "IMAGE_TYPE",
          "Only PNG, JPEG and WebP artwork is supported.",
          422,
        );
        const assetId = id("asset"),
          path = join(service.config.dataDir, "assets", assetId);
        stagedPaths.push(path);
        await writeFile(path, f.buffer);
        try {
          const { stdout } = await exec(
            "uv",
            [
              "run",
              "--project",
              resolve("node"),
              "python",
              "-c",
              'import sys,json; from PIL import Image; Image.MAX_IMAGE_PIXELS=20000000; im=Image.open(sys.argv[1]); im.load(); assert im.format in ["PNG","JPEG","WEBP"]; print(json.dumps({"width":im.width,"height":im.height,"mime":{"PNG":"image/png","JPEG":"image/jpeg","WEBP":"image/webp"}[im.format]}))',
              path,
            ],
            { timeout: 30000, maxBuffer: 50000 },
          );
          const dimensions = JSON.parse(stdout);
          assets.push({
            id: assetId,
            ownerId: a.id,
            path,
            url: `/assets/${assetId}`,
            sha256: createHash("sha256").update(f.buffer).digest("hex"),
            mime: dimensions.mime,
            width: dimensions.width,
            height: dimensions.height,
            createdAt: now(),
          });
        } catch {
          await unlink(path).catch(() => {});
          throw new Problem(
            "INVALID_IMAGE",
            "This image cannot be decoded safely. Use a smaller PNG, JPEG or WebP.",
            422,
          );
        }
      }
    } catch (error) {
      // An upload batch is all-or-nothing. Remove earlier decoded files too
      // when a later member fails, rather than leaving unowned artwork behind.
      await Promise.all(
        stagedPaths.map((path) => unlink(path).catch(() => {})),
      );
      throw error;
    }
    await mutate(service.store, (s) => {
      for (const asset of assets) s.assets[asset.id] = asset;
    });
    res
      .status(201)
      .json({ assets: assets.map(({ path, ownerId, ...asset }) => asset) });
  });
  const prepare = async (
    req: Request,
    ownerId: string,
    version: number,
    suppliedBody: unknown = req.body,
  ) => {
    const parsed = specSchema.safeParse(suppliedBody);
    if (!parsed.success)
      throw new Problem(
        "INVALID_SPEC",
        parsed.error.issues.map((x) => x.message).join(" "),
        422,
      );
    const spec = parsed.data;
    if (spec.outputType === "3d") {
      const model = service.config.catalog?.find(
        (m) => m.id === spec.preparedModelId,
      );
      requireThat(
        model,
        "MODEL_UNCONFIGURED",
        "A configured inspected prepared 3D model is required.",
        422,
      );
      service.validateCatalog(spec, model.artifact);
      return model.artifact;
    }
    const s = await service.read();
    for (const assetId of spec.assetIds)
      requireThat(
        ownValue(s.assets, assetId)?.ownerId === ownerId,
        "ASSET_ACCESS",
        "Upload your own artwork before creating this order.",
        403,
      );
    const source = s.assets[spec.assetIds[0]];
    const assetId = id("preview"),
      path = join(service.config.dataDir, "assets", assetId + ".png");
    await exec(
      "uv",
      [
        "run",
        "--project",
        resolve("node"),
        "fabrary-prepare",
        source.path,
        path,
        "--output-type",
        spec.outputType,
        "--width-mm",
        String(spec.widthMm),
        "--height-mm",
        String(spec.heightMm),
        "--crop",
        spec.crop,
        ...spec.assetIds.slice(1).flatMap((a) => ["--extra", s.assets[a].path]),
      ],
      { timeout: 30000, maxBuffer: 50000 },
    );
    const bytes = await readFile(path);
    const artifact = {
      id: assetId,
      url: `/assets/${assetId}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await mutate(service.store, (s) => {
      s.assets[assetId] = {
        ...artifact,
        path,
        mime: "image/png",
        ownerId,
        width: 0,
        height: 0,
        createdAt: now(),
      };
    });
    return artifact;
  };
  app.post("/api/jobs", async (req, res) => {
    const a = await actor(req);
    requireThat(
      a.role === "requester",
      "REQUESTER_REQUIRED",
      "Use requester access to create an order.",
      403,
    );
    const artifact = await prepare(req, a.id, 1);
    res
      .status(201)
      .json({ job: view(await service.create(a.id, req.body, artifact)) });
  });
  app.get("/api/jobs", async (req, res) => {
    const a = await actor(req);
    const { version: revision, data } = await service.store.read();
    const jobs = Object.values(data.jobs)
      .filter((j) => a.role === "owner" || j.requesterId === a.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ revision, jobs: jobs.map(view) });
  });
  app.get("/api/jobs/:id", async (req, res) => {
    await owned(req);
    res.json({ job: view(await service.job(String(req.params.id))) });
  });
  app.patch("/api/jobs/:id/spec", async (req, res) => {
    const a = await owned(req);
    const old = await service.job(String(req.params.id));
    requireThat(
      old.paymentState === "unpaid" &&
        !old.attemptId &&
        old.productionState !== "cancelled",
      "LOCKED",
      "Cancelled, paid or dispatched orders cannot change.",
    );
    res.json({
      job: view(
        await service.revise(
          old.id,
          req.body,
          await prepare(req, old.requesterId, old.specVersion + 1),
        ),
      ),
    });
  });
  for (const [route, action] of Object.entries({
    approve: (jobId: string, b: any) => service.approve(jobId, b),
    quote: (jobId: string, b: any) =>
      service.quote(jobId, b.autoAccept === true),
    checkout: (jobId: string, b: any) =>
      service.checkout(jobId, b.idempotencyKey, b.paymentPayload),
    dispatch: (jobId: string) => service.dispatch(jobId),
    cancel: (jobId: string) => service.cancel(jobId),
  })) {
    app.post(`/api/jobs/:id/${route}`, async (req, res) => {
      const a = await owned(req);
      requireThat(
        a.role === "requester",
        "REQUESTER_REQUIRED",
        "This action needs requester access.",
        403,
      );
      if (route === "checkout" && req.get("PAYMENT-SIGNATURE")) {
        try {
          req.body.paymentPayload = decodeX402PaymentSignature(
            req.get("PAYMENT-SIGNATURE")!,
          );
        } catch {
          throw new Problem(
            "INVALID_PAYMENT_HEADER",
            "The x402 payment signature header is malformed.",
            422,
          );
        }
      }
      const result = await action(String(req.params.id), req.body);
      if (route === "checkout") {
        const collection = Object.values(
          (await service.read()).operations,
        ).find(
          (o) =>
            o.jobId === result.id &&
            o.kind === "collection" &&
            o.status === "confirmed",
        );
        const header = collection?.receipt
          ? x402PaymentResponseHeader(collection.receipt)
          : undefined;
        if (header) res.setHeader("PAYMENT-RESPONSE", header);
      }
      res.json({ job: view(result) });
    });
  }
  app.post("/api/owner/jobs/:id/payment-reference", async (req, res) => {
    await ownerJob(req);
    const body = z
      .object({
        operationId: z.string().min(1).max(250),
        transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(req.body);
    res.json({
      job: view(
        await service.attachConfirmedPaymentReference(
          String(req.params.id),
          body.operationId,
          body.transactionHash,
          body.reason,
        ),
      ),
    });
  });
  app.post("/api/owner/jobs/:id/economics", async (req, res) => {
    await ownerJob(req);
    const values = z
      .object({
        consumablesCents: z.number().int().min(0),
        machineSeconds: z.number().min(0),
        handlingSeconds: z.number().min(0),
        failedAttempts: z.number().int().min(0),
        apiCostCents: z.number().int().min(0),
        machineCostCents: z.number().int().min(0),
      })
      .strict()
      .parse(req.body);
    res.json({
      job: view(await service.recordEconomics(String(req.params.id), values)),
    });
  });
  app.get("/api/jobs/:id/receipt", async (req, res) => {
    await owned(req);
    const j = await service.job(String(req.params.id));
    res.json({
      job: view(j),
      mode: service.payment.mode,
      description: "Platform-managed test payment hold",
      ledger: Object.values((await service.read()).operations).filter(
        (o) => o.jobId === j.id,
      ),
    });
  });
  app.get("/api/jobs/:id/evidence", async (req, res) => {
    await owned(req);
    const j = await service.job(String(req.params.id));
    const frameUrl = j.evidence?.url;
    requireThat(
      frameUrl,
      "NO_EVIDENCE",
      "No evidence image is available.",
      404,
    );
    const m = (await service.read()).machines[j.machineId!];
    requireThat(
      service.node.fetchFrame,
      "FRAME_UNAVAILABLE",
      "The recorded frame cannot be loaded. Ask the owner to check the camera node.",
      502,
    );
    try {
      const bytes = await service.node.fetchFrame(frameUrl, m);
      res.type("png").send(bytes);
    } catch {
      throw new Problem(
        "FRAME_UNAVAILABLE",
        "The recorded frame cannot be loaded. Ask the owner to check the camera node.",
        502,
      );
    }
  });
  app.get("/assets/:id", async (req, res) => {
    const assetId = String(req.params.id),
      s = await service.read(),
      asset = ownValue(s.assets, assetId);
    requireThat(asset, "NOT_FOUND", "Asset not found.", 404);
    const expires = Number(req.query.expires);
    const expected = createHmac("sha256", service.config.secret)
      .update(`${assetId}:${expires}`)
      .digest("hex");
    const sig = String(req.query.sig ?? "");
    const signed =
      Number.isFinite(expires) &&
      expires >= Date.now() / 1000 &&
      expires <= Date.now() / 1000 + 600 &&
      /^[0-9a-f]{64}$/i.test(sig) &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!signed) {
      const a = await actor(req);
      requireThat(
        a.id === asset.ownerId ||
          a.role === "owner" ||
          asset.ownerId === "catalog",
        "ASSET_ACCESS",
        "You cannot access this artwork.",
        403,
      );
    }
    res.type(asset.mime).send(await readFile(asset.path));
  });
  app.get("/api/owner/dashboard", async (req, res) => {
    await owner(req);
    const { version: revision, data: s } = await service.store.read();
    res.json({
      revision,
      machines: Object.values(s.machines).map(({ nodeUrl, ...m }) => m),
      jobs: Object.values(s.jobs).map(view),
      ledger: Object.values(s.operations),
    });
  });
  app.post("/api/owner/machines", async (req, res) => {
    await owner(req);
    const slug = String(req.body.model);
    const models: Record<string, string> = {
      "phomemo-m02pro": "phomemo_01",
      "instax-mini-link-3": "instax_01",
      "bambu-a1-mini": "bambu_01",
      "Phomemo M02Pro": "phomemo_01",
      "Instax Mini Link 3": "instax_01",
      "Bambu Lab A1 mini": "bambu_01",
    };
    const machineId = ownValue(models, slug);
    requireThat(
      machineId,
      "UNSUPPORTED_DEVICE",
      "Supported adapters are Phomemo M02Pro, Instax Mini Link 3 (compatibility unverified), and Bambu A1 mini.",
      422,
    );
    requireThat(
      req.body.mode === "simulation" || req.body.mode === "hardware",
      "INVALID_MODE",
      "Choose simulation or configured hardware.",
      422,
    );
    const nodeUrl =
      process.env[
        `FABRARY_${machineId.split("_")[0].toUpperCase()}_NODE_URL`
      ] ?? service.config.nodeUrl;
    const selected = { ...(await service.read()).machines[machineId], nodeUrl };
    const manifest = await service.node.call(
      "get_capabilities",
      { machine_id: machineId },
      selected,
    );
    requireThat(
      manifest,
      "NODE_UNAVAILABLE",
      "The configured node did not provide capabilities.",
    );
    const machine = await mutate(service.store, (s) => {
      const m = s.machines[machineId];
      requireThat(
        !m.activeJobId && !m.reservation,
        "MACHINE_BUSY",
        "Finish existing orders before registering a different adapter.",
      );
      requireThat(
        manifest.mode === req.body.mode,
        "MODE_MISMATCH",
        "The configured node must be in the selected simulation or hardware mode.",
      );
      m.mode = req.body.mode;
      m.nodeUrl = nodeUrl;
      m.paired = manifest.paired === true;
      m.configured = manifest.configured === true;
      if (Number.isInteger(manifest.max_job_seconds))
        m.maxJobSeconds = manifest.max_job_seconds;
      if (Number.isInteger(manifest.media_remaining))
        m.mediaRemaining = manifest.media_remaining;
      m.calibrated = false;
      m.listed = false;
      m.ready = false;
      m.paused = true;
      m.adapterVersion =
        manifest.adapter_version ?? manifest.adapterVersion ?? "unverified";
      m.reason = manifest.blockers?.length
        ? manifest.blockers.join(" ")
        : "Registered; calibration and owner inspection required.";
      return m;
    });
    res.status(201).json({ machine });
  });
  app.patch("/api/owner/machines/:id", async (req, res) => {
    await owner(req);
    const body = machineSchema.parse(req.body);
    const before = ownValue(
      (await service.read()).machines,
      String(req.params.id),
    );
    requireThat(before, "NOT_FOUND", "Machine not found.", 404);
    if (body.paused === false) {
      requireThat(
        before.calibrated &&
          body.inspected &&
          body.cleared &&
          !before.activeJobId,
        "OWNER_RECOVERY_REQUIRED",
        "A calibrated machine needs explicit inspection and clearance before resuming.",
      );
    }
    const nodePolicy = {
      listed: body.listed,
      paused: body.paused,
      ready:
        body.paused === false ? true : body.paused === true ? false : undefined,
      mediaRemaining: body.mediaRemaining,
      material: body.material,
      maxJobSeconds: body.maxJobSeconds,
      maxQuantity: body.policy?.maxQuantity,
      hours: body.hours,
      inspected: body.inspected,
      cleared: body.cleared,
    };
    await service.node.call(
      `/machines/${before.id}/policy`,
      Object.fromEntries(
        Object.entries(nodePolicy).filter(([, v]) => v !== undefined),
      ),
      before,
    );
    const machine = await mutate(service.store, (s) => {
      const m = s.machines[before.id];
      if (body.paused === false)
        requireThat(
          !m.activeJobId,
          "MACHINE_BUSY",
          "Machine started an order during configuration.",
        );
      const { inspected, cleared, ...patch } = body;
      Object.assign(m, patch);
      if (body.paused !== undefined) {
        m.ready = !body.paused;
        m.reason = body.paused
          ? "Paused by owner."
          : "Owner inspected and cleared the machine.";
      }
      if (body.priceCard) {
        for (const j of Object.values(s.jobs).filter(
          (j) =>
            j.machineId === m.id &&
            j.paymentState === "unpaid" &&
            j.productionState !== "cancelled" &&
            j.quote,
        )) {
          delete j.quote;
          delete j.approvedSpecHash;
          j.productionState = "specified";
          record(
            j,
            "price_changed",
            "Owner changed pricing; preview and quote approval required again.",
          );
        }
        if (
          m.reservation &&
          s.jobs[m.reservation.jobId]?.paymentState === "unpaid"
        )
          delete m.reservation;
      }
      return m;
    });
    res.json({ machine });
  });
  app.post("/api/owner/machines/:id/calibration/start", async (req, res) => {
    const a = await owner(req);
    const machineId = String(req.params.id);
    const machine = ownValue((await service.read()).machines, machineId);
    requireThat(machine, "NOT_FOUND", "Machine not found.", 404);
    requireThat(
      machine.ownerId === a.id,
      "FORBIDDEN",
      "This machine belongs to another owner.",
      403,
    );
    service.validateCalibrationIntent(
      req.body.idempotencyKey,
      req.body.ownerReady,
    );
    const artifact = await prepare(req, a.id, 1, req.body.spec);
    res.json({
      calibration: await service.startCalibration(
        machineId,
        a.id,
        req.body.spec,
        artifact,
        req.body.idempotencyKey,
        req.body.ownerReady,
      ),
    });
  });
  app.get("/api/owner/machines/:id/calibration", async (req, res) => {
    await owner(req);
    const result = await service.calibrationStatus(String(req.params.id));
    res.json({
      ...result,
      calibration: result.calibration
        ? {
            ...result.calibration,
            evidence: result.calibration.evidence
              ? {
                  ...result.calibration.evidence,
                  frame: undefined,
                  url: `/api/owner/machines/${req.params.id}/calibration/evidence`,
                }
              : undefined,
          }
        : null,
    });
  });
  app.get("/api/owner/machines/:id/calibration/evidence", async (req, res) => {
    await owner(req);
    const state = await service.read(),
      m = ownValue(state.machines, String(req.params.id));
    requireThat(m, "NOT_FOUND", "Machine not found.", 404);
    const c = Object.values(state.calibrations ?? {})
      .filter((c) => c.machineId === m?.id && c.evidence?.url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    requireThat(
      c && service.node.fetchFrame,
      "EVIDENCE_UNAVAILABLE",
      "Capture a calibration result frame first.",
      404,
    );
    const bytes = await service.node.fetchFrame(c.evidence.url, m);
    res.type("png").send(bytes);
  });
  app.post("/api/owner/machines/:id/calibration/resolve", async (req, res) => {
    await owner(req);
    res.json(await service.resolveCalibration(String(req.params.id), req.body));
  });
  app.post("/api/owner/machines/:id/calibrate", async (req, res) => {
    await owner(req);
    const s = await service.read(),
      m = ownValue(s.machines, String(req.params.id));
    requireThat(m, "NOT_FOUND", "Machine not found.", 404);
    requireThat(
      (!m.activeJobId ||
        Object.values(s.calibrations ?? {}).some(
          (c) => c.id === m.activeJobId && c.attemptId === req.body.attemptId,
        )) &&
        !m.reservation,
      "MACHINE_BUSY",
      "Calibration requires an idle machine or its current calibration attempt.",
    );
    requireThat(
      req.body.inspected === true,
      "INSPECTION_REQUIRED",
      "Inspect calibration output before confirming calibration.",
    );
    const sameAttempt = (current: Machine) =>
      current.activeJobId === m.activeJobId && !current.reservation;
    // Remove availability before contacting the node so a quote cannot reserve
    // the machine while its calibration confirmation is still in flight.
    await mutate(service.store, (s) => {
      const current = s.machines[m.id];
      requireThat(
        sameAttempt(current),
        "MACHINE_BUSY",
        "The machine changed during calibration. Refresh before confirming it.",
      );
      current.calibrated = false;
      current.ready = false;
      current.paused = true;
      current.reason = "Owner calibration confirmation is in progress.";
    });
    let result;
    try {
      result = await service.node.call(
        "/calibrate",
        {
          machine_id: m.id,
          inspected: true,
          ...(req.body.reason ? { reason: String(req.body.reason) } : {}),
          ...(req.body.attemptId
            ? { attempt_id: String(req.body.attemptId) }
            : {}),
        },
        m,
      );
    } catch (e) {
      await mutate(service.store, (s) => {
        if (!sameAttempt(s.machines[m.id])) return;
        s.machines[m.id].calibrated = false;
        s.machines[m.id].paused = true;
        s.machines[m.id].ready = false;
        s.machines[m.id].reason = `Calibration failed: ${(e as Error).message}`;
      });
      throw e;
    }
    if (result.calibrated !== true) {
      await mutate(service.store, (s) => {
        const m = s.machines[String(req.params.id)];
        if (!sameAttempt(m)) return;
        m.calibrated = false;
        m.ready = false;
        m.paused = true;
        m.reason =
          result.reason ??
          "Calibration failed; inspect and recover before listing.";
      });
      throw new Problem(
        "CALIBRATION_FAILED",
        result.reason ??
          "Calibration did not pass. Inspect and recover before listing.",
      );
    }
    const machine = await mutate(service.store, (s) => {
      const m = s.machines[String(req.params.id)];
      requireThat(
        sameAttempt(m),
        "MACHINE_BUSY",
        "The machine moved to another attempt during calibration. Refresh before confirming it.",
      );
      m.calibrated = true;
      m.calibrationAt = now();
      m.activeJobId = null;
      m.ready = false;
      m.paused = true;
      m.reason =
        m.mode === "simulation"
          ? "Simulated calibration passed. List and explicitly resume."
          : "Calibration passed with owner inspection; list and resume.";
      return m;
    });
    res.json({ machine, calibration: result });
  });
  for (const [route, fn] of Object.entries({
    prepare: (jobId: string, b: any) => service.prepare(jobId, b),
    clear: (jobId: string, b: any) => service.clearFailed(jobId, b),
    redeem: (jobId: string, b: any) => service.redeem(jobId, b.code),
    review: (jobId: string, b: any) =>
      service.operatorReview(jobId, b.result, b.reason),
    reconcile: (jobId: string) => service.reconcile(jobId),
    verify: (jobId: string) => service.verify(jobId),
    abort: async (jobId: string) => (await service.abort(jobId)).job,
  }))
    app.post(`/api/owner/jobs/:id/${route}`, async (req, res) => {
      await ownerJob(req);
      res.json({
        job: view((await fn(String(req.params.id), req.body)) as Job),
      });
    });
  app.post("/api/owner/simulation/:id", async (req, res) => {
    await owner(req);
    requireThat(
      service.config.mode === "simulation",
      "NOT_SIMULATION",
      "Simulation controls are disabled for hardware.",
      403,
    );
    const result = await service.node.call(
      `/simulation/${String(req.params.id)}`,
      { outcome: req.body.outcome },
    );
    res.json(result);
  });
  app.use(express.static(webDirectory, { index: "index.html" }));
  app.get("/owner", (req, res) =>
    res.sendFile("index.html", { root: webDirectory }),
  );
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.challenge) {
      for (const [k, v] of Object.entries(err.challenge.headers ?? {}))
        res.setHeader(k, String(v));
      return res.status(402).json(err.challenge.body);
    }
    const isValidation = err instanceof z.ZodError;
    const status =
      err.status ??
      (isValidation ? 422 : err instanceof multer.MulterError ? 422 : 500);
    const message =
      err instanceof Problem
        ? err.message
        : isValidation
          ? err.issues.map((i: any) => i.message).join(" ")
          : status === 500
            ? "The service could not complete this action. Try again or ask the owner to inspect the order."
            : err.message;
    res.status(status).json({
      error: {
        code: err.code ?? (isValidation ? "INVALID_INPUT" : "SERVICE_ERROR"),
        message,
      },
    });
  });
  return app;
}
