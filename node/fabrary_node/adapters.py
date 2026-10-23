"""Explicitly configured hardware adapters. Construction performs no discovery.

Protocol reference: vivier/phomemo-tools at 2b767486d4590676f1ffb61c7ca870984978a980.
Bambu API: bambulabs-api 2.6.6. Upstream transport acknowledgments never imply a
finished physical job. Link 3 remains blocked pending exact-device validation.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re
import socket
import struct
import sys
import time
import httpx
from PIL import Image
from .security import NodeError


class Simulator:
    version = "fabrary-simulator/1.0.0"

    def __init__(self, config: dict):
        self.config = config
        self.executions = 0

    def blockers(self) -> list[str]:
        return []

    async def run(self, artifact: Path, parameters: dict, attempt_id: str) -> tuple[str, bool, str]:
        self.executions += 1
        await asyncio.sleep(self.config.get("simulationSeconds", 0.35))
        return "completed", True, "Simulated device completion; no physical item was produced"

    async def abort(self) -> dict:
        return {"status": "stopped", "reason": "Simulation task cancelled; no physical hardware is involved"}


class Phomemo:
    version = "fabrary-phomemo/1.0.0;protocol=phomemo-tools@2b76748"

    def __init__(self, config: dict):
        self.config = config

    def blockers(self) -> list[str]:
        issues = []
        if sys.platform != "linux":
            issues.append("M02Pro RFCOMM adapter requires Linux/Pi; macOS Bluetooth serial is not supported by this adapter")
        if not self.config.get("bluetoothAddress"):
            issues.append("Configured paired M02Pro Bluetooth address is missing")
        if not isinstance(self.config.get("rfcommChannel"), int):
            issues.append("Explicit RFCOMM channel is missing; node will not scan for it")
        if not self.config.get("paired"):
            issues.append("Owner has not confirmed pairing")
        if not self.config.get("cameraCommand") and not self.config.get("cameraUrl"):
            issues.append("A fixed camera capture path is missing")
        if not self.config.get("ownerReady"):
            issues.append("Owner supervision, loaded media and a clear output area are not confirmed")
        return issues

    @staticmethod
    def raster(artifact: Path) -> bytes:
        with Image.open(artifact) as image:
            if image.mode != "1" or image.width > 640:
                raise NodeError("artifact_format", "Phomemo requires the approved 1-bit raster, at most 640 dots wide")
            width_bytes = (image.width + 7) // 8
            padded = Image.new("1", (width_bytes * 8, image.height), 1)
            padded.paste(image, (0, 0))
            rows = padded.tobytes()
            # Pillow uses 1 for white; protocol uses 1 for black. No resizing,
            # rotation, brightness correction or pixel substitution after approval.
            rows = bytes(byte ^ 255 for byte in rows)
            output = bytearray(b"\x1b\x40\x1b\x61\x01\x1f\x11\x02\x04")
            for start in range(0, image.height, 255):
                count = min(255, image.height - start)
                output += b"\x1d\x76\x30\x00" + struct.pack("<HH", width_bytes, count)
                output += rows[start * width_bytes:(start + count) * width_bytes]
            output += b"\x1b\x64\x02\x1b\x64\x02\x1f\x11\x08\x1f\x11\x0e\x1f\x11\x07\x1f\x11\x09"
            return bytes(output)

    def _send(self, data: bytes, quantity: int) -> None:
        connection = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
        connection.settimeout(20)
        try:
            connection.connect((self.config["bluetoothAddress"], self.config["rfcommChannel"]))
            for _ in range(quantity):
                connection.sendall(data)
        finally:
            connection.close()

    async def run(self, artifact: Path, parameters: dict, attempt_id: str) -> tuple[str, bool, str]:
        await asyncio.to_thread(self._send, self.raster(artifact), parameters["quantity"])
        return "uncertain", False, "Raster delivered over RFCOMM; this driver has no credible physical-completion signal. Inspect output; never automatically reprint."

    async def abort(self) -> dict:
        return {"status": "unsupported", "reason": "M02Pro raster transport has no verified stop command; inspect the device"}


class InstaxLink3:
    version = "fabrary-instaxble/1.0.0;upstream=804dca8;link3-unverified"

    def __init__(self, config: dict):
        self.config = config
        self.device = None

    def blockers(self) -> list[str]:
        issues = []
        if importlib.util.find_spec("simplepyble") is None:
            issues.append("Install pinned simplepyble hardware dependency")
        if not self.config.get("bluetoothAddress") or not self.config.get("paired"):
            issues.append("Exact paired Link 3 Bluetooth identity is missing; no discovery scan will run")
        if not all(self.config.get(key) for key in ("serviceUUID", "writeCharUUID", "notifyCharUUID")):
            issues.append("Exact-device Link 3 service and characteristic UUIDs are not configured")
        if self.config.get("compatibilityValidated") is not True:
            issues.append("BLOCKED: verify the exact Link 3 protocol, 55KB image transfer, orientation and output on the team device before enabling this candidate")
        if not self.config.get("ownerReady"):
            issues.append("Owner supervision, loaded film and clear output area are not confirmed")
        if not self.config.get("cameraCommand") and not self.config.get("cameraUrl"):
            issues.append("Fresh fixed camera capture is unconfigured")
        if self.config.get("developmentSeconds", 90) < 90:
            issues.append("Link 3 development allowance must be at least 90 seconds until measured on the actual film")
        return issues

    @staticmethod
    def jpeg_payload(artifact: Path, flip_vertical: bool) -> bytes:
        with Image.open(artifact) as original:
            image = original.convert("RGB")
            if image.size != (600, 800):
                raise NodeError("instax_image", "Mini Link 3 requires the approved 600×800 image")
            if flip_vertical:
                image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            for quality in range(95, 0, -1):
                stream = io.BytesIO()
                image.save(stream, "JPEG", quality=quality, optimize=False)
                payload = stream.getvalue()
                if len(payload) <= 55_000:
                    return payload
        raise NodeError("instax_image", "Approved image cannot fit the conservative Link 3 transfer limit")

    def _send(self, artifact: Path, parameters: dict) -> tuple[str, bool, str]:
        from .instaxble.InstaxBLE import InstaxBLE
        from .instaxble.Types import EventType
        config = self.config
        deadline = time.monotonic() + config.get("maxJobSeconds", 240)

        class ConfiguredPrinter(InstaxBLE):
            def find_device(self, timeout=0):
                # Obtain only already-paired handles and select the exact owner
                # identity. No scan, nearest-device fallback or prefix matching.
                method = getattr(self.adapter, "get_paired_peripherals", None)
                if method is None:
                    raise NodeError("link3_paired_lookup", "Installed BLE runtime cannot access paired handles without discovery; this platform remains blocked", 503)
                for peripheral in method():
                    if peripheral.address().upper() == config["bluetoothAddress"].upper():
                        return peripheral
                raise NodeError("link3_not_paired", "Configured Link 3 is not available among paired handles", 503)

            def display_current_status(self):
                pass

            def send_packet(self, packet):
                while self.waitingForResponse and not self.cancelled:
                    if time.monotonic() >= deadline:
                        self.cancelled = True
                        raise TimeoutError("Instax response timed out")
                    time.sleep(.02)
                if self.cancelled or time.monotonic() >= deadline:
                    raise TimeoutError("Instax transfer cancelled or expired")
                if not self.peripheral or not self.peripheral.is_connected():
                    raise ConnectionError("Configured Instax peripheral is not connected")
                self.waitingForResponse = True
                for offset in range(0, len(packet), 182):
                    self.peripheral.write_command(self.serviceUUID, self.writeCharUUID, packet[offset:offset+182])

            def parse_printer_response(self, event, packet):
                if event == EventType.PRINT_IMAGE:
                    self.print_acknowledged = True
                return super().parse_printer_response(event, packet)

        printer = ConfiguredPrinter(device_address=config["bluetoothAddress"], print_enabled=True, verbose=False)
        self.device = printer
        printer.serviceUUID, printer.writeCharUUID, printer.notifyCharUUID = (config[key] for key in ("serviceUUID", "writeCharUUID", "notifyCharUUID"))
        try:
            printer.connect(timeout=10)
            if not printer.peripheral or not printer.peripheral.is_connected() or not printer.printerSettings:
                raise ConnectionError("Link 3 identity/protocol handshake did not finish")
            if printer.imageSize != (600, 800):
                raise NodeError("link3_identity", "Configured peripheral did not report Instax mini image dimensions", 503)
            # Upstream accepts bytearrays directly, avoiding its path conversion
            # that may exceed the Link 3 transfer limit documented in issue 21.
            payload = self.jpeg_payload(artifact, bool(config.get("flipVertical", True)))
            for _ in range(parameters["quantity"]):
                if printer.photosLeft < 1:
                    raise NodeError("instax_media", "Link 3 reported no remaining film", 409)
                printer.print_acknowledged = False
                printer.print_image(bytearray(payload))
                while not printer.print_acknowledged or printer.packetsForPrinting or printer.waitingForResponse:
                    if printer.cancelled or time.monotonic() >= deadline:
                        raise TimeoutError("Instax print acknowledgment timed out")
                    time.sleep(.05)
                # Film development is a separate measured prerequisite; do not
                # capture the undeveloped output as a failed image.
                time.sleep(config.get("developmentSeconds", 90))
                printer.photosLeft = max(0, printer.photosLeft - 1)
            return "uncertain", False, "Link 3 acknowledged print transfer and film development allowance elapsed; physical ejection/completion still requires owner inspection and fresh evidence"
        finally:
            printer.cancelled = True
            printer.disconnect()
            self.device = None

    async def run(self, artifact: Path, parameters: dict, attempt_id: str) -> tuple[str, bool, str]:
        issues = self.blockers()
        if issues:
            raise NodeError("link3_unverified", "; ".join(issues), 503)
        return await asyncio.to_thread(self._send, artifact, parameters)

    async def abort(self) -> dict:
        if self.device:
            # Cancelling unsent packets cannot stop an image already ejecting.
            self.device.cancelled = True
            self.device.packetsForPrinting = []
        return {"status": "unsupported", "reason": "Queued Link 3 transfer can be cancelled; physical print stoppage is not verified"}


# Match the backend's String.trim() and Zod code-point length so an owner
# catalog can round-trip through the signed specification without changes.
_JS_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def normalized_catalog_color(value) -> str:
    if not isinstance(value, str):
        raise NodeError("catalog_color", "Prepared model color must be a string", 422)
    color = value.strip(_JS_TRIM)
    if not color or len(color) > 60:
        raise NodeError("catalog_color", "Prepared model color must contain 1–60 characters after trimming", 422)
    return color


class Bambu:
    version = "bambulabs-api/2.6.6"

    def __init__(self, config: dict):
        self.config = config
        for entry in self.config.get("catalog", []):
            entry["color"] = normalized_catalog_color(entry.get("color"))
        self.printer = None

    def blockers(self) -> list[str]:
        issues = []
        for key in ("host", "serial", "accessCodeEnv"):
            if not self.config.get(key):
                issues.append("Bambu " + key + " is missing")
        if self.config.get("accessCodeEnv") and not os.environ.get(self.config["accessCodeEnv"]):
            issues.append("Configured Bambu access-code environment variable is unset")
        if not self.config.get("lanOnly") or not self.config.get("developerMode"):
            issues.append("Owner must confirm LAN Only and Developer Mode on the exact firmware")
        if not self.config.get("ownerReady") or not self.config.get("paired"):
            issues.append("Owner supervision, configured printer and clear bed are not confirmed")
        if not self.config.get("catalog"):
            issues.append("No owner-reviewed, A1-mini-sliced, single-color PLA catalog entry is configured")
        if importlib.util.find_spec("bambulabs_api") is None:
            issues.append("Install pinned hardware dependencies with uv sync --extra hardware")
        if not self.config.get("cameraCommand") and not self.config.get("cameraUrl"):
            issues.append("Fresh fixed camera capture is unconfigured; cached SDK frames are not sufficient evidence")
        return issues

    def _connect(self):
        if self.printer is None:
            import bambulabs_api as bl
            self.printer = bl.Printer(self.config["host"], os.environ[self.config["accessCodeEnv"]], self.config["serial"])
            # One MQTT client per configured device. Do not start an SDK camera
            # loop: our evidence path must capture a fresh, timestamped frame.
            self.printer.mqtt_start()
        return self.printer

    def catalog_entry(self, digest: str, parameters: dict) -> dict:
        for entry in self.config.get("catalog", []):
            if entry.get("sha256") == digest and entry.get("material") == "pla" and entry.get("machineModel") == "Bambu Lab A1 mini" and entry.get("reviewed") is True:
                if not isinstance(entry.get("estimatedSeconds"), (int, float)) or not 0 < entry["estimatedSeconds"] <= self.config.get("maxJobSeconds", 900):
                    raise NodeError("catalog_duration", "Prepared model duration exceeds local policy or is unmeasured")
                fields = ("widthMm", "heightMm", "depthMm", "color", "material", "estimatedSeconds")
                if any(key not in entry or key not in parameters or entry[key] != parameters[key] for key in fields):
                    raise NodeError("catalog_specification", "Prepared model dimensions, color, material and duration must exactly match the approved catalog specification", 422)
                return entry
        raise NodeError("catalog_only", "3D artifact must exactly match an owner-reviewed A1 mini prepared catalog file", 403)

    async def run(self, artifact: Path, parameters: dict, attempt_id: str) -> tuple[str, bool, str]:
        entry = self.catalog_entry(hashlib.sha256(artifact.read_bytes()).hexdigest(), parameters)
        printer = await asyncio.to_thread(self._connect)
        deadline = time.monotonic() + 15
        while not printer.mqtt_client_ready():
            if time.monotonic() > deadline:
                raise TimeoutError("Bambu MQTT never became ready")
            await asyncio.sleep(0.25)
        state = str(printer.get_state()).split(".")[-1].upper()
        if state not in {"IDLE", "FINISH", "FAILED"}:
            raise NodeError("device_busy", "Bambu actual state is not idle: " + state, 409)
        filename = "fabrary_" + re.sub(r"[^A-Za-z0-9_-]", "_", attempt_id)[:64] + ".3mf"
        with artifact.open("rb") as stream:
            await asyncio.to_thread(printer.upload_file, stream, filename)
        # publish success only acknowledges the command, never physical finish.
        await asyncio.to_thread(printer.start_print, filename, entry.get("plateNumber", 1), False, [], None, False)
        saw_running = False
        deadline = time.monotonic() + self.config.get("maxJobSeconds", 900)
        while time.monotonic() < deadline:
            state = str(printer.get_state()).split(".")[-1].upper()
            reported_names = [str(printer.get_file_name() or ""), str(printer.subtask_name() or "")]
            same_file = any(Path(name).name in {filename, Path(filename).stem} for name in reported_names if name)
            if state in {"RUNNING", "PREPARE"} and same_file:
                saw_running = True
            if state == "FINISH" and same_file and saw_running:
                return "completed", True, "Bambu reported running then FINISH for this exact prepared file"
            if state == "FAILED" and same_file and saw_running:
                return "failed", False, "Bambu reported FAILED for this prepared file"
            await asyncio.sleep(1)
        await self.abort()
        return "uncertain", False, "Bambu completion timed out; stop requested, physical stoppage unconfirmed"

    async def abort(self) -> dict:
        if self.printer is None:
            return {"status": "unknown", "reason": "No connected Bambu client; physical state is unknown"}
        try:
            await asyncio.to_thread(self.printer.stop_print)
            return {"status": "requested", "reason": "Stop command published; this acknowledgment does not confirm physical stoppage"}
        except Exception:
            return {"status": "unknown", "reason": "Stop command outcome is unknown; inspect the printer"}


def adapter_for(config: dict):
    if config.get("mode", "simulation") == "simulation":
        return Simulator(config)
    return {"Phomemo M02Pro": Phomemo, "Instax Mini Link 3": InstaxLink3, "Bambu Lab A1 mini": Bambu}[config["model"]](config)


async def capture_camera(config: dict) -> bytes:
    """Capture now; do not accept filesystem snapshots that can be stale."""
    maximum = 10 * 1024 * 1024
    if config.get("cameraCommand"):
        command = config["cameraCommand"]
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise NodeError("camera_config", "cameraCommand must be an owner-configured argument list")
        try:
            process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        except OSError:
            raise NodeError("camera_failed", "Configured camera capture could not start", 503) from None
        async def read_frame():
            content = bytearray()
            while chunk := await process.stdout.read(64 * 1024):
                content.extend(chunk)
                if len(content) > maximum:
                    raise NodeError("camera_oversize", "Camera frame exceeds 10 MiB", 503)
            await process.wait()
            return bytes(content)
        try:
            data = await asyncio.wait_for(read_frame(), 10)
        except asyncio.TimeoutError:
            raise NodeError("camera_timeout", "Camera did not return a fresh frame", 503) from None
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()
        if process.returncode != 0:
            raise NodeError("camera_failed", "Camera capture failed", 503)
    elif config.get("cameraUrl"):
        content = bytearray()
        try:
            async with asyncio.timeout(10):
                async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
                    async with client.stream("GET", config["cameraUrl"], headers={"Cache-Control": "no-cache", "Pragma": "no-cache"}) as response:
                        if response.status_code != 200:
                            raise NodeError("camera_failed", "Camera capture endpoint is unavailable", 503)
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > maximum:
                                raise NodeError("camera_oversize", "Camera frame exceeds 10 MiB", 503)
            data = bytes(content)
        except (httpx.HTTPError, TimeoutError, ValueError):
            raise NodeError("camera_failed", "Camera capture endpoint is unavailable or timed out", 503) from None
    else:
        raise NodeError("camera_unconfigured", "Fresh camera capture is unconfigured", 503)
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 24_000_000 or getattr(image, "is_animated", False):
                raise ValueError()
            image.verify()
    except Exception:
        raise NodeError("camera_invalid", "Camera returned an unusable image", 503) from None
    return data
