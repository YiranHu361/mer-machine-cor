"""Fabyn machine connector.

Runs on the computer next to a machine. It enrolls with a one-time setup code,
dials out to the workshop (no inbound port or tunnel), runs a fixed list of
setup checks only after the owner allows each one, writes the machine config,
and then relays the workshop's node requests to an in-process node service.
Nothing here starts a print: jobs still need the workshop's signed tokens.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sys

import httpx

from .security import NodeError

VERSION = "fabyn-connector/1.0.0"
DEVICE_LINE = re.compile(r"^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2}) (.+)$", re.I)
ALLOWED_PATH = re.compile(r"^/(tools/[a-z_]+|machines/[a-z0-9_]+/policy|calibrate|reconcile|simulation/[a-z0-9_]+|health)$")


def write_private(path: Path, value: dict) -> None:
    """Write JSON readable only by this user, replacing the file atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, indent=2)
    os.replace(temporary, path)


class Commands:
    """The only external programs setup may run, with bounded time."""

    def which(self, name: str) -> str | None:
        return shutil.which(name)

    async def run(self, args: list[str], timeout: float = 20) -> tuple[int, str]:
        try:
            process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
        except OSError as error:
            return 127, str(error)
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return 124, "timed out"
        return process.returncode or 0, output.decode(errors="replace")


def parse_devices(output: str, pattern: str) -> list[tuple[str, str]]:
    """Read `bluetoothctl devices` lines whose name matches the chosen model."""
    found = {}
    for line in output.splitlines():
        match = DEVICE_LINE.match(line.strip())
        if match and re.search(pattern, match.group(2), re.I):
            found[match.group(1).upper()] = match.group(2).strip()
    return sorted(found.items())


def parse_serial_channel(output: str) -> int | None:
    """Find the RFCOMM channel of the Serial Port service in `sdptool browse` output."""
    for block in re.split(r"\n\s*\n", output):
        if re.search(r"Serial Port|SPP", block, re.I):
            match = re.search(r"Channel:\s*(\d+)", block)
            if match:
                return int(match.group(1))
    match = re.search(r"RFCOMM.*?Channel:\s*(\d+)", output, re.S)
    return int(match.group(1)) if match else None


NAMES = {"Phomemo M02Pro": "M02 Pro", "Instax Mini Link 3": "Instax Link 3", "Bambu Lab A1 mini": "A1 mini"}


