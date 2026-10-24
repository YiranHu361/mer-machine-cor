"""Byte pipes to a Phomemo printer.

  ble     Bluetooth LE via bleak. Default on macOS. Write FF02, notify FF03 (service FF00).
          The printer advertises by name ("M02 Pro"); on macOS bleak addresses are
          CoreBluetooth UUIDs, not MACs, so match by name unless you've run the scan tool.
  serial  Classic Bluetooth SPP / RFCOMM as a serial port: /dev/cu.<name> on macOS,
          /dev/rfcomm0 on a Pi after `rfcomm connect`.
  file    No hardware. Writes the bytes to a folder, for dry runs and tests.

All transports are used as `async with transport: ...` around one job, so a printer
that went to sleep between jobs gets a fresh connection each time.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

WRITE_CHAR = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFY_CHAR = "0000ff03-0000-1000-8000-00805f9b34fb"
PRINT_COMPLETE = b"\x1a\x0f\x0c"  # seen on our M02 Pro after each print (2026-10-24)


def parse_status(note: bytes) -> dict[str, Any]:
    """Replies to the footer's 1f 11 xx queries, as seen on our M02 Pro.

    1a 04 NN battery %  ·  1a 08 <ascii> serial number  ·  01 01 flow-control credit (ignored)
    """
    if len(note) >= 3 and note[0] == 0x1A:
        if note[1] == 0x04:
            return {"battery_pct": note[2]}
        if note[1] == 0x08:
            return {"serial": note[2:].decode("ascii", "replace")}
    return {}


class Transport:
    chunk_bytes = 128
    has_completion_signal = False
    info: dict[str, Any] = {}

    async def __aenter__(self) -> "Transport":
        await self.open()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def open(self) -> None: ...
    async def close(self) -> None: ...
    async def write_chunk(self, chunk: bytes) -> None: ...

    async def wait_complete(self, timeout_s: float) -> bool:
        """True if the printer said it finished; False if we only know the bytes were sent."""
        return False


class BleTransport(Transport):
    def __init__(self, cfg: dict[str, Any]):
        self.name_prefix = cfg.get("ble_name", "M02")
        self.address = cfg.get("ble_address")
        self.chunk_bytes = int(cfg.get("chunk_bytes", 128))
        self.chunk_delay_s = float(cfg.get("chunk_delay_s", 0.02))
        self.scan_timeout_s = float(cfg.get("scan_timeout_s", 10))
        self._client = None
        self._notes: asyncio.Queue[bytes] = asyncio.Queue()
        self.has_completion_signal = True
        self.info = {}

    async def _find(self):
        from bleak import BleakScanner

        # Match the pinned address or the name in one scan: on macOS the CoreBluetooth UUID
        # can change after a Bluetooth reset, and address-only lookups sometimes time out.
        def match(d, ad) -> bool:
            if self.address and d.address.upper() == self.address.upper():
                return True
            return (d.name or ad.local_name or "").startswith(self.name_prefix)

        dev = await BleakScanner.find_device_by_filter(match, timeout=self.scan_timeout_s)
        if dev is None:
            target = self.address or f"name starting with {self.name_prefix!r}"
            raise ConnectionError(f"Phomemo not found over BLE ({target}). Is it on and not connected to the phone app?")
        return dev

    async def open(self) -> None:
        from bleak import BleakClient

        dev = await self._find()
        self._client = BleakClient(dev)
        await self._client.connect()
        mtu = getattr(self._client, "mtu_size", 0) or 0
        if mtu > 3:
            self.chunk_bytes = min(self.chunk_bytes, mtu - 3)
        self._notes = asyncio.Queue()
        try:
            await self._client.start_notify(NOTIFY_CHAR, lambda _c, data: self._notes.put_nowait(bytes(data)))
        except Exception as e:  # printing still works without notifications
            log.warning("could not subscribe to printer notifications: %s", e)
            self.has_completion_signal = False
        log.info("BLE connected to %s (%s), chunk %d B", dev.name, dev.address, self.chunk_bytes)

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.disconnect()
            finally:
                self._client = None

    async def write_chunk(self, chunk: bytes) -> None:
        await self._client.write_gatt_char(WRITE_CHAR, chunk, response=False)
        await asyncio.sleep(self.chunk_delay_s)

    async def wait_complete(self, timeout_s: float) -> bool:
        deadline = time.monotonic() + timeout_s
        buf = b""
        while (left := deadline - time.monotonic()) > 0:
            try:
                note = await asyncio.wait_for(self._notes.get(), left)
            except asyncio.TimeoutError:
                break
            log.debug("printer notify: %s", note.hex(" "))
            self.info.update(parse_status(note))
            buf = (buf + note)[-32:]
            if PRINT_COMPLETE in buf:
                return True
        return False


class SerialTransport(Transport):
    def __init__(self, cfg: dict[str, Any]):
        self.port = cfg.get("serial_port")
        if not self.port:
            raise ValueError("serial transport needs adapter.serial_port, e.g. /dev/cu.M02Pro or /dev/rfcomm0")
        self.baud = int(cfg.get("baud", 115200))
        self.chunk_bytes = int(cfg.get("chunk_bytes", 512))
        self.chunk_delay_s = float(cfg.get("chunk_delay_s", 0.0))
        self._ser = None
        self.has_completion_signal = True
        self.info = {}

    async def open(self) -> None:
        import serial  # pyserial

        self._ser = await asyncio.to_thread(serial.Serial, self.port, self.baud, timeout=0.2, write_timeout=20)
        log.info("serial open on %s", self.port)

    async def close(self) -> None:
        if self._ser is not None:
            await asyncio.to_thread(self._ser.close)
            self._ser = None

    async def write_chunk(self, chunk: bytes) -> None:
        await asyncio.to_thread(self._ser.write, chunk)
        if self.chunk_delay_s:
            await asyncio.sleep(self.chunk_delay_s)

    async def wait_complete(self, timeout_s: float) -> bool:
        await asyncio.to_thread(self._ser.flush)
        deadline = time.monotonic() + timeout_s
        buf = b""
        while time.monotonic() < deadline:
            data = await asyncio.to_thread(self._ser.read, 64)
            if data:
                log.debug("printer says: %s", data.hex(" "))
                self.info.update(parse_status(data))
                buf = (buf + data)[-32:]
                if PRINT_COMPLETE in buf:
                    return True
        return False


class FileTransport(Transport):
    def __init__(self, cfg: dict[str, Any]):
        self.out_dir = Path(cfg.get("out_dir", ".work/printer_out"))
        self.chunk_bytes = int(cfg.get("chunk_bytes", 4096))
        self._fh = None
        self.path: Path | None = None

    async def open(self) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.out_dir / f"print_{time.strftime('%Y%m%d-%H%M%S')}_{time.monotonic_ns() % 10**6}.bin"
        self._fh = self.path.open("wb")

    async def close(self) -> None:
        if self._fh:
            self._fh.close()
            log.info("dry run: wrote %s", self.path)
            self._fh = None

    async def write_chunk(self, chunk: bytes) -> None:
        self._fh.write(chunk)


def make_transport(cfg: dict[str, Any]) -> Transport:
    kind = cfg.get("transport", "ble")
    if kind == "ble":
        return BleTransport(cfg)
    if kind == "serial":
        return SerialTransport(cfg)
    if kind == "file":
        return FileTransport(cfg)
    raise ValueError(f"unknown Phomemo transport {kind!r} (ble | serial | file)")
