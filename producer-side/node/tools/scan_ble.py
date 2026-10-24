"""List nearby BLE devices so you can find a machine (Phomemo, Instax, ...).

  python -m node.tools.scan_ble                              # everything with a name
  python -m node.tools.scan_ble --prefix M02 --services      # also list GATT services of matches
  python -m node.tools.scan_ble --prefix INSTAX --services

On macOS the address shown is a CoreBluetooth UUID; paste it into adapter.ble_address.
The machine must not be connected to its phone app (BLE allows one central).
"""
from __future__ import annotations

import argparse
import asyncio

from bleak import BleakClient, BleakScanner


async def main(timeout: float, prefix: str | None, services: bool) -> None:
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    rows = sorted(found.values(), key=lambda da: -(da[1].rssi or -999))
    for dev, adv in rows:
        name = dev.name or adv.local_name
        if not name:
            continue
        mark = "  <-- match" if prefix and name.startswith(prefix) else ""
        print(f"{adv.rssi:>4} dBm  {dev.address}  {name}{mark}")
    if not services or not prefix:
        return
    for dev, adv in rows:
        if (dev.name or adv.local_name or "").startswith(prefix):
            print(f"\nGATT services on {dev.name} ({dev.address}):")
            async with BleakClient(dev) as client:
                for svc in client.services:
                    print(f"  service {svc.uuid}")
                    for ch in svc.characteristics:
                        print(f"    char {ch.uuid}  {','.join(ch.properties)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=8)
    ap.add_argument("--prefix", help="name prefix to highlight, e.g. M02; required for --services")
    ap.add_argument("--services", action="store_true")
    a = ap.parse_args()
    asyncio.run(main(a.timeout, a.prefix, a.services))
