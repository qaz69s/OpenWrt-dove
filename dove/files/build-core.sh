#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# 在构建机上现场编出 DaeNext **core-only** 静态 musl 二进制。
#
# 用法（通常由 dove/Makefile 的 DOVE_SOURCE_MODE=source 调用）:
#   DOVE_CORE_SRC=<DaeNext 源码目录> DOVE_RUST_TARGET=<triple> \
#   DOVE_JOBS=2 DOVE_OUT=<输出文件>  ./build-core.sh
#
# 为什么不用 crossbuild/build-musl.sh：那个脚本出的是 daed（product-api，
# 带 SQLite/API/WebUI）和 dae（诊断 CLI）。core 形态要的是同一个 crate 在
# **关掉 product-api** 时的二进制，即 daed-contract-runner：
#   cargo build -p dae-daemon --bin daed-contract-runner \
#     --no-default-features \
#     --features service-contract,resident-runtime,native-ebpf,allocator-jemalloc,\
# test-boringssl-tcp-tls,test-boringssl-quic
# 这个二进制读 config.dae 文本、跑 resident eBPF 数据面，支持 run/validate/reload。
#
# 依赖：rustup（含对应 target）、zig >= 0.14、cmake/clang/perl/libelf-dev
#      （BoringSSL）；eBPF 对象还需要 nightly + rust-src + bpf-linker
#      （与 crossbuild/build-musl.sh 完全一致的环境）。

set -e

DOVE_CORE_SRC="${DOVE_CORE_SRC:?build-core: 需要 DOVE_CORE_SRC=<DaeNext 源码目录>}"
DOVE_RUST_TARGET="${DOVE_RUST_TARGET:?build-core: 需要 DOVE_RUST_TARGET=<triple>}"
DOVE_JOBS="${DOVE_JOBS:-2}"
DOVE_OUT="${DOVE_OUT:?build-core: 需要 DOVE_OUT=<输出文件路径>}"
ZIG_BIN_DIR="${ZIG_BIN_DIR:-$HOME/zig}"

[ -d "$DOVE_CORE_SRC" ] || { echo "build-core: $DOVE_CORE_SRC 不是目录" >&2; exit 1; }
[ -x "$ZIG_BIN_DIR/zig" ] || { echo "build-core: 找不到 zig（$ZIG_BIN_DIR/zig），设 ZIG_BIN_DIR" >&2; exit 1; }

case "$DOVE_RUST_TARGET" in
	x86_64-unknown-linux-musl) ZIG_TARGET=x86_64-linux-musl; CPU_FLAG=x86-64 ;;
	aarch64-unknown-linux-musl) ZIG_TARGET=aarch64-linux-musl; CPU_FLAG=generic ;;
	*) echo "build-core: 不支持的 target $DOVE_RUST_TARGET" >&2; exit 1 ;;
esac

TARGET_ENV="$(printf '%s' "$DOVE_RUST_TARGET" | tr '-' '_')"
TARGET_UPPER="$(printf '%s' "$DOVE_RUST_TARGET" | tr 'a-z-' 'A-Z_')"
ROOT="$DOVE_CORE_SRC"

BINDGEN_ARGS="$(PATH="$ZIG_BIN_DIR:$PATH" "$ROOT/crossbuild/zig-bindgen-env" "$ZIG_TARGET")"
echo "build-core: src=$ROOT target=$DOVE_RUST_TARGET zig=$ZIG_TARGET cpu=$CPU_FLAG jobs=$DOVE_JOBS"

cd "$ROOT"
env \
	PATH="$ZIG_BIN_DIR:$PATH" \
	ZIGCC_TARGET="$ZIG_TARGET" \
	"CC_${TARGET_ENV}=$ROOT/crossbuild/zigcc" \
	"CXX_${TARGET_ENV}=$ROOT/crossbuild/zigcxx" \
	"AR_${TARGET_ENV}=llvm-ar" \
	"CARGO_TARGET_${TARGET_UPPER}_LINKER=$ROOT/crossbuild/zigcc" \
	"CARGO_TARGET_${TARGET_UPPER}_RUSTFLAGS=-C link-self-contained=no -C target-cpu=$CPU_FLAG" \
	"BINDGEN_EXTRA_CLANG_ARGS=$BINDGEN_ARGS" \
	cargo build --locked --release -j"$DOVE_JOBS" \
		--target "$DOVE_RUST_TARGET" \
		-p dae-daemon --bin daed-contract-runner \
		--no-default-features \
		--features service-contract,resident-runtime,native-ebpf,allocator-jemalloc,test-boringssl-tcp-tls,test-boringssl-quic

ARTIFACT="$ROOT/target/$DOVE_RUST_TARGET/release/daed-contract-runner"
[ -x "$ARTIFACT" ] || { echo "build-core: 产物不存在: $ARTIFACT" >&2; exit 1; }

mkdir -p "$(dirname "$DOVE_OUT")"
install -m 0755 "$ARTIFACT" "$DOVE_OUT"
echo "build-core: 完成 -> $DOVE_OUT"
