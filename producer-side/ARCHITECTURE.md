# Producer side: how it works

The producer side turns jobs from the hub into physical items. Every machine runs one **node** process. The node dials out to the hub over a WebSocket, accepts or rejects jobs against its owner's rules, and drives the machine through an **adapter**. The hub side of that connection is the **gateway** (`hub/gateway.py`), which the consumer's FastAPI hub mounts.

Source of truth for the shared contracts: the *Fabrary — Cal Hacks Build Design Doc* (sections "Shared contracts" and "Producer side"). This file describes what the code does today.

## Status (2026-10-24)

| Part | State |
| --- | --- |
| Node loop: connect, heartbeat, offer → accept/reject → run → result, reconnect | Working, tested end to end |
| Gateway: `/ws/node`, offline detection, dispatch, frame upload, events | Working against the stub hub; not yet mounted in the consumer's hub |
| Phomemo M02 Pro adapter (`sticker_print`) | Working on the real printer over BLE from macOS |
| Instax mini adapter (`photo_print`) | Not started |
| Bambu A1 mini adapter (`fdm_print`) | Rudimentary: prints a pre-sliced `.gcode` / `.gcode.3mf` over LAN. One test part printed on the real printer. No STL slicing yet |
| Webcam frame capture and upload | Code written, no camera tested yet |
| Claude vision check | Not started; results say `pass: null` (needs manual approval) |
| Simulator (`sim/`, `SimAdapter`), outage, add-machine | Not started |
| Convex publish (`hub/publish.py`) | Working: the stub hub forwards gateway events to Convex when `CONVEX_URL` (or a full `CONVEX_DEPLOY_KEY`) and `FABRARY_PUBLISH_SECRET` are set; progress at most every 2 s per job; signed links and adapter config stay in the hub |

## Picture

```
 consumer hub (FastAPI, Vultr)                         one laptop / Pi per machine (or several)
┌──────────────────────────────┐   WebSocket /ws/node   ┌──────────────────────────────────────┐
│ planner · matcher · x402     │ ◀──── node dials out ──│ node/client.py  NodeClient           │
│        │  offer_job()        │   hello / heartbeat    │   policy.py  (owner rules)           │
│        ▼                     │   job.offer / cancel   │   adapters/<family>/  (machine)      │
│ hub/gateway.py  Gateway ─────┼──────────────────────▶ │   verify.py  (webcam → upload)       │
│        │  subscribe()        │   job.accept/progress/ │            │                         │
│        ▼                     │   result               │            ▼ BLE / LAN / USB          │
│ /ws/events → web UI          │ ◀──────────────────────│   Phomemo · Instax · Bambu           │
│ GET /assets/… (HTTP)  ───────┼──── node downloads ───▶│                                      │
│ POST /nodes/{id}/frames ◀────┼──── node uploads ──────│                                      │
└──────────────────────────────┘                        └──────────────────────────────────────┘
```

Only the hub needs a public address. Nodes never listen on a port.

## Layout

```
producer-side/
  ARCHITECTURE.md        this file
  README.md              quickstart
  requirements.txt       node + gateway + tests (one venv)
  node/
    client.py            NodeClient: the node loop; CLI `python -m node.client`
    protocol.py          Job model, message type names, envelope(); mirrors contracts/ until it exists
    policy.py            owner rules → reject reason or None
    verify.py            capture a webcam frame, upload it, return (photo_url, verification)
    adapters/
      __init__.py        REGISTRY: adapter.type → "package:Class", lazy import
      base.py            Adapter ABC, Progress, AdapterError
      phomemo/           Phomemo M02 Pro (see its README.md)
      bambu/             Bambu Lab A1 mini over LAN (see its README.md)
    machines/            one manifest per real machine: m_sticker_01.json, m_fdm_01.json
    tools/
      run_job.py         run one job through any adapter with no hub (bring-up)
      scan_ble.py        find BLE machines and list their GATT services
      bambu.py           A1 mini: discover, status, inspect, print, stop
  hub/
    gateway.py           Gateway class + `gateway` singleton for the consumer's hub
    dev_server.py        stub hub: gateway + /assets + /dev/offer etc., for testing nodes alone
  samples/               sample job files (A1 mini PLA G-code)
  tests/                 raster, policy, bambu, end-to-end (stub hub → node → dry-run printer)
```

## The node loop (`node/client.py`)

