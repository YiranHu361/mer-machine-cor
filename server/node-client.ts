import { createHmac } from "node:crypto";
import type { Job, Machine } from "./model.ts";
import { parameters, Problem } from "./model.ts";
export interface NodeBoundary {
  call(tool: string, input: any, machine?: Machine): Promise<any>;
  token(
    job: Job,
    machine: Machine,
    scope: string,
  ): { token: string; expires_at: number };
  fetchFrame?(url: string, machine: Machine): Promise<Buffer>;
}
export class HttpNode implements NodeBoundary {
  constructor(
    public baseUrl: string,
    public key: string,
    public secret: string,
  ) {}
  token(job: Job, machine: Machine, scope: string) {
    const expires_at = Math.floor(Date.now() / 1000) + 300;
    const payload = {
      machine_id: machine.id,
      job_id: job.id,
      attempt_id: job.attemptId ?? "calibration",
      artifact_sha256: job.artifact.sha256,
      parameters: parameters(job),
      expires_at,
      scope,
    };
    const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return {
      token: `${raw}.${createHmac("sha256", this.secret).update(raw).digest("hex")}`,
      expires_at,
    };
  }
  async fetchFrame(url: string, machine: Machine) {
    const u = new URL(url, machine.nodeUrl ?? this.baseUrl);
    if (
      u.origin !== new URL(machine.nodeUrl ?? this.baseUrl).origin ||
      !u.pathname.startsWith("/frames/")
    )
      throw new Error("Frame outside configured camera node");
    const response = await fetch(u, {
      headers: { Authorization: `Bearer ${this.key}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Camera frame unavailable");
    const b = Buffer.from(await response.arrayBuffer());
    if (b.length > 8 * 1024 * 1024) throw new Error("Camera frame too large");
    return b;
  }
  async call(tool: string, input: any, machine?: Machine) {
    const url = new URL(machine?.nodeUrl ?? this.baseUrl);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Invalid configured node URL");
    const route = tool.startsWith("/") ? tool : `/tools/${tool}`;
    const r = await fetch(`${url.origin}${route}`, {
      method: route.startsWith("/machines/") ? "PATCH" : "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const error = (await r.json().catch(() => null)) as any;
      throw new Problem(
        error?.error?.code ?? "NODE_REJECTED",
        error?.error?.message ??
          "The configured machine node rejected this action.",
        r.status >= 500 ? 502 : r.status,
      );
    }
    return r.json();
  }
}
