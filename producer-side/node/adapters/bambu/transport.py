"""How the node talks to a Bambu printer on the LAN, plus a dry-run stand-in.

lan:  MQTT over TLS on :8883 (status reports in, commands out) and implicit FTPS on :990
      (file upload to the SD card). Both log in as "bblp" with the printer's LAN access code.
file: no printer. Upload copies the file to out_dir; a print plays a fast fake
      PREPARE -> RUNNING 0..100% -> FINISH sequence through the same report stream.

The printer's TLS certificates are signed by Bambu's own CA, so verification is off.
That is acceptable on the LAN this runs on; do not point it across the internet.
"""
from __future__ import annotations

import asyncio
import ftplib
import itertools
import json
import logging
import os
import shutil
import socket
import ssl
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..base import AdapterError

log = logging.getLogger(__name__)

MQTT_PORT = 8883
FTPS_PORT = 990
USERNAME = "bblp"
SSDP_PORT = 2021

_seq = itertools.count(1)


def _seq_id() -> str:
    return str(next(_seq))


# --- commands (JSON published to device/<serial>/request) -----------------------------

def pushall_cmd() -> dict[str, Any]:
    return {"pushing": {"sequence_id": _seq_id(), "command": "pushall", "version": 1, "push_target": 1}}


def version_cmd() -> dict[str, Any]:
    return {"info": {"sequence_id": _seq_id(), "command": "get_version"}}


def stop_cmd() -> dict[str, Any]:
    return {"print": {"sequence_id": _seq_id(), "command": "stop", "param": ""}}


def project_file_cmd(remote_name: str, task_name: str, *, plate: int = 1, url_template: str,
                     bed_leveling: bool = True, flow_cali: bool = False, vibration_cali: bool = False,
                     timelapse: bool = False, use_ams: bool = False) -> dict[str, Any]:
    """Start printing plate <plate> of a .gcode.3mf already on the SD card."""
    return {"print": {
        "sequence_id": _seq_id(),
        "command": "project_file",
        "param": f"Metadata/plate_{plate}.gcode",
        "url": url_template.format(name=remote_name),
        "subtask_name": task_name,
        "project_id": "0", "profile_id": "0", "task_id": "0", "subtask_id": "0",
        "bed_type": "auto",
        "bed_leveling": bed_leveling,
        "flow_cali": flow_cali,
        "vibration_cali": vibration_cali,
        "layer_inspect": False,
        "timelapse": timelapse,
        "use_ams": use_ams,
        "ams_mapping": [],
    }}


# --- serial number discovery ---------------------------------------------------------

def cn_from_der(der: bytes) -> str | None:
    """Subject CN of a DER certificate (the last commonName in it). Bambu printers use the serial."""
    oid = b"\x55\x04\x03"
    found = None
    i = der.find(oid)
    while i != -1:
        j = i + len(oid)
        if j + 2 <= len(der) and der[j] in (0x0C, 0x13, 0x16):
            n = der[j + 1]
            if n < 0x80:
                found = der[j + 2 : j + 2 + n].decode("utf-8", "replace")
        i = der.find(oid, i + 1)
    return found