1. **Load** `node/machines/<id>.json` and build the adapter from its `adapter.type`.
2. **Connect** to `ws(s)://<hub>/ws/node` and send `hello` with the public manifest. Wait up to 10 s for `welcome`.
3. **Run three tasks per connection:**
   - **Reader:** handles `job.offer`, `job.cancel` and `machine.check`.
   - **Writer:** drains the outbox.
   - **Heartbeat:** sends one every 5 s.
4. **On `job.offer`:**
   - Validate it as `Job`. Invalid → `job.reject {reason: "invalid_job"}`.
   - Ignore duplicate `job_id`s.
   - Run `policy.check`. If it returns a reason → `job.reject`.
   - Otherwise queue the job and send `job.accept`.
5. **Worker task.** It survives reconnects. Jobs run one at a time, in order:
   1. `job.progress {state: "running", progress: 0}`
   2. Download `asset_url`. It may be relative to the hub, absolute, or `file://`, which is for tests.
   3. `adapter.prepare(job, asset_path)` → native file
   4. `async for p in adapter.run(job, native)`, sending `job.progress` for each `p`.
   5. `job.progress {state: "verifying", progress: 1}`
   6. `verify.verify_job` captures a frame, uploads it, and returns `(photo_url, verification)`.
   7. `job.result {ok: true, photo_url, verification}`. Any exception → `job.result {ok: false, error}`.
6. **On disconnect:** reconnect with backoff (1 s doubling to 15 s, plus jitter). Job messages wait in the outbox and are sent after the reconnect. A message leaves the outbox only after a successful send. Heartbeats are never queued.

Per-job working files go in `.work/<machine_id>/<job_id>/`.

CLI flags:

| Flag | Meaning |
| --- | --- |
| `--machine` | Manifest path (required) |
| `--hub` | Hub URL; env `FABRARY_HUB_URL`; default `http://localhost:8000` |
| `--transport` | Override the adapter transport; `file` = dry run |
| `--probe` | Connect to the machine once before going online |
| `--max-queue` | Default 3 |
| `-v` | Debug logging |

## Wire protocol (hub ↔ node)

Every message in both directions uses the same envelope as `/ws/events`: `{"type": str, "ts": ISO-8601, "data": {...}}`.

| Dir | type | data |
| --- | --- | --- |
| node → hub | `hello` | Public manifest (below), with live `status` |
| hub → node | `welcome` | `{machine_id, listed: true}` |
| node → hub | `heartbeat` | `{machine_id, status: idle\|busy\|error, media_loaded, queue, current_job, detail, battery_pct}`, every 5 s |
| hub → node | `job.offer` | The job (§4 of the design doc) |
| node → hub | `job.accept` | `{job_id, reason: null}` |
| node → hub | `job.reject` | `{job_id, reason}`. Reason strings are listed under "Owner policy" |
| node → hub | `job.progress` | `{job_id, state: running\|verifying, progress: 0–1, eta_s, message}` |
| node → hub | `job.result` | `{job_id, ok, photo_url, verification: {pass: true\|false\|null, reason}, error?}` |
| hub → node | `job.cancel` | `{job_id}` |
| hub → node | `machine.check` | `{check_id}`: connect to the machine once and print nothing (`adapter.probe()`), never during a job |
| node → hub | `machine.checked` | `{check_id, ok, detail}`. A failed check is an answer about the printer, not an error state for the node |

Timing: the gateway marks a node offline after 15 s without any message.

Progress convention: an adapter reports up to 0.9 while it is still sending, and 1.0 only once the machine says it is done.

Example `job.offer` data:

```json
{"job_id": "job_0031", "order_id": "ord_0007", "item_id": "it_2", "machine_id": "m_sticker_01",
 "process": "sticker_print", "quantity": 1, "asset_url": "/assets/ord_0007/it_2.png",
 "preview_url": "/assets/ord_0007/it_2_preview.png", "params": {"width_mm": 40, "height_mm": 25},
 "state": "offered", "progress": 0.0, "eta_s": 60, "escrow": "held", "verification": null}
```

## The machine manifest (`node/machines/<id>.json`)

The manifest follows design doc §2. It has two kinds of keys:

- **Public keys** (sent in `hello`): `machine_id, process, display_name, owner, owner_wallet, simulated, location, media_loaded, limits, time_model, price_card, status`
- **Local keys** (`LOCAL_KEYS` in `client.py`, never sent):
  - `adapter`: `type` picks the class; everything else is that adapter's config.
  - `camera`: `{index, warmup_frames, delay_s}` for OpenCV. `index: null` means no camera.

