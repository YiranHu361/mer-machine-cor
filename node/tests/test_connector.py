"""Connector setup and relay, with fake commands and transports: no Bluetooth,
device or network I/O is performed."""
import base64
import io
import json
import stat

import httpx
from PIL import Image

from fabrary_node.connector import (
    Connector, PlatformAssetTransport, SetupAgent, parse_devices, parse_serial_channel,
)
from fabrary_node.security import NodeError

PHOMEMO = {"id": "phomemo_01", "model": "Phomemo M02Pro", "outputType": "sticker", "material": "thermal-paper"}
SDP = """Service Name: Serial Port
Service RecHandle: 0x10001
Protocol Descriptor List:
  "L2CAP" (0x0100)
  "RFCOMM" (0x0003)
    Channel: 2
"""


def jpeg() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), "white").save(buffer, "JPEG")
    return buffer.getvalue()


class FakeCommands:
    def __init__(self, devices="Device AA:BB:CC:DD:EE:01 M02 Pro\nDevice 11:22:33:44:55:66 Headphones\n",
                 tools=("bluetoothctl", "sdptool", "rpicam-still")):
        self.devices, self.tools, self.calls = devices, set(tools), []

    def which(self, name):
        return f"/usr/bin/{name}" if name in self.tools else None

    async def run(self, args, timeout=20):
        self.calls.append(args)
        if args[:2] == ["bluetoothctl", "devices"]:
            return 0, self.devices
        if args[:1] == ["sdptool"]:
            return 0, SDP
        return 0, "Pairing successful"


def test_parsers_read_only_matching_devices_and_the_serial_channel():
    assert parse_devices("Device AA:BB:CC:DD:EE:01 M02 Pro\nDevice 11:22:33:44:55:66 Speaker", r"\bM0?2") == [
        ("AA:BB:CC:DD:EE:01", "M02 Pro")]
    assert parse_serial_channel(SDP) == 2
    assert parse_serial_channel("Service Name: Audio\n") is None


async def test_simulation_steps_wait_for_each_allowance_and_write_private_config(tmp_path):
    agent = SetupAgent({**PHOMEMO, "mode": "simulation"}, tmp_path)
    assert await agent.advance({}) is True  # the system check needs no allowance
    checks = {c["id"]: c for c in agent.checks()}
    assert checks["system"]["status"] == "done"
    assert checks["search"]["status"] == "waiting" and checks["search"]["consent"]
    assert checks["pair"]["status"] == "pending"
    assert agent.ready is False
    consents = {}
    for step in ("search", "pair", "ready"):
        consents[step] = f"2026-10-24T00:00:0{len(consents)}Z"
        await agent.advance(consents)
    assert agent.ready is True
    config = json.loads((tmp_path / "machines.json").read_text())
    assert config == {"machines": [{"id": "phomemo_01", "model": "Phomemo M02Pro", "mode": "simulation", "paired": True}]}
    assert stat.S_IMODE((tmp_path / "machines.json").stat().st_mode) == 0o600


async def test_hardware_m02_setup_finds_pairs_reads_channel_without_a_capture_step(tmp_path):
    commands = FakeCommands()
    agent = SetupAgent({**PHOMEMO, "mode": "hardware"}, tmp_path, commands=commands,
                       platform="linux", bluetooth=True)
    consents = {}
    await agent.advance(consents)
    for step in ("search", "pair", "ready"):
        consents[step] = f"t-{step}"
        await agent.advance(consents)
    assert agent.ready is True
    machine = json.loads((tmp_path / "machines.json").read_text())["machines"][0]
    assert machine["bluetoothAddress"] == "AA:BB:CC:DD:EE:01"
    assert machine["rfcommChannel"] == 2
    assert machine["mode"] == "hardware" and machine["paired"] is True and machine["ownerReady"] is True
    # Pairing touched only the one matching printer; nothing ran before its allowance.
    assert ["bluetoothctl", "pair", "AA:BB:CC:DD:EE:01"] in commands.calls


async def test_a_step_never_runs_without_its_allowance_and_retries_need_a_new_one(tmp_path):
    commands = FakeCommands(devices="Device AA:BB:CC:DD:EE:01 M02 Pro\nDevice AA:BB:CC:DD:EE:02 M02 Pro\n")
    agent = SetupAgent({**PHOMEMO, "mode": "hardware"}, tmp_path, commands=commands,
                       platform="linux", bluetooth=True)
    await agent.advance({})
    assert commands.calls == []
    await agent.advance({"search": "first"})
    search = {c["id"]: c for c in agent.checks()}["search"]
    assert search["status"] == "waiting" and "More than one M02" in search["detail"]
    calls = len(commands.calls)
    await agent.advance({"search": "first"})  # the same allowance is not reused
    assert len(commands.calls) == calls
    commands.devices = "Device AA:BB:CC:DD:EE:02 M02 Pro\n"
    await agent.advance({"search": "second"})
    assert {c["id"]: c for c in agent.checks()}["search"]["status"] == "done"


