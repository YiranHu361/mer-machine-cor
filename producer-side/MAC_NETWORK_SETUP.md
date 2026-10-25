# Mac network setup for the A1 mini (iPhone hotspot)

Use this when the Bambu A1 mini and your Mac share an **iPhone hotspot** and the Mac can't reach the printer. The fix is a macOS network **Location** with a manual IPv4 address. You switch to it on the hotspot and back to `Automatic` everywhere else.

## Do you need this?

```sh
cd producer-side
.venv/bin/python -m node.tools.bambu discover    # finds the printer, e.g. 172.20.10.3 ... model N1
.venv/bin/python -m node.tools.bambu status      # but this fails: "cannot reach printer ... timed out"
ipconfig getifaddr en0                           # prints nothing, or only 192.0.0.2
```

If `discover` finds the printer but `status` times out, and your Mac has no `172.20.10.x` address, you need this.

## Why it happens

The iPhone hotspot tells clients it prefers IPv6-only (DHCP option 108). macOS honors that and takes no IPv4 address; the only IPv4 address it shows is the internal `192.0.0.2`. The printer ignores option 108, so it gets a normal `172.20.10.x` address. The Mac can hear the printer's broadcasts, but it can't open connections to it on MQTT (8883) or FTPS (990).

iPhone hotspots always use `172.20.10.0/28`: router `172.20.10.1`, usable addresses `.2`–`.14`. The hotspot hands out addresses from `.2` upward, so manual addresses at the top of the range are unlikely to clash.

## One-time setup

Pick an address. **Each teammate needs a different one:** `172.20.10.14`, `.13`, `.12`, and so on. Then run:

```sh
networksetup -createlocation PrinterHotspot populate
networksetup -switchtolocation PrinterHotspot
networksetup -setmanual Wi-Fi 172.20.10.14 255.255.255.240 172.20.10.1   # your address here
networksetup -setdnsservers Wi-Fi 172.20.10.1 1.1.1.1 8.8.8.8
networksetup -switchtolocation Automatic
```

If macOS asks for your password, enter it. Nothing changes until you switch to the new Location.

`-setmanual` sets no DNS servers, so without the `-setdnsservers` line the Mac reaches the printer but no website loads in this Location. If you set up the Location before that line was added, add DNS to it once:

```sh
networksetup -switchtolocation PrinterHotspot
networksetup -setdnsservers Wi-Fi 172.20.10.1 1.1.1.1 8.8.8.8
networksetup -switchtolocation Automatic
```

## Every time you switch networks

| You are on | Run |
| --- | --- |
| The printer's iPhone hotspot | `networksetup -switchtolocation PrinterHotspot` |
| Any other Wi-Fi | `networksetup -switchtolocation Automatic` |

The same switch is in **System Settings → Network → ⋯ (bottom of the list) → Locations**.

Then check that the Mac can reach the printer:

```sh
ipconfig getifaddr en0                           # 172.20.10.14 (your address)
.venv/bin/python -m node.tools.bambu status      # state, filament, temps
```

## Don't set the manual address without a Location

`networksetup -setmanual Wi-Fi ...` on the default `Automatic` Location applies to **every** Wi-Fi network. On any other network, the Mac then connects but has no internet, and the browser says "not connected". To undo that:

```sh
networksetup -setdhcp Wi-Fi
```

## If the printer's address changes

The hotspot may give the printer a different address after a restart. Run `bambu discover` and put the address it prints in `producer-side/.env` as `BAMBU_HOST=172.20.10.x` (it overrides `adapter.host` in `node/machines/m_fdm_01.json`). Alternatively, pass `--host 172.20.10.x` to any `bambu` command.

## Remove the setup

```sh
networksetup -switchtolocation Automatic
networksetup -deletelocation PrinterHotspot
```