def serial_from_tls(host: str, port: int = MQTT_PORT, timeout: float = 5) -> str | None:
    """Read the serial number off the printer's MQTT certificate. No login needed."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((host, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as s:
                der = s.getpeercert(binary_form=True)
    except OSError as e:
        raise AdapterError(f"cannot reach printer at {host}:{port} ({e}); is it on this network?") from e
    return cn_from_der(der) if der else None


def discover(timeout: float = 10.0) -> list[dict[str, str]]:
    """Listen for the printers' SSDP broadcasts on UDP 2021 (every few seconds). Blocking."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    s.bind(("", SSDP_PORT))
    found: dict[str, dict[str, str]] = {}
    deadline = time.monotonic() + timeout
    try:
        while (left := deadline - time.monotonic()) > 0:
            s.settimeout(left)
            try:
                data, (ip, _) = s.recvfrom(4096)
            except socket.timeout:
                break
            headers = {}
            for line in data.decode("utf-8", "replace").splitlines()[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            serial = headers.get("usn")
            if serial and "bambu" in " ".join(headers):
                found[serial] = {
                    "ip": headers.get("location", ip),
                    "serial": serial,
                    "model": headers.get("devmodel.bambu.com", ""),
                    "name": headers.get("devname.bambu.com", ""),
                    "signal": headers.get("devsignal.bambu.com", ""),
                    "connect": headers.get("devconnect.bambu.com", ""),
                }
    finally:
        s.close()
    return list(found.values())


# --- FTPS ----------------------------------------------------------------------------

class _ImplicitFTPS(ftplib.FTP_TLS):
    """ftplib speaks explicit FTPS; the printer wants implicit TLS on :990, and the data
    connection must reuse the control connection's TLS session."""

    def __init__(self, *a: Any, **kw: Any):
        super().__init__(*a, **kw)
        self._sock: ssl.SSLSocket | None = None

    @property
    def sock(self):  # type: ignore[override]
        return self._sock

    @sock.setter
    def sock(self, value):  # type: ignore[override]
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value, server_hostname=self.host)
        self._sock = value

    def ntransfercmd(self, cmd, rest=None):  # type: ignore[override]
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(conn, server_hostname=self.host, session=self.sock.session)
        return conn, size

    def storbinary(self, cmd, fp, blocksize=32768, callback=None, rest=None):  # type: ignore[override]
        # Same as ftplib's, minus conn.unwrap(): the printer never answers the TLS close and it hangs.
        self.voidcmd("TYPE I")
        with self.transfercmd(cmd, rest) as conn:
            while buf := fp.read(blocksize):
                conn.sendall(buf)
                if callback:
                    callback(buf)
        return self.voidresp()


def _tls_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def ftps_upload(host: str, access_code: str, local: Path, remote_name: str, timeout: float = 30) -> str:
    """Upload to the SD card root. Returns the server's final reply (2xx). Blocking."""
    ftp = _ImplicitFTPS(context=_tls_context(), timeout=timeout)
    try:
        ftp.connect(host, FTPS_PORT)
        ftp.login(USERNAME, access_code)
        ftp.prot_p()
        with local.open("rb") as f:
            reply = ftp.storbinary(f"STOR {remote_name}", f)
        if not reply.startswith("2"):
            raise AdapterError(f"upload not confirmed by printer: {reply}")
        return reply
    except ftplib.error_perm as e:
        if str(e).startswith("530"):
            raise AdapterError("FTPS login refused: wrong LAN access code") from e
        if str(e).startswith(("550", "553")):
            raise AdapterError(f"printer refused the file ({e}); is a microSD card inserted?") from e
        raise AdapterError(f"FTPS error: {e}") from e
    except (OSError, EOFError, ftplib.Error) as e:
        raise AdapterError(f"FTPS upload to {host}:{FTPS_PORT} failed: {e}") from e
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


# --- transports ----------------------------------------------------------------------

def _merge(dst: dict[str, Any], src: dict[str, Any]) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _merge(dst[k], v)
        else:
            dst[k] = v


class _Reports:
    """Merged "print" report plus a wake-up for the asyncio side. Fed from any thread."""

    def __init__(self) -> None:
        self.print: dict[str, Any] = {}
        self.info: dict[str, Any] = {}
        self.command_results: dict[str, dict[str, Any]] = {}  # command name -> last reply
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._event: asyncio.Event | None = None
        self.count = 0

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop, self._event = loop, asyncio.Event()

    def feed(self, msg: dict[str, Any]) -> None:
        with self._lock:
            if isinstance(p := msg.get("print"), dict):
                cmd = p.get("command")
                if cmd and cmd != "push_status" and ("result" in p or "reason" in p or "err_code" in p):
                    self.command_results[cmd] = dict(p)
                _merge(self.print, p)
            if isinstance(i := msg.get("info"), dict):
                _merge(self.info, i)
            self.count += 1
        if self._loop and self._event:
            self._loop.call_soon_threadsafe(self._event.set)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self.print))

    async def wait(self, timeout: float) -> bool:
        assert self._event is not None
        try:
            await asyncio.wait_for(self._event.wait(), timeout)
        except asyncio.TimeoutError:
            return False
        self._event.clear()
        return True


