// Vercel build (vercel.json): the website from web/ as static files, and the
// server's own paths forwarded to the machine next to the printers at
// FABYN_BACKEND_ORIGIN, which npm run vercel:link keeps current. The app, its
// printers and its data never run on Vercel.
//
// Output follows Vercel's Build Output API: .vercel/output/{config.json,static/}.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const backend = process.env.FABYN_BACKEND_ORIGIN;
if (!backend) {
  console.error(
    "FABYN_BACKEND_ORIGIN is not set on this Vercel project; run npm run vercel:link on the machine next to the printers.",
  );
  process.exit(1);
}
const origin = new URL(backend).origin;

const r = spawnSync("npm", ["--prefix", "web", "run", "build"], {
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status ?? 1);

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
cpSync("web/dist", `${out}/static`, { recursive: true });
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/(api(?:/.*)?)$", dest: `${origin}/$1` },
        { handle: "filesystem" },
        // The build's own /assets files are served above; uploaded photos are not files here.
        { src: "^/(assets/.*)$", dest: `${origin}/$1` },
        { src: "^/(connect\\.sh|connect/.*)$", dest: `${origin}/$1` },
        { src: "^/.*$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Website built; server paths forward to ${origin}.`);
