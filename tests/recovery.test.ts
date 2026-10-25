import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
test(
  "real backend/node process restarts preserve attempts without silently printing again",
  { timeout: 60000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "fabyn-recovery-")),
      origin = "http://127.0.0.1:4418",
      nodeOrigin = "http://127.0.0.1:8888";
    const machineConfig = join(dir, "machines.json");
    await writeFile(
      machineConfig,
      JSON.stringify([
        {
          id: "phomemo_01",
          model: "Phomemo M02Pro",
          mode: "simulation",
          simulationSeconds: 1.3,
        },
      ]),
    );
    const env = {
      ...process.env,
      PORT: "4418",
      FABYN_DATA_DIR: join(dir, "app"),
      FABYN_STORE: "sqlite-development",
      FABYN_MODE: "simulation",
      FABYN_PAYMENT_MODE: "mock",
      FABYN_OWNER_CODE: "isolated-recovery-owner-code",
      FABYN_NODE_KEY: "isolated-recovery-node-key",
      FABYN_TOKEN_SECRET: "isolated-recovery-hmac-secret",
      FABYN_NODE_URL: nodeOrigin,
      FABYN_NODE_PORT: "8888",
      FABYN_NODE_DATA: join(dir, "node"),
      FABYN_ASSET_ORIGIN: origin + "/assets",
      FABYN_MACHINES_FILE: machineConfig,
      FABYN_CATALOG_FILE: "",
      // Set here so a developer's .env (loaded by the backend) never leaks in:
      // dotenv keeps values that are already set, even empty ones.
      FABYN_ALLOWED_MODES: "simulation",
      FABYN_PRODUCER_HUB_URL: "",
      FABYN_AUTO_PREPARE_PRINTS: "",
      CONVEX_URL: "",
      CONVEX_DEPLOY_KEY: "",
      FABYN_PUBLISH_SECRET: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
    };
    let backend: ChildProcess | undefined, node: ChildProcess | undefined;
    async function alive(url: string, headers: any = {}) {
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(500),
          });
          if (r.ok) return;
        } catch {}
        await delay(50);
      }
      throw new Error("Isolated local test service did not start");
    }
    async function startNode() {
      node = spawn(resolve("node/.venv/bin/fabyn-node"), [], {
        env,
        stdio: "ignore",
      });
      await alive(nodeOrigin + "/health", {
        Authorization: "Bearer " + env.FABYN_NODE_KEY,
      });
    }
    async function startBackend() {
      backend = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
        env,
        stdio: "ignore",
      });
      await alive(origin + "/api/health");
    }
    async function stop(child: ChildProcess | undefined) {
      if (!child || child.exitCode !== null) return;
      child.kill("SIGKILL");
      await new Promise<void>((r) => child!.once("exit", () => r()));
    }
    async function session(role: string) {
      const response = await fetch(origin + "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, accessCode: env.FABYN_OWNER_CODE }),
      });
      assert(response.ok);
      return response.headers.get("set-cookie")!.split(";")[0];
    }
    let owner = "",
      requester = "",
      assetId = "";
    async function api(
      cookie: string,
      path: string,
      body?: any,
      method = body === undefined ? "GET" : "POST",
    ) {
      const r = await fetch(origin + "/api" + path, {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await r.json()) as any;
      assert(r.ok, `${path}: ${JSON.stringify(json)}`);
      return json;
    }
    async function resume() {
      await api(
        owner,
        "/owner/machines/phomemo_01",
        { listed: true, paused: false, inspected: true, cleared: true },
        "PATCH",
      );
    }
    async function paid() {
      const j = (
        await api(requester, "/jobs", {
          assetIds: [assetId],
          intent: "Isolated process recovery fixture",
          outputType: "sticker",
          widthMm: 53,
          heightMm: 50,
          quantity: 1,
          material: "thermal-paper",
          permission: "authorized",
          crop: "contain",
        })
      ).job;
      await api(requester, `/jobs/${j.id}/approve`, {
        specVersion: j.specVersion,
        artifactSha256: j.artifact.sha256,
      });
      await api(requester, `/jobs/${j.id}/quote`, {});
      await api(requester, `/jobs/${j.id}/checkout`, {
        idempotencyKey: "recovery-" + j.id,
      });
      return j;
    }
    async function nodeStatus(j: any) {
      const r = await fetch(nodeOrigin + "/tools/get_status", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.FABYN_NODE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          machine_id: "phomemo_01",
          job_id: j.id,
          attempt_id: j.attemptId,
        }),
      });
      return r.json() as any;
    }
    async function waitState(jobId: string, state: string) {
      for (let i = 0; i < 100; i++) {
        const j = (await api(requester, `/jobs/${jobId}`)).job;
        if (j.productionState === state) return j;
        await delay(60);
      }
      throw new Error("Expected recovered state " + state);
    }
    const results: any[] = [];
    try {
      await startNode();
      await startBackend();
      owner = await session("owner");
      requester = await session("requester");
      await api(owner, "/owner/machines/phomemo_01/calibrate", {
        inspected: true,
      });
      await resume();
      const form = new FormData();
      form.append(
        "images",
        new Blob(
          [
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
              "base64",
            ),
          ],
          { type: "image/png" },
        ),
        "test.png",
      );
      const upload = await fetch(origin + "/api/uploads", {
        method: "POST",
        headers: { Cookie: requester },
        body: form,
      });
      assert(upload.ok);
      assetId = ((await upload.json()) as any).assets[0].id;
      // Node dies after its durable possible-start checkpoint.
      let j = await paid();
      j = (await api(requester, `/jobs/${j.id}/dispatch`, {})).job;
      for (let i = 0; i < 50; i++) {
        if ((await nodeStatus(j)).execution_status === "running") break;
        await delay(10);
      }
      await stop(node);
      await startNode();
      let recovered = await waitState(j.id, "needs_review");
      assert.equal(recovered.paymentState, "held");
      assert.equal(
        (await api(requester, `/jobs/${j.id}/dispatch`, {})).job.attemptId,
        j.attemptId,
      );
      assert.equal((await nodeStatus(j)).execution_status, "uncertain");
      await api(owner, `/owner/jobs/${j.id}/review`, {
        result: "fail",
        reason:
          "Inspected interrupted simulated attempt after real node process death",
      });
      await api(owner, `/owner/jobs/${j.id}/clear`, {
        inspected: true,
        cleared: true,
        reason: "Cleared interrupted simulation fixture after inspection",
      });
      await resume();
      results.push({
        case: "node crash after possible start",
        jobId: j.id,
        attemptId: j.attemptId,
        state: recovered.productionState,
        paymentBeforeResolution: recovered.paymentState,
      });
      // Orchestrator dies while accepted node work continues, then reconciles it.
      j = await paid();
      j = (await api(requester, `/jobs/${j.id}/dispatch`, {})).job;
      await stop(backend);
      await delay(1500);
      await startBackend();
      recovered = await waitState(j.id, "produced");
      assert.equal(recovered.attemptId, j.attemptId);
      assert.equal(recovered.paymentState, "released");
      const prepared = (
        await api(owner, `/owner/jobs/${j.id}/prepare`, {
          removed: true,
          labeled: true,
          stored: true,
          cleared: true,
        })
      ).job;
      await api(owner, `/owner/jobs/${j.id}/redeem`, {
        code: prepared.pickup.code,
      });
      await resume();
      results.push({
        case: "orchestrator crash after node acceptance",
        jobId: j.id,
        attemptId: j.attemptId,
        state: recovered.productionState,
      });
      // A recorded dispatch cannot reach a stopped node. A later404 is only a
      // lookup result: refund requires a durable cancellation barrier for the exact authorization.
      j = await paid();
      await stop(node);
      j = (await api(requester, `/jobs/${j.id}/dispatch`, {})).job;
      assert.equal(j.productionState, "needs_review");
      await startNode();
      const status = await nodeStatus(j);
      assert.equal(status.error.code, "unknown_attempt");
      await api(owner, `/owner/jobs/${j.id}/review`, {
        result: "fail",
        reason:
          "Owner inspected the empty output area and requested durable cancellation before acceptance",
      });
      const refunded = (await api(requester, `/jobs/${j.id}`)).job;
      assert.equal(refunded.paymentState, "refunded");
      assert.equal(
        refunded.executionCancellation?.status,
        "cancelled_before_acceptance",
      );
      assert.equal(refunded.executionCancellation?.attempt_id, j.attemptId);
      assert.equal(refunded.executionCancellation?.job_id, j.id);
      assert.equal(refunded.executionCancellation?.machine_id, j.machineId);
      assert.equal(refunded.executionCancellation?.target_scope, "dispatch");
      results.push({
        case: "node unavailable before durable acceptance",
        jobId: j.id,
        attemptId: j.attemptId,
        state: refunded.productionState,
        payment: refunded.paymentState,
        cancellationProof: refunded.executionCancellation.status,
      });
      const journal = new DatabaseSync(join(dir, "node/journal.sqlite"), {
        readOnly: true,
      });
      for (const result of results) {
        const count = (
          journal
            .prepare("SELECT count(*) n FROM attempts WHERE job_id=?")
            .get(result.jobId) as any
        ).n;
        assert.equal(
          count,
          result.case === "node unavailable before durable acceptance" ? 0 : 1,
        );
        result.durableAttempts = Number(count);
      }
      journal.close();
      await mkdir("docs/evidence", { recursive: true });
      await writeFile(
        "docs/evidence/process-recovery.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            status: "PASS",
            mode: "simulation",
            store: "sqlite-development",
            physicalJobs: 0,
            results,
          },
          null,
          2,
        ),
      );
    } finally {
      await stop(backend);
      await stop(node);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
