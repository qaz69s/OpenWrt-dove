#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# 下载 DaeNext **core-only** 预编译二进制（裸 musl 文件）
#
# 用法: download-dove.sh <ARCH_SUFFIX> <DL_DIR> <PKG_BUILD_DIR>
#   ARCH_SUFFIX: aarch64 | x86_64
# 环境变量（Makefile 传入）:
#   DOVE_VERSION   release tag，如 v3.1.0-core-musl
#   DOVE_REPO      仓库，默认 qaz69s/DaeNext
#
# 资产命名约定:
#   dove-<arch>-musl     DaeNext core（dae-daemon 去掉 product-api 编出来的
#                        daed-contract-runner），装成 /usr/bin/dove
#   SHA256SUMS           可选，存在则强校验
#
# 怎么产生这个资产：用 files/build-core.sh（或手动执行等价的 cargo 命令），
# 把 target/<triple>/release/daed-contract-runner 以 dove-<arch>-musl 上传到 release。

set -e

ARCH_SUFFIX="$1"
DL_DIR="$2"
PKG_BUILD_DIR="$3"

[ -n "$ARCH_SUFFIX" ] || { echo "download-dove: 缺少 ARCH_SUFFIX 参数" >&2; exit 1; }
[ -n "$DL_DIR" ] || { echo "download-dove: 缺少 DL_DIR 参数" >&2; exit 1; }
[ -n "$PKG_BUILD_DIR" ] || { echo "download-dove: 缺少 PKG_BUILD_DIR 参数" >&2; exit 1; }

DOVE_VERSION="${DOVE_VERSION:?download-dove: 缺少 DOVE_VERSION}"
DOVE_REPO="${DOVE_REPO:-qaz69s/DaeNext}"
BASE_URL="https://github.com/${DOVE_REPO}/releases/download/${DOVE_VERSION}"
ASSET="dove-${ARCH_SUFFIX}-musl"

mkdir -p "$DL_DIR" "$PKG_BUILD_DIR"

log() { echo "download-dove: $*"; }

fetch() {
	_url="$1"; _dest="$2"
	if [ -s "$_dest" ]; then
		log "命中缓存 $(basename "$_dest")"
		return 0
	fi
	log "下载 $(basename "$_dest")"
	rm -f "$_dest.tmp"
	if ! curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 -o "$_dest.tmp" "$_url"; then
		rm -f "$_dest.tmp"
		echo "download-dove: 下载失败 $_url" >&2
		echo "download-dove: 该 release 里没有 $ASSET 资产？" >&2
		echo "download-dove: core-only 二进制需要自己产出（见 files/build-core.sh），或用" >&2
		echo "               make package/dove/compile DOVE_SOURCE_MODE=local DOVE_CORE_BINARY=<path>" >&2
		echo "               make package/dove/compile DOVE_SOURCE_MODE=source DOVE_CORE_SRC=<DaeNext 源码目录>" >&2
		exit 1
	fi
	mv "$_dest.tmp" "$_dest"
}

verify_sum() {
	_sums="$DL_DIR/SHA256SUMS.$DOVE_VERSION"
	[ -f "$_sums" ] || { log "无 SHA256SUMS，跳过 sha256 校验"; return 0; }
	_want="$(awk -v n="$ASSET" '$2 == n { print $1; exit }' "$_sums")"
	if [ -z "$_want" ]; then
		# 常见原因：release 资产被 --clobber 重发后，GitHub CDN 仍在吐旧副本。
		# 静默 return 0 会把"校验被跳过"伪装成"校验通过"，所以这里必须吵。
		echo "download-dove: ⚠️ SHA256SUMS 无 $ASSET 条目（当前副本 $(wc -c <"$_sums" | tr -d ' ') 字节），未做 sha256 校验" >&2
		return 0
	fi
	_got="$(sha256sum "$1" | cut -d' ' -f1)"
	if [ "$_got" != "$_want" ]; then
		echo "download-dove: sha256 不匹配 $ASSET" >&2
		echo "  want=$_want" >&2
		echo "  got =$_got" >&2
		return 1
	fi
	log "sha256 校验通过 $ASSET"
}

log "core 二进制 ${DOVE_VERSION} 架构 ${ARCH_SUFFIX}"

# SHA256SUMS 每次都尝试刷新（上游同 tag 重发资产时，旧缓存会让新资产永远校验失败）
# 实测：同一 tag 用 --clobber 重发 SHA256SUMS 后，不带参数的 URL 仍会命中 GitHub CDN
# 的旧副本（返回旧文件、里面没有新资产条目）→ 必须加 cache-buster。
SUMS_FILE="$DL_DIR/SHA256SUMS.$DOVE_VERSION"
rm -f "$SUMS_FILE.tmp"
if curl -fsSL --retry 2 --connect-timeout 10 -o "$SUMS_FILE.tmp" "$BASE_URL/SHA256SUMS?cb=$(date +%s)-$$" 2>/dev/null; then
	mv "$SUMS_FILE.tmp" "$SUMS_FILE"
else
	rm -f "$SUMS_FILE.tmp"
	[ -s "$SUMS_FILE" ] || log "SHA256SUMS 不可用，跳过校验"
fi

DEST="$DL_DIR/$ASSET"
fetch "$BASE_URL/$ASSET" "$DEST"
if ! verify_sum "$DEST"; then
	log "缓存与 SHA256SUMS 不一致，强制重新下载 $ASSET"
	rm -f "$DEST"
	fetch "$BASE_URL/$ASSET" "$DEST"
	verify_sum "$DEST" || { echo "download-dove: $ASSET 重下后仍校验失败，中止" >&2; exit 1; }
fi

install -m 0755 "$DEST" "$PKG_BUILD_DIR/dove"
log "完成 -> $PKG_BUILD_DIR/dove"
