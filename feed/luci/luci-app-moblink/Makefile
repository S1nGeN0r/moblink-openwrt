include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-moblink
PKG_RELEASE:=1
MOBLINK_ROUTER_ARCH:=aarch64_cortex-a53_neon-vfpv4

PKG_LICENSE:=MIT
PKG_MAINTAINER:=Daniel

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-moblink
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for Moblink
  PKGARCH:=$(MOBLINK_ROUTER_ARCH)
  DEPENDS:=+luci-base +moblink-relay-service +moblink-streamer
endef

define Package/luci-app-moblink/description
LuCI web interface for configuring Moblink streamer and relay service.
endef

define Build/Compile
endef

define Package/luci-app-moblink/install
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-moblink.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-moblink.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/moblink
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/moblink/streamer.js $(1)/www/luci-static/resources/view/moblink/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/moblink/relay-manager-v3.js $(1)/www/luci-static/resources/view/moblink/
endef

$(eval $(call BuildPackage,luci-app-moblink))
