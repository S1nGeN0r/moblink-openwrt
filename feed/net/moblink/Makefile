include $(TOPDIR)/rules.mk

PKG_NAME:=moblink-rust
PKG_VERSION:=0.9.7
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/datagutt/moblink-rust.git
PKG_SOURCE_VERSION:=c84cfc94a2e51df66a67e19757d860458bf332d7
PKG_SOURCE_DATE:=2025-06-01
PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION)-$(PKG_SOURCE_DATE)-$(PKG_SOURCE_VERSION).tar.xz
PKG_SOURCE_SUBDIR:=$(PKG_NAME)-$(PKG_VERSION)
PKG_MIRROR_HASH:=skip
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_SOURCE_SUBDIR)

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Daniel
PKG_BUILD_DEPENDS:=rust/host
PKG_BUILD_PARALLEL:=1
MOBLINK_ROUTER_ARCH:=aarch64_cortex-a53_neon-vfpv4

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/rust/rust-package.mk

define Build/Prepare
	$(call Build/Prepare/Default)
	$(CP) ./src/. $(PKG_BUILD_DIR)/src/
endef

define Package/moblink-relay-service
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Moblink relay supervisor for OpenWrt
  URL:=https://github.com/datagutt/moblink-rust
  PKGARCH:=$(MOBLINK_ROUTER_ARCH)
  DEPENDS:=+libgcc +ca-bundle
endef

define Package/moblink-relay-service/description
Auto-discovers Moblink streamers over mDNS and starts one relay per eligible
network interface.
endef

define Package/moblink-streamer
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Moblink streamer for OpenWrt
  URL:=https://github.com/datagutt/moblink-rust
  PKGARCH:=$(MOBLINK_ROUTER_ARCH)
  DEPENDS:=+libgcc +kmod-tun +ip-full
endef

define Package/moblink-streamer/description
Accepts Moblink relay connections and forwards bonded UDP traffic through a TUN
device to the configured destination.
endef

define Build/Compile
	$(call Build/Compile/Cargo,.,--bin moblink-relay-service --bin moblink-streamer)
endef

define Package/moblink-relay-service/conffiles
/etc/config/moblink-relay-service
endef

define Package/moblink-streamer/conffiles
/etc/config/moblink-streamer
endef

define Package/moblink-relay-service/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/bin/moblink-relay-service $(1)/usr/sbin/
	$(INSTALL_BIN) ./files/moblink-relay-autoscan.sh $(1)/usr/sbin/moblink-relay-autoscan
	$(INSTALL_BIN) ./files/moblink-relay-status-sync.sh $(1)/usr/sbin/moblink-relay-status-sync
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/moblink-relay-service.init $(1)/etc/init.d/moblink-relay-service
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/moblink-relay-service.config $(1)/etc/config/moblink-relay-service
endef

define Package/moblink-streamer/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/bin/moblink-streamer $(1)/usr/sbin/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/moblink-streamer.init $(1)/etc/init.d/moblink-streamer
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/moblink-streamer.config $(1)/etc/config/moblink-streamer
endef

$(eval $(call BuildPackage,moblink-relay-service))
$(eval $(call BuildPackage,moblink-streamer))
