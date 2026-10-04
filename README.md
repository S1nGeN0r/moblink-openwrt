# Moblink for OpenWrt

OpenWrt feed for running Moblink on routers, with packages for the upstream
Rust services and a LuCI interface for day-to-day configuration.

This feed builds upstream [`datagutt/moblink-rust`](https://github.com/datagutt/moblink-rust)
`1.1.0` from commit:

```text
23936ab65f518c2bd7397c01fefc45d1d00cd8f2
```

The current integration release is **v1.1.0-4**: upstream version `1.1.0`,
OpenWrt package revision `4` (`1.1.0-4` for IPK, `1.1.0-r4` for APK).
This replaces the older `v0.9.8-*` integration numbering, which packaged
upstream `0.9.7`.

Upstream source is downloaded at the pinned commit and verified by SHA-256.
The feed carries two Rust patches: toolchain compatibility and authenticated
relay state / WebSocket recovery. The remaining integration lives in package
metadata, init scripts, UCI defaults, and LuCI views.

## Packages

- `moblink-relay-service`: starts one process per active, enabled relay section.
- `moblink-streamer`: streamer service package for OpenWrt.
- `luci-app-moblink`: LuCI UI for streamer and relay settings.

## Supported Targets

The current tested package builds are:

- GL.iNet GL-AXT1800 on OpenWrt 23.05 / GL.iNet 4.x firmware:
  `aarch64_cortex-a53_neon-vfpv4` IPK packages.
- Cudy TR3000 256MB v1 on OpenWrt 25.12.4:
  `mediatek/filogic`, `aarch64_cortex-a53` APK packages (LuCI is `noarch`).

Other OpenWrt targets should be buildable through the matching OpenWrt SDK, but
they are not release-tested yet.

## Relay Behavior

The relay package can auto-create one relay section per eligible uplink
interface. Runtime state is stored under `/tmp`, while UCI is kept for user
configuration. Interface changes are handled through OpenWrt hotplug events, and
a small watchdog supervises status freshness for individual procd instances.
It does not restart every relay when one connection fails.

Manual relay sections can use active L3 interfaces even when those interfaces
are not eligible for automatic WAN/modem discovery. Multiple manual sections
can share an interface while retaining separate identities. VPN uplinks,
including WireGuard and AmneziaWG, can be included or excluded.

Interface names are escaped as literal regex patterns before being passed to
upstream Moblink. Upstream adds the anchors; the init script does not add them
again. Selecting an interface does not configure its WAN or policy routing.

Connection status comes from authenticated relay state, not ICMP or unrelated
TCP connections. LuCI refreshes it every five seconds and treats stale status
as unavailable. The Rust patch adds heartbeat timeouts and reconnect handling;
the watchdog is a fallback for a stalled relay process.

## Install Prebuilt Packages

Download all three packages for your target from
[GitHub Releases](https://github.com/S1nGeN0r/moblink-openwrt/releases/latest),
plus `SHA256SUMS`. Package filenames include a target label. Do not mix GL.iNet
IPKs with Cudy APKs, or install packages built for a different firmware ABI.

Verify the downloaded packages against `SHA256SUMS`, then copy the three
matching packages into an otherwise empty directory on the router. Run the
following commands from that directory. Binary packages and checksums are
release attachments, not part of the source tree.

For IPK-based OpenWrt:

```sh
opkg install --force-reinstall ./*.ipk
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

For APK-based OpenWrt:

```sh
apk add --allow-untrusted --force-reinstall ./*.apk
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

The LuCI pages are available under:

```text
Services -> Moblink
```

## Build With OpenWrt SDK

Use the SDK that matches your router target, libc ABI, and OpenWrt version.
Vendor firmware may require its vendor SDK. These packages do not require a
full firmware build, but the SDK must provide a compatible Rust host toolchain
through the OpenWrt `packages` feed.

1. Add this repository as a feed:

   ```sh
   echo 'src-git moblink https://github.com/S1nGeN0r/moblink-openwrt.git;main' >> feeds.conf.default
   ./scripts/feeds update -a
   ./scripts/feeds install -a
   ./scripts/feeds install -p moblink -a
   ```

2. Select the packages:

   ```sh
   make menuconfig
   ```

   Enable:

   ```text
   Network -> moblink-relay-service
   Network -> moblink-streamer
   LuCI -> Applications -> luci-app-moblink
   ```

3. Build the packages:

   ```sh
   make package/feeds/moblink/moblink/compile V=s
   make package/feeds/moblink/luci-app-moblink/compile V=s
   ```

Artifacts are written under `bin/packages/` for package builds and, depending on
the SDK, may also appear under `bin/targets/`.

### GL-AXT1800 Note

Use a toolchain compatible with the installed GL.iNet firmware first.
Some GL.iNet firmware builds expect packages marked as
`aarch64_cortex-a53_neon-vfpv4`. If you are building specifically for that
environment, pass:

```sh
MOBLINK_PKGARCH=aarch64_cortex-a53_neon-vfpv4 \
MOBLINK_LUCI_PKGARCH=aarch64_cortex-a53_neon-vfpv4 \
make package/feeds/moblink/moblink/compile package/feeds/moblink/luci-app-moblink/compile V=s
```

These overrides change package metadata, not the generated machine code or
ABI. They cannot make an incompatible SDK suitable for a router.
For normal OpenWrt SDK builds, leave both overrides unset so buildroot uses
the target package architecture and LuCI remains architecture-independent.

## Configuration

The relay manager config is stored in:

```text
/etc/config/moblink-relay-service
```

The streamer config is stored in:

```text
/etc/config/moblink-streamer
```

Both services are disabled in the shipped defaults. For use with the Moblin
iPhone app, enable the relay manager; the router's streamer service is a
separate role and is not needed just to add router uplinks to the iPhone.
Manual streamer URLs use `ws://`; this build does not enable `wss://` support.

The streamer requires an explicit UDP destination address and port when
enabled. They describe your receiving endpoint and cannot be inferred from
the router's uplinks. Its default listener binds to all IPv4 interfaces.
The compatibility password default is `1234`; change it on both peers and
restrict service access to trusted networks.

After changing config outside LuCI, restart the relevant service:

```sh
/etc/init.d/moblink-relay-service restart
/etc/init.d/moblink-streamer restart
```

The output packages are standard OpenWrt `.ipk` files on opkg-based releases
and `.apk` files on apk-based OpenWrt releases.

## LuCI

The LuCI app includes:

- `Moblink -> Streamer`
- `Moblink -> Relay Service`

Relay manager features include:

- global enable / disable
- auto-create relays for detected uplinks
- per-relay labels, passwords, and identity databases
- automatic or manual streamer source
- live authenticated connection status and wrong-password reporting
- streamer IP display
- inactive relay visibility
- collapsible global settings and inactive relays, retained after Save & Apply

## Package Layout

- `feed/net/moblink`
- `feed/luci/luci-app-moblink`
- `tests`: shell and LuCI regression tests

Run the local regression tests with a POSIX-compatible shell and Node.js:

```sh
sh tests/relay-common-test.sh
sh tests/relay-watchdog-test.sh
node --test tests/relay-manager.test.js
```

## Notes

- this repository contains the OpenWrt integration, not the original Moblink source
- upstream runtime logic comes from `datagutt/moblink-rust`, with the patches
  described above applied during the build
- OpenWrt packaging and LuCI behavior are implemented here

## FAQ

**Q: How do I use this on my own router?**

Add this repository as an OpenWrt feed, build the packages, install them, and
configure the relay or streamer through LuCI.

**Q: Does this project support more than one uplink at the same time?**

Yes. That is one of the main points here. The router can run one relay per
interface and expose multiple paths to the Moblin app.

**Q: Do I need LuCI to use it?**

No. LuCI makes life much easier, but the services still use normal OpenWrt
config and init scripts underneath.

## License

This project is distributed under the terms of the MIT license.

Enjoy using Moblink on OpenWrt.
