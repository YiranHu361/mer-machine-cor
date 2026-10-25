"""Actual pinned SDK wrappers; FTP, MQTT and Bluetooth boundaries are fakes."""
import asyncio
import hashlib
import io
import json
import time

import httpx
import pytest
from PIL import Image

from fabrary_node.adapters import Bambu, InstaxLink3
from fabrary_node.security import NodeError, sign_token
from fabrary_node.service import NodeService
from .test_mode_binding import KEY, artifact


def pinned_printer(*, upload_failure=False, connected=True, published=True, reply="226 Transfer complete"):
    pytest.importorskip("bambulabs_api")
    from bambulabs_api.client import Printer
    from bambulabs_api.ftp_client import PrinterFTPClient
    from bambulabs_api.mqtt_client import PrinterMQTTClient

    events = []
    started = False
    state_reads = 0

    class PrintReport(dict):
        def get(self, key, default=None):
            nonlocal state_reads
            if key == "gcode_state" and started:
                state_reads += 1
                return "RUNNING" if state_reads == 1 else "FINISH"
            return super().get(key, default)

    report = PrintReport(gcode_state="IDLE", gcode_file="", subtask_name="")

    class FakeFTP:
        def connect(self, **kwargs): events.append("ftp_connect")
        def login(self, *args): pass
        def prot_p(self): return "200 Private channel"
        def storbinary(self, command, stream, **kwargs):
            events.append("upload")
            stream.read()
            if upload_failure:
                raise OSError("Fake partial upload failure")
            return reply
        def close(self): events.append("ftp_close")

    class FakeCommand:
        def wait_for_publish(self): events.append("wait_for_publish")
        def is_published(self): return published

    class FakeMQTT:
        def is_connected(self): return connected
        def publish(self, topic, payload):
            nonlocal started
            command = json.loads(payload)["print"]
            events.append(command["command"])
            if command["command"] == "project_file":
                started = True
                report["gcode_file"] = command["file"]
            return FakeCommand()
        def loop_stop(self): events.append("mqtt_cleanup")

    # Avoid SDK constructors: they create real transport objects. The real
    # upload/start/stop methods still exercise the pinned SDK wrappers.
    ftp = PrinterFTPClient.__new__(PrinterFTPClient)
    ftp.ftps = FakeFTP()
    ftp.server_ip, ftp.port, ftp.user, ftp.access_code = "isolated.invalid", 990, "fixture", "fixture"
    mqtt = PrinterMQTTClient.__new__(PrinterMQTTClient)
    mqtt._client, mqtt.command_topic = FakeMQTT(), "fixture/request"
    mqtt._data, mqtt._last_update, mqtt.pushall_timeout, mqtt.strict = {"print": report}, int(time.time()), 100000, False
    printer = Printer.__new__(Printer)
    printer.ftp_client, printer.mqtt_client = ftp, mqtt
    return printer, events


def catalog(data):
    entry = {"id": "fixture", "sha256": hashlib.sha256(data).hexdigest(), "machineModel": "Bambu Lab A1 mini",
             "reviewed": True, "widthMm": 30, "heightMm": 20, "depthMm": 10, "color": "white",
             "material": "pla", "estimatedSeconds": 1}
    parameters = {key: entry[key] for key in ("widthMm", "heightMm", "depthMm", "color", "material", "estimatedSeconds")}
    return entry, {**parameters, "outputType": "3d", "quantity": 1, "crop": "contain", "specVersion": 1}


def request(data, machine, parameters, mode="hardware"):
    body = {"machine_id": machine, "job_id": "job_" + machine, "attempt_id": "attempt_" + machine,
            "artifact_sha256": hashlib.sha256(data).hexdigest(), "parameters": parameters, "expires_at": int(time.time()) + 300}
    return {**body, "token": sign_token({**body, "scope": "dispatch", "expected_mode": mode}, KEY),
            "artifact_url": "http://127.0.0.1:4318/assets/fixture?expires=9999999999&sig=fixture"}


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["upload", "disconnected", "unpublished"])
async def test_actual_bambu_sdk_failures_leave_node_uncertain_without_consumption_or_reprint(tmp_path, monkeypatch, failure):
    data = b"Owner-reviewed prepared catalog fixture"
    entry, parameters = catalog(data)
    config = {"id": "bambu_01", "model": "Bambu Lab A1 mini", "mode": "hardware", "host": "isolated.invalid",
              "serial": "fixture", "accessCodeEnv": "FABRARY_ISOLATED_SDK_TEST", "lanOnly": True,
              "developerMode": True, "ownerReady": True, "paired": True, "catalog": [entry],
              "maxJobSeconds": 60}
    monkeypatch.setenv("FABRARY_ISOLATED_SDK_TEST", "fake-test-value")
    service = NodeService(key=KEY, data_dir=tmp_path, machines=[config],
                          artifact_transport=httpx.MockTransport(lambda _: httpx.Response(200, content=data)))
    printer, events = pinned_printer(upload_failure=failure == "upload", connected=failure != "disconnected", published=failure != "unpublished")
    service.adapters[config["id"]].printer = printer
    state = service.journal.machine(config["id"])
    state.update(calibrated=True, listed=True, ready=True, paused=False, mediaRemaining=100)
    service.journal.save_machine(config["id"], state)
    req = request(data, config["id"], parameters)
    try:
        assert (await service.run_job(**req))["status"] == "accepted"
        await service.tasks[req["attempt_id"]]
        row = service.journal.get(req["attempt_id"])
        assert row["status"] == "uncertain" and not row["completion_credible"]
        assert row["estimated_consumption_recorded"] == 0
        assert service.journal.machine(config["id"])["mediaRemaining"] == 100
        assert events.count("project_file") == (1 if failure == "unpublished" else 0)
        assert events.count("upload") == 1
        before = events.copy()
        assert (await service.run_job(**req))["status"] == "already_accepted"
        assert events == before
        assert service.get_capabilities(config["id"])["ready"] is False
    finally:
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("reply", ["226 Transfer complete", "250 Requested file action okay"])
async def test_bambu_positive_ftp_and_publish_ack_still_require_matching_running_then_finish(tmp_path, monkeypatch, reply):
    data = b"Owner-reviewed prepared catalog fixture"
    entry, parameters = catalog(data)
    path = tmp_path / "approved.3mf"
    path.write_bytes(data)
    adapter = Bambu({"catalog": [entry], "maxJobSeconds": 60})
    adapter.printer, events = pinned_printer(reply=reply)
    original_sleep = asyncio.sleep
    async def no_delay(seconds): await original_sleep(0)
    monkeypatch.setattr(asyncio, "sleep", no_delay)
    result = await adapter.run(path, parameters, "exact_attempt")
    assert result[:2] == ("completed", True)
    assert events == ["ftp_connect", "upload", "ftp_close", "project_file", "wait_for_publish"]


