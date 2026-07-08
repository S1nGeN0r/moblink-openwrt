include $(TOPDIR)/rules.mk

PKG_NAME:=moblink-rust
PKG_VERSION:=0.9.7
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/datagutt/moblink-rust.git
PKG_SOURCE_VERSION:=a77d42c34cff65156a44617af34fad4e7592ea64
PKG_SOURCE_DATE:=2026-05-26
PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION)-$(PKG_SOURCE_DATE)-$(PKG_SOURCE_VERSION).tar.xz
PKG_SOURCE_SUBDIR:=$(PKG_NAME)-$(PKG_VERSION)
PKG_MIRROR_HASH:=394ac2d6ec079710e963abbff4dd16928e74f69c026f575c99902b8b76283aba
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_SOURCE_SUBDIR)

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
