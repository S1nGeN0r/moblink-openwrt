# Moblink for OpenWrt

Moblink, router edition.

Use your OpenWrt router as a multi-uplink Moblink relay with a LuCI interface,
separate relay instances per interface, and packageable `.ipk` builds.

Built on top of:

- [`datagutt/moblink-rust`](https://github.com/datagutt/moblink-rust)

Originally, the router work here grew out of adapting the Moblink Rust code to
OpenWrt, LuCI, and the practical reality that routers tend to have more than one
way to get online.

## Features

- OpenWrt packages for `moblink-relay-service`
- OpenWrt packages for `moblink-streamer`
- LuCI UI for relay and streamer management
- one relay instance per uplink interface
- separate identity database per relay
- custom relay labels visible in the Moblin app
- automatic uplink detection
- automatic streamer discovery
- optional manual streamer URL mode
- connection status and streamer IP visible in LuCI

## Tested On

- `GL.iNet GL-AXT1800`
- `OpenWrt 23.05-SNAPSHOT`
- target `qualcommax/ipq60xx`

## How It Works

The relay side is intentionally multi-interface.

Instead of one big relay process trying to do everything, the router creates one
relay per usable uplink:

- Ethernet WAN
- Wi-Fi WAN
- WireGuard uplink
- USB tethering
- cellular / WWAN uplink
- other backup links

That means the router can expose several independent paths at once, while the
Moblin app handles priority and bonding on its side.

In practice, the configuration model is:

- one `globals` section
- one `relay_*` section per interface
- one relay process per interface
- one database file per relay identity

## Requirements

For package builds:

- OpenWrt source tree or OpenWrt SDK
- Rust support in the OpenWrt build environment
- Cargo via the OpenWrt Rust packaging flow

For runtime:

- OpenWrt router
- LuCI if you want the web UI
- at least one active uplink interface

## Usage

### Relay Manager

Install:

- `moblink-relay-service`
- `luci-app-moblink`

Then open:

- `Moblink -> Relay Service`

Typical flow:

1. Enable the relay manager
2. Let it auto-create relays for active uplinks
3. Rename relay labels if you want nicer names in the Moblin app
4. Keep streamer discovery on automatic, or set a manual streamer URL
5. Watch connection state and streamer IP directly in LuCI

### Streamer

If the router should also run the streamer side, install:

- `moblink-streamer`

Then configure it from:

- `Moblink -> Streamer`

## Build

Add this repository to `feeds.conf`:

```text
src-git moblink https://github.com/S1nGeN0r/moblink-openwrt.git
```

Update and install the feed:

```bash
./scripts/feeds update moblink
./scripts/feeds install -a -p moblink
```

Select packages in `menuconfig`:

- `Network -> moblink-relay-service`
- `Network -> moblink-streamer`
- `LuCI -> Applications -> luci-app-moblink`

Build specific packages:

```bash
make package/feeds/moblink/moblink-relay-service/compile V=s
make package/feeds/moblink/moblink-streamer/compile V=s
make package/feeds/moblink/luci-app-moblink/compile V=s
```

Or build from the full OpenWrt tree:

```bash
make -j$(nproc) V=s
```

The output packages are standard OpenWrt `.ipk` files.

## LuCI

The LuCI app includes:

- `Moblink -> Streamer`
- `Moblink -> Relay Service`

Relay manager features include:

- global enable / disable
- auto-create relays for detected uplinks
- per-relay labels, passwords, and identity databases
- automatic or manual streamer source
- connection status
- streamer IP display
- inactive relay visibility

## Package Layout

- `feed/net/moblink`
- `feed/luci/luci-app-moblink`

## Notes

- this repository contains the OpenWrt integration, not the original Moblink source
- upstream runtime logic comes from `datagutt/moblink-rust`
- OpenWrt packaging and LuCI behavior are implemented here

## FAQ

Q: How do I use this on my own router?
A: Add this repository as an OpenWrt feed, build the packages, install them, and configure the relay or streamer through LuCI.

Q: Does this project support more than one uplink at the same time?
A: Yes. That is one of the main points here. The router can run one relay per interface and expose multiple paths to the Moblin app.

Q: Do I need LuCI to use it?
A: No. LuCI makes life much easier, but the services still use normal OpenWrt config and init scripts underneath.

## License

This project is distributed under the terms of the MIT license.

Enjoy using Moblink on OpenWrt.
