# DSH-Docker 完整指南

[English](README.md) | 中文 | [快速开始](../README_CN.md)

本文档说明完整配置、平台行为、在线更新、信任、发布自动化和开发流程。普通部署请从根目录的 [README](../README_CN.md) 开始。

## 配置参考

### Compose 变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机端口发布地址 |
| `DSH_PORT` | `3080` | 宿主机发布端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载到 `/workspace` 的宿主机目录 |
| `DSH_SUDO_ENABLED` | `true` | 是否提供不受限制的免密码 sudo；`true` 或 `false` |

### 容器变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_PLATFORM_DATA` | `/data/platform` | 平台状态、受管理资产、快照和日志目录 |
| `DSH_HOME` | `/data/dsh` | DSH 配置和数据目录 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器初始路径；必须是可访问的绝对目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用上游遥测；`true` 或 `false` |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的外部 `host` 或 `host:port` authority |
| `DSH_PROXY_USERNAME` | 空 | 可选 HTTP Basic 用户名；密码为空时忽略 |
| `DSH_PROXY_PASSWORD` | 空 | 可选 Gateway 密码；留空关闭认证 |
| `DSH_PROXY_POLYFILL` | `true` | 是否注入受保护的 `crypto.randomUUID` 兼容代码 |
| `DSH_LOG_MAX_BYTES` | `104857600` | 平台 JSONL 日志总量上限 |
| `DSH_LOG_RETENTION_DAYS` | `14` | 平台日志保留天数 |
| `DSH_ACTIVATION_TIMEOUT_SECONDS` | `60` | 更新激活健康检查期限 |
| `DSH_EXPERIMENTAL_PROBATION_SECONDS` | `120` | Experimental Runtime 提交前观察期 |

`DSH_TRUSTED_HOSTS` 支持：

- 留空：仅接受 loopback Host。
- 单值：接受 loopback 和该主机；不带端口时匹配任意端口。
- 逗号分隔多值：接受列出的全部 authority。
- `*`：接受任意 Host；Origin、Fetch Metadata 和可选密码检查仍然启用。

值中不能包含协议、路径、凭据或子域名通配符。合法示例包括 `dsh.example.com`、`dsh.example.com:8443`、`192.168.1.100` 和 `[fd00::1]:3080`。旧变量 `DSH_TRUSTED_HOST` 暂时兼容；不要同时设置新旧变量。

### Workspace 行为

`DSH_DEFAULT_WORKSPACE` 只修改目录选择器初始路径，不是文件系统沙箱。用户仍可选择容器 `node` 用户有权访问的其他路径。DSH 在 Environment 组件启动时验证访问权限。

镜像通过精确匹配编译产物实现此行为。补丁必须恰好匹配一次，因此不兼容的上游版本会使构建失败，而不会修改错误位置。

## 平台架构

```text
tini
  └─ Stage-0
       └─ Bootstrap
            ├─ Control Plane
            │    ├─ management + Platform Management  Unix socket
            │    └─ gateway                      0.0.0.0:3080
            └─ Environment
                 └─ dsh-runtime                  127.0.0.1:3079
```

Stage-0 负责信任验证、首次种入、Bootstrap A/B 选择、启动失败回滚和信号转发。初始不可变版本通过经过校验的 Image Reference 直接使用镜像内的只读 Seed；只有在线更新产物才会实体化到平台数据卷。Bootstrap 分别监督常驻 Control Plane 与可重载 Environment。因此，替换、暂停或重启 DSH 不会停止 Gateway、Management 或平台管理界面。

源码目录使用同一边界：

- `container/platform/`：Stage-0、Bootstrap、共享合约和发布工具。
- `container/control-plane/services/`：常驻 Gateway 和 Management 进程。
- `container/control-plane/hooks/`：受监督的一次性恢复任务。
- `container/control-plane/modules/`：更新、日志、补丁和 System Plugin 逻辑。
- `container/environment/`：完整 Container Environment 源码，包括工作负载和 `resources/{patches,system-plugins}`。

### 平台数据与 Runtime 解析

持久化状态、受管理资产和每次启动生成的运行视图采用不同目录：

```text
/data/platform/
├── state/{trust,bootstrap,deployments,updater}
├── store/{objects,bootstrap,environments,pristine,runtimes,system-plugins,snapshots}
├── cache/downloads
└── logs

/run/dsh-platform/
├── stage0-trust.sock
├── bootstrap.sock
├── management.sock
├── recovery.sock
├── deployments/
└── views/{bootstrap,environment,runtime,system-plugins}
```