class SetupAgent:
    """A fixed, consent-gated checklist. It proposes; the owner allows; code acts."""

    def __init__(self, machine: dict, data_dir: Path, commands: Commands | None = None,
                 platform: str | None = None,
                 bluetooth: bool | None = None):
        self.machine, self.data_dir = machine, data_dir
        self.commands = commands or Commands()
        self.platform = platform or sys.platform
        self.bluetooth = (hasattr(socket, "AF_BLUETOOTH") and hasattr(socket, "BTPROTO_RFCOMM")) if bluetooth is None else bluetooth
        self.simulation = machine["mode"] == "simulation"
        self.state_path = data_dir / "setup.json"
        self.state = json.loads(self.state_path.read_text()) if self.state_path.is_file() else {}
        if self.state.get("machineId") != machine["id"] or self.state.get("mode") != machine["mode"]:
            self.state = {"machineId": machine["id"], "mode": machine["mode"], "values": {}, "consumed": {}, "checks": {}}
        # A restart re-runs anything unfinished; consented steps still wait for a new allowance.
        for check_id, saved in list(self.state["checks"].items()):
            if saved.get("status") in {"running", "failed"}:
                del self.state["checks"][check_id]
        name = NAMES.get(machine["model"], machine["model"])
        phomemo = machine["model"] == "Phomemo M02Pro"
        media = {"Phomemo M02Pro": "Paper loaded", "Instax Mini Link 3": "Film loaded",
                 "Bambu Lab A1 mini": "Filament loaded"}.get(machine["model"], "Media loaded")
        suffix = " (simulated)" if self.simulation else ""
        self.steps = [
            ("system", "Check this computer", None),
            ("search", f"Find your {name}", ("Allow a short Bluetooth search" if phomemo else "Allow a search") + suffix),
            ("pair", "Pair and read its serial channel" if phomemo else "Connect to it", "Allow pairing" + suffix),
            ("ready", f"{media} and output area clear", "Confirm it is ready"),
            ("config", "Save the machine settings here", None),
        ]
        if not self.simulation and not phomemo:
            # Only the M02 Pro has automatic hardware setup; the check explains why.
            self.steps = self.steps[:1]

    def save(self) -> None:
        write_private(self.state_path, self.state)

    def checks(self) -> list[dict]:
        listed, blocked = [], False
        for check_id, label, consent in self.steps:
            saved = self.state["checks"].get(check_id, {})
            status = saved.get("status", "pending")
            if blocked and status != "done":
                status = "pending"
            elif status == "pending" and consent:
                status = "waiting"
            entry = {"id": check_id, "label": label, "status": status}
            if saved.get("detail"):
                entry["detail"] = saved["detail"]
            if consent and status == "waiting":
                entry["consent"] = consent
            listed.append(entry)
            blocked = blocked or status != "done"
        return listed

    @property
    def ready(self) -> bool:
        return all(self.state["checks"].get(step[0], {}).get("status") == "done" for step in self.steps)

    def mark(self, check_id: str, status: str, detail: str | None = None) -> None:
        self.state["checks"][check_id] = {"status": status, **({"detail": detail} if detail else {})}
        self.save()

    async def advance(self, consents: dict) -> bool:
        """Run every step that is now allowed. Returns True when anything changed."""
        changed = False
        for check_id, _label, consent in self.steps:
            status = self.state["checks"].get(check_id, {}).get("status")
            if status == "done":
                continue
            if status == "failed" and not consent:
                return changed
            if consent:
                granted = consents.get(check_id)
                if not granted or granted == self.state["consumed"].get(check_id):
                    return changed
                self.state["consumed"][check_id] = granted
            self.mark(check_id, "running")
            try:
                detail = await getattr(self, f"run_{check_id}")()
                self.mark(check_id, "done", detail)
            except NodeError as error:
                # A consented step returns to waiting so the owner can retry it.
                self.mark(check_id, "pending" if consent else "failed", error.message)
                return True
            changed = True
        return changed

    async def run_system(self) -> str:
        if self.simulation:
            return "Simulation: no physical device is used"
        if self.machine["model"] != "Phomemo M02Pro":
            raise NodeError("unsupported", f"Automatic setup for {self.machine['model']} is not available yet. Use the manual setup in docs/node-integration.md.")
        problems = []
        if not self.platform.startswith("linux"):
            problems.append("the M02 Pro needs a Linux computer such as a Raspberry Pi")
        if not self.bluetooth:
            problems.append("this Python has no Bluetooth serial support (use the system Python)")
        for tool in ("bluetoothctl", "sdptool"):
            if not self.commands.which(tool):
                problems.append(f"{tool} is missing (install the bluez package)")
        if problems:
            raise NodeError("system", "This computer is not ready: " + "; ".join(problems) + ". Fix it and restart the connector.")
        return "Linux with Bluetooth serial support"

    async def run_search(self) -> str:
        if self.simulation:
            self.state["values"]["bluetoothAddress"] = "00:00:00:00:00:00"
            return f"Simulated {self.machine['model']} found"
        await self.commands.run(["bluetoothctl", "--timeout", "10", "scan", "on"], timeout=20)
        code, output = await self.commands.run(["bluetoothctl", "devices"], timeout=10)
        if code != 0:
            raise NodeError("search", "Bluetooth is not available. Check that it is turned on, then search again.")
        found = parse_devices(output, r"\bM0?2")
        if not found:
            raise NodeError("search", "No M02 printer was found. Turn it on, keep it close, then search again.")
        if len(found) > 1:
            listed = ", ".join(f"{name} ({address})" for address, name in found)
            raise NodeError("search", f"More than one M02 printer was found: {listed}. Turn off the others, then search again.")
        address, name = found[0]
        self.state["values"]["bluetoothAddress"] = address
        return f"Found {name} ({address})"

    async def run_pair(self) -> str:
        if self.simulation:
            if self.machine["model"] != "Phomemo M02Pro":
                return "Connected (simulated)"
            self.state["values"]["rfcommChannel"] = 1
            return "Paired (simulated). Serial channel 1"
        address = self.state["values"].get("bluetoothAddress")
        if not address:
            raise NodeError("pair", "Search for the printer first.")
        code, output = await self.commands.run(["bluetoothctl", "pair", address], timeout=30)
        if code != 0 and "AlreadyExists" not in output and "Already" not in output:
            raise NodeError("pair", "Pairing did not finish. Keep the printer on and close, then allow pairing again.")
        await self.commands.run(["bluetoothctl", "trust", address], timeout=10)
        code, output = await self.commands.run(["sdptool", "browse", address], timeout=30)
        channel = parse_serial_channel(output) if code == 0 else None
        if channel is None:
            raise NodeError("pair", "Paired, but the printer did not report a serial channel. Turn it off and on, then allow pairing again.")
        self.state["values"]["rfcommChannel"] = channel
        return f"Paired. Serial channel {channel}"

    async def run_ready(self) -> str:
        return "Confirmed by the owner"

    async def run_config(self) -> str:
        write_private(self.data_dir / "machines.json", {"machines": [self.config()]})
        return "Saved privately on this computer"

    def config(self) -> dict:
        values = self.state["values"]
        if self.simulation:
            return {"id": self.machine["id"], "model": self.machine["model"], "mode": "simulation", "paired": True}
        return {
            "id": self.machine["id"], "model": self.machine["model"], "mode": "hardware",
            "paired": True, "ownerReady": True,
            "bluetoothAddress": values["bluetoothAddress"], "rfcommChannel": values["rfcommChannel"],
            "maxJobSeconds": 120,
        }


