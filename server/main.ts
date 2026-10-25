import "dotenv/config";
import { createRuntime } from "./runtime.ts";
const runtime = await createRuntime();
const port = Number(process.env.PORT ?? 4318);
const host = process.env.FABYN_HOST ?? "127.0.0.1";
const server = runtime.app.listen(port, host, () =>
  console.log(`Fabyn http://${host}:${port}`),
);
const tick = setInterval(
  () =>
    void runtime
      .reconcile()
      .catch(() =>
        console.error(
          "Background reconciliation failed; existing attempts remain recorded.",
        ),
      ),
  1500,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    clearInterval(tick);
    server.close(() => void runtime.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000).unref();
  });
