// Pushes convex/ (schema, publish:batch, live queries) to the deployment named
// by CONVEX_DEPLOY_KEY and stores FABRARY_PUBLISH_SECRET there, so both hubs
// can publish and nothing else can write.
//
// Usage: npm run convex:push
import "dotenv/config";
import { spawnSync } from "node:child_process";

const key = process.env.CONVEX_DEPLOY_KEY ?? "";
const kind = /^(dev|prod|preview):/.exec(key)?.[1];
if (!kind) {
  console.error(
    "Set CONVEX_DEPLOY_KEY in .env to the whole deploy key from the Convex dashboard (Settings → Deploy keys); it starts with dev: or prod:.",
  );
  process.exit(1);
}
const secret = process.env.FABRARY_PUBLISH_SECRET;
if (!secret) {
  console.error("Set FABRARY_PUBLISH_SECRET in .env (any long random string).");
  process.exit(1);
}
// The deploy key names the deployment; a local CONVEX_DEPLOYMENT must not compete with it.
const env = { ...process.env, CONVEX_DEPLOY_KEY: key, CONVEX_DEPLOYMENT: "" };
const convex = (...argv) => {
  const r = spawnSync("npx", ["convex", ...argv], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
convex(...(kind === "dev" ? ["dev", "--once"] : ["deploy", "-y"]));
convex("env", "set", "FABRARY_PUBLISH_SECRET", secret);
console.log(
  `Convex is ready: https://${/^(?:dev|prod):([a-z0-9-]+)\|/.exec(key)?.[1] ?? "<deployment>"}.convex.cloud`,
);