class PlatformAssetTransport(httpx.AsyncBaseTransport):
    """Download approved files from the workshop that signed them, and nothing else."""

    def __init__(self, platform: str, asset_origin: str, inner: httpx.AsyncBaseTransport | None = None):
        self.platform, self.asset = httpx.URL(platform), httpx.URL(asset_origin)
        self.inner = inner or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        if (url.scheme, url.host, url.port) != (self.asset.scheme, self.asset.host, self.asset.port) or \
                not url.path.startswith(self.asset.path.rstrip("/") + "/"):
            raise httpx.ConnectError("Only workshop assets can be downloaded", request=request)
        request.url = url.copy_with(scheme=self.platform.scheme, host=self.platform.host, port=self.platform.port)
        request.headers["Host"] = request.url.netloc.decode()
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()


class Connector:
    def __init__(self, credentials: dict, data_dir: Path, agent: SetupAgent | None = None,
                 api_transport: httpx.AsyncBaseTransport | None = None, say: Callable[[str], None] | None = None):
        self.credentials, self.data_dir = credentials, data_dir
        self.say = say or (lambda line: print(line, flush=True))
        self.agent = agent or SetupAgent(credentials["machine"], data_dir)
        self.api_transport = api_transport
        self.consents: dict = {}
        self.node = None
        self.service = None
        self.local_key = secrets.token_hex(32)
        self.registered = False
        self.stopping = False
        self.setup_wake = asyncio.Event()
        self.reported: str | None = None
        self.announced: set[tuple] = set()

    def api(self) -> httpx.AsyncClient:
        auth = f"Bearer {self.credentials['connectorId']}.{self.credentials['connectorKey']}"
        return httpx.AsyncClient(base_url=self.credentials["platform"], transport=self.api_transport,
            headers={"Authorization": auth, "User-Agent": VERSION}, timeout=httpx.Timeout(40, connect=10), trust_env=False)

    async def start_node(self) -> None:
        if self.node is not None:
            return
        from .server import create_app
        from .service import NodeService
        self.service = NodeService(key=self.local_key, token_secret=self.credentials["tokenSecret"],
            data_dir=self.data_dir / "node-data", asset_origin=self.credentials["assetOrigin"],
            machines=[self.agent.config()], public_url=self.credentials["nodeOrigin"],
            artifact_transport=PlatformAssetTransport(self.credentials["platform"], self.credentials["assetOrigin"],
                inner=self.api_transport))
        self.node = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(self.service)),
            base_url="http://node.local", headers={"Authorization": f"Bearer {self.local_key}"}, timeout=60)

    async def report(self, api: httpx.AsyncClient) -> None:
        body = {"checks": self.agent.checks(), "ready": self.agent.ready and self.node is not None}
        fingerprint = json.dumps(body, sort_keys=True)
        if fingerprint == self.reported:
            return
        response = await api.post("/api/connectors/report", json=body)
        response.raise_for_status()
        self.reported = fingerprint
        for check in body["checks"]:
            line = (check["id"], check["status"], check.get("detail"))
            if line in self.announced or check["status"] not in {"done", "waiting"}:
                continue
            self.announced.add(line)
            if check["status"] == "done":
                self.say(f"  ✓ {check['label']}" + (f": {check['detail']}" if check.get("detail") else ""))
            else:
                self.say(f"  … {check['label']}: waiting for you in the workshop" +
                         (f" ({check['detail']})" if check.get("detail") else ""))

    async def setup_loop(self, api: httpx.AsyncClient) -> None:
        while not self.stopping:
            if await self.agent.advance(self.consents):
                if self.agent.ready:
                    await self.start_node()
            try:
                await self.report(api)
            except httpx.HTTPError:
                self.reported = None
            if self.agent.ready and self.node is not None and self.registered:
                return
            self.setup_wake.clear()
            try:
                await asyncio.wait_for(self.setup_wake.wait(), 15)
            except asyncio.TimeoutError:
                pass

    async def handle(self, api: httpx.AsyncClient, request: dict) -> None:
        method, path = request.get("method"), request.get("path", "")
        if method not in {"GET", "POST", "PATCH"} or not ALLOWED_PATH.match(path):
            reply = {"id": request.get("id"), "status": 403, "json": {"error": {"code": "connector_forbidden", "message": "This request is not relayed"}}}
        elif self.node is None:
            reply = {"id": request.get("id"), "status": 503, "json": {"error": {"code": "connector_setting_up", "message": "This machine is still being set up"}}}
        else:
            try:
                response = await self.node.request(method, path, json=request.get("body") if method != "GET" else None)
                reply = {"id": request["id"], "status": response.status_code, "contentType": response.headers.get("content-type", "")}
                if reply["contentType"].startswith("application/json"):
                    reply["json"] = response.json()
                else:
                    reply["base64"] = base64.b64encode(response.content).decode()
            except Exception as error:  # noqa: BLE001 - the workshop records this as uncertain
                reply = {"id": request.get("id"), "status": 502, "json": {"error": {"code": "node_error", "message": f"The machine node failed: {type(error).__name__}"}}}
        try:
            await api.post("/api/connectors/reply", json=reply)
        except httpx.HTTPError:
            pass  # The workshop treats a missing reply as an uncertain outcome.

    async def poll_once(self, api: httpx.AsyncClient) -> bool:
        response = await api.post("/api/connectors/poll", json={})
        if response.status_code == 401:
            self.say("This connector was removed or its code is no longer valid. Get a new setup code in your workshop.")
            return False
        response.raise_for_status()
        data = response.json()
        if data.get("consents") != self.consents:
            self.consents = data.get("consents") or {}
            self.setup_wake.set()
        if data.get("registered") and not self.registered:
            self.registered = True
            self.say("Registered with your workshop. Calibrate the machine in Machine checks, then list and resume it.")
            self.setup_wake.set()
        for request in data.get("requests", []):
            asyncio.create_task(self.handle(api, request))
        return not data.get("revoked")

    async def run(self) -> None:
        if self.agent.ready:
            await self.start_node()
        async with self.api() as api:
            setup = asyncio.create_task(self.setup_loop(api))
            delay = 1
            try:
                while not self.stopping:
                    try:
                        if not await self.poll_once(api):
                            break
                        delay = 1
                    except httpx.HTTPError:
                        await asyncio.sleep(delay)
                        delay = min(delay * 2, 30)
            finally:
                self.stopping = True
                self.setup_wake.set()
                await asyncio.gather(setup, return_exceptions=True)
                if self.node is not None:
                    await self.node.aclose()
                if self.service is not None:
                    await self.service.close()