@pytest.mark.asyncio
@pytest.mark.parametrize("connected,published,expected", [(False, True, "unknown"), (True, False, "unknown"), (True, True, "requested")])
async def test_actual_bambu_stop_publication_contract_is_reported_truthfully(connected, published, expected):
    adapter = Bambu({})
    adapter.printer, events = pinned_printer(connected=connected, published=published)
    result = await adapter.abort()
    assert result["status"] == expected
    assert events.count("stop") == int(connected)
    if expected == "unknown":
        assert "unconfirmed" in result["reason"] and "published;" not in result["reason"]
    else:
        assert "does not confirm physical stoppage" in result["reason"]


@pytest.mark.asyncio
async def test_absent_bluetooth_uses_actual_instax_init_without_exiting_node_or_emitting_output(tmp_path, monkeypatch):
    simplepyble = pytest.importorskip("simplepyble")
    lookups = []
    class FakeNoBluetooth:
        @staticmethod
        def get_adapters(): lookups.append("fake adapters only"); return []
    monkeypatch.setattr(simplepyble, "Adapter", FakeNoBluetooth)
    image = io.BytesIO()
    Image.new("RGB", (600, 800), "white").save(image, "PNG")
    data = image.getvalue()
    config = {"id": "instax_01", "model": "Instax Mini Link 3", "mode": "hardware", "paired": True,
              "ownerReady": True, "bluetoothAddress": "fake-owner-instax", "serviceUUID": "fixture-service",
              "writeCharUUID": "fixture-write", "notifyCharUUID": "fixture-notify", "compatibilityValidated": True,
              "developmentSeconds": 90, "maxJobSeconds": 240}
    # Directly exercise the same vendored constructor's ordinary disconnected
    # path before proving that a journaled job can survive it in this process.
    with pytest.raises(NodeError) as unavailable:
        InstaxLink3(config)._send(tmp_path / "never-read.png", {"quantity": 1})
    assert unavailable.value.code == "link3_unavailable" and unavailable.value.status == 503
    simulation = artifact()
    service = NodeService(key=KEY, data_dir=tmp_path, machines=[config,
        {"id": "phomemo_01", "model": "Phomemo M02Pro", "mode": "simulation", "simulationSeconds": 0}],
        artifact_transport=httpx.MockTransport(lambda r: httpx.Response(200, content=simulation if r.url.path.endswith("simulation") else data)))
    state = service.journal.machine(config["id"])
    state.update(calibrated=True, listed=True, ready=True, paused=False, mediaRemaining=100)
    service.journal.save_machine(config["id"], state)
    req = request(data, config["id"], {"outputType": "instax", "widthMm": 54, "heightMm": 86,
        "quantity": 1, "material": "photo-film", "crop": "contain", "specVersion": 1})
    try:
        await service.run_job(**req)
        await service.tasks[req["attempt_id"]]
        row = service.journal.get(req["attempt_id"])
        assert row["status"] == "uncertain" and row["estimated_consumption_recorded"] == 0
        assert not service.get_capabilities(config["id"])["ready"]
        assert service.adapters[config["id"]].device is None
        later = request(simulation, "phomemo_01", {"outputType": "sticker", "widthMm": 53, "heightMm": 50,
            "quantity": 1, "material": "thermal-paper", "crop": "contain", "specVersion": 1}, "simulation")
        later["artifact_url"] = later["artifact_url"].replace("/fixture?", "/simulation?")
        assert (await service.run_job(**later))["status"] == "accepted"
        await service.tasks[later["attempt_id"]]
        assert service.journal.get(later["attempt_id"])["status"] == "completed"
        assert lookups == ["fake adapters only", "fake adapters only"]
    finally:
        await service.close()
