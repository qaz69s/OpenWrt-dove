# SPDX-License-Identifier: AGPL-3.0-only
#
# Copyright (C) 2026 OpenWrt-dove contributors

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/package.mk

PKG_NAME    := dove
# DaeNext core 版本：prebuilt 模式下从 release 拉 dove-<arch>-musl。
# 可命令行覆盖锁定（可复现构建）：DOVE_VERSION=v3.1.0-core-musl
DOVE_VERSION ?= latest
ifeq ($(DOVE_VERSION),latest)
DOVE_LATEST := $(shell v=$$(curl -fsSL --retry 2 --connect-timeout 5 https://api.github.com/repos/qaz69s/DaeNext/releases 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4); [ -n "$$v" ] && echo "$$v" || echo v3.1.0-musl)
DOVE_VERSION := $(DOVE_LATEST)
endif
# apk 版本号格式要求严格：每个点分段必须以数字开头，且 `_` 后缀只接受
# alpha/beta/pre/rc/cvs/svn/git/hg/p 白名单。所以 PKG_VERSION 只取 tag 的数字主干。
PKG_VERSION := $(shell echo '$(DOVE_VERSION)' | sed -E 's/^v//; s/[-_].*$$//')
DOVE_RELEASE ?= 3
PKG_RELEASE := $(DOVE_RELEASE)

PKG_LICENSE    := AGPL-3.0-only
PKG_MAINTAINER := OpenWrt-dove contributors

# ── 架构映射：OpenWrt ARCH → 资产后缀 ──────────────────────────────────
# 不在解析期用 $(error)（扫描阶段 $(ARCH) 为空会让包不被注册）。
# ⚠️ 必须先精确匹配 x86_64（它自身含下划线）。
ifeq ($(ARCH),x86_64)
  DOVE_TARGET := x86_64
  DOVE_RUST_TARGET := x86_64-unknown-linux-musl
else ifeq ($(ARCH),aarch64)
  DOVE_TARGET := aarch64
  DOVE_RUST_TARGET := aarch64-unknown-linux-musl
else
  DOVE_ARCH_BASE := $(firstword $(subst _, ,$(ARCH)))
  ifeq ($(DOVE_ARCH_BASE),aarch64)
    DOVE_TARGET := aarch64
    DOVE_RUST_TARGET := aarch64-unknown-linux-musl
  else
    DOVE_TARGET :=
  endif
endif

# ── 二进制来源（三选一）───────────────────────────────────────────────
# prebuilt（默认）: 从 $(DOVE_REPO) 的 $(DOVE_VERSION) release 下载
#                  dove-<arch>-musl（含 SHA256SUMS 校验）
# local          : 直接用构建机上已编好的 core 二进制
#                  make package/dove/compile DOVE_SOURCE_MODE=local \
#                       DOVE_CORE_BINARY=/home/you/DaeNext/target/x86_64-unknown-linux-musl/release/daed-contract-runner
# source         : 在构建机上现场交叉编译（需要 cargo + zig；用 files/build-core.sh）
#                  make package/dove/compile DOVE_SOURCE_MODE=source \
#                       DOVE_CORE_SRC=/home/you/DaeNext
DOVE_SOURCE_MODE ?= prebuilt
DOVE_REPO        ?= qaz69s/DaeNext
DOVE_CORE_SRC    ?= $(HOME)/DaeNext
DOVE_JOBS        ?= 2

# 解析期就把"取二进制"的命令算好。
# ⚠️ 条件指令（ifeq/else）放在 define 里头会失效（make 在展开 define 时
#    不按顶层条件处理，实测会一直落到 else 分支），所以这里在顶层算。
# 未用 $(error)：本文件在 make menuconfig 扫描阶段也会被解析，
# 解析期报错会连累整棵树；这里降级成构建期报错。
ifeq ($(DOVE_SOURCE_MODE),prebuilt)
  DOVE_PREPARE_CMD = DOVE_VERSION="$(DOVE_VERSION)" DOVE_REPO="$(DOVE_REPO)" \
	$(CURDIR)/files/download-dove.sh "$(DOVE_TARGET)" "$(DL_DIR)" "$(PKG_BUILD_DIR)"
else ifeq ($(DOVE_SOURCE_MODE),local)
  DOVE_PREPARE_CMD = { [ -f "$(DOVE_CORE_BINARY)" ] || { \
	echo "Dove: DOVE_CORE_BINARY 不存在或未设置: '$(DOVE_CORE_BINARY)'" >&2; \
	echo "提示: 需指向 core 二进制（DaeNext 的 daed-contract-runner，见 files/build-core.sh）" >&2; \
	exit 1; \
  }; } && install -m 0755 "$(DOVE_CORE_BINARY)" "$(PKG_BUILD_DIR)/dove"
else ifeq ($(DOVE_SOURCE_MODE),source)
  DOVE_PREPARE_CMD = DOVE_CORE_SRC="$(DOVE_CORE_SRC)" DOVE_RUST_TARGET="$(DOVE_RUST_TARGET)" \
	DOVE_JOBS="$(DOVE_JOBS)" DOVE_OUT="$(PKG_BUILD_DIR)/dove" \
	$(CURDIR)/files/build-core.sh
else
  DOVE_PREPARE_CMD = echo "Dove: 未知的 DOVE_SOURCE_MODE='$(DOVE_SOURCE_MODE)'（应为 prebuilt|local|source）" >&2; false
endif

define Package/dove
  SECTION  := net
  CATEGORY := Network
  SUBMENU  := Web Servers/Proxies
  TITLE    := Dove - DaeNext core (dae core only) eBPF transparent proxy
  URL      := https://github.com/ksong008/DaeNext
  # 运行时依赖（core 的数据面同样要 attach eBPF / 建 netns veth）：
  #  ip-full/tc-bpf、kmod-sched-core/bpf、kmod-veth、kmod-xdp-sockets-diag
  #  geoip/geosite —— /etc/dove/*.dat 软链目标（core 的 geodata 目录 = 配置文件所在目录）
  DEPENDS  := @(aarch64||x86_64) \
	+ca-bundle +ip-full +tc-bpf \
	+kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-xdp-sockets-diag \
	+v2ray-geoip +v2ray-geosite
endef

define Package/dove/description
  DaeNext CORE ONLY, packaged the way joey packages upstream dae.

  This is dae-daemon built WITHOUT the product layer (no product-api feature):
  no SQLite state store, no REST API, no Web UI. It reads a plain dae config
  file and runs the resident eBPF dataplane as a plain service:

    dove validate -c /etc/dove/config.dae     # config check
    dove run      -c /etc/dove/config.dae --logfile /var/log/dove.log
    dove reload                               # SIGHUP-free hot reload (SIGUSR1)
    dove identity                             # build identity

  Installed as /usr/bin/dove (the upstream artifact is named
  daed-contract-runner, which is the core-only binary of the same crate).

  Install luci-app-dove for the LuCI interface (config editor / status / logs).
endef

define Package/dove/conffiles
/etc/config/dove
/etc/dove/config.dae
endef

define Build/Prepare
	[ -n "$(DOVE_TARGET)" ] || { \
		echo "Dove: 不支持的架构 $(ARCH)，仅支持 aarch64 / x86_64" >&2; \
		exit 1; \
	}
	$(DOVE_PREPARE_CMD)
endef

define Build/Configure
endef

define Build/Compile
endef

# 二进制由 cargo 产出时已经 strip 过（静态 musl + strip）。关掉 OpenWrt 的
# 二次 strip（RSTRIP），保证包内 /usr/bin/dove 与构建产物逐字节一致、可校验，
# 也避免对 native-ebpf 内嵌 BPF 对象做任何多余加工。
RSTRIP:=:

define Package/dove/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/dove $(1)/usr/bin/dove

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/dove.config $(1)/etc/config/dove

	$(INSTALL_DIR) $(1)/etc/dove
	$(INSTALL_CONF) $(CURDIR)/files/config.dae $(1)/etc/dove/config.dae
	# core 的 geodata 目录 = 配置文件所在目录（resident_config_geodata_asset_dirs）。
	# ⚠️ 这里必须用绝对目标：从 /etc/dove 到 /usr/share/v2ray 的相对路径是
	#    ../../usr/share/v2ray/...，上一版写成 ../v2ray/... 会被解析成 /etc/v2ray/...，
	#    结果是悬空软链（geodata 解析失败）。
	$(LN) /usr/share/v2ray/geoip.dat $(1)/etc/dove/geoip.dat
	$(LN) /usr/share/v2ray/geosite.dat $(1)/etc/dove/geosite.dat

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/dove.init $(1)/etc/init.d/dove
endef

define Package/dove/postinst
#!/bin/sh
[ -z "$${IPKG_INSTROOT}" ] && {
	mkdir -p /etc/dove /var/log
	chmod 0600 /etc/dove/config.dae 2>/dev/null || true
	[ -x /etc/init.d/dove ] && /etc/init.d/dove enable 2>/dev/null || true
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
	# core 的兜底搜索目录（GeodataResolver 固定路径之一）
	[ "$$(readlink /usr/share/dae/geoip.dat 2>/dev/null)" = "../v2ray/geoip.dat" ] && rm -f /usr/share/dae/geoip.dat
	[ "$$(readlink /usr/share/dae/geosite.dat 2>/dev/null)" = "../v2ray/geosite.dat" ] && rm -f /usr/share/dae/geosite.dat
	rmdir /usr/share/dae 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,dove))