async def enroll(platform: str, code: str, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    async with httpx.AsyncClient(base_url=platform, transport=transport, timeout=20, trust_env=False,
                                 headers={"User-Agent": VERSION}) as client:
        response = await client.post("/api/connectors/enroll",
            json={"code": code, "hostLabel": socket.gethostname()[:60], "version": VERSION})
    if response.status_code >= 400:
        try:
            message = response.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            message = f"The workshop refused this setup code ({response.status_code})."
        raise SystemExit(message)
    return {**response.json(), "platform": platform}


async def run(args) -> None:
    data_dir = Path(args.data_dir).expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(data_dir, 0o700)
    credentials_path = data_dir / "connector.json"
    platform = args.platform.rstrip("/")
    if args.code:
        credentials = await enroll(platform, args.code)
        write_private(credentials_path, credentials)
    elif credentials_path.is_file():
        credentials = json.loads(credentials_path.read_text())
    else:
        raise SystemExit("Run the setup command from your workshop: it includes a one-time setup code.")
    machine = credentials["machine"]
    print(f"Connected to {platform} for {machine['model']} ({machine['mode']}).", flush=True)
    print("Continue in your workshop: Machines → Add a machine. Leave this running; press Ctrl-C to stop.", flush=True)
    await Connector(credentials, data_dir).run()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="fabyn-connect", description="Connect a machine to a Fabyn workshop.")
    parser.add_argument("--platform", required=True, help="Workshop address, for example http://192.168.1.20:4318")
    parser.add_argument("--code", help="One-time setup code from Machines → Add a machine")
    parser.add_argument("--data-dir", default=str(Path.home() / ".fabyn-connector"))
    try:
        asyncio.run(run(parser.parse_args(argv)))
    except KeyboardInterrupt:
        print("\nConnector stopped.")


if __name__ == "__main__":
    main()
