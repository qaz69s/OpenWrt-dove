# OpenWrt-dove

OpenWrt 插件：把 **DaeNext 的 core（`dae` 内核层）** 打包成 joey 那种形态的服务 ——
**没有 daed**（不带产品层：无 SQLite、无 REST API、无 Web UI），配置就是一份文本
`/etc/dove/config.dae`，LuCI 三页（配置 / 状态 / 日志）。

结构照 `OpenWrt-joey`：两个独立目录、各自独立 Makefile。

## 三个二进制别搞混

| 产物 | 来源 | 能不能跑代理 |
|---|---|---|
| `daed` | `cargo build -p dae-daemon --bin daed`（默认 features，含 `product-api`） | 能，但带 SQLite + REST API + Web UI 产品层 |
| `dae` | `cargo build -p dae-cli --bin dae` | **不能** —— 实测 `dae run` → `unsupported command: run`，它是诊断 CLI |
| **core（本包用的）** | `cargo build -p dae-daemon --bin daed-contract-runner --no-default-features --features service-contract,resident-runtime,native-ebpf,allocator-jemalloc,test-boringssl-tcp-tls,test-boringssl-quic` | **能**，且无产品层 |

为什么 core 是 `daed-contract-runner`：`daed` 这个 bin 在 `Cargo.toml` 里带
`required-features = ["product-api"]`，关掉 `product-api` 就不出 `daed`；
而同一个 crate 的 `daed-contract-runner` bin（只要求 `service-contract`）调的是
**core 版命令分发** `dae_daemon::run_with_args_and_version`。它的 `run` 在没有 CI
标志时走：

```rust
if !bounded_report_requested {
    let options = ResidentRunOptions::for_config(config);   // -c <config.dae>
    return run_resident_service(&options);                  // 常驻 eBPF 数据面
}
```

`run_resident_service()`（`crates/dae-daemon/src/service_contract/resident_service.rs:89`）：
读文本配置 → 起 resident 生产运行时（真 eBPF 数据面）→ 写 pidfile →
`SIGUSR1` 热重载 / `SIGUSR2` suspend / `SIGTERM` 停止 → 还能 `notify_systemd`。

## 目录结构

```
dove/                                   # core 引擎包
├── Makefile                            # 三种二进制来源（见下）
└── files/
    ├── download-dove.sh                # prebuilt：从 release 下载 dove-<arch>-musl
    ├── build-core.sh                   # source：构建机上现场交叉编译
    ├── dove.init                       # procd（validate → run → hot_reload）
    ├── dove.config                     # UCI
    └── config.dae                      # 默认配置（可直接 validate 通过的"只直连"安全默认）
luci-app-dove/                          # LuCI 包
├── Makefile
├── root/usr/libexec/rpcd/luci.dove     # 状态/日志/校验/服务控制
├── root/usr/share/{luci/menu.d, rpcd/acl.d}/
├── root/etc/uci-defaults/90_dove
└── htdocs/luci-static/resources/view/dove/{overview,status,log}.js
```

## 安装布局

| 路径 | 说明 |
|---|---|
| `/usr/bin/dove` | core 二进制（上游产物名 `daed-contract-runner`，改名为 dove） |
| `/etc/dove/config.dae` | **配置本体**（0600，conffile） |
| `/etc/config/dove` | UCI（config_file / log_file / 轮转 / pidfile / respawn / limits） |
| `/etc/dove/{geoip,geosite}.dat` | 软链到 `/usr/share/v2ray/`（core 的 geodata 目录 = 配置文件所在目录） |
| `/var/log/dove.log` | 运行日志（core 无内建轮转，init 启动时按 UCI 滚动） |
| `/var/run/dove.pid` | pidfile（`dove reload` 靠它定位进程） |
| `/var/run/dove.progress` | 热重载握手文件（run 写进度 / reload 写 SEND 并等 DONE） |
| `/var/run/dove.abort` | `dove reload -a` 时用来通知断开已有连接 |

## 命令