Fields the node itself uses:

| Field | Used for |
| --- | --- |
| `limits.max_size_mm`, `limits.max_job_minutes`, `limits.hours` | Owner policy |
| `time_model.setup_s`, `time_model.per_unit_s` | Policy time check and the ETA estimate |
| `media_loaded.remaining_est` | Policy media check; decremented after each print (in memory only) |

## Owner policy (`node/policy.py`)

The node enforces the owner's rules itself, so the hub can't override them. Checks run in this order; the first failure is the reject reason:

| Reason prefix | When |
| --- | --- |
| `wrong_machine` | `job.machine_id` ≠ this machine |
| `wrong_process` | `job.process` ≠ manifest `process` |
| `machine_error` | Adapter status is `error` |
| `busy` | Queue + running job ≥ `--max-queue` |
| `outside_hours` | Local time outside `limits.hours` (`"HH:MM-HH:MM"`, may wrap midnight) |
| `too_large` | `params.width_mm`/`height_mm` (or `size_mm`) exceed `limits.max_size_mm` |
| `too_long` | `(setup_s + per_unit_s × quantity) / 60 > max_job_minutes` |
| `out_of_media` | `media_loaded.remaining_est < quantity` |

## Adapters (`node/adapters/`)

```python
class Adapter(ABC):
    process: str                                     # e.g. "sticker_print"
    def __init__(self, manifest, config): ...        # config = manifest["adapter"]
    async def prepare(self, job, asset_path) -> Path # consumer's file -> machine-native file
    async def run(self, job, native_path) -> AsyncIterator[Progress]
    async def status(self) -> dict                   # {"state": idle|busy|error, "media", "detail", ...extras}
    async def cancel(self, job_id) -> None
    async def probe(self) -> None                    # optional: reach the machine or raise AdapterError
```

Rules every adapter follows:

- **prepare** does no hardware I/O. It writes its outputs next to `asset_path` and runs CPU work in `asyncio.to_thread`. Put the heavy conversion in a pure module (like `phomemo/raster.py`) so it can be unit-tested.
- **run** connects to the machine itself, per job, and always disconnects in `finally`. It yields `Progress(state="running", progress, eta_s, message)`. It returns normally only when the machine reports the item finished. If there is no such signal, it waits a configured settle time and says so in the docs.
- **Failures** raise `AdapterError` with a human-readable reason; that string becomes `job.result.error`. Set status to `error` for machine faults that need a person. A cancellation is not a machine fault.
- **cancel** sets a flag that `run` checks between steps. Document what still finishes physically.
- **Extra keys** in `status()` (like `battery_pct`) flow into heartbeats. Add the key in `client._heartbeat` if it's new.
- **Imports:** import the machine's library inside the adapter package only. The registry imports packages lazily, so a Phomemo node never needs Bambu libraries.

### Adding a machine (Instax mini, Bambu A1 mini, ...)

1. Create `node/adapters/<family>/` with:
   - `__init__.py` exporting the class
   - `adapter.py`
   - pure helpers (image or slicing code)
   - a transport if needed
   - `README.md` with device notes, using the Phomemo one as the template
2. Register it in `REGISTRY` in `node/adapters/__init__.py`, e.g. `"instax_mini": "instax:InstaxMini"`.
3. Write `node/machines/m_<process>_01.json`: public keys from the design doc, plus `adapter: {type: "...", ...}`.
4. Add its libraries to `requirements.txt` under a comment naming the adapter.
5. Bring it up without the hub:
   - Find it with `python -m node.tools.scan_ble --prefix <name> --services` (BLE devices).
   - Run `python -m node.tools.run_job --machine node/machines/<id>.json <asset>`.
6. Run it against the stub hub (README), then add tests for the pure helpers.

Notes for the two remaining machines:

