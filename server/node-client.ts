import { createHmac } from "node:crypto";
import type { Job, Machine } from "./model.ts";
import { parameters, Problem, requireThat } from "./model.ts";
export interface NodeBoundary {
  call(tool: string, input: any, machine?: Machine): Promise<any>;
  token(
    job: Job,
    machine: Machine,
    scope: string,
    extra?: { targetScope: "dispatch" | "calibration" },
  ): { token: string; expires_at: number };
}
export function signNodeToken(
  secret: string,
  job: Job,
  machine: Machine,
  scope: string,
  extra?: { targetScope: "dispatch" | "calibration" },
) {
  requireThat(
    machine.mode === "simulation" || machine.mode === "hardware",
    "INVALID_MACHINE_MODE",
    "The saved machine mode could not be confirmed. Ask the owner to register the current device before authorizing work.",
    409,
  );
  requireThat(
    scope !== "cancel_before_acceptance" ||
      extra?.targetScope === "dispatch" ||
      extra?.targetScope === "calibration",
    "INVALID_CANCELLATION_SCOPE",
    "Cancellation must bind the original dispatch or calibration authorization.",
    422,
  );
  const expires_at = Math.floor(Date.now() / 1000) + 300;
  const payload = {
    machine_id: machine.id,
    expected_mode: machine.mode,
    ...(scope === "cancel_before_acceptance"
      ? { target_scope: extra!.targetScope }
      : {}),
    job_id: job.id,
    attempt_id: job.attemptId ?? "calibration",
    artifact_sha256: job.artifact.sha256,
    parameters: parameters(job),
    expires_at,
    scope,
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${raw}.${createHmac("sha256", secret).update(raw).digest("hex")}`,
    expires_at,
  };
}
export class HttpNode implements NodeBoundary {
  constructor(
    public baseUrl: string,
    public key: string,
    public secret: string,
  ) {}
  token(
    job: Job,
    machine: Machine,
    scope: string,
    extra?: { targetScope: "dispatch" | "calibration" },
  ) {
    return signNodeToken(this.secret, job, machine, scope, extra);
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