```sh
dove validate -c /etc/dove/config.dae      # 校验配置
dove run -c /etc/dove/config.dae --logfile /var/log/dove.log --service-pid-file /var/run/dove.pid
dove reload [--service-pid-file /var/run/dove.pid] [-a]   # -a = 顺便断开已有连接
dove identity                              # JSON：name/version/…（没有 --version）
```

init 提供 `hot_reload`（先 validate，再 `dove reload`；失败自动退化成 stop/start）
和 `check_config`。

⚠️ run 与 reload 必须共用同一组 `--service-pid-file/--service-progress-file/--service-abort-file`
（reload 是"写 progress → SIGUSR1 → 等 progress 变 DONE"的握手，路径不一致就会空等到超时）。
init 两边都从 UCI 取同一组路径。

## 构建：三种二进制来源

`.config` 里选上（先备份）：

```
CONFIG_PACKAGE_dove=y
CONFIG_PACKAGE_luci-app-dove=y
```

**1) prebuilt（默认）** —— 从 release 下载 `dove-<arch>-musl`（SHA256SUMS 强校验）

```sh
make package/dove/compile V=s
# 换仓库/版本：
make package/dove/compile DOVE_REPO=<owner/repo> DOVE_VERSION=v3.1.0-core-musl
```

> ⚠️ `qaz69s/DaeNext` 现有 release 里**没有** `dove-<arch>-musl` 资产（只有
> `daed-*` / `dae-*` / `daed-web-*`）。要跑 prebuilt 模式，得先把 core 二进制
> 用下面第 3 步产出并上传成 release 资产。

**2) local** —— 用构建机上已经编好的 core 二进制

```sh
make package/dove/compile V=s DOVE_SOURCE_MODE=local \
     DOVE_CORE_BINARY=$HOME/DaeNext/target/x86_64-unknown-linux-musl/release/daed-contract-runner
```

**3) source** —— 在构建机上现场交叉编译（需要 cargo + zig ≥0.14 + cmake/clang/perl/
libelf-dev；eBPF 对象还要 nightly + rust-src + bpf-linker）

```sh
make package/dove/compile V=s DOVE_SOURCE_MODE=source DOVE_CORE_SRC=$HOME/DaeNext \
     DOVE_RUST_TARGET=x86_64-unknown-linux-musl DOVE_JOBS=2
```

也可以脱离 OpenWrt 单独跑（产物放哪都行）：

```sh
DOVE_CORE_SRC=$HOME/DaeNext DOVE_RUST_TARGET=x86_64-unknown-linux-musl DOVE_JOBS=2 \
  DOVE_OUT=/tmp/dove-core ./dove/files/build-core.sh
```

支持的架构：`x86_64`、`aarch64`（含 `aarch64_cortex-a53` 这类复合名）。

## LuCI 界面：joey 原样移植

界面代码是 **joey 那套原样搬过来的**（`overview.js` 单页 + `status.js`/`log.js` 两个标签页，
`require('view.dove.status')` 方式挂载），只换了引擎相关的几处：

| joey（原版 dae） | dove（DaeNext core） |
|---|---|
| `PROG=/usr/bin/dae` | `PROG=/usr/bin/dove` |
| `dae --version \| awk 'NR==1{print $3}'` | `dove identity` 里取版本号字段 |
| `ps \| awk '/[d]ae.*run/'` | `ps \| awk '/[d]ove.*run/'` |
| `/etc/joey/config.dae` | `/etc/dove/config.dae` |
| `/var/log/joey.log` | `/var/log/dove.log` |
| `luci.joey` / `admin/services/joey` | `luci.dove` / `admin/services/dove` |

菜单只有一项（`admin/services/dove` → `dove/overview`），页面内三个标签 —— 与 joey 一致。
rpcd 方法保持 joey 的四个：`getInitStatus` / `getMem` / `setInitAction` / `clearLog`
（`setInitAction` 的 action 名也照抄：`start|stop|restart|enable|disable|reload_config|enable_start`，
其中 `reload_config` → `/etc/init.d/dove hot_reload`）。

