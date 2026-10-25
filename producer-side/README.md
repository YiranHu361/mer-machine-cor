# Producer side: machines and nodes

For the Vercel deployment, run `npm run producer` from the repository root after
configuring this folder's `.env`. It starts all three machine nodes and polls the
cloud for work; no local hub or inbound connection is required. See
[deployment and recovery](../docs/deployment.md). The standalone tools and local
stub hub below remain available for development.


One node process per machine. Each node dials out to the hub at `/ws/node`, takes jobs, and drives its machine through an adapter. `hub/gateway.py` is the hub's end of that connection.

**How it works, and how to add a machine: [ARCHITECTURE.md](ARCHITECTURE.md).**

| Machine | Adapter | Process | State |
| --- | --- | --- | --- |
| Phomemo M02 Pro | [`node/adapters/phomemo/`](node/adapters/phomemo/README.md) | `sticker_print` | Working on the real printer (BLE, macOS) |
| Fujifilm Instax mini | [`node/adapters/instax/`](node/adapters/instax/README.md) | `photo_print` | First version: picture transfer checked on the real Link 3 (BLE, macOS); first real print pending |
| Bambu Lab A1 mini | [`node/adapters/bambu/`](node/adapters/bambu/README.md) | `fdm_print` | Rudimentary: prints a pre-sliced G-code file over LAN; one test part printed |

## Setup

```sh
cd producer-side
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

## Print a sticker with no hub

```sh
.venv/bin/python -m node.tools.scan_ble --prefix M02 --services          # find the printer
.venv/bin/python -m node.tools.run_job --machine node/machines/m_sticker_01.json --text "hello"
.venv/bin/python -m node.tools.run_job --machine node/machines/m_sticker_01.json sticker.png --width-mm 40
```

Add `--transport file` for a dry run: no printer, writes the bytes and a preview PNG under `.work/`. The printer must not be connected to the Phomemo phone app.

## Print a sliced G-code file on the A1 mini

```sh
echo BAMBU_ACCESS_CODE=<code from the printer screen> >> .env       # once; .env is git-ignored
.venv/bin/python -m node.tools.bambu status                          # printer reachable?
.venv/bin/python -m node.tools.bambu print samples/yiran_PLA_11m11s.gcode   # upload, start, follow to FINISH
```

Needs LAN Only + Developer Mode on the printer, a microSD card, and the printer IP in `node/machines/m_fdm_01.json`. See [the adapter README](node/adapters/bambu/README.md). On an iPhone hotspot, a Mac needs a one-time network setting first: [MAC_NETWORK_SETUP.md](MAC_NETWORK_SETUP.md).

## Run a node against the stub hub

```sh
.venv/bin/python -m hub.dev_server                                                    # terminal 1
.venv/bin/python -m node.client --machine node/machines/m_sticker_01.json --hub http://localhost:8000   # terminal 2
curl -X POST localhost:8000/dev/offer -H 'content-type: application/json' -d '{"machine_id":"m_sticker_01"}'
curl localhost:8000/dev/events
```

Point `--hub` (or `FABYN_HUB_URL`) at the real hub once it's deployed.