`state` 保存权威的选择、信任和事务状态。`store` 保存不可变的 Managed 资产与回滚材料；只有 slots、事务、Hold、receipt 和快照都不再引用时才会回收。`cache` 可以随时清理。`/run/dsh-platform` 在每次容器启动时重建，不应备份或挂载为持久数据。`/data/dsh` 始终是独立的用户数据卷。

Runtime、Environment 和 System Plugins 共同组成一个内容寻址的 Deployment Record。Bootstrap 将完整 Record 解析为一个 candidate view，启动并执行健康检查，然后原子提交 current/previous slots。重启后不会选中只切换了一部分的组合。

Patches 是强制 Deployment 内容，不属于用户选装项。每次 DSH 启动、恢复、reload 或单服务重启前，Bootstrap 都会核对当前 Environment 中 Patch Artifact 的 SHA-256 和大小，并执行 Patch 自带的结果校验；校验失败时不会启动该候选 DSH。

current Deployment 资产无法解析、Patch 校验失败或 DSH 启动失败时，Bootstrap 会在存在 previous 的情况下先临时选择 previous。previous 完成同样的 Patch 校验和健康检查、并激活其 receipts 后，才通过可恢复 journal 原子交换 slots；previous 也失败时不提交并进入 recovery mode。无法解析的 Record 和信任冲突不会触发自动降级。

镜像内含不可变的 Bootstrap 和 Deployment inventory。平台没有状态时，Seed 资产直接从镜像运行，不复制到数据卷。较新的已签名 Stable 镜像只有通过健康检查后才成为基线。target sequence 更高的 Managed Deployment 会继续作为 current，并报告镜像落后；旧镜像不会让它降级。相同 sequence 必须描述完全相同的内容，否则启动会拒绝冲突。Experimental DSH 领先 Stable 时会被保留，平台按更新状态机协调正式 Environment。

因此，拉取新镜像仍然有意义：其签名 target sequence 高于当前 Stable Deployment 时，容器会推进到新镜像基线；在线更新已经更高时，新镜像则作为经过验证的后备，不覆盖当前状态。

这套预发布布局不会迁移旧版 `/data/platform` 目录。Stage-0 检测到旧卷后会给出明确错误并拒绝启动。此时只清空 platform volume，绝不能因此删除 `/data/dsh`。

日常备份至少保留 `/data/dsh` 和 `/data/platform/state`。如需保留精确的本地回滚点，还要备份 `/data/platform/store`，尤其是 snapshots。最简单可靠的做法是完整备份这两个 Volume。`/data/platform/cache` 和 `/run/dsh-platform` 无需备份。

## Gateway

Gateway 校验外部 `Host`、`Origin` 和 Fetch Metadata，并按需使用 HTTP Basic 认证。固定的 `/_dsh_platform/ui/` 和受限管理 API 路由转发给 Management；其余 HTTP、SSE 和 WebSocket 请求使用 loopback `Host` 和 `Origin` 转发给 DSH。

官方 DSH 根据公开 hostname 判断浏览器是否为 loopback，并可能在非 loopback 页面禁用 Host 侧设置。一个精确匹配补丁会将 Gateway 已放行的浏览器标记为 loopback，与转发给上游的 authority 保持一致。上游服务端特权 API 实现不作修改。

### 密码访问

`DSH_PROXY_PASSWORD` 非空时，浏览器收到 HTTP Basic 认证请求。`DSH_PROXY_USERNAME` 为空时，Gateway 忽略提交的用户名，只校验密码；两者均设置时必须全部匹配。用户名不能包含 `:`。

凭据不会被裁剪、记录或持久化。Gateway 在请求进入 DSH 前删除 `Authorization`。浏览器可能在当前会话保留 Basic 凭据，且没有可靠的退出机制。远程访问必须使用 HTTPS，因为 Basic 凭据只是编码而非加密；TLS 终止仍由容器外部负责。

### 浏览器兼容

Gateway 默认向 HTML 注入经过特性检测的 `crypto.randomUUID` polyfill。它只在需要时运行，使用 `crypto.getRandomValues`，不会降级到 `Math.random`。客户端或后续 DSH 不再需要时，可设置 `DSH_PROXY_POLYFILL=false`。

修改后的 HTML 使用 `Cache-Control: no-cache`，并删除已失效的上游校验器；未修改资源保留上游缓存行为。

## 在线更新

`/data` 是容器内的数据命名空间。平台状态位于 `/data/platform`；DSH 设置、会话、凭据和第三方插件位于 `/data/dsh`。两个目录必须继续使用独立 Volume。

自动检查默认每六小时带抖动执行一次，可在任一平台管理前端中关闭或调整频率。检查不会自动下载或激活更新；可选的网页提醒只由自动检查产生，打开页面和手动检查只刷新结果，不弹提醒。Management 组件通过 `/_dsh_platform/ui/` 提供独立控制台；它优先使用已保存的 DSH 语言，提供相同的更新、运行维护、日志和系统插件操作，并且只在自己的页面内显示更新提醒。

