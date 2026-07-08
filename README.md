# Moblink for OpenWrt

OpenWrt feed for running Moblink on routers, with packages for the upstream
Rust services and a LuCI interface for day-to-day configuration.

This feed builds upstream [`datagutt/moblink-rust`](https://github.com/datagutt/moblink-rust)
`0.9.7` from commit:

```text
a77d42c34cff65156a44617af34fad4e7592ea64
```

The feed does not carry a local Rust relay-service fork. OpenWrt integration
lives in package metadata, init scripts, UCI defaults, LuCI views, and a small
compatibility patch for OpenWrt toolchains.

## Packages

- `moblink-relay-service`: starts one relay process per enabled uplink.
- `moblink-streamer`: streamer service package for OpenWrt.
- `luci-app-moblink`: LuCI UI for streamer and relay settings.

## Supported Targets

The current tested package builds are:

- GL.iNet GL-AXT1800 on OpenWrt 23.05 / GL.iNet 4.x firmware:
  `aarch64_cortex-a53_neon-vfpv4` IPK packages.
- Cudy TR3000 256MB on OpenWrt 25 / apk-based builds:
  `mediatek/filogic` APK packages.

Other OpenWrt targets should be buildable through the matching OpenWrt SDK, but
they are not release-tested yet.

## Relay Behavior

The relay package can auto-create one relay section per eligible uplink
interface. Runtime state is stored under `/tmp`, while UCI is kept for user
configuration. Interface changes are handled through OpenWrt hotplug events, and
a small watchdog supervises relay health without forking upstream Rust code.

Relay interface allow filters pass plain interface names to upstream Moblink.
The upstream service handles anchoring; the OpenWrt init script does not add
extra regex anchors.

## Install Prebuilt Packages

Download the matching release assets for your target and copy them to the
router.

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

Use the SDK that matches your router target and OpenWrt version.

1. Add this repository as a feed:

   ```sh
   echo "src-git moblink https://github.com/S1nGeN0r/moblink-openwrt.git" >> feeds.conf.default
   ./scripts/feeds update moblink
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

Some GL.iNet firmware builds expect packages marked as
`aarch64_cortex-a53_neon-vfpv4`. If you are building specifically for that
environment, pass:

```sh
MOBLINK_PKGARCH=aarch64_cortex-a53_neon-vfpv4 \
MOBLINK_LUCI_PKGARCH=aarch64_cortex-a53_neon-vfpv4 \
make package/feeds/moblink/moblink/compile package/feeds/moblink/luci-app-moblink/compile V=s
```

For normal OpenWrt SDK builds, leave `MOBLINK_PKGARCH` unset so buildroot uses
the target package architecture.

## Configuration

The relay manager config is stored in:

```text
/etc/config/moblink-relay-service
```

The streamer config is stored in:

```text
/etc/config/moblink-streamer
```

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
