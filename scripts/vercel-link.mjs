// Legacy tunnel forwarding tool. Not used by the split deployment; see docs/deployment.md.
// Points the Vercel site (FABYN_PUBLIC_ORIGIN) at this machine's current tunnel.
// Vercel builds and serves only the website (vercel.json, scripts/vercel-build.mjs);
// the app, its printers and its data stay on this machine, and the site forwards
// /api, uploaded photos and /connect here through FABYN_BACKEND_ORIGIN.
//
// Usage: npm run vercel:link [-- https://<name>.trycloudflare.com]
// With no link it asks the running cloudflared quick tunnel for its address.
// Run it again whenever the tunnel restarts: it saves the new address in Vercel
// (so later GitHub deployments use it too) and redeploys from this folder.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

async function tunnelLink() {
  if (process.argv[2]) return new URL(process.argv[2]).origin;
  // cloudflared serves its metrics, and a quick tunnel's name, on 20241-20245.
  for (let port = 20241; port <= 20245; port++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/quicktunnel`, {
        signal: AbortSignal.timeout(1000),
      });
      const { hostname } = await r.json();
      if (hostname) return `https://${hostname}`;
    } catch {}
  }
  console.error(
    "No running tunnel found. Start one first:\n  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4318",
  );
  process.exit(1);
}

const vercel = (...argv) => {
  const r = spawnSync("npx", ["--yes", "vercel@63.1.2", ...argv], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const link = await tunnelLink();
const project = process.env.FABYN_VERCEL_PROJECT ?? "fabyn";
if (!existsSync(".vercel/project.json")) {
  // Reuse the link from the earlier forwarder setup, else link by name.
  const earlier = `${process.env.FABYN_DATA_DIR ?? ".data"}/vercel/${project}/.vercel/project.json`;
  if (existsSync(earlier)) {
    mkdirSync(".vercel", { recursive: true });
    copyFileSync(earlier, ".vercel/project.json");
  } else vercel("link", "--yes", "--project", project);
}
console.log(`• Forwarding the Vercel site to ${link}`);
vercel(
  "env",
  "add",
  "FABYN_BACKEND_ORIGIN",
  "production,preview",
  "--value",
  link,
  "--no-sensitive",
  "--force",
  "--yes",
);
vercel("deploy", "--prod", "--yes");

const site = process.env.FABYN_PUBLIC_ORIGIN;
if (!site) {
  console.log(
    "Put the production address above in .env as FABYN_PUBLIC_ORIGIN, then restart the app and agent.",
  );
  process.exit(0);
}
// The site is live once its address reaches this app.
for (let i = 0; i < 10; i++) {
  try {
    const health = await fetch(new URL("/api/health", site), {
      signal: AbortSignal.timeout(10000),
    });
    if (health.ok) {
      console.log(`${site} now reaches this app.`);
      process.exit(0);
    }
  } catch {}
  await new Promise((done) => setTimeout(done, 2000));
}
console.error(
  `${site} does not reach this app yet; check the tunnel and the Vercel project.`,
);
process.exit(1);