“运行维护”和 `dsh-platform restart` 都只重新启动 `dsh-runtime`。Bootstrap、Gateway、Management 和容器保持运行，因此已经打开的平台管理界面会继续显示进度，并在 DSH 通过健康检查后刷新。重启与更新激活、完整回滚互斥。CLI 默认提交任务后立即返回；`--wait` 只跟踪本次任务直到结束。

独立控制台还列出当前 Environment 随附的 System Plugins。用户可以从当前 Deployment 的本地可信 Environment Artifact 重新安装其中一个插件，包括被禁用或卸载的 `platform-management` DSH 集成；平台会重建并校验完整 System Plugin Set，要求内容 Hash 与 Deployment Record 一致，然后只重启 DSH。这个操作不访问 GitHub 或 npm，也不从已构建 Runtime 复制文件。插件缺失不会自动触发重新安装。

平台和 DSH 的新日志也会以带 Source 的 JSON 实时写入容器 stdout 或 stderr，因此 `docker logs deepseek-harness` 可以查看完整运行流；容器启动时不会重放历史日志。`/data/platform/logs` 中按 Source 分离的 JSONL 仍是支持查询和轮转的权威日志存储。

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform channel experimental
docker exec deepseek-harness dsh-platform retry
docker exec deepseek-harness dsh-platform logs --source updater
docker exec deepseek-harness dsh-platform rollback
docker exec -it deepseek-harness dsh-platform return-stable
```

切换通道只修改本地 desired state。Stable 收敛到已签名的受支持 DSH 和 Environment；Experimental 先收敛正式 Environment，再提供经过验证的最新上游 DSH。当前 DSH 领先 Latest Supported 时，完整组合会冻结，直到 Stable 追上。

候选构建失败会创建版本 Hold；不兼容的 Runtime/Environment 组合会创建组合 Hold。`retry` 清除当前唯一的 Hold 或 Blocked 组合。

Experimental Runtime 接触真实数据前，Updater 停止 `dsh-runtime`，并为 `/data/dsh` 创建经过校验的 tar 快照。之后才切换 Runtime、执行健康检查并观察候选版本。失败或中断时，会在 DSH 重启前恢复 Runtime、Environment、System Plugin、receipt 和快照。

`rollback` 恢复保留的 previous 完整状态。交互式 `return-stable` 只在存在已验证的实验前恢复点时开放，并可能丢弃所显示快照时间之后写入的数据。

## 信任与恢复

Stage-0 只内置一个离线 Recovery Root 公钥。它先验证单调递增、由 Recovery 签署的 keyring，再只接受 keyring 中 current Release Key 签署的 `stable.json`。Updater 下载的 Bootstrap、Environment 等平台 Artifact 会保留在 `/data/platform/cache/downloads`，直到 Stage-0 按签名描述验证并导入 `/data/platform/store/objects`；Runtime 构建后续使用的每条路径都来自 receipt，不再读取未验证的下载文件。

Bootstrap 和 Updater 不能添加根公钥、修改 keyring、提交任意 expected hash 或自行签发 receipt；它们只消费 Stage-0 验证结果。

Stable 元数据委托精确的官方 npm Registry Origin、`@deepseek-ai/dsh` 包身份和允许的 Registry 签名公钥。Updater 可以读取 npm `latest` 选择 Experimental 版本，但 Stable 与 Experimental 最终都只向 `POST /v1/dsh/ensure` 提交所选版本。Stage-0 禁止重定向并独立获取该版本 metadata，验证 `name@version:integrity` 的 Registry 签名，推导规范 tarball URL，以受限、identity encoding 响应下载并重新计算 SHA-512，最后签发由可信对象库支撑的 `official-dsh` receipt。Updater 无法通过该接口提交包名、Registry、URL、integrity、expected hash、candidate 文档或 tarball 路径。

官方 DSH ledger 保持单调：同版本 repair 只允许完全相同的签名内容，低版本普通导入会被拒绝；回滚直接恢复保留的 previous Runtime、Environment、receipt 和数据快照，不重新下载旧包。Release Key 或 Registry policy 变化会使 staged receipt 失效，但不会破坏 active/previous 状态。

`dsh` 是动态 shim，始终执行 current 可信 Runtime。`dsh-platform trust status` 显示已接受的信任状态。`dsh-platform trust reset` 只能在控制台执行：停止 Stage-0，将 platform-data Volume 挂到以 `dsh-platform` 为 entrypoint 的一次性容器，通过交互式 TTY 运行 `trust reset` 并输入完整确认文本。该操作清除已接受状态，但不会替换镜像内 Recovery Root。

current 和 previous Deployment 都不可用时，Control Plane 会保持恢复模式。可以在 root 交互式容器控制台恢复当前镜像精确携带的 Deployment：

```bash
docker exec -it --user root deepseek-harness dsh-platform recover --image-baseline
```

命令会显示失效的 current 状态、镜像基线和数据兼容风险，并要求输入完整 image build ID 确认。Gateway 和 Web API 不提供此操作。恢复流程先健康检查镜像 Deployment，再提交 slots，且不会删除 `/data/dsh`；运维人员仍需判断现有 DSH 数据是否兼容该镜像基线。

日常 Release Key 轮换或泄露时，使用离线 Recovery 私钥签署 generation+1：将原 next 提升为 current、吊销旧 current，并加入新的 next。吊销集合只能累积。只有 Recovery Root 失陷或密码学迁移时，才需要新镜像或显式 trust reset。

Recovery 私钥绝不能进入 GitHub secrets。CI 只接收已签好的公开 keyring bundle 和受保护的 current Release 私钥。

## 安全模型

能通过 Gateway 访问，就等同于拥有完整 DSH 权限。被放行的用户可能读取或替换模型凭据、执行命令，并访问容器 `node` 用户可用的所有路径，而不只是 `/workspace`。Host allowlist 用于缓解 DNS rebinding，不是用户身份认证。

允许不可信网络访问前，应使用强 Gateway 密码、带认证的反向代理、VPN 或其他可信边界。显式绑定 loopback 后可以使用 SSH 隧道：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose 默认向 Agent 提供不受限制的免密码 root 权限。设置 `DSH_SUDO_ENABLED=false` 可将其关闭。除非明确需要这些权限，否则不要同时使用 sudo、特权模式、Docker Socket 或敏感宿主机目录挂载。

## 发布自动化

`DSH Upstream Update` 每日及手动运行。它比较 npm `latest` 与 [`release/supported-target.json`](../release/supported-target.json)，保持当前 Environment，并创建或更新用于晋升 Latest Supported 的候选 PR。候选 CI 验证 npm integrity、应用当前 Environment、运行两套项目测试，并执行标准版和 devtools 容器 smoke。相关 job 不拥有 Release 或 Recovery 凭据；Merge 始终是发布闸门。

`Publish Latest Supported DSH` 在 `main` 的 Supported Target 变更后运行，也可以通过已审批的手动任务触发。创建仅允许 `main` 的受保护 `production-release` GitHub Environment，并配置：

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

工作流接续 `targetSequence`，创建 draft，上传不可变 Bootstrap/Environment Artifact 和签名元数据，最后发布为 Latest。它会验证所选 npm tarball 并将 npm integrity 绑定到 Stable 元数据，但不会重新发布一份 DSH tarball；Stage-0 从官方 npm 导入。Recovery 私钥没有任何工作流输入。

`Publish Docker Image` 由独立的 `production-image` Environment 保护。它使用三个公开 trust bundle secret 和 `DOCKER_TOKEN`，不拥有 Release 私钥或 GitHub Release 写权限。仓库或组织 Secret `GOTIFY_URL`、`GOTIFY_TOKEN` 会显式传给可复用 Gotify 工作流。

## 构建与测试

构建标准镜像：

```bash
docker build -t deepseek-harness:local .
```

为本地开发构建指定官方包，或构建开发工具版：

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

任意本地 `DSH_VERSION` 都会生成 target sequence 为 0 的 development-authority inventory，不能成为正式版本标签或 `latest`。发布工作流只使用经过验证的签名 Release Artifact 构建已审核 Supported Target，拒绝带标记的非生产信任 fixture，并要求由离线 Recovery 签署的公开 trust bundle。

使用 Node.js 24 和 Docker Compose 运行本地检查：

```bash
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

Docker 可用时，`container/test/container-smoke.sh [image]` 检查受管理进程、信任、密码流程、常驻 Console 访问和 DSH 仅监听 loopback。`container/test/devtools-smoke.sh <image>` 检查开发工具版。

标准镜像包含 Node.js 24、`pnpm`、带 `venv` 的 Python 3、Git、OpenSSH、curl、jq、ripgrep 和可选 sudo。开发工具版还包含构建工具、Bash 补全、网络诊断、压缩与文件工具、Vim、`pkg-config` 和固定版本 uv。

开发工具版使用 uv，不预创建共享 Python 环境。可以使用 `uv run --with requests script.py`，项目可使用 `uv sync` 和 `uv run`。镜像有意不提供裸 `pip` 和 `pip3` 命令，同时保留 `python3 -m venv`。其他 Python 版本需要显式执行 `uv python install <version>`。
