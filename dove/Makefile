# SPDX-License-Identifier: AGPL-3.0-only
#
# Copyright (C) 2026 OpenWrt-dove contributors

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/package.mk

PKG_NAME    := dove
# DaeNext 引擎版本：默认每次构建都查询 GitHub 获取该 fork 的最新 release。
# 可命令行覆盖锁定（可复现构建）：
#   make package/dove/compile DOVE_VERSION=v3.1.0-musl
# 查询失败时回退 v3.1.0-musl，保证离线/限流时也能构建。
DOVE_VERSION ?= latest
ifeq ($(DOVE_VERSION),latest)
DOVE_LATEST := $(shell v=$$(curl -fsSL --retry 2 --connect-timeout 5 https://api.github.com/repos/qaz69s/DaeNext/releases 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4); [ -n "$$v" ] && echo "$$v" || echo v3.1.0-musl)
DOVE_VERSION := $(DOVE_LATEST)
endif
# apk 版本号格式要求严格：每个点分段必须以数字开头，且 `_` 后缀只接受
# alpha/beta/pre/rc/cvs/svn/git/hg/p 白名单（实测 apk mkpkg 拒绝 `3.1.0_musl`
# 与 `3.1.0-musl`，只有 `3.1.0` 通过）。因此 PKG_VERSION 只取 tag 的数字主干；
# tag 里的 `-musl` 这类构建后缀无法在版本号中表达。
# v3.1.0-musl -> 3.1.0 ；v3.2.0 -> 3.2.0
PKG_VERSION := $(shell echo '$(DOVE_VERSION)' | sed -E 's/^v//; s/[-_].*$$//')
# 同一数字版本重新发布（例如重打 tag）时用 DOVE_RELEASE 递增：
#   make package/dove/compile DOVE_RELEASE=2
DOVE_RELEASE ?= 1
PKG_RELEASE := $(DOVE_RELEASE)

PKG_LICENSE    := AGPL-3.0-only
PKG_MAINTAINER := OpenWrt-dove contributors

# ── 架构映射：OpenWrt ARCH → DaeNext release asset 后缀 ────────────────
# 注意：不在解析期用 $(error)（扫描阶段 $(ARCH) 为空会让包不被注册），
# 不支持的架构统一在 Build/Prepare 阶段报错。
# ⚠️ 必须先精确匹配 x86_64：它自身含下划线，用 $(firstword $(subst _, ,...)) 会
# 被拆成 `x86` 从而匹配失败（实测踩过）。
ifeq ($(ARCH),x86_64)
  DOVE_TARGET := x86_64
else ifeq ($(ARCH),aarch64)
  DOVE_TARGET := aarch64
else
  # 复合架构名（如 aarch64_cortex-a53 / aarch64_cortex-a72）取首段主架构
  DOVE_ARCH_BASE := $(firstword $(subst _, ,$(ARCH)))
  ifeq ($(DOVE_ARCH_BASE),aarch64)
    DOVE_TARGET := aarch64
  else
    DOVE_TARGET :=
  endif
endif

# ── 可覆盖开关 ────────────────────────────────────────────────────────
# DOVE_WEB=0      不打包 daed 自带 Web UI（只留 REST API，体积小约 2.3M；
#                 Dove 的配置/状态/日志三页在 LuCI 里，不依赖它）
# DOVE_WITH_CLI=1 额外安装 /usr/bin/dove-cli（DaeNext 的 dae 诊断 CLI）
DOVE_WEB      ?= 1
DOVE_WITH_CLI ?= 0
# 前端资产名 daed-web-<版本>.tar.gz：版本 = release tag 去前导 v 与 -musl 后缀
DOVE_WEB_VERSION := $(shell echo '$(DOVE_VERSION)' | sed -E 's/^v//; s/-musl$$//')

define Package/dove
  SECTION  := net
  CATEGORY := Network
  SUBMENU  := Web Servers/Proxies
  TITLE    := Dove - DaeNext (daed) Rust-native eBPF transparent proxy
  URL      := https://github.com/qaz69s/DaeNext
  # 运行时依赖：
  #  ip-full/tc-bpf —— daed 的 eBPF 数据面通过 `tc qdisc add ... clsact` /
  #                   `tc filter add ... bpf` / `ip netns exec` 附加程序（shell 调用）
  #  kmod-sched-core —— sch_clsact / sch_ingress
  #  kmod-sched-bpf  —— cls_bpf
  #  kmod-veth       —— 数据面 netns 的 veth 对（dae50cli0/dae50lan0）
  #  geoip/geosite   —— /usr/share/dove/*.dat 软链目标
  DEPENDS  := @(aarch64||x86_64) \
	+ca-bundle +ip-full +tc-bpf \
	+kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-xdp-sockets-diag \
	+v2ray-geoip +v2ray-geosite
endef

define Package/dove/description
  DaeNext (daed) Rust-native eBPF transparent proxy, packaged the way joey
  packages upstream dae: daed is installed as /usr/bin/dove, with a procd
  init script and UCI configuration under /etc/dove.

  Unlike dae, daed keeps its configuration in a SQLite state store instead of
  a config.dae text file, so the daemon reads no text config at start. The
  companion luci-app-dove drives daed's REST API (dae config file
  import/export + runtime reload) so the LuCI overview page can still edit
  configuration as text, joey style.

  Install luci-app-dove for the LuCI interface. Set DOVE_WEB=0 at build time
  to drop the bundled daed Web UI and keep only the REST API.
endef

define Package/dove/conffiles
/etc/config/dove
endef

define Build/Prepare
	[ -n "$(DOVE_TARGET)" ] || { \
		echo "Dove: 不支持的架构 $(ARCH)，仅支持 aarch64 / x86_64" >&2; \
		exit 1; \
	}
	DOVE_VERSION="$(DOVE_VERSION)" DOVE_WEB_VERSION="$(DOVE_WEB_VERSION)" \
	DOVE_WITH_WEB="$(DOVE_WEB)" DOVE_WITH_CLI="$(DOVE_WITH_CLI)" \
		$(CURDIR)/files/download-dove.sh "$(DOVE_TARGET)" "$(DL_DIR)" "$(PKG_BUILD_DIR)"
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/dove/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/daed $(1)/usr/bin/dove
ifeq ($(DOVE_WITH_CLI),1)
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/dae $(1)/usr/bin/dove-cli
endif

	$(INSTALL_DIR) $(1)/etc/dove
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/dove.config $(1)/etc/config/dove

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/dove.init $(1)/etc/init.d/dove

	$(INSTALL_DIR) $(1)/usr/share/dove
	$(LN) ../v2ray/geoip.dat $(1)/usr/share/dove/geoip.dat
	$(LN) ../v2ray/geosite.dat $(1)/usr/share/dove/geosite.dat

ifeq ($(DOVE_WEB),1)
	$(INSTALL_DIR) $(1)/usr/share/dove/web
	$(CP) $(PKG_BUILD_DIR)/web/. $(1)/usr/share/dove/web/
endif
endef

define Package/dove/postinst
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] && {
	mkdir -p /etc/dove /tmp/log/dove
	chmod 0700 /etc/dove 2>/dev/null || true
	[ -x /etc/init.d/dove ] && /etc/init.d/dove enable 2>/dev/null || true
	# 升级场景：服务已在跑则重启，让新二进制的 Web UI / API 生效
	if /etc/init.d/dove running 2>/dev/null; then
		/etc/init.d/dove restart 2>/dev/null || true
	fi
}
exit 0
endef

define Package/dove/prerm
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] && {
	[ -x /etc/init.d/dove ] && {
		/etc/init.d/dove stop    2>/dev/null || true
		/etc/init.d/dove disable 2>/dev/null || true
	}
	# Dove 自己的 API 凭据与状态库不进 overlay 残留
	rm -f /etc/dove/api.cred /run/dove/api.token 2>/dev/null
	# 清理 geodata 兜底软链（仅当仍指向本包依赖的 v2ray geodata 时）
	[ "$$(readlink /usr/share/daed/geoip.dat 2>/dev/null)" = "../v2ray/geoip.dat" ] && rm -f /usr/share/daed/geoip.dat
	[ "$$(readlink /usr/share/daed/geosite.dat 2>/dev/null)" = "../v2ray/geosite.dat" ] && rm -f /usr/share/daed/geosite.dat
	rmdir /usr/share/daed 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,dove))
