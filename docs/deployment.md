# Vercel consumer and local producer

The repository now has two independent entry points. Vercel runs `api/index.ts`
(Express APIs, ordering and AI orchestration) and serves `web/dist`. This Mac
runs `npm run producer` (`producer-side/hub/cloud.py`), which connects to the
Phomemo M02 Pro and Instax mini Link 3 over Bluetooth and the Bambu A1 mini over
LAN. The optional Fetch.ai mailbox agent is unchanged; point its
`FABYN_API_ORIGIN` at the Vercel URL if you run it.

The Mac polls the cloud over authenticated HTTPS every three seconds. No tunnel,
inbound port, public local hub, or public printer address is required. Convex
holds application state, pending tasks, progress, and private artwork. Local
disk on Vercel is only a verified cache under `/tmp`. Python preparation,
OpenSCAD generation, and Bambu Studio slicing run on the Mac.

## Deploy the consumer and ordering agent

1. Use a hosted Convex deployment reachable from Vercel. Deploy `convex/` with
   `npm run convex:push`, using that deployment's `CONVEX_DEPLOY_KEY` and
   `FABYN_PUBLISH_SECRET`. This deploys the new private file functions too.
2. Set the variables in `consumer.env.example` in the Vercel project. Generate
   separate strong random values for `FABYN_OWNER_CODE`, `FABYN_TOKEN_SECRET`,
   `FABYN_PUBLISH_SECRET`, and `FABYN_PRODUCER_KEY`; the last must be at least
   32 characters. Preserve the existing token secret when migrating saved data.
   Set `FABYN_PUBLIC_ORIGIN` to the exact HTTPS origin people open, without a
   path. Set the same publish secret in Convex. Add AI keys only on Vercel.
3. Deploy this repository with its root as the Vercel project root. The checked-in
   `vercel.json` installs the root, integrations, and web dependencies, builds
   the frontend, and routes APIs to the Node function. Use a plan supporting
   the configured 300-second function duration. Vercel automatically enables
   direct-to-storage artwork uploads in the frontend build.
4. Open `/api/health` and `/fabyn/seller`. Cloud owner access requires the
   configured code. Requester and owner cookies remain separate, as on `main`.

The old static-site tunnel forwarder has been replaced. Do not run
`npm run vercel:link` for this deployment. `FABYN_BACKEND_ORIGIN` and
`FABYN_PRODUCER_HUB_URL` are not used by the cloud runtime.

## Run the producer on this Mac

Set up its Python environment if needed:

```sh
cd producer-side
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env  # only if .env does not already exist
```

Add `FABYN_CLOUD_ORIGIN` and `FABYN_PRODUCER_KEY` to `producer-side/.env`, using
the Vercel origin and the same producer key set there. Preserve the existing
`BAMBU_ACCESS_CODE`. Device addresses and adapter settings remain in
`producer-side/node/machines/*.json`. AI keys, the owner code, and the Convex
publish secret are not needed by the producer.

From the repository root:

```sh
npm run producer
# Only after physically checking the A1 mini plate is empty:
npm run producer -- --plate-cleared
```

All three nodes run in this local process. Startup probes do not print.
OpenSCAD and Bambu Studio must remain installed locally for generated 3D tags.
For a software test, `npm run producer -- --dry-run` uses file transports and
labels the machines as simulated; those nodes cannot be linked as tested real
printers. `npm run test:cloud` exercises this path without hardware or paid APIs.

In the seller's **Connections** panel, confirm a successful physical test print
and select **Use this printer for orders** for each printer. The panel now reads
the local producer's heartbeats and can request a connection test through the
queue. Installation and device credentials are managed on the Mac. Alternatively,
after testing all three, set `FABYN_PUBLIC_ORIGIN` and `FABYN_OWNER_CODE` privately
in the root `.env` and run:

```sh
npm run producer:link -- --confirm-test-prints
```

After a Bambu job, remove the item and use the existing clear-print control.
Paper/film auto handling follows `FABYN_AUTO_PREPARE_PRINTS` as before.

## Migrate existing local state

Use a new Convex deployment, or migrate the existing authoritative Convex store
in place. Stop the old combined app and finish or reconcile active jobs first.
Keep the source artwork files available. The migration refuses active physical
jobs, pending payments, and overwriting another populated target.

```sh
npm run cloud:migrate  # inspect source counts only
# Set FABYN_CLOUD_CONVEX_URL and FABYN_CLOUD_PUBLISH_SECRET privately.
npm run cloud:migrate -- --write
```

The source is selected by the root `.env`: SQLite development or Convex.
Machines are paused during migration and must be linked to the local producer.
The original source files are retained. A fresh deployment needs no migration.

## Delivery and recovery behavior

- Job attempts are durable and deduplicated in the cloud. The producer commits
  each delivery to `producer-side/.work/cloud/producer.sqlite` before accepting
  it. Keep that journal when restarting or upgrading the producer.
- A lost poll response can redeliver a task; the journal prevents a second
  print. Reports remain in its outbox until a successful cloud acknowledgement.
- If the producer restarts during a print, it reports an uncertain outcome for
  owner inspection. It never automatically repeats the physical operation.
- Undelivered print jobs expire after five minutes. Preparation expires after
  three minutes. Machine heartbeats become offline after twenty seconds.
- The producer's polling requests trigger reconciliation, so printing continues
  without an open browser. Vercel `waitUntil` retains bounded ordering work;
  no serverless timer or persistent socket is required.
- Prepared files are verified by SHA-256 during transfer and again before the
  adapter consumes a downloaded job artifact. Signed download links are issued
  at poll time, rather than expiring while a job waits in the queue.

The existing state format is still a single versioned application document;
it is suitable for this three-machine setup, rather than a large public fleet.
Keep a backup and periodically archive old orders/files as usage grows.

Vercel's filesystem and function lifecycle constraints are documented in
[Vercel runtimes](https://vercel.com/docs/functions/runtimes) and
[the background-task API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
Private file transfer follows [Convex's upload URL flow](https://docs.convex.dev/file-storage/upload-files).
