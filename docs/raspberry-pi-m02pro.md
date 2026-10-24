# Connect a Phomemo M02 Pro through a Raspberry Pi

This guide moves the **Sticker counter** (`phomemo_01`) from the simulator to a real Phomemo M02 Pro. The app and database stay on your Mac. A Raspberry Pi next to the printer runs the Fabrary connector, which talks to the printer over classic Bluetooth.

> **Status:** the M02 Pro adapter and the connector's hardware checks have been tested in software only (the full connector flow was verified end to end in simulation). No physical print has been made through Fabrary yet. Treat your first prints as supervised calibration. The printer reports no completion signal and has no remote stop, so every print needs your inspection, and nothing is ever reprinted automatically.

## Recommended: one-command setup

The connector dials out to your workshop, so there is no tunnel, no copied secrets and no hand-written config.

### On the Mac (once)

The Pi has to reach the workshop over your network. In the Fabrary folder's `.env`, add your Mac's network address (find it in System Settings → Network), then restart the app:

```
FABRARY_HOST=0.0.0.0
FABRARY_PUBLIC_ORIGIN=http://192.168.1.20:4318
FABRARY_MODE=hardware
```

`FABRARY_HOST=0.0.0.0` makes the app listen on your network as well as on `127.0.0.1`, so the Pi can reach it while you keep using http://127.0.0.1:4318 on the Mac. Only do this on a network you trust. Browser actions still only work from the Mac itself; the connector authenticates with its own key. `FABRARY_PUBLIC_ORIGIN` is your Mac's address as the Pi sees it, and it goes into the setup command. `FABRARY_MODE=hardware` lets the workshop use a real device (the simulated photo and 3D machines stop taking orders, and the browser test suite refuses to run until you switch back).

### On the Pi (once)

Raspberry Pi OS 64-bit, with Bluetooth on, the M02 Pro charged and a camera (Camera Module or USB webcam) aimed at where stickers come out:

```bash
sudo apt update && sudo apt install -y bluez && curl -LsSf https://astral.sh/uv/install.sh | sh
```

For a USB webcam, also `sudo apt install -y fswebcam`. Open a new shell afterwards so `uv` is on your path.

### Connect

1. In the provider workspace, open **Machines → Add a machine**. Type **Phomemo M02 Pro** (or add a photo of the label under the printer) and click **Identify**; it should select **Phomemo M02Pro**. Choose **Hardware · a real machine** and click **Get setup command**.
2. Copy the command and run it on the Pi. It downloads the connector into `~/.fabrary-connector`, installs it with the Pi's own Python (which has Bluetooth support), and connects using the one-time code. The code works once and expires after 15 minutes.
3. Back in the workshop, a checklist appears for the Sticker counter. Each step waits for your button:
   - **Check this computer** runs on its own: Linux, Bluetooth serial support, `bluetoothctl` and `sdptool`.
   - **Allow a short Bluetooth search**: turn the printer on first. It looks for a device named M02; if it finds more than one, it asks you to turn the others off.
   - **Allow pairing**: pairs, trusts, and reads the printer's serial channel.
   - **Take a test photo**: tries the Pi camera, then a USB webcam, and keeps the one that works.
   - **Confirm it is ready**: you confirm paper is loaded and the output area is clear.
   - The connector then saves the settings privately on the Pi and the workshop registers the machine.
4. Calibrate: **Machine checks → Physical calibration job & inspection** (step 10 below explains it), then list and resume the machine.

Leave the connector running; press Ctrl-C on the Pi to stop it. To start it again later, run the same command without the code (`curl -fsSL http://192.168.1.20:4318/connect.sh | sh`); it reconnects with its saved credentials. To disconnect it for good, use **Remove connector…** in the machine's **Connection details**.

If a step fails, its message says what to fix, and the button comes back so you can try it again. If **Check this computer** fails, fix the named problem and restart the connector.

## Manual setup with an SSH tunnel

Use this only if you can't run the connector. It wires the same pieces by hand.

### How the pieces connect

```
Mac                                              Raspberry Pi
───────────────────────────────                  ─────────────────────────────
Fabrary app  127.0.0.1:4318  ◄── SSH tunnel ──►  127.0.0.1:4318 (asset downloads)
             127.0.0.1:8789  ◄── SSH tunnel ──►  Fabrary node 127.0.0.1:8788
SpacetimeDB  127.0.0.1:3002                       │ Bluetooth (RFCOMM)
Local node   127.0.0.1:8788 (simulated others)    ▼
                                                 Phomemo M02 Pro + camera
```

