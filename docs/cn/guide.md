# DSH-Docker 完整指南

[English](../en/guide.md) | 中文 | [快速开始](../../README_CN.md)

本文档在根目录 [README](../../README_CN.md) 的基础上，完整说明部署、运行维护、恢复、安全、发布和开发流程。

## 目录

- [部署](#部署)
- [配置参考](#配置参考)
- [平台架构](#平台架构)
- [Gateway](#gateway)
- [在线更新](#在线更新)
- [系统插件](#系统插件)
- [系统技能](#系统技能)
- [独立恢复工具](#独立恢复工具)
- [日志](#日志)
- [更新通道与回滚](#更新通道与回滚)
- [信任与恢复](#信任与恢复)
- [安全模型](#安全模型)
- [发布自动化](#发布自动化)
- [构建与测试](#构建与测试)

## 部署

### 镜像变体

| 变体 | Docker Hub 滚动标签 | Docker Hub DSH 版本标签 | 内容 |
| --- | --- | --- | --- |
| 标准版 | `latest` | `<version>` | DSH 和正常运行所需工具 |
| 开发工具版 | `latest-devtools` | `<version>-devtools` | 标准版加开发工具 |

普通部署应使用标准版；标准版已包含 DSH 原生插件依赖所需的最小编译工具链。开发工具版额外提供更完整的诊断、编辑和开发工具，但使用相同的持久化数据布局。

Docker Hub 同时发布两个变体。GHCR 仅作为标准镜像备份：`ghcr.io/yjrszcq/dsh-docker` 使用 Environment 标签 `latest`、`1.0.3`、`1.0`、`1`，并提供 DSH 定位标签 `dsh-0.1.1-rc.1`；GHCR 不发布任何 Devtools 标签。

### 使用前须知

- **目录权限：** bind mount 的 DSH 数据、平台数据和工作区目录必须允许 UID/GID `1000:1000` 写入。替换或升级容器时必须保留两个数据目录。
- **端口暴露：** `127.0.0.1:3080:3080` 只允许从 Docker 宿主机访问；`3080:3080` 或 `0.0.0.0:3080:3080` 会向宿主机所有网络接口开放 DSH。
- **远程访问：** 将 `DSH_TRUSTED_HOSTS` 设置为浏览器实际使用的 IP 地址或域名。建议设置强 `DSH_PROXY_PASSWORD`，同时应在容器外终止 HTTPS。
- **Agent Root 权限：** `dsh-sudo-true` 附加用户组会向 DSH 和 Agent 提供不受限制的免密码 Root 权限。不需要时应移除该用户组；使用仓库 Compose 时则设置 `DSH_SUDO_ENABLED=false`。
- **管理中心 Root 权限：** 关闭 Agent sudo 不会限制独立 DSH 管理中心。其容器终端和文件管理会按设计使用 Root 权限，必须放在认证和可信网络边界之后。
- **恢复入口：** `/_dsh_platform/console/` 在 DSH 停止或无法启动时仍可使用。配置 Gateway 密码时复用该密码，否则使用 `DSH_PLATFORM_PASSWORD`；两者均为空时进入临时密钥模式。

### 精简 Bind Mount Compose

创建直观且可从宿主机直接查看的持久化目录：

```bash
mkdir -p data/dsh data/platform workspace
```

创建 `docker-compose.yaml`：

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "127.0.0.1:3080:3080"
    group_add:
      - dsh-sudo-true
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

启动容器：

```bash
docker compose up -d
```

bind mount 无法写入时，应先修正宿主机目录所有权：

```bash
sudo chown -R 1000:1000 data workspace
```

### 等价 Docker Run

不使用 Compose 时，可以用以下命令启动相同的 bind mount 部署：

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

打开 <http://127.0.0.1:3080>。DSH 和 Agent 不需要 Root 权限时，删除 `--group-add dsh-sudo-true`。

### 仓库 Compose

仓库提供的 [`docker-compose.yaml`](../../docker-compose.yaml) 是面向生产配置的完整版本。它使用 `dsh-data` 和 `dsh-platform` named volumes 保存数据，将 `DSH_WORKSPACE` 指定的目录 bind mount 为工作区，并读取 [Compose 变量](#compose-变量)中列出的配置。可从环境变量模板开始：

```bash
cp .env.example .env
docker compose up -d
```

普通容器替换和 `docker compose down` 不会删除 named volumes，但这些数据不会像普通项目目录一样直接显示在仓库中，备份时必须通过 Docker 同时保存两个完整 Volume。`docker compose down -v` 会删除它们，也会因此删除持久化的 DSH 和平台数据。

## 配置参考

### Compose 变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | `szcq/deepseek-harness` 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机端口发布地址 |
| `DSH_PORT` | `3080` | 宿主机发布端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载到 `/workspace` 的宿主机目录 |
| `DSH_SUDO_ENABLED` | `true` | 是否提供不受限制的免密码 sudo；`true` 或 `false` |

以上值来自仓库中的 `.env.example`。Compose 使用 named volumes 保存 DSH 与平台数据，并将 `DSH_WORKSPACE` 挂载到 `/workspace`。

### 容器变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_PLATFORM_DATA` | `/data/platform` | 平台状态、受管理资产、快照和日志目录 |
| `DSH_HOME` | `/data/dsh` | DSH 配置和数据目录 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器和独立文件管理的默认目录；必须是可访问的绝对目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用上游遥测；`true` 或 `false` |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的外部 `host` 或 `host:port` authority |
| `DSH_PROXY_USERNAME` | 空 | 可选 HTTP Basic 用户名；密码为空时忽略 |
| `DSH_PROXY_PASSWORD` | 空 | 可选 Gateway 密码；留空关闭认证 |
| `DSH_PLATFORM_PASSWORD` | 空 | Gateway 密码关闭时使用的 DSH 管理中心密码；留空进入临时密钥模式 |
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

值中不能包含协议、路径、凭据或子域名通配符。合法示例包括 `dsh.example.com`、`dsh.example.com:8443`、`192.168.1.100` 和 `[fd00::1]:3080`。

### Workspace 行为

`DSH_DEFAULT_WORKSPACE` 会设置目录选择器和独立文件管理的初始目录，但不是文件系统沙箱。独立文件操作通过 root Maintenance Broker 执行；DSH 仍会在 Environment 组件启动时为自身的 `node` 进程验证工作区访问权限。

镜像通过精确匹配编译产物实现此行为。补丁必须恰好匹配一次，因此不兼容的上游版本会使构建失败，而不会修改错误位置。

## 平台架构

```text
Docker Image
│
├── System Runtime
├── Image Inventory 与 Seed
│   ├── Bootstrap Record
│   └── Deployment Record
├── tini
└── Stage-0
      │
      ├── Trust 与 receipt 校验
      ├── Image / Store Reference 解析
      │
      ▼
Bootstrap Runtime（current / previous）
│
├── Control Plane（常驻）
│   ├── Services
│   │   ├── gateway                      0.0.0.0:3080
│   │   └── management + DSH 管理中心     Unix socket
│   ├── Managers
│   │   ├── updater
│   │   ├── patch-manager
│   │   ├── plugin-manager
│   │   ├── skill-manager
│   │   ├── log-manager
│   │   └── file-manager
│   └── Recovery hooks
│
└── Container Environment（可重载）
    ├── Components
    │   └── dsh-runtime                  127.0.0.1:3079
    └── Resources
        ├── Patches
        └── System Plugins

已验证的 Pristine DSH
          +
完整 Environment
├── Component Manifest
├── 完整 Patch Set
└── 完整 System Plugin Set
          │
          ▼
完整 Deployment
├── Runtime DSH
├── Environment view
└── System Plugin overlay
          │
          ▼
原子 current / previous slots
```

Stage-0 负责信任验证、首次种入、Bootstrap A/B 选择、启动失败回滚和信号转发。初始不可变版本通过经过校验的 Image Reference 直接使用镜像内的只读 Seed；只有在线更新产物才会实体化到平台数据卷。Bootstrap 分别监督常驻 Control Plane 与可重载 Environment。因此，替换、暂停或重启 DSH 不会停止 Gateway、Management 或 DSH 管理中心。

源码目录使用同一边界：

- `container/platform/`：Stage-0、Bootstrap、共享合约和发布工具。
- `container/control-plane/services/`：常驻 Gateway 和 Management 进程。
- `container/control-plane/hooks/`：受监督的一次性恢复任务。
- `container/control-plane/modules/`：更新、日志、补丁、System Plugin 和 System Skill 逻辑。
- `container/environment/resources/skills/`：由 Environment 归属的 System Skill 清单与指引树，发布时映射进已签名 Bootstrap 包，由其执行可信运行管理。
- `container/environment/`：完整 Container Environment 源码，包括工作负载和 `resources/{patches,plugins,skills}`。

### 平台数据与 Runtime 解析

持久化状态、受管理资产和每次启动生成的运行视图采用不同目录：

```text
/data/platform/
├── state/{trust,bootstrap,deployments,updater,management}
├── store/{objects,bootstrap,environments,pristine,runtimes,system-plugins,snapshots}
├── cache/{downloads,npm}
└── logs

/run/dsh-platform/
├── stage0-trust.sock
├── bootstrap.sock
├── dsh-lifecycle.sock
├── management.sock
├── maintenance.sock
├── gateway-access.sock
├── recovery.sock
├── deployments/
├── system-plugin-views/
├── deployment
└── views/{bootstrap,environment,runtime,system-plugins,skills}
```

`state` 保存权威的选择、信任和事务状态。`store` 保存不可变的 Managed 资产与回滚材料；只有 slots、事务、Hold、receipt 和快照都不再引用时才会回收。`cache` 可以随时清理：`downloads` 保存不可信下载，`npm` 复用经过完整性校验的依赖下载以构建后续 Pristine DSH。`/run/dsh-platform` 在每次容器启动时重建，不应备份或挂载为持久数据。`/data/dsh` 始终是独立的用户数据卷。

Runtime、Environment 和 System Plugins 共同组成一个内容寻址的 Deployment Record。Bootstrap 将完整 Record 解析为一个 candidate view，启动并执行健康检查，然后原子提交 current/previous slots。重启后不会选中只切换了一部分的组合。

Patches 是强制 Deployment 内容，不属于用户选装项。每次 DSH 启动、恢复、reload 或单服务重启前，Bootstrap 都会核对当前 Environment 中 Patch Artifact 的 SHA-256 和大小，并执行 Patch 自带的结果校验；校验失败时不会启动该候选 DSH。

current Deployment 资产无法解析、Patch 校验失败或 DSH 启动失败时，Bootstrap 会在存在 previous 的情况下先临时选择 previous。previous 完成同样的 Patch 校验和健康检查、并激活其 receipts 后，才通过可恢复 journal 原子交换 slots；previous 也失败时不提交并进入 recovery mode。无法解析的 Record 和信任冲突不会触发自动降级。

镜像内含不可变的 Bootstrap 和 Deployment inventory。平台没有状态时，Seed 资产直接从镜像运行，不复制到数据卷。较新的已签名 Stable 镜像只有通过健康检查后才成为基线。target sequence 更高的 Managed Deployment 会继续作为 current，并报告镜像落后；旧镜像不会让它降级。相同 sequence 必须描述完全相同的内容，否则启动会拒绝冲突。Experimental DSH 领先 Stable 时会被保留，平台按更新状态机协调正式 Environment。

因此，拉取新镜像仍然有意义：其签名 target sequence 高于当前 Stable Deployment 时，容器会推进到新镜像基线；在线更新已经更高时，新镜像则作为经过验证的后备，不覆盖当前状态。

这套预发布布局不会迁移旧版 `/data/platform` 目录。Stage-0 检测到旧卷后会给出明确错误并拒绝启动。此时只清空 platform volume，绝不能因此删除 `/data/dsh`。

日常备份至少保留 `/data/dsh` 和 `/data/platform/state`；Compose 分别使用 `dsh-data` 和 `dsh-platform` named volume 保存它们。如需保留精确的本地回滚点，还要备份 `/data/platform/store`，尤其是 snapshots。最简单可靠的做法是完整备份这两个 Volume。`/data/platform/cache` 和 `/run/dsh-platform` 无需备份。

## Gateway

Gateway 校验外部 `Host`、`Origin` 和 Fetch Metadata，并按需使用 HTTP Basic 认证。固定的 `/_dsh_platform/console/` 和受限管理 API 路由转发给 Management；其余 HTTP、SSE 和 WebSocket 请求使用 loopback `Host` 和 `Origin` 转发给 DSH。转发到 DSH 前还会移除外部 `Forwarded`、`X-Forwarded-*` 和 `X-Real-IP`，因此 OpenResty 等外层代理不会被 DSH 内的同源插件误判为不可信代理；Management 路由仍保留这些转发信息。原始外部请求的安全检查不会因此绕过。

官方 DSH 根据公开 hostname 判断浏览器是否为 loopback，并可能在非 loopback 页面禁用 Host 侧设置。一个精确匹配补丁会将 Gateway 已放行的浏览器标记为 loopback，与转发给上游的 authority 保持一致。上游服务端特权 API 实现不作修改。

### 远程部署示例

远程发布必须同时配置外部监听地址和明确的可信 Host allowlist。示例还包含建议使用但并非必需的 Gateway 密码；使用前应替换其中的值：

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    group_add:
      - dsh-sudo-true
    environment:
      DSH_TRUSTED_HOSTS: "192.168.1.100,dsh.example.com"
      DSH_PROXY_PASSWORD: "请替换为强密码"
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

不使用 Compose 时，等价命令为：

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -e 'DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com' \
  -e 'DSH_PROXY_PASSWORD=请替换为强密码' \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

反向代理必须保留原始 `Host` 请求头，远程部署必须在容器外终止 TLS；只允许部分客户端连接时，还应通过宿主机防火墙限制来源。

两个示例都可以删除 `DSH_PROXY_PASSWORD`。此时独立管理中心改用 `DSH_PLATFORM_PASSWORD` 或临时密钥模式；Host、Origin 和 Fetch Metadata 校验仍然生效。

### 密码访问

`DSH_PROXY_PASSWORD` 非空时，浏览器收到 HTTP Basic 认证请求。`DSH_PROXY_USERNAME` 为空时，Gateway 忽略提交的用户名，只校验密码；两者均设置时必须全部匹配。用户名不能包含 `:`。

凭据不会被裁剪、记录或持久化。Gateway 在请求进入 DSH 前删除 `Authorization`。浏览器可能在当前会话保留 Basic 凭据，且没有可靠的退出机制。远程访问必须使用 HTTPS，因为 Basic 凭据只是编码而非加密；TLS 终止仍由容器外部负责。

`DSH_PROXY_PASSWORD` 为空时，独立管理中心的 `/_dsh_platform/console/*`、完整管理 API、SSE 和终端 WebSocket 改由独立的平台会话保护。设置 `DSH_PLATFORM_PASSWORD` 后可在登录页输入该密码。DSH 设置中的“平台管理”插件使用单独的受限 API，不要求管理中心会话；它只开放插件自身所需的更新、DSH 重启、日志、系统插件和系统技能操作，不开放容器终端、文件管理或用户插件恢复。能够访问 DSH 页面就意味着能够使用这些插件操作。

两个密码都为空时不会开放匿名访问，而是进入临时密钥模式。执行：

```bash
docker exec deepseek-harness dsh-platform access create
```

命令返回一个随机临时密钥和失效时间。密钥从生成起有效 10 分钟，期间可以用于登录；每次重新生成都会产生不同密钥并立即废止旧密钥。成功登录得到只作用于 `/_dsh_platform/` 的 HttpOnly、SameSite 会话 Cookie；会话空闲 30 分钟或持续 8 小时后失效，Gateway 或容器重启也会清除。临时密钥和会话都不会写入 `/data/platform` 或日志。

### 浏览器兼容

Gateway 默认向 HTML 注入经过特性检测的 `crypto.randomUUID` polyfill。它只在需要时运行，使用 `crypto.getRandomValues`，不会降级到 `Math.random`。客户端或后续 DSH 不再需要时，可设置 `DSH_PROXY_POLYFILL=false`。

修改后的 HTML 使用 `Cache-Control: no-cache`，并删除已失效的上游校验器；未修改资源保留上游缓存行为。

## 在线更新

### 检查与提醒

`/data` 是容器内的数据命名空间。平台状态位于 `/data/platform`；DSH 设置、会话、凭据和第三方插件位于 `/data/dsh`。两个目录必须继续使用独立 Volume。

自动检查默认每六小时带抖动执行一次，可在任一管理前端中关闭或调整频率。检查不会自动下载或激活更新。可选提醒只在 DSH 页面中显示，且只由自动检查触发；独立管理中心不显示更新弹窗。打开其中的“更新管理”标签会执行一次只读检查，打开页面和手动检查都只刷新已保存结果，不触发提醒。Management 组件通过 `/_dsh_platform/console/` 提供独立管理中心；它优先使用已保存的 DSH 语言，并提供相同的更新、运行维护、日志、系统插件和系统技能操作。

### DSH 生命周期与 Runtime 维护

独立管理中心和 `dsh-platform start|stop|restart` 只控制 `dsh-runtime`，Bootstrap、Gateway、Management 和容器保持运行。主动停止只持续到再次启动 DSH 或容器自身重启。生命周期操作与更新激活、回滚、Runtime 重置和插件事务互斥。

CLI 默认立即返回任务 ID。通过当前 DSH 会话操作的 Agent 必须使用异步 `dsh-platform restart`，不得使用 `restart --wait` 或 `stop --wait`，因为停止 DSH 也会中断本次工具传输。`--wait` 仍适用于 `docker exec`、独立管理中心终端和外部自动化。

Bootstrap 在每次启动 Web Profile 前签发一次性令牌，并通过仅存在于 `/run/dsh-platform/dsh-lifecycle.sock` 的内部 Broker 绑定当前受监督实例。手工命令或第三方 helper 再次执行 `dsh web` 时不能取得第二个实例：DSH 已停止时会提交正式启动任务；运行中、启动中、重启中、恢复中或平台事务占用生命周期时只报告当前状态并退出；failed/recovery mode 则明确引导到独立管理中心。令牌和 Session 不写入日志、持久状态或 Deployment Record。

当前受监督 DSH 收到平台未登记的第一次 `SIGTERM` 时，会先向 Broker 查询处置，再通过 Management 提交正式异步重启。浏览器因此进入“正在重新启动 DSH”页面，第三方提前创建的 detached 替代进程也无法绕过单实例门禁。Bootstrap 主动停止、重启、切换或关闭容器时，Broker 会要求 DSH 直接优雅退出，避免重复登记任务。第二次 `SIGTERM`、请求超时或 Control Plane 不可用时也会执行原有退出，由 Bootstrap 的有限恢复兜底；`process.exit()`、未捕获异常和 `SIGKILL` 仍按意外退出处理，不伪装成正常重启。

已登记操作在断开 DSH 前会让已打开的浏览器进入本地化等待页。页面区分启动中、停止中、已停止、重启中、意外退出恢复、Runtime 切换/恢复和启动失败，Ready 后返回原来的同源路径。短暂连接中断会先通过 Gateway readiness 确认，不会直接跳页；API 和 WebSocket 继续返回 `503`，未分类代理故障仍返回 `502`。

`dsh-runtime` 在没有平台操作登记时意外退出，Bootstrap 最多恢复三次，间隔依次为立即、2 秒和 5 秒。更新、回滚、重置或 probation 已持有生命周期时不会并行恢复。三次均失败后进入 recovery mode，Gateway 和独立管理中心继续可用。

独立控制台还提供“重置运行时”，用于修复意外损坏的 DSH 程序或补丁文件。平台从已验证的 Pristine DSH 和当前 Environment 的完整 Patch Set 重新构建 Runtime，确认重建内容仍与当前 Deployment Record 一致后，才暂停并重启 DSH。该操作不会改变 DSH 或 Environment 版本、更新通道、回滚 slots，也不会修改 `/data/dsh` 中的设置、会话、凭据和第三方插件。如果重建后的 Runtime 无法启动，平台会自动恢复原 Runtime 目录。

## 系统插件

Container Environment 当前包含：

| 插件 | 用途 |
| --- | --- |
| `@dsh-docker/platform-management` | 在 DSH 设置中增加“平台管理”，用于更新、运行维护、日志、系统插件和系统技能管理 |
| `@dsh-docker/settings-document-editor` | 将只能在桌面打开配置文件的操作替换为可选的浏览器 `settings.yaml` 编辑器 |

独立管理中心会列出当前 Environment 随附的全部 System Plugins，并允许安装、卸载、启用或禁用，包括恢复 `platform-management` DSH 集成。DSH 内的集成对缺失插件显示“安装”，对已安装插件只允许启用或禁用，不提供卸载。变更会标记为“待重启”，只有重启 DSH 后生效；重启前刷新页面会丢弃待应用草稿。安装会从当前 Deployment 的本地可信 Environment Artifact 重建完整 System Plugin Set，并校验其内容 Hash 与 Deployment Record 一致。该过程不访问 GitHub 或 npm，不从已构建 Runtime 复制文件，也不会自动重装缺失插件。

可选的“设置文档编辑器”System Plugin 会在容器环境中接管 DSH 的“打开配置文件”操作，改为显示响应式网页编辑器。它只能编辑当前的 `/data/dsh/settings.yaml`，采用原子保存，并在文件自页面载入后发生变化时拒绝覆盖。

## 系统技能

已签名 Bootstrap 内置 `dsh-docker-operations`，这是面向 Agent 的英文 DSH Docker 完整操作手册。精简的 `SKILL.md` 只负责触发和路由，并按任务读取身份与权限、工作区与开发工具、DSH 与扩展、生命周期与日志、更新与恢复、网络与认证、有序诊断等引用文件。手册要求 Agent 继续使用用户的语言回答，并优先使用 `dsh`、`dsh-platform`、它们当前的帮助以及管理界面，而不是从平台内部反推公共操作。日常操作中明确禁止搜索凭据、直接调用 socket、手工修改 Trust/Store/Runtime view，以及覆盖包管理器环境。

Bootstrap 只从当前已验证的本地包中发布已启用 Skill 到 `/run/dsh-platform/views/skills`，DSH 通过 `DSH_BUNDLED_SKILL_DIR` 发现这个固定根目录。System Skill 只使用 `id + SHA-256` 标识，没有独立发布版本。选择状态保存于 `/data/platform/state/deployments/skills.json`；“卸载”只移除运行选择，不删除已签名 Bootstrap 中的不变副本，因此可离线重新安装。管理接口不接受 URL、任意路径、上传内容或客户端 Hash。

独立管理中心始终列出当前 Bootstrap 提供的全部 System Skill，并支持安装、卸载、启用和禁用。DSH 内的“平台管理”可安装缺失技能，已安装时只允许启用或禁用，不提供卸载。所有变更都会原子更新稳定 Skill view，并由 DSH 原生文件系统 watcher 热加载，无需重启 DSH。容器重启后保留选择；新签名 Skill 默认安装并启用，新 Bootstrap 已移除的 Skill 会从状态中清理。项目或用户的同名 Skill 仍按 DSH 原生优先级覆盖内置副本；禁用 System Skill 不会修改这些覆盖。

`dsh-docker-operations` 可被模型自动发现，也可显式调用 `/dsh-docker-operations`。它用于操作已安装的容器环境，不用于开发 dsh-docker 平台本身。只有用户明确要求平台开发或实现调试时，才允许检查 `/opt/dsh-platform` 和 `/run/dsh-platform` 内部。

## 独立恢复工具

### 用户技能管理

独立管理中心的“用户技能”会读取 `DSH_HOME/skills` 和 `DSH_AGENTS_HOME/skills` 中 DSH 原生支持的目录 Skill 与单文件 Skill，不扫描或修改项目级 Skill。清单显示来源、原生条目名、解析出的技能名称与描述、启用状态和 metadata 错误；即使 metadata 已损坏，条目仍会显示，方便禁用或删除。

禁用会把指定条目原子移动到同一用户根目录的隐藏禁用目录，并完整保留内容；启用会恢复到原来的用户根，删除则只永久移除选中的条目。符号链接始终按链接本身处理，删除不会跟随目标。所有动作携带当前清单 revision，与其他受管修改互斥，并分别记录 started、completed 或 failed 审计。DSH 原生文件系统 watcher 会立即接收启禁变化，无需重启 DSH。DSH 内的“平台管理”集成不会提供用户技能控制。

### 用户插件恢复

`/_dsh_platform/console/` 中的“用户插件”和“容器终端”由 Management 提供，不依赖 DSH。即使 `dsh-runtime` 已停止，或在加载插件时启动失败，这两个标签页仍然可用。DSH 内的“平台管理”集成不会显示这两个恢复标签。

用户插件恢复只管理 `/data/dsh/profiles/web/package.json` 声明的 Bundle Plugin：包必须同时存在于 dependencies 和有序的 `dsh.profile.bundles` 中。普通依赖和用户手写的 `cordis.patch.yml` Entry 不会被改写。本地 metadata 损坏时仍会显示并允许卸载。System Plugin 身份来自已验证的 Environment 清单；与其同名的用户包不能启用，与包名前缀或 scope 无关。

启用、禁用和卸载会先积累为当前页面内的草稿。提交时，Management 会幂等暂停 DSH、为完整 Web Profile 创建快照、执行精确操作、校验结果，然后只重启 DSH。提交前刷新或离开页面会丢弃草稿；revision 冲突时会重新读取清单，不会覆盖并发修改。commit 前中断会恢复快照；commit 后即使 DSH 仍启动失败，也会保留本次插件修改，方便连续处理多个故障插件。此处不提供安装功能；请使用 DSH 正常插件流程或独立终端安装。

### 容器终端

“容器终端”由 Stage-0 内的受限 Maintenance Broker 以 root 身份启动真实的交互式 `/bin/bash`，初始目录取自 `DSH_DEFAULT_WORKSPACE`，并传入 `DSH_HOME`、PATH 和代理变量。`DSH_SUDO_ENABLED` 只控制 DSH/Agent 的 sudo 能力，不会降低此终端的管理员权限。只重启 DSH 不会终止终端。浏览器刷新或短暂断线后可在 30 秒内重连，并重绘最近最多 256 KiB 输出；显式关闭会话、停止 Stage-0 或停止容器都会终止终端。平台日志只记录会话生命周期，不记录终端输入、输出、命令历史或完整环境。

### 文件管理

独立 DSH 管理中心的“文件管理”同样不依赖 DSH，因此 DSH 停止、启动失败或处于恢复模式时仍可使用；DSH 内的“平台管理”插件不会显示此标签。初始目录取自 `DSH_DEFAULT_WORKSPACE`；快捷入口依次使用 `DSH_DEFAULT_WORKSPACE`、`DSH_HOME`、`DSH_PLATFORM_DATA` 和 `/`，重复路径会自动去除。文件操作通过 Maintenance Broker 以 root 身份执行，可计算目录大小，并可修改文件或目录的用户、用户组和八进制权限；目录属性可选择递归应用且不会跟随符号链接。它可修复普通 Management/DSH 用户无法写入的文件，但仍受只读挂载和平台托管路径互斥保护。Windows、SMB 等不支持 Unix metadata 的宿主机 bind mount 可能静默忽略 `chown`/`chmod`；平台会校验修改结果并报告失败，此时需改用支持 Unix metadata 的 Linux/WSL 路径或 named volume。

文件管理支持上传文件或完整文件夹，也可将文件拖入目录清单并上传到当前目录；下载文件时直接流式传输，下载目录时则临时打包为 ZIP。它还支持创建和解压 ZIP、7z、tar.gz。上传、下载、粘贴、压缩、解压和删除共用一个可见的 FIFO 任务队列；同一时刻只执行一个冲突操作，排队项和运行项都可在安全提交边界前取消。压缩工具无法提供可靠字节数的阶段显示不定进度，能够测量的传输阶段显示实际字节数，不会虚构百分比。刷新或关闭页面会中止浏览器持有的上传、下载流和尚未开始的上传，并清理 staging；持久化后台任务会在重新连接后再次显示。目录下载的临时 ZIP 在完成、失败或取消后删除。目录清单默认每页 100 项，可切换为 50 或 200 项，并限制在独立滚动区域内；默认名称排序只读取当前页的详细 metadata。

文件清单支持隐藏文件、排序、分页、当前目录筛选、用户:用户组显示和有上限的递归搜索；文件夹大小只有点击“计算”后才会作为可取消的只读任务计算，且不跟随符号链接。符号链接按链接本身列出、复制和删除，不递归跟随。普通 UTF-8 文本可在带行号的编辑器中修改，最大 2 MiB；保存会携带 revision，若终端、Agent 或其他页面已经修改文件则返回冲突，不会静默覆盖。上传与下载均为流式传输，下载支持 HTTP Range；多文件上传由当前浏览器标签逐文件排队，关闭页面后尚未开始的文件不会继续。

复制、移动和永久删除作为持久化后台任务执行。移动和删除在提交边界写入 journal，Management 重启后会完成可以证明安全的收尾；无法证明幂等的未提交任务标记为中断，并保留源文件。删除没有回收站，`/`、`/data`、`/data/dsh`、`/data/platform`、`/workspace` 和当前 Deployment view 根本身不能作为递归删除目标。平台托管路径可查看和修改，但界面会警告这些修改可能被更新、重启、Runtime 重建或 GC 覆盖，并可能破坏当前 Deployment。平台日志记录路径、操作、字节数、耗时和结果，但不记录文件内容。

两项能力复用 Gateway 现有的 Host、Origin、Fetch Metadata、Basic Auth 或独立管理中心会话校验，不增加监听端口。这是容器 root 级管理边界：能进入该页面的用户可读写容器数据并执行任意 Shell 命令，只应在[安全模型](#安全模型)所述的可信边界内开放。

## 日志

平台和 DSH 的新日志会以带 Source 的 JSON 实时写入容器 stdout 或 stderr，因此 `docker logs deepseek-harness` 可以查看完整运行流。两个管理界面支持按文本、Source 和级别筛选，可选择最近 100、250、500 或 1000 条处理后记录，并提供手动刷新、自动滚动开关和 JSONL 导出。每条日志默认显示简短摘要，展开后显示错误堆栈、Cause、任务 ID 和其他完整诊断字段。“清空显示”只影响当前浏览器视图，不删除日志文件。容器启动时不会向 stdout 重放历史日志。`/data/platform/logs` 中按 Source 分离的 JSONL 是权威日志存储，默认按总量 100 MiB、保留 14 天自动轮转。

## 更新通道与回滚

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform stop --wait
docker exec deepseek-harness dsh-platform start --wait
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

Stage-0 只内置一个离线 Recovery Root 公钥。它从只追加公开产物的 `release-channel` 分支读取机器更新通道，先验证单调递增、由 Recovery 签署的 keyring，再只接受 keyring 中 current Release Key 签署的 `stable.json`。不可变目标位于 `targets/<targetSequence>/`，分支根目录只暴露当前签名 keyring 和 Stable 指针。Updater 下载的 Bootstrap、Environment 等平台 Artifact 会保留在 `/data/platform/cache/downloads`，直到 Stage-0 按签名描述验证并导入 `/data/platform/store/objects`；Runtime 构建后续使用的每条路径都来自 receipt，不再读取未验证的下载文件。

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

能通过 Gateway 访问 DSH，就等同于拥有完整 DSH 权限；通过独立管理中心认证后，容器终端和文件管理还拥有 root 权限。被放行的用户可能读取或替换模型凭据、执行命令并访问容器内的任意可写路径。Host allowlist 用于缓解 DNS rebinding，不是用户身份认证。

允许不可信网络访问前，应使用强 Gateway 密码、带认证的反向代理、VPN 或其他可信边界。显式绑定 loopback 后可以使用 SSH 隧道：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose 默认向 Agent 提供不受限制的免密码 root 权限。设置 `DSH_SUDO_ENABLED=false` 可将其关闭。除非明确需要这些权限，否则不要同时使用 sudo、特权模式、Docker Socket 或敏感宿主机目录挂载。

## 发布自动化

`DSH Upstream Update` 每 6 小时整点及手动运行。它比较 npm `latest` 与 [`release/supported-target.json`](../../release/supported-target.json)，保持当前 Environment，并创建或更新用于晋升 Latest Supported 的候选 PR。发现新上游版本并创建候选 PR 后会通知一次；完整兼容性验证结束后再通知最终通过或失败结果。候选 CI 验证 npm integrity、应用当前 Environment、运行两套项目测试，并执行标准版和 devtools 容器 smoke。相关 job 不拥有 Release 或 Recovery 凭据；Merge 始终是发布闸门。其他 PR 独立触发的候选验证无论成功或失败，都由一个不检出、不执行候选代码的 `workflow_run` 发送 Gotify 通知，避免向 PR 暴露 Secret。独立通知明确排除自动候选分支，因此不会重复报告同一验证结果；没有新版本时不通知。

`Publish Supported Platform Target` 会在 `main` 的 Supported Target、Environment definition 或官方 DSH Registry policy 变化后运行，也支持经过审批的手动触发。创建仅允许 `main` 的受保护 `production-release` GitHub Environment，并配置：

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

工作流从首个正式 `targetSequence: 1` 开始，将后续签名目标依次追加到 `release-channel` 分支。它会验证所选 npm tarball 并将 npm integrity 绑定到 Stable 元数据，但不会重新发布一份 DSH tarball；Stage-0 从官方 npm 导入。同一源码提交和 keyring 的失败任务重试会复用已经发布的目标，不会额外消耗序列。Recovery 私钥没有任何工作流输入。

GitHub Release 只表示 Container Environment。新 Environment 发布 `v<environment-version>`（例如 `v1.0.0`）并标记为 Latest；仅 DSH 更新时只推进签名通道和重建镜像，不创建 GitHub Release。打包后的 Environment、Bootstrap 或 [`release/official-dsh-policy.json`](../../release/official-dsh-policy.json) 发生变化时必须提升 Environment 版本；Environment 内容指纹会拒绝让同一版本绑定不同内容。

每个 Environment Release 只上传 `environment-release.json` 一个自定义附件，用于防止同一版本绑定不同的 Environment 内容。在线更新从不可变 `release-channel` 获取 Manifest 和 Artifact，并由 Stage-0 逐项验证，完全不依赖 GitHub Release 附件。加上 GitHub 自动生成的两个源码包，Release 页面通常显示三个 Assets。

`Publish Container Images` 是独立的 Actions 运行：它在 `Publish Supported Platform Target` 成功结束后自动触发，并由独立的 `production-image` Environment 保护，因此 Release 工作流本身不会访问镜像环境。将 `DSH_RECOVERY_ROOT_PUBLIC_KEY` 放入该 Environment，将 `DOCKER_TOKEN` 放入仓库或组织 Actions Secrets。镜像任务不拥有 Release 私钥；它根据上游运行的源码 commit，在只追加的 `release-channel` 历史中解析并消费精确匹配的不可变 channel commit。工作流需要 `packages: write`，并使用 `GITHUB_TOKEN` 登录 GHCR。

标准多架构镜像只构建一次并同时推送两个 Registry。Docker Hub 获得 `<dsh-version>` 和 `latest`；单独测试的 Devtools 镜像获得 `<dsh-version>-devtools` 和 `latest-devtools`。GHCR 仅获得标准镜像的 `latest`、Environment 完整/次要/主要版本标签和 `dsh-<dsh-version>`。仅 DSH 更新会移动当前 Environment 标签，但不发布 GitHub Release；仅 Environment 更新会用新 digest 覆盖 Docker Hub 现有 DSH 标签，并在 GHCR 发布新的 Environment 标签层级。

仓库或组织 Secret `GOTIFY_URL`、`GOTIFY_TOKEN` 会显式传给可复用 Gotify 工作流。统一的结果通知工作流只负责正式目标发布和人工候选 PR 验证的最终成功或失败；每个事件只命中一个通知作业。签名目标和必要的 Environment Release 发布成功后，它会通知镜像工作流已启动、可能正在等待 `production-image` 审批；通知服务不会影响正式发布结果或阻塞镜像触发。镜像工作流也只发送一条最终结果通知：两种镜像均发布并验证后通知成功，任一步骤失败则发送带 Actions 链接的失败通知。

## 构建与测试

构建标准镜像：

```bash
docker build -t deepseek-harness:local .
```

为本地开发构建指定官方包，或构建开发工具版：

```bash
DSH_VERSION="$(jq -r .latestSupportedDsh release/supported-target.json)"
docker build --build-arg "DSH_VERSION=$DSH_VERSION" -t "deepseek-harness:$DSH_VERSION" .
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

任意本地 `DSH_VERSION` 都会生成 target sequence 为 0 的 development-authority inventory，不能成为正式版本标签或 `latest`。生产工作流只使用经过验证的签名 channel target 构建已审核 Supported Target，拒绝带标记的非生产信任 fixture，并要求由离线 Recovery 签署的公开 trust bundle。

使用 Node.js 24 和 Docker Compose 运行本地检查：

```bash
npm ci --omit=dev --ignore-scripts --prefix container/control-plane/services/management
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

Docker 可用时，`container/test/container-smoke.sh [image]` 检查受管理进程、信任、密码流程、常驻 Console 访问和 DSH 仅监听 loopback。`container/test/devtools-smoke.sh <image>` 检查开发工具版。

标准镜像包含 Node.js 24、`pnpm`、带 `venv` 的 Python 3、Git、OpenSSH、curl、jq、ripgrep、可选 sudo，以及构建 DSH 原生插件依赖所需的最小 `make`/C++ 工具链。开发工具版还包含更完整的开发头文件和工具、Bash 补全、网络诊断、压缩与文件工具、Vim、`pkg-config` 和固定版本 uv。

开发工具版使用 uv，不预创建共享 Python 环境。可以使用 `uv run --with requests script.py`，项目可使用 `uv sync` 和 `uv run`。镜像有意不提供裸 `pip` 和 `pip3` 命令，同时保留 `python3 -m venv`。其他 Python 版本需要显式执行 `uv python install <version>`。
