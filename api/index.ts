import type { Request, Response } from "express";
import { waitUntil } from "@vercel/functions";
import { createRuntime } from "../server/runtime.ts";

let runtime: ReturnType<typeof createRuntime> | undefined;
export default async function handler(req: Request, res: Response) {
  // Reset a failed cold start so correcting configuration does not require a warm instance restart.
  runtime ??= createRuntime({ cloud: true, background: waitUntil }).catch(
    (error) => {
      runtime = undefined;
      throw error;
    },
  );
  const ready = await runtime;
  res.once("finish", () => waitUntil(ready.reconcile()));
  return ready.app(req, res);
}
