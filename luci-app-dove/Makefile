# This is free software, licensed under the GNU AFFERO GENERAL PUBLIC LICENSE v3.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-dove
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI app for Dove (DaeNext / daed)
LUCI_DESCRIPTION:=Joey-style LuCI pages for Dove: edit the dae config text of a \
	running DaeNext (daed) instance through its REST API, plus runtime status and logs.
# +curl: rpcd helper luci.dove 通过 curl 调 daed 的本地 REST 接口
LUCI_DEPENDS:=+luci-base +dove +curl
LUCI_PKGARCH:=all

PKG_LICENSE:=AGPL-3.0
PKG_MAINTAINER:=OpenWrt-dove contributors

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/install
	$(call Package/$(PKG_NAME)/install/Default,$(1))

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.dove $(1)/usr/libexec/rpcd/luci.dove

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-dove.json $(1)/usr/share/rpcd/acl.d/luci-app-dove.json

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-dove.json $(1)/usr/share/luci/menu.d/luci-app-dove.json

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/90_dove $(1)/etc/uci-defaults/90_dove
endef

# call BuildPackage - OpenWrt buildroot signature