async def test_unsupported_computer_or_model_explains_the_blocker(tmp_path):
    mac = SetupAgent({**PHOMEMO, "mode": "hardware"}, tmp_path / "a", commands=FakeCommands(tools=()),
                     platform="darwin", bluetooth=False)
    await mac.advance({})
    system = mac.checks()[0]
    assert system["status"] == "failed"
    assert "Linux" in system["detail"] and "bluez" in system["detail"]
    instax = SetupAgent({"id": "instax_01", "model": "Instax Mini Link 3", "mode": "hardware"}, tmp_path / "b",
                        platform="linux", bluetooth=True)
    await instax.advance({})
    assert [c["id"] for c in instax.checks()] == ["system"]
    assert "not available yet" in instax.checks()[0]["detail"]


async def test_restart_reruns_unfinished_checks_but_keeps_completed_ones(tmp_path):
    agent = SetupAgent({**PHOMEMO, "mode": "simulation"}, tmp_path)
    await agent.advance({"search": "a"})
    agent.mark("pair", "running")
    restarted = SetupAgent({**PHOMEMO, "mode": "simulation"}, tmp_path)
    states = {c["id"]: c["status"] for c in restarted.checks()}
    assert states["search"] == "done" and states["pair"] == "waiting"


def test_asset_transport_only_reaches_workshop_assets():
    seen = []

    def serve(request):
        seen.append(str(request.url))
        return httpx.Response(200, content=b"png")

    transport = PlatformAssetTransport("http://192.168.1.20:4318", "http://127.0.0.1:4318/assets",
                                       inner=httpx.MockTransport(serve))

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            ok = await client.get("http://127.0.0.1:4318/assets/a1?expires=1&sig=x")
            assert ok.content == b"png"
            for refused in ("http://127.0.0.1:4318/api/owner/dashboard", "http://example.com/assets/a1"):
                try:
                    await client.get(refused)
                except httpx.ConnectError:
                    continue
                raise AssertionError(refused)
    import asyncio
    asyncio.run(run())
    assert seen == ["http://192.168.1.20:4318/assets/a1?expires=1&sig=x"]


async def test_relay_forwards_allowed_requests_to_the_local_node_and_refuses_others(tmp_path):
    replies = []

    def api(request):
        replies.append(json.loads(request.content))
        return httpx.Response(200, json={"accepted": True})

    agent = SetupAgent({**PHOMEMO, "mode": "simulation"}, tmp_path)
    for step in ("search", "pair", "ready"):
        await agent.advance({step: "x"})
    credentials = {"connectorId": "connector_1", "connectorKey": "k" * 64, "tokenSecret": "s" * 64,
                   "assetOrigin": "http://127.0.0.1:4318/assets", "nodeOrigin": "http://connector.invalid",
                   "platform": "http://127.0.0.1:4318", "machine": {**PHOMEMO, "mode": "simulation"}}
    connector = Connector(credentials, tmp_path, agent=agent, api_transport=httpx.MockTransport(api), say=lambda _: None)
    async with connector.api() as client:
        await connector.handle(client, {"id": "r0", "method": "POST", "path": "/tools/get_capabilities",
                                        "body": {"machine_id": "phomemo_01"}})
        assert replies[-1]["status"] == 503  # still setting up: no node yet
        await connector.start_node()
        await connector.handle(client, {"id": "r1", "method": "POST", "path": "/tools/get_capabilities",
                                        "body": {"machine_id": "phomemo_01"}})
        await connector.handle(client, {"id": "r2", "method": "POST", "path": "/mcp/", "body": {}})
    await connector.node.aclose()
    await connector.service.close()
    capabilities = replies[1]
    assert capabilities["status"] == 200 and capabilities["json"]["mode"] == "simulation"
    assert replies[2]["status"] == 403


async def test_poll_applies_allowances_and_stops_when_removed(tmp_path):
    responses = [httpx.Response(200, json={"requests": [], "consents": {"search": "now"}, "registered": False}),
                 httpx.Response(401, json={"error": {"code": "CONNECTOR_AUTH"}})]

    def api(request):
        assert request.headers["Authorization"] == "Bearer connector_1." + "k" * 64
        return responses.pop(0)

    credentials = {"connectorId": "connector_1", "connectorKey": "k" * 64, "platform": "http://127.0.0.1:4318",
                   "machine": {**PHOMEMO, "mode": "simulation"}}
    said = []
    connector = Connector(credentials, tmp_path, api_transport=httpx.MockTransport(api), say=said.append)
    async with connector.api() as client:
        assert await connector.poll_once(client) is True
        assert connector.consents == {"search": "now"} and connector.setup_wake.is_set()
        assert await connector.poll_once(client) is False
    assert "removed" in said[-1]