The app and node only listen on `127.0.0.1`. One SSH connection makes each side reachable from the other on localhost: the Mac reaches the Pi's node on port 8789, and the Pi downloads approved print files from the Mac's port 4318. Nothing is exposed on your network.

### What you need

- A Raspberry Pi with Bluetooth (Pi 3 B+, 4, 5 or Zero 2 W) running **Raspberry Pi OS 64-bit** (Bookworm or later), with SSH enabled and on the same network as your Mac.
- The M02 Pro, charged, with a sticker roll loaded. Note the roll width: Fabrary supports 15, 25 and 53 mm.
- A camera on the Pi pointed at where stickers come out: a Raspberry Pi Camera Module or a USB webcam. Fabrary needs a fresh photo of every result and of every calibration print.
- Your Pi's login, written below as `pi@raspberrypi.local`. Replace it with your own user and host name (or IP address) everywhere.

### 1. Prepare the Pi

On the Pi:

```bash
sudo apt update && sudo apt install -y bluez rsync
```

For a USB webcam, also install `fswebcam`:

```bash
sudo apt install -y fswebcam
```

Install uv (the Python tool Fabrary uses), then open a new shell:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Pair the printer

Turn the M02 Pro on and start Bluetooth setup on the Pi:

```bash
bluetoothctl
```

Inside `bluetoothctl`, run these one at a time. Wait for a device whose name starts with `M02` to appear after `scan on`, and use its address (`XX:XX:XX:XX:XX:XX`) in the next steps:

```
power on
agent on
default-agent
scan on
scan off
pair XX:XX:XX:XX:XX:XX
trust XX:XX:XX:XX:XX:XX
quit
```

If it asks for a PIN, use the one in the printer's manual.

Find the printer's serial-port channel:

```bash
sdptool browse XX:XX:XX:XX:XX:XX
```

Look for the **Serial Port** service and note its `Channel:` number. Fabrary never scans for this; you put it in the config file below.

### 3. Check the camera

The camera command must write exactly one image to standard output within 10 seconds (at most 10 MB). Try the one that matches your camera and confirm the result is an image:

Camera Module:

```bash
rpicam-still -n -t 1000 --width 1280 --height 960 -e jpg -o - > /tmp/frame.jpg && file /tmp/frame.jpg
```

USB webcam:

```bash
fswebcam -q --no-banner -r 1280x720 --jpeg 90 - > /tmp/frame.jpg && file /tmp/frame.jpg
```

`file` should report `JPEG image data`. Open `/tmp/frame.jpg` and adjust the camera until the sticker output area is clearly in view.

### 4. Copy the node to the Pi

On the Mac, from the Fabrary folder:

```bash
cd /path/to/fabrary && rsync -a --exclude .venv --exclude .pytest_cache --exclude __pycache__ node/ pi@raspberrypi.local:~/fabrary/node/
```

### 5. Install the node with the Pi's own Python

The repository pins a Python version that uv would download on its own, and that download may not include Bluetooth socket support. Use the Pi's system Python instead.

On the Pi:

```bash
cd ~/fabrary && export UV_PYTHON=/usr/bin/python3 && uv sync --project node --locked
```

Then confirm Python can open Bluetooth serial connections:

```bash
cd ~/fabrary && UV_PYTHON=/usr/bin/python3 uv run --project node python -c "import socket; print(hasattr(socket, 'AF_BLUETOOTH'), hasattr(socket, 'BTPROTO_RFCOMM'))"
```

