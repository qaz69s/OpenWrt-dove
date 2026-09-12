     1|# This is free software, licensed under the GNU AFFERO GENERAL PUBLIC LICENSE v3.
     2|
     3|include $(TOPDIR)/rules.mk
     4|
     5|PKG_NAME:=luci-app-dove
     6|PKG_VERSION:=0.1.0
     7|PKG_RELEASE:=1
     8|
     9|LUCI_TITLE:=LuCI app for Dove (DaeNext / daed)
    10|LUCI_DESCRIPTION:=Joey-style LuCI pages for Dove: edit the dae config text of a \
    11|	running DaeNext (daed) instance through its REST API, plus runtime status and logs.
    12|# +curl: rpcd helper luci.dove 通过 curl 调 daed 的本地 REST 接口
    13|LUCI_DEPENDS:=+luci-base +dove +curl
    14|LUCI_PKGARCH:=all
    15|
    16|PKG_LICENSE:=AGPL-3.0
    17|PKG_MAINTAINER:=OpenWrt-dove contributors
    18|
    19|include $(TOPDIR)/feeds/luci/luci.mk
    20|
    21|define Package/$(PKG_NAME)/install
    22|	$(call Package/$(PKG_NAME)/install/Default,$(1))
    23|
    24|	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
    25|	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.dove $(1)/usr/libexec/rpcd/luci.dove
    26|
    27|	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
    28|	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-dove.json $(1)/usr/share/rpcd/acl.d/luci-app-dove.json
    29|
    30|	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
    31|	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-dove.json $(1)/usr/share/luci/menu.d/luci-app-dove.json
    32|
    33|	$(INSTALL_DIR) $(1)/etc/uci-defaults
    34|	$(INSTALL_BIN) ./root/etc/uci-defaults/90_dove $(1)/etc/uci-defaults/90_dove
    35|endef
    36|
    37|# call BuildPackage - OpenWrt buildroot signature
    38|