class Transport:
    """What the adapter needs from a printer connection."""

    host: str = ""
    serial: str | None = None

    def __init__(self) -> None:
        self.reports = _Reports()

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def publish(self, payload: dict[str, Any]) -> None: ...
    async def upload(self, local: Path, remote_name: str) -> str: ...

    def report(self) -> dict[str, Any]:
        return self.reports.snapshot()

    async def wait_report(self, timeout: float) -> bool:
        """True when a new report arrived within timeout."""
        return await self.reports.wait(timeout)

    async def refresh(self, timeout: float = 10.0) -> dict[str, Any]:
        """Ask for a full status push and wait for it."""
        before = self.reports.count
        await self.publish(pushall_cmd())
        deadline = time.monotonic() + timeout
        while self.reports.count == before or "gcode_state" not in self.reports.print:
            left = deadline - time.monotonic()
            if left <= 0:
                raise AdapterError("printer accepted the connection but sent no status; "
                                   "check the serial number and that LAN mode is on")
            await self.reports.wait(left)
        return self.report()


class LanTransport(Transport):
    def __init__(self, host: str, access_code: str, serial: str | None = None, connect_timeout: float = 10):
        super().__init__()
        self.host, self.access_code, self.serial = host, access_code, serial
        self.connect_timeout = connect_timeout
        self._client = None

    async def connect(self) -> None:
        import paho.mqtt.client as mqtt

        if not self.serial:
            self.serial = await asyncio.to_thread(serial_from_tls, self.host)
            if not self.serial:
                raise AdapterError("could not read the printer's serial number; set adapter.serial")
            log.info("printer serial %s (from its certificate)", self.serial)

        loop = asyncio.get_running_loop()
        self.reports.bind(loop)
        connected: asyncio.Future[Any] = loop.create_future()
        report_topic = f"device/{self.serial}/report"

        def on_connect(client, _ud, _flags, reason_code, _props):
            if reason_code.is_failure:
                if not connected.done():
                    loop.call_soon_threadsafe(connected.set_result, reason_code)
                return
            client.subscribe(report_topic)
            if not connected.done():
                loop.call_soon_threadsafe(connected.set_result, None)

        def on_message(_client, _ud, msg):
            try:
                self.reports.feed(json.loads(msg.payload))
            except ValueError:
                log.debug("non-JSON message on %s", msg.topic)

        def on_disconnect(_client, _ud, _flags, reason_code, _props):
            if reason_code.is_failure:
                log.warning("MQTT disconnected (%s); paho will reconnect", reason_code)

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fabrary-{os.getpid()}",
                             protocol=mqtt.MQTTv311)
        client.username_pw_set(USERNAME, self.access_code)
        client.tls_set_context(_tls_context())
        client.tls_insecure_set(True)
        client.on_connect, client.on_message, client.on_disconnect = on_connect, on_message, on_disconnect
        try:
            await asyncio.to_thread(client.connect, self.host, MQTT_PORT, 30)
        except OSError as e:
            raise AdapterError(f"cannot reach printer MQTT at {self.host}:{MQTT_PORT} ({e}); "
                               "same network? LAN mode on?") from e
        client.loop_start()
        self._client = client
        try:
            rc = await asyncio.wait_for(connected, self.connect_timeout)
        except asyncio.TimeoutError:
            await self.close()
            raise AdapterError("MQTT connect timed out") from None
        if rc is not None:
            await self.close()
            hint = " (wrong LAN access code?)" if "authori" in str(rc).lower() or "password" in str(rc).lower() else ""
            raise AdapterError(f"MQTT login refused: {rc}{hint}")

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            client.disconnect()
            client.loop_stop()

    async def publish(self, payload: dict[str, Any]) -> None:
        if self._client is None:
            raise AdapterError("not connected")
        # QoS 0: the printer's broker never sends PUBACK for QoS 1 (seen on our A1 mini). Whether a
        # command took effect shows up in the reports (command replies, gcode_state).
        info = self._client.publish(f"device/{self.serial}/request", json.dumps(payload), qos=0)
        await asyncio.to_thread(info.wait_for_publish, 10)
        if not info.is_published():
            raise AdapterError("could not send the command to the printer (MQTT not connected)")

    async def upload(self, local: Path, remote_name: str) -> str:
        return await asyncio.to_thread(ftps_upload, self.host, self.access_code, local, remote_name)