It must print `True True`. If not, see [Troubleshooting](#troubleshooting).

The optional `hardware` extra is only for the Instax and Bambu adapters; the M02 Pro does not need it.

### 6. Describe the printer: `machines.json`

On the Pi, create the private data folder:

```bash
mkdir -p ~/fabrary/.data && chmod 700 ~/fabrary/.data
```

Create `~/fabrary/.data/machines.json` with only the printer in it:

```json
{
  "machines": [
    {
      "id": "phomemo_01",
      "model": "Phomemo M02Pro",
      "mode": "hardware",
      "paired": true,
      "ownerReady": true,
      "bluetoothAddress": "XX:XX:XX:XX:XX:XX",
      "rfcommChannel": 1,
      "maxJobSeconds": 120,
      "cameraCommand": ["rpicam-still", "-n", "-t", "1000", "--width", "1280", "--height", "960", "-e", "jpg", "-o", "-"]
    }
  ]
}
```

| Field | What to put |
| --- | --- |
| `id` | Keep `phomemo_01`. The app maps the M02 Pro to this ID. |
| `model` | Keep `Phomemo M02Pro` exactly. |
| `mode` | `hardware`. |
| `paired` | `true` once step 2 succeeded. `false` blocks printing. |
| `ownerReady` | `true` only while you are at the printer with paper loaded and the output area clear. Set it to `false` and restart the node when you leave it unattended. |
| `bluetoothAddress` | The address from step 2. |
| `rfcommChannel` | The `Channel:` number from step 2, as a number without quotes. |
| `maxJobSeconds` | Longest allowed print. 120 is a safe start. |
| `cameraCommand` | Your working command from step 3, split into a list of words. For a USB webcam: `["fswebcam", "-q", "--no-banner", "-r", "1280x720", "--jpeg", "90", "-"]`. |

Changing the address, channel, model or camera command later invalidates calibration, and you will need to calibrate again. Changing `ownerReady` does not.

### 7. Give the Pi the node's credentials

The Pi node must use the same node key and signing secret as the app on your Mac.

On the Mac, from the Fabrary folder, write them to a private file (nothing is printed):

```bash
node --input-type=module -e "import 'dotenv/config'; import fs from 'node:fs'; const c = JSON.parse(fs.readFileSync('.data/local-credentials.json', 'utf8')); fs.writeFileSync('.data/pi-node-secrets.env', 'FABRARY_NODE_KEY=' + (process.env.FABRARY_NODE_KEY ?? c.nodeKey) + '\nFABRARY_TOKEN_SECRET=' + (process.env.FABRARY_TOKEN_SECRET ?? c.secret) + '\n', { mode: 0o600 });"
```

Copy it to the Pi, then delete the Mac copy:

```bash
scp .data/pi-node-secrets.env pi@raspberrypi.local:~/fabrary/.data/node-secrets.env && rm .data/pi-node-secrets.env
```

On the Pi, create `~/fabrary/.data/node.env`. Replace `pi` in the paths with your Pi user name:

```
FABRARY_NODE_HOST=127.0.0.1
FABRARY_NODE_PORT=8788
FABRARY_NODE_URL=http://127.0.0.1:8789
FABRARY_ASSET_ORIGIN=http://127.0.0.1:4318/assets
FABRARY_NODE_DATA=/home/pi/fabrary/.data/node
FABRARY_MACHINES_FILE=/home/pi/fabrary/.data/machines.json
UV_PYTHON=/usr/bin/python3
```

| Setting | Why |
| --- | --- |
| `FABRARY_NODE_HOST`, `FABRARY_NODE_PORT` | The node listens only on the Pi's localhost, port 8788. |
| `FABRARY_NODE_URL` | The address the **Mac** uses to reach this node through the tunnel. Camera-photo links are built from it, and the app only accepts photos from the address it calls. |
| `FABRARY_ASSET_ORIGIN` | Where the node downloads approved print files. It must match the app exactly; the tunnel makes the Mac's port 4318 appear on the Pi. |
| `FABRARY_NODE_DATA` | The node's job journal. Never delete it to clear a stuck print. |
| `FABRARY_MACHINES_FILE` | The file from step 6. |
| `UV_PYTHON` | Keeps uv on the system Python with Bluetooth support. |

Lock both files down:

```bash
chmod 600 ~/fabrary/.data/node.env ~/fabrary/.data/node-secrets.env ~/fabrary/.data/machines.json
```

### 8. Point the Mac app at the Pi

In the Fabrary folder on the Mac, edit `.env`:

- Change `FABRARY_MODE=simulation` to `FABRARY_MODE=hardware`.
- Add `FABRARY_PHOMEMO_NODE_URL=http://127.0.0.1:8789`.

Leave `FABRARY_PAYMENT_MODE=mock`.

In hardware mode the simulated photo and 3D machines stop taking orders, and the browser test suite refuses to run. Switch back before running tests ([below](#back-to-simulation)).

### 9. Start everything

1. **Database (Mac).** If it isn't already running: `npm run spacetime`.
2. **Tunnel (Mac).** In its own terminal tab:

   ```bash
   ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 8789:127.0.0.1:8788 -R 4318:127.0.0.1:4318 pi@raspberrypi.local
   ```

   Leave it running. It prints nothing when it works.
3. **Node (Pi).** In an SSH session or on the Pi itself:

   ```bash
   cd ~/fabrary && set -a && . .data/node-secrets.env && . .data/node.env && set +a && uv run --project node fabrary-node
   ```

   Wait for `Uvicorn running on http://127.0.0.1:8788`.
4. **App (Mac).** Restart it so it reads the new `.env`: press Ctrl-C in the tab running `npm run demo`, then start it again with `npm run demo`.
5. **Check the link (Mac):**

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8789/health
   ```

   `401` is the expected answer: the Pi node is reachable and correctly refusing a request without its key. `000` means the tunnel or node isn't running.

### 10. Register and calibrate in the provider workspace

Open http://127.0.0.1:4318/owner and sign in.

1. **Finish open work on the sticker machine.** Registration is refused while an order holds the machine. Mark any waiting order ready for pickup first.
2. **Register.** Machines → **Add a machine** → Supported model **Phomemo M02Pro**, Device mode **Hardware** → **Register supported device**. The Sticker counter is now bound to the Pi, paused, unlisted and uncalibrated.
3. **Check for blockers.** Open **Connection details**. A line such as "Configured paired M02Pro Bluetooth address is missing" names a problem in `machines.json`. Fix it, restart the node, and register again.
4. **Set the paper.** **Settings** → **Media remaining (estimated)**: the number of stickers left on the roll. A new hardware machine starts at 0 and cannot take orders until you set this. **Save machine settings**.
5. **Calibrate.** **Machine checks** → **Physical calibration job & inspection**:
   - Choose a simple high-contrast test image as **Calibration artwork**, and set the width and height in mm (width no wider than your roll).
   - Tick **The device is supervised, the output area is clear and I am ready to start this physical calibration.** and click **Start physical calibration**. The Pi sends one print.
   - The attempt ends as uncertain, because the printer can't confirm completion. Look at the sticker and the camera photo shown in Fabrary.
   - If it is good: tick **I inspected this device and the output state for this calibration attempt.** and write what you saw in **Calibration inspection reason** (at least 10 characters, for example "Full image printed, edges sharp, 53 mm wide"). Under **Resolve an uncertain calibration attempt**, choose **Completed · output observed** and **Record observed outcome**, then click **Confirm usable calibration**.
   - If it is missing or wrong: use **Reject calibration output**, fix the cause, and prepare a new supervised calibration. Nothing reprints on its own.
6. **List it.** **Settings** → tick **List this machine for requester discovery** → **Save machine settings**.
7. **Resume it.** **Machine checks** → tick **I inspected the output area, loaded media and cleared the machine.** → **Resume machine**.

### 11. First real order

On the requester page, upload a picture. The recommendation shows the Sticker counter with "Hardware · owner readiness required". Preview, approve, pay (mock) and start production as usual.

When the print finishes, the order goes to **Needs a review**, because the printer can't confirm completion. Check the sticker and the photo, record **Pass · output visibly present** (or **Fail**) with a reason, then prepare the item for pickup as usual.

## Back to simulation

1. In the Mac's `.env`, set `FABRARY_MODE=simulation`, and remove `FABRARY_PHOMEMO_NODE_URL` if you used the manual setup.
2. Restart the app (`npm run demo`). You can stop the connector (or the tunnel and Pi node).
3. Machines → **Add a machine** → **Phomemo M02Pro**, Device mode **Simulation** → **Register supported device**. Then run the simulation calibration, list and resume it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The Python check prints `False False` | uv used a downloaded Python. On the Pi: `rm -rf ~/fabrary/node/.venv`, export `UV_PYTHON=/usr/bin/python3`, and run step 5 again. |
| `Another node owns this journal` | A node is already running on the Pi. Use that one, or stop it first. |
| The tunnel prints `remote port forwarding failed` or `Address already in use` | Something already uses port 4318 on the Pi or 8789 on the Mac. Stop it, or pick other ports and change them everywhere they appear in this guide. |
| Registration says the node did not provide capabilities | The tunnel or the Pi node isn't running. Repeat the check in step 9.5. |
| Registration says the node must be in the selected mode | `machines.json` must say `"mode": "hardware"` and you must choose **Hardware** in the form. |
| Camera timeout or unusable image | The command must print one JPEG or PNG to standard output in under 10 seconds. Re-test step 3. |
| Nothing prints, or the print is cut off | Check the channel, that the printer is on and paired, and the roll width. Record the failed attempt; never delete the node journal to retry. |

## Security notes

- Keep `.data/` private on both machines. It holds the node key, signing secret and owner code, and `.gitignore` already excludes it.
- The node and app never listen on your network; the encrypted SSH tunnel is the only path between them.
- Every request to the node needs its key, and every print or capture needs a short-lived token signed for that exact order and file.

See [node-integration.md](node-integration.md) for the full node contract and recovery rules.
