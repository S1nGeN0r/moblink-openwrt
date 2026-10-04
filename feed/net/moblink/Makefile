include $(TOPDIR)/rules.mk

PKG_NAME:=moblink-rust
PKG_VERSION:=1.1.0
PKG_RELEASE:=4

PKG_SOURCE_VERSION:=23936ab65f518c2bd7397c01fefc45d1d00cd8f2
PKG_SOURCE_DATE:=2026-08-09
PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION)-$(PKG_SOURCE_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/datagutt/moblink-rust/tar.gz/$(PKG_SOURCE_VERSION)?
PKG_HASH:=9671e8c9ba525c7dcd7132fae6a101d3381dd4d88defdec93a04366d33fd86ed
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_SOURCE_VERSION)

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Daniel
PKG_BUILD_DEPENDS:=rust/host
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/rust/rust-package.mk

define Package/moblink-relay-service
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Moblink relay supervisor for OpenWrt
  URL:=https://github.com/datagutt/moblink-rust
ifneq ($(strip $(MOBLINK_PKGARCH)),)
  PKGARCH:=$(MOBLINK_PKGARCH)
endif
  DEPENDS:=+libgcc +ca-bundle +jsonfilter
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
ifneq ($(strip $(MOBLINK_PKGARCH)),)
  PKGARCH:=$(MOBLINK_PKGARCH)
endif
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
	$(INSTALL_BIN) ./files/moblink-relay-watchdog.sh $(1)/usr/sbin/moblink-relay-watchdog
	$(INSTALL_DIR) $(1)/usr/share/moblink
	$(INSTALL_DATA) ./files/moblink-relay-common.sh $(1)/usr/share/moblink/relay-common.sh
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) ./files/moblink-relay.hotplug $(1)/etc/hotplug.d/iface/99-moblink-relay
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