- **Instax mini (`photo_print`):**
  - The design doc says the consumer sends a 4×6 postcard JPEG. Instax mini film needs a 600×800 portrait image (about 46 × 62 mm), so `prepare` must crop and fit it. Confirm with the consumer at standup.
  - Prior art in this repo: `../node/fabrary_node/adapters.py` (`InstaxLink3`, which shrinks the JPEG to ~55 KB), and the vendored [javl/InstaxBLE](https://github.com/javl/InstaxBLE) in `../node/fabrary_node/instaxble/`. Neither was validated on our camera/printer.
  - Development takes about 90 s after ejection, so delay the camera frame.
- **Bambu A1 mini (`fdm_print`):**
  - The consumer sends an STL.
  - `prepare` slices it with the OrcaSlicer CLI and one fixed profile → `.gcode.3mf` plus print statistics.
  - `run` uploads over FTPS and starts it over MQTT (LAN-only + Developer Mode), with progress from MQTT percent.
  - After each print, set status so policy rejects new jobs until someone presses "Plate cleared". This needs a hub → node message for "plate cleared", which isn't in the contract yet.
  - Prior art: `../node/fabrary_node/adapters.py` (`Bambu`, using `bambulabs-api`).
  - Fallback: open the `.gcode.3mf` in Bambu Studio and press print.

## Gateway (`hub/gateway.py`): what the consumer's hub uses

```python
from hub.gateway import gateway                 # module singleton (or Gateway(frames_dir=...))
app.include_router(gateway.router)              # adds /ws/node and POST /nodes/{machine_id}/frames
gateway.start()                                 # in the app lifespan: starts the heartbeat watchdog
gateway.subscribe(handler)                      # handler(type, data), sync or async
await gateway.offer_job(job)                    # raises LookupError if the machine is offline
await gateway.cancel_job(machine_id, job_id)
gateway.machines()                              # manifests with live status ("offline" when gone)
await gateway.approve_manually(machine_id, job_id)   # owner dashboard "Approve manually"
```

Events it emits, named like the `/ws/events` types so the hub can forward them as is:

| Event | When | data |
| --- | --- | --- |
| `machine.online` | `hello`, or a heartbeat after being offline | Manifest |
| `machine.updated` | Heartbeat changed `status` or `media_loaded` | Manifest |
| `machine.offline` | Disconnect or 15 s of silence | `{machine_id, reason, unfinished_jobs}` |
| `job.updated` | Offered, accepted, rejected, running, verifying (including made but awaiting approval) | Job fields so far |
| `job.done` | `ok` and `verification.pass == true`, or manual approval | Job, including `photo_url` |
| `job.failed` | `ok == false` or `verification.pass == false` | Job, including `error` |

The gateway keeps the last known state of each job per machine, but the consumer owns plans, escrow and re-planning. On `machine.offline` the consumer re-plans `unfinished_jobs`.

Frames are saved to `frames_dir` and returned as `/frames/<name>`. The hub must serve that directory, as `dev_server.py` does.

## Stub hub (`hub/dev_server.py`)

`python -m hub.dev_server [--port 8000]` runs the real gateway plus:

| Endpoint | Purpose |
| --- | --- |
| `GET /machines` | Live manifests |
| `POST /dev/offer` | `{machine_id, asset_url?, quantity?, params?}` builds a job and offers it. The default asset is a generated 48×30 mm test sticker |
| `POST /dev/cancel`, `POST /dev/approve` | `{machine_id, job_id}` |
| `POST /dev/check` | `{machine_id}` → `{machine_id, ok, detail}` after the node tries its machine (up to 90 s). The consumer calls it while drafts are drawn, so a printer that has gone to sleep is not offered |
| `GET /dev/events?limit=` | Recent gateway events |
| `/assets/*`, `/frames/*` | Static files |

## Testing

```sh
.venv/bin/python -m pytest -q
```

| Test | Covers |
| --- | --- |
| `test_phomemo_raster.py` | Byte layout, scaling, centering, alpha, cropping |
| `test_policy.py` | Every reject reason and the midnight-wrapping hours window |
| `test_end_to_end.py` | Starts the stub hub in-process, runs a real `NodeClient` with the Phomemo adapter on the `file` transport, checks rejection and acceptance through to `verifying`, the bytes written and the media count |

No test touches hardware. Use `node.tools.run_job` for that.

## Assumptions to confirm with the consumer (contracts/)

- The hub ↔ node envelope is `{type, ts, data}`.
- Sticker size travels as `params.width_mm` / `height_mm` (or `size_mm`).
- `job.result` may carry `error`, and `verification.pass` may be `null`, meaning made but unchecked. The gateway then emits `job.updated` with state `verifying`.
- Heartbeats carry the extra keys `queue`, `current_job`, `detail` and `battery_pct`.
- `node/protocol.py` duplicates the `Job` model until `contracts/models.py` lands. Then import from there.
- Instax image size vs the "4×6 postcard" in the design doc.
- A hub → node "plate cleared" message is needed for the Bambu.
