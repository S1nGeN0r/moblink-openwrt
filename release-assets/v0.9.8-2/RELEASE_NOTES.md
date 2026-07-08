# Moblink OpenWrt v0.9.8-2

Refactoring release for the public OpenWrt feed, with a cleaner relay manager
runtime model and an additional OpenWrt 25 / Cudy package set.

## Highlights

- Refactored the relay manager away from UCI-backed runtime polling.
- Runtime relay status is read from `/tmp` status files instead of being
  committed back into UCI.
- Interface changes are handled through OpenWrt hotplug events.
- Added a relay watchdog for recovery without forking upstream Moblink Rust
  sources.
- Added OpenWrt 25 APK artifacts for Cudy TR3000 256MB
  (`mediatek/filogic`).
- Kept GL-AXT1800 OpenWrt 23.05 IPK artifacts for
  `aarch64_cortex-a53_neon-vfpv4`.
- Relay interface allow filters now pass plain interface names to upstream
  Moblink instead of adding redundant regex anchors in the OpenWrt init script.
- The OpenWrt package builds upstream `moblink-rust` `0.9.7`.
- The feed does not carry a local Rust relay-service override.

## Included Artifacts

- `moblink-relay-service_0.9.7-1_aarch64_cortex-a53_neon-vfpv4_openwrt23-gl-axt1800.ipk`
- `moblink-streamer_0.9.7-1_aarch64_cortex-a53_neon-vfpv4_openwrt23-gl-axt1800.ipk`
- `luci-app-moblink_1_aarch64_cortex-a53_neon-vfpv4_openwrt23-gl-axt1800.ipk`
- `moblink-relay-service-0.9.7-r1_openwrt25-mediatek-filogic-cudy-tr3000-256mb-v1.apk`
- `moblink-streamer-0.9.7-r1_openwrt25-mediatek-filogic-cudy-tr3000-256mb-v1.apk`
- `luci-app-moblink-1_openwrt25-mediatek-filogic-cudy-tr3000-256mb-v1.apk`
- `SHA256SUMS`
