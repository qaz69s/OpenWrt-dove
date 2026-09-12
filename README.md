# OpenWrt-dove

OpenWrt 插件：把 **DaeNext（Rust 版 dae）** 的 `daed` 打包成 joey 那种形态的服务，
带一个 joey 风格的三页 LuCI（**配置 / 状态 / 日志**）。

引擎、二进制来自 [qaz69s/DaeNext](https://github.com/qaz69s/DaeNext) 的 release
（上游 [ksong008/DaeNext](https://github.com/ksong008/DaeNext) 目前没有发布任何
release 产物，只有源码）。结构照 `OpenWrt-joey`：两个独立目录、各自独立 Makefile。

## 为什么不是「把 joey 的二进制换掉」

joey 跑的是上游 **dae（Go）**：直接读 `/etc/joey/config.dae` 文本，`dae run/reload`
全部由 CLI 支持。DaeNext 里同名二进制 `dae` 是**诊断 CLI**（实测 `dae run` →
`unsupported command: run`；`reload`/`suspend`/`sysdump` 同理），透明代理只在
`daed` 里；而 `daed` 的配置实体在 SQLite（`daed.db`），**启动不读 config.dae**
（`recover_product_durable_state` 只回滚未完成事务）。直接替换二进制的两条路
（装 `dae` 或装 `daed`）都跑不起来。

所以 Dove 的做法是：**用 `daed` 当引擎，把 joey 的「文本配置 + 保存重载」体验
用 daed 的 REST 接口实现**。

## 目录结构

```
dove/                                   # 守护进程包
├── Makefile                            # 从 release 下载预编译 musl 二进制
└── files/
    ├── download-dove.sh                # 下载 + SHA256SUMS 校验 + 架构映射
    ├── dove.init                       # procd 服务脚本
    └── dove.config                     # UCI 默认配置
luci-app-dove/                          # LuCI 包
├── Makefile
├── root/usr/libexec/rpcd/luci.dove     # rpcd 后端（API 胶水层）
├── root/usr/share/luci/menu.d/         # 菜单注册
├── root/usr/share/rpcd/acl.d/          # ACL
├── root/etc/uci-defaults/90_dove       # 首装初始化
└── htdocs/luci-static/resources/view/dove/
    ├── overview.js                     # 配置（dae 文本编辑器）
    ├── status.js                       # 状态
    └── log.js                          # 日志
```

## 安装布局

| 路径 | 说明 |
|---|---|
| `/usr/bin/dove` | `daed` 二进制（改名，避免与 deer / 原生 daed 抢 `/usr/bin/daed`） |
| `/usr/bin/dove-cli` | 可选（`DOVE_WITH_CLI=1`），DaeNext 的 `dae` 诊断 CLI |
| `/etc/dove/daed.db` | daed 状态库（节点、订阅、分组、路由、DNS 都在这里） |
| `/etc/dove/api.cred` | 首启自动创建的本地 API 凭据（0600，root only） |
| `/run/dove/control.sock` | 独立控制 socket（可与 deer/原生 daed 共存） |
| `/usr/share/dove/web` | daed 自带面板（`DOVE_WEB=0` 可不装） |
| `/tmp/log/dove/current.jsonl` | 产品 JSONL 日志（LuCI 日志页读它） |

## 配置是怎么"保存即生效"的

LuCI 配置页不碰文件，走 daed REST（`luci.dove` rpcd 里实现，跑在 127.0.0.1）：

1. `GET /api/user/me/dae-config-file` —— 导出当前生效的 dae 配置文本
2. `PUT /api/user/me/dae-config-file` —— 导入（节点/订阅/分组/路由/DNS，固定
   `namePrefix=dove`，重复导入替换同名资源）
3. `POST /api/profiles/select` —— 把导入出来的 `configId/dnsId/routingId` 选中
   （导入**不会**自动选中，必须显式 select）
4. `POST /api/runtime/reload` —— 物化并应用（等价于 `dae reload`）

「仅校验」按钮走 `POST /api/user/me/dae-config-file/preview`，不落库。

认证：首启（`numberUsers=0`）自动建一个本地用户 `dove`，随机密码存
`/etc/dove/api.cred`；token 缓存在 `/run/dove/api.token`（tmpfs，重启后自动续签）。
设备上已有面板账号（`numberUsers>0`）且不认这套凭据时，配置页会出现登录框，
用面板账号登录一次即可（可勾选记住，写入 `api.cred`）。

## 构建

```sh
# 放进构建树
cp -r OpenWrt-dove <openwrt-tree>/package/new/

# .config 里选上（.config 请先备份）
#   CONFIG_PACKAGE_dove=y
#   CONFIG_PACKAGE_luci-app-dove=y
make package/dove/compile V=s
make package/luci-app-dove/compile V=s
```

可覆盖开关：

- `DOVE_VERSION=latest`（默认查 fork 最新 release；失败回退 `v3.1.0-musl`）
  或锁定 `DOVE_VERSION=v3.1.0-musl`
- `DOVE_RELEASE=N` —— 同一数字版本重发时递增包释放号
- `DOVE_WEB=0` —— 不装 daed 自带面板（只留 REST/SSE，体积小约 2.3M）
- `DOVE_WITH_CLI=1` —— 额外装 `/usr/bin/dove-cli`（诊断 CLI）
- `DOVE_REPO=qaz69s/DaeNext` —— 换下载源

支持的架构：`x86_64`、`aarch64`（含 `aarch64_cortex-a53` 这类复合名）。

## 与 deer / joey 共存

- 二进制不冲突：Dove 装 `/usr/bin/dove`。
- 控制 socket 不冲突：Dove 用 `/run/dove/control.sock`（deer/原生 daed 用
  `/run/daed/control.sock`）。
- Web/API 端口会冲突：三者默认都想监听 `2023`。同时跑要改
  `uci set dove.main.listen='0.0.0.0:2024'` 之类。
- geodata：`/usr/share/dove/{geoip,geosite}.dat` 软链到 `/usr/share/v2ray/`，
  并通过 `DAE_LOCATION_ASSET` 传给 daed（daed 只认这个变量和固定目录，
  不认 `web_root`）。

## UCI 选项（`/etc/config/dove`）

`config_dir` / `state` / `listen` / `web_root` / `control_socket` / `geodata_dir` /
`log_dir` / `http_profile` / `api_only` / `validate_start` / `validate_reload` /
`hijack_resolv` / `reload_ready_timeout` / `reload_recovery_timeout` / `respawn` /
`term_timeout` / `nofile` / `nproc`

说明见 `/etc/config/dove` 里的注释。几个容易踩的：

- `api_only=1` 只关掉 Web UI 静态托管（`router.rs:26`），REST/SSE/SQLite/数据面
  照旧 —— 它不是"只跑控制面"。
- `hijack_resolv=1` 会把 `/tmp/resolv.conf` 绑到 daed 的 DNS，配置不当会全机断解析，
  默认关闭。
- 配置文本里的 `routing` 必须保留本机网段直连规则（如
  `dip(192.168.0.0/16) -> must_direct`），否则数据面会连到路由器自身的 SSH/LuCI
  流量一起劫持（表现为能建 TCP 但握手被 reset）。

## 已知取舍

- daed 的启动/重载要重建整个控制面（配置编译 + geodata 展开 + eBPF 附加），
  弱 CPU 上十几秒量级，所以「保存并重载」会等；配置页有明确提示。
- DaeNext 的 `dae`（诊断 CLI）**不能**替代 `daed` 跑代理 —— 上游 `surface.rs`
  里声明的 `run/reload/suspend` 尚未实现（`runner.rs` 的真实分发只有
  `validate/export/config/userspace/active-datapath/outbound`）。
