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
| `DSH_HOME` | `/home/node/.dsh` | DSH 配置和数据目录 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器初始路径；必须是可访问的绝对目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用上游遥测；`true` 或 `false` |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的外部 `host` 或 `host:port` authority |
| `DSH_PROXY_USERNAME` | 空 | 可选 HTTP Basic 用户名；密码为空时忽略 |
| `DSH_PROXY_PASSWORD` | 空 | 可选 Gateway 密码；留空关闭认证 |
| `DSH_PROXY_POLYFILL` | `true` | 是否注入受保护的 `crypto.randomUUID` 兼容代码 |
| `DSH_UPDATE_CHECK_INTERVAL_SECONDS` | `21600` | 后台检查间隔；检查不会自动下载或激活 |
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
            │    ├─ management + Update Console  Unix socket
            │    └─ gateway                      0.0.0.0:3080
            └─ Environment
                 └─ dsh-runtime                  127.0.0.1:3079
```

Stage-0 负责信任验证、首次种入、Bootstrap A/B 选择、启动失败回滚和信号转发。Bootstrap 分别监督常驻 Control Plane 与可重载 Environment。因此，替换或暂停 DSH 不会停止 Gateway、Management 或 Update Console。

源码目录使用同一边界：

- `container/platform/`：Stage-0、Bootstrap、共享合约和发布工具。
- `container/control-plane/services/`：常驻 Gateway 和 Management 进程。
- `container/control-plane/hooks/`：受监督的一次性恢复任务。
- `container/control-plane/modules/`：更新、日志、补丁和 System Plugin 逻辑。
- `container/environment/`：完整 Container Environment 源码，包括工作负载和 `resources/{patches,system-plugins}`。

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

平台状态位于 `/data`；DSH 设置、会话、凭据和第三方插件仍位于 `/home/node/.dsh`。两个 Volume 都必须保留。

Management 每六小时带抖动检查一次，但不会自动下载或激活。DSH 设置入口打开常驻 Console `/_dsh_platform/ui/`；DSH 暂停、替换、健康检查或回滚时，该页面仍然可用。

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform channel experimental
docker exec deepseek-harness dsh-platform retry
docker exec deepseek-harness dsh-platform logs --source updater
docker exec deepseek-harness dsh-platform rollback
docker exec -it deepseek-harness dsh-platform return-stable
```

切换通道只修改本地 desired state。Stable 收敛到已签名的受支持 DSH 和 Environment；Experimental 先收敛正式 Environment，再提供经过验证的最新上游 DSH。当前 DSH 领先 Latest Supported 时，完整组合会冻结，直到 Stable 追上。

候选构建失败会创建版本 Hold；不兼容的 Runtime/Environment 组合会创建组合 Hold。`retry` 清除当前唯一的 Hold 或 Blocked 组合。

Experimental Runtime 接触真实数据前，Updater 停止 `dsh-runtime`，并为 `/home/node/.dsh` 创建经过校验的 tar 快照。之后才切换 Runtime、执行健康检查并观察候选版本。失败或中断时，会在 DSH 重启前恢复 Runtime、Environment、System Plugin、receipt 和快照。

`rollback` 恢复保留的 previous 完整状态。交互式 `return-stable` 只在存在已验证的实验前恢复点时开放，并可能丢弃所显示快照时间之后写入的数据。

## 信任与恢复

Stage-0 只内置一个离线 Recovery Root 公钥。它先验证单调递增、由 Recovery 签署的 keyring，再只接受 keyring 中 current Release Key 签署的 `stable.json`。下载内容保留在 `/data/downloads/untrusted`，直到 Stage-0 验证其授权关系并导入可信对象库。

Bootstrap 和 Updater 不能添加根公钥、修改 keyring、提交任意 expected hash 或自行签发 receipt；它们只消费 Stage-0 验证结果。

Stable 元数据会委托官方 npm Registry 地址、精确的 `@deepseek-ai/dsh` 包名和允许的 Registry 签名公钥。Experimental 模式直接查询 npm。Stage-0 验证 `name@version:integrity` 的 Registry 签名、规范 tarball URL、版本递增关系和下载 integrity 后，才签发 Experimental receipt。系统不存在逐版本 Experimental GitHub 发布。

`dsh` 是动态 shim，始终执行 current 可信 Runtime。`dsh-platform trust status` 显示已接受的信任状态。`dsh-platform trust reset` 只能在控制台执行：停止 Stage-0，将 platform-data Volume 挂到以 `dsh-platform` 为 entrypoint 的一次性容器，通过交互式 TTY 运行 `trust reset` 并输入完整确认文本。该操作清除已接受状态，但不会替换镜像内 Recovery Root。

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

工作流接续 `targetSequence`，创建 draft，上传全部不可变 Artifact，最后发布为 Latest。Recovery 私钥没有任何工作流输入。

`Publish Docker Image` 由独立的 `production-image` Environment 保护。它使用三个公开 trust bundle secret 和 `DOCKER_TOKEN`，不拥有 Release 私钥或 GitHub Release 写权限。仓库或组织 Secret `GOTIFY_URL`、`GOTIFY_TOKEN` 会显式传给可复用 Gotify 工作流。

## 构建与测试

构建标准镜像：

```bash
docker build -t deepseek-harness:local .
```

构建指定官方包或开发工具版：

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

本地构建使用带标记的非生产信任 fixture。发布工作流会拒绝该 marker，并要求由离线 Recovery 签署的公开 trust bundle。

使用 Node.js 24 和 Docker Compose 运行本地检查：

```bash
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

Docker 可用时，`container/test/container-smoke.sh [image]` 检查受管理进程、信任、密码流程、常驻 Console 访问和 DSH 仅监听 loopback。`container/test/devtools-smoke.sh <image>` 检查开发工具版。

标准镜像包含 Node.js 24、`pnpm`、带 `venv` 的 Python 3、Git、OpenSSH、curl、jq、ripgrep 和可选 sudo。开发工具版还包含构建工具、Bash 补全、网络诊断、压缩与文件工具、Vim、`pkg-config` 和固定版本 uv。

开发工具版使用 uv，不预创建共享 Python 环境。可以使用 `uv run --with requests script.py`，项目可使用 `uv sync` 和 `uv run`。镜像有意不提供裸 `pip` 和 `pip3` 命令，同时保留 `python3 -m venv`。其他 Python 版本需要显式执行 `uv python install <version>`。
