"""Bluetooth link to an Instax mini Link, on the vendored InstaxBLE protocol code.

InstaxBLE is synchronous (simplepyble) and sends each next image packet from its
notification callback when the printer answers the last one. This wrapper finds the
printer by name with a bounded scan, sends one JPEG, and waits for the printer's print
confirmation. Run it in a worker thread; it blocks.
"""
from __future__ import annotations

import time
from typing import Any, Callable

from .image import FILM_PX
from .instaxble.InstaxBLE import InstaxBLE
from .instaxble.Types import EventType


class LinkError(Exception):
    pass


class _Printer(InstaxBLE):
    """InstaxBLE that records the print confirmation instead of only logging it."""

    print_confirmed = False

    def display_current_status(self) -> None:  # upstream prints a status block to stdout
        pass

    def parse_printer_response(self, event, packet) -> None:
        super().parse_printer_response(event, packet)
        if event == EventType.PRINT_IMAGE:
            self.print_confirmed = True


class InstaxLink:
    def __init__(self, name: str | None, address: str | None, scan_s: float):
        self.name, self.address, self.scan_s = name, address, scan_s
        self.printer: _Printer | None = None
        self.info: dict[str, Any] = {}

    def open(self) -> None:
        try:
            p = _Printer(device_name=self.name, device_address=self.address, print_enabled=True)
        except SystemExit:  # upstream exits when there is no Bluetooth adapter
            raise LinkError("no Bluetooth adapter; is Bluetooth on?") from None
        self.printer = p
        try:
            p.connect(timeout=self.scan_s)
        except SystemExit as e:  # upstream exits on an image size it does not know
            raise LinkError(f"printer reported an unsupported model: {e}") from None
        if not p.peripheral or not p.peripheral.is_connected():
            raise LinkError(f"{self.name or self.address} not found; is it on and not connected to the phone app?")
        if tuple(p.imageSize) == (0, 0):
            raise LinkError("printer connected but did not report its details; try again")
        if tuple(p.imageSize) != FILM_PX:
            raise LinkError(f"printer asks for {p.imageSize[0]}x{p.imageSize[1]} px, not an Instax mini's 600x800")
        self._read_info()

    def _read_info(self) -> None:
        p = self.printer
        self.info.update(photos_left=p.photosLeft, battery_pct=p.batteryPercentage, charging=p.isCharging)

    def print_jpeg(self, data: bytes, progress: Callable[[float], None], cancelled: Callable[[], bool],
                   timeout_s: float) -> None:
        """Send one picture and print it; returns once the printer confirms the print."""
        p = self.printer
        if p.photosLeft < 1:
            raise LinkError("out_of_media: the printer reports no film left")
        p.print_confirmed = False
        p.print_image(bytearray(data))  # a bytearray is sent as is, not re-encoded
        total = len(p.packetsForPrinting) + 1
        deadline = time.monotonic() + timeout_s
        while not p.print_confirmed:
            if cancelled():
                try:
                    p.cancel_print()
                except Exception:
                    p.packetsForPrinting = []
                raise LinkError("cancelled")
            if not p.peripheral.is_connected():
                raise LinkError("printer disconnected during the transfer")
            if time.monotonic() > deadline:
                raise LinkError(f"no print confirmation within {timeout_s:.0f} s "
                                f"({len(p.packetsForPrinting)} of {total} packets unsent)")
            progress(1 - len(p.packetsForPrinting) / total)
            time.sleep(0.1)
        # Upstream queues a status request after the print command and never sends it.
        p.packetsForPrinting = []
        p.photosLeft = max(0, p.photosLeft - 1)
        self._read_info()

    def close(self) -> None:
        if self.printer:
            self.printer.cancelled = True
            try:
                self.printer.disconnect()
            except Exception:
                pass