class FileTransport(Transport):
    """Dry run. Behaves like an idle printer with the manifest's material loaded."""

    def __init__(self, out_dir: Path, initial: dict[str, Any], step_s: float = 0.02):
        super().__init__()
        self.host, self.serial = "dry-run", "DRYRUN0000000"
        self.out_dir, self.step_s = out_dir, step_s
        self._initial = initial
        self._task: asyncio.Task | None = None

    async def connect(self) -> None:
        self.reports.bind(asyncio.get_running_loop())
        self.out_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        if self._task:
            self._task.cancel()

    async def publish(self, payload: dict[str, Any]) -> None:
        if "pushing" in payload:
            self.reports.feed({"print": {"command": "push_status", **self._initial}})
            return
        cmd = (payload.get("print") or {}).get("command")
        if cmd == "project_file":
            p = payload["print"]
            name = p["url"].rsplit("/", 1)[-1]
            if not (self.out_dir / name).exists():
                self.reports.feed({"print": {"command": "project_file", "result": "fail",
                                             "reason": f"{name} not on SD card"}})
                return
            self._task = asyncio.create_task(self._simulate(p["subtask_name"]))
        elif cmd == "stop":
            if self._task:
                self._task.cancel()
            self.reports.feed({"print": {"gcode_state": "FAILED", "print_error": 50348044}})

    async def _simulate(self, task: str) -> None:
        feed = self.reports.feed
        feed({"print": {"command": "project_file", "result": "success"}})
        feed({"print": {"gcode_state": "PREPARE", "subtask_name": task, "mc_percent": 0}})
        await asyncio.sleep(self.step_s)
        for pct in range(0, 101, 10):
            feed({"print": {"gcode_state": "RUNNING", "subtask_name": task, "mc_percent": pct,
                            "mc_remaining_time": (100 - pct) // 10, "layer_num": pct // 10, "total_layer_num": 10}})
            await asyncio.sleep(self.step_s)
        feed({"print": {"gcode_state": "FINISH", "subtask_name": task, "mc_percent": 100, "mc_remaining_time": 0}})

    async def upload(self, local: Path, remote_name: str) -> str:
        shutil.copyfile(local, self.out_dir / remote_name)
        return "226 Transfer complete (dry run)"


def make_transport(config: dict[str, Any], *, dry_run_state: Callable[[], dict[str, Any]]) -> Transport:
    kind = config.get("transport", "lan")
    if kind == "file":
        return FileTransport(Path(config.get("out_dir", ".work/bambu_out")), dry_run_state(),
                             float(config.get("dry_run_step_s", 0.02)))
    if kind != "lan":
        raise AdapterError(f"unknown Bambu transport {kind!r}; use lan or file")
    host = config.get("host")
    if not host:
        raise AdapterError("adapter.host (the printer's IP) is not set")
    env = config.get("access_code_env", "BAMBU_ACCESS_CODE")
    code = config.get("access_code") or os.environ.get(env)
    if not code:
        raise AdapterError(f"LAN access code missing: set {env} (printer screen: Settings > WLAN/LAN-only)")
    return LanTransport(host, code, config.get("serial") or None)