## 与 deer / joey 共存

- 二进制路径独立（`/usr/bin/dove`），pidfile 独立（`/var/run/dove.pid`）。
- 不占端口（core 没有 API/面板）。**和 joey 一样，一台机上只能有一个 eBPF 透明代理
  在跑** —— joey/dove/deer 同时开数据面会互相踩，别同时启用。

## 代理明细日志（需要上游补丁分支）

DaeNext 的 resident 事件模块是 **dispatch-only**：`crates/dae-resident-core/src/events.rs`
注释原文「File-based persistence was removed: resident events are dispatch-only to
the configured sink」；绑定 sink 的代码在**产品层**
（`daed_product/logs/init.rs::register_resident_event_product_log_sink`），被
`product-api` 门控。所以：

- **daed / deer**：有代理日志
- **core / dove（未打补丁）**：事件直接丢弃，日志里只有 `service ready` / `service stopping`

修法（已实现，在 fork 的分支上）：
**`qaz69s/DaeNext` 分支 `dove/core-event-log`**（commit `7c2cc6ef`，改动
`crates/dae-daemon/src/service_contract/resident_service.rs` +83 行）：
`run_resident_service()` 里读配置后调用 `install_core_event_log_sink()`，
用公开 API `dae_resident_dataplane::facade::{set_event_log_sink,set_event_log_policies}`
把事件按 JSONL 追加到 `--logfile`。级别跟随 `global.log_level`：

- `*_route_chosen` / `*_path_chosen` / `session_started|stopped` / `*_failed` → `info`
- 其余 packet 级 → `debug`（避免 UDP 事件刷爆日志）

拿到带日志的二进制：把 DaeNext 源码切到该分支，然后用 `DOVE_SOURCE_MODE=source`
编译（或用它编出来的二进制走 `DOVE_SOURCE_MODE=local` / 发 release 资产走 `prebuilt`）。

日志长相（LuCI 日志页直接可见，可按关键字过滤）：

```
service ready
{"event":"resident_health_checker_started","group":"proxy","group_policy":"min_moving_avg","candidate_count":1,...}
{"event":"tcp_worker_started","dial_mode":"domain",...}
{"event":"tcp_route_chosen","dial_target":"www.google.com:443","dialer":"USA1","final_outbound":2,...}
```

事件类型全集见 `crates/dae-resident-core/src/events/model.rs`（17 种，含
`tcp_route_chosen` / `udp_route_chosen` / `dns_path_chosen` / `udp_session_*` / `*_failed`）。

## 容易踩的坑

- 配置里 `routing` 必须保留本机网段直连（`dip(192.168.0.0/16) -> must_direct` 等），
  否则数据面会劫持到路由器自身的管理流量（TCP 能连、握手被 reset）。
- `global.disable_waiting_network`：默认 false 时，只要配了 `subscription`，
  **启动和重载都会先探测网络**（每次 connect 5s 超时、最多 60 轮）——这是"启动慢"
  的头号原因。默认配置里已置 true。
- core 的 geodata 查找目录 = **配置文件所在目录**（`resident_config_geodata_asset_dirs`），
  另外还会找 `/etc/dae`、`/usr/local/share/dae`、`/usr/share/dae`；本包在
  `/etc/dove/` 和 `/usr/share/dae/` 都放了软链。
- `dove`（core）**没有** `--version`，取版本用 `dove identity` 的 `version` 字段。
- **配置文件的权限必须是 0600/0640**。`dove validate` 会拒绝 0644：
  `permissions 0644 ... are too open; requires the file is NOT writable by the same group and NOT accessible by others`。
  包的 postinst / uci-defaults / init 每次启动都会 `chmod 0600`；手动 `dove validate`
  时注意先 chmod，否则会误判成配置错误。
- daed 那套（deer 包）的启动慢（geodata 贪婪展开 + 每次重建控制面）在这里同样存在，
  因为数据面是同一套；区别只是没有产品层。
