# **DSH-Docker**

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像构建仓库。

镜像构建时安装官方 `@deepseek-ai/dsh` npm 包。本仓库维护的容器适配集中在 [`container/`](container/)：一个轻量 gateway、目录选择器初始路径和浏览器 loopback 判定的精确匹配补丁，以及对应的集成检查。镜像不修改上游服务端特权 API 代码。

> DeepSeek Harness 目前处于 Developer Preview，可能出现不兼容更新。本镜像不隶属于 DeepSeek AI。

同一 DSH 版本和容器适配会发布两种镜像：

| 变体 | 滚动标签 | 固定版本标签 | 内容 |
| --- | --- | --- | --- |
| 标准版 | `latest` | `<version>` | DSH 和正常使用所需的运行工具 |
| 开发工具版 | `latest-devtools` | `<version>-devtools` | 标准版加通用开发工具集 |

## **快速开始**

### **一键部署**

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v dsh-platform-data:/data \
  -v "$(pwd)/data:/home/node/.dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

### **Docker Compose**

精简版 `docker-compose.yaml`：

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    group_add:
      - "dsh-sudo-${DSH_SUDO_ENABLED:-true}"
    environment:
      DSH_PROXY_PASSWORD: "${DSH_PROXY_PASSWORD:-}"
      DSH_TRUSTED_HOSTS: "${DSH_TRUSTED_HOSTS:-}"
    volumes:
      - dsh-platform-data:/data
      - ./data:/home/node/.dsh
      - ./workspace:/workspace

volumes:
  dsh-platform-data:
```

### **使用说明**

使用任一部署方式前，先创建 bind mount 目录：

```bash
mkdir -p data workspace
```

执行 `docker compose up -d` 启动 Compose；如需自定义，请提前复制示例环境文件：

```bash
cp .env.example .env
```

打开 <http://127.0.0.1:3080>。DSH 数据保存在 `./data`，`./workspace` 挂载到 `/workspace`。

### **注意事项**

#### **权限说明**

Stage-0 以 root 运行，Bootstrap 和 Environment 组件以 `node` 用户（UID/GID `1000:1000`）运行。如果 bind mount 无法访问，请修正目录的所有权或权限，例如：

```bash
sudo chown -R 1000:1000 data workspace
```

一键部署时，删除 `--group-add dsh-sudo-true` 即可关闭免密码 sudo；使用 Compose 时设置 `DSH_SUDO_ENABLED=false`。

#### **远程访问**

通过局域网地址或反向代理域名访问时，需要放行浏览器实际使用的 authority：

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=请设置一个强密码
```

`DSH_PROXY_PASSWORD` 始终允许留空；留空表示 gateway 不请求浏览器认证。

反向代理必须保留浏览器侧的 `Host` 请求头。TLS 证书和终止由镜像外部负责。

#### **端口暴露**

短端口语法 `3080:3080` 通常会将端口发布到宿主机的所有网络接口。如需仅允许从 Docker 宿主机访问，请在 Compose 中使用 `127.0.0.1:3080:3080`：

```yaml
ports:
  - "127.0.0.1:3080:3080"
```

等价的 `docker run` 参数为 `-p 127.0.0.1:3080:3080`。需要进一步限制网络访问时，请配置外部防火墙。`DSH_TRUSTED_HOSTS` 只校验 HTTP authority，不能替代网络隔离或身份认证。

## **配置**

### **仅供 Compose 插值的变量**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机端口发布地址 |
| `DSH_PORT` | `3080` | 宿主机发布端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载到 `/workspace` 的宿主机目录 |
| `DSH_SUDO_ENABLED` | `true` | 是否在容器内提供不受限制的免密码 `sudo`；仅接受 `true` 或 `false` |

### **容器环境变量**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `/home/node/.dsh` | DSH 配置和数据目录 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器初始路径；必须是已存在、可访问的绝对目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用上游遥测；仅接受 `true` 或 `false` |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的外部 `host` 或 `host:port` authority |
| `DSH_PROXY_USERNAME` | 空 | 可选的 HTTP Basic 用户名；密码为空时忽略 |
| `DSH_PROXY_PASSWORD` | 空 | 可选的单一 gateway 密码；留空即禁用 gateway 密码认证 |
| `DSH_PROXY_POLYFILL` | `true` | 是否注入受保护的 `crypto.randomUUID` 兼容代码；仅接受 `true` 或 `false` |
| `DSH_UPDATE_METADATA_URL` | 项目 Release 地址 | 签名更新元数据根地址 |
| `DSH_UPDATE_CHECK_INTERVAL_SECONDS` | `21600` | 后台检查间隔；检查不会自动下载或激活 |
| `DSH_LOG_MAX_BYTES` | `104857600` | 平台 JSONL 日志总量上限 |
| `DSH_LOG_RETENTION_DAYS` | `14` | 平台日志保留天数 |
| `DSH_ACTIVATION_TIMEOUT_SECONDS` | `60` | 更新激活健康检查期限 |
| `DSH_EXPERIMENTAL_PROBATION_SECONDS` | `120` | Experimental Runtime 提交前的观察期 |

`DSH_TRUSTED_HOSTS` 的语义如下：

- 留空：仅接受 loopback Host。
- 单值：接受 loopback 和该主机；不带端口时匹配任意端口。
- 逗号分隔多值：接受列表中的全部 authority。
- `*`：接受任意 Host。此配置关闭 Host allowlist，但仍保留 Origin、Fetch Metadata 和可选密码检查。

值中不能包含协议、路径、凭据或子域名通配符。例如 `dsh.example.com`、`dsh.example.com:8443`、`192.168.1.100` 和 `[fd00::1]:3080` 均合法。旧的单值变量 `DSH_TRUSTED_HOST` 暂时兼容；不要同时设置新旧变量。

### **Workspace 行为**

`DSH_DEFAULT_WORKSPACE` 只影响网页目录选择器未收到显式路径时显示的初始位置，它不是文件系统沙箱。用户仍可选择容器内 `node` 用户有权访问的其他路径。DSH 在 Environment 组件启动时验证访问权限。

这是镜像对上游编译产物保留的精确匹配补丁之一。补丁必须精确匹配一次，因此遇到不兼容的上游版本时，镜像构建会明确失败，而不会静默修改错误位置。

### **浏览器 loopback 行为**

官方 DSH 还会根据页面公开 hostname 判定浏览器是否为 loopback，并在非 loopback 页面禁用 Host 持久化设置。由于本镜像 gateway 放行的浏览器拥有完整 DSH 权限，第二处精确匹配的编译产物补丁会将该浏览器连接标记为 loopback，使前端行为与 gateway 转发给上游的 loopback `Host`/`Origin` 保持一致。服务端特权方法实现不作修改。

## **Gateway 工作方式**

```text
tini
  └─ Stage-0
       └─ Bootstrap
            ├─ dsh web       127.0.0.1:3079
            ├─ 平台管理服务   Unix socket
            └─ gateway       0.0.0.0:3080
```

gateway 校验外部 `Host`、`Origin` 和 Fetch Metadata，按需验证单一密码，再将 HTTP、SSE 和 WebSocket 请求以 loopback `Host`/`Origin` 转发给 DSH。因此，任何被 gateway 放行的用户都能使用完整 DSH 功能，包括设置、凭据和宿主机操作接口。

## **在线更新与信任体系**

平台状态保存在 `/data`；DSH 设置、会话和第三方插件仍保存在 `/home/node/.dsh`。两个 Volume 都必须保留。旧 Compose 部署执行下一次 `docker compose up -d` 时会新增平台 Volume，原 DSH Volume 原位复用。

Stage-0 只内置一个离线 Recovery Root 公钥。它先验证单调递增、由 Recovery 签署的 keyring，再只接受 keyring 中 current Release Key 签署的 `stable.json`。下载内容先进入 `/data/downloads/untrusted`；Stage-0 验证其授权关系后才导入可信对象库。Bootstrap 和 Updater 没有添加根公钥、修改 keyring、提交任意 expected hash 或自行签发 receipt 的接口。

Stable 元数据还会委托官方 npm Registry 地址、精确的 `@deepseek-ai/dsh` 包名和允许的 npm Registry 签名公钥。选择 Experimental 后，由当前 dsh-docker 实例直接查询 npm。Stage-0 验证 `name@version:integrity` 的 Registry 签名、规范 tarball URL、版本递增关系和下载内容的 SHA-512，再签发 Experimental receipt。系统不会为每个实验版本运行 GitHub 发布工作流，也不存在 `experimental.json` 发布通道。

系统每六小时带抖动检查一次，但不会自动下载或激活。可以使用设置中的“平台更新”页，或执行：

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

切换通道只修改本地 desired state，本身不会下载或激活。Stable 收敛到已签名的 Supported DSH 和 Environment；Experimental 会先收敛正式 Environment，再提供 Stage-0 已验证的最新上游 DSH。当前 DSH 领先 Latest Supported 时，完整 Runtime/Environment 组合会冻结，直到 Stable 追上。候选构建失败会生成版本 Hold，Runtime/Environment 组合失败会生成组合 Hold；`retry` 用于清除当前唯一的 Hold 或 Blocked 组合。

Experimental Runtime 接触真实数据前，Updater 会停止 `dsh-runtime`，并为完整 `/home/node/.dsh` 创建经过校验的 tar 快照。随后才切换 Runtime、执行健康检查并进入观察期。失败或事务中断时，会在 DSH 重启前恢复 Runtime、Environment、System Plugin、receipt 和数据快照。`rollback` 恢复保留的 previous 完整状态。`return-stable` 只能交互执行，且仅在存在已验证的实验前恢复点时开放；确认界面会显示快照时间，并明确提示该时间之后的数据会丢失。

`dsh` 是动态 shim，始终执行 current 可信 Runtime。`dsh-platform trust status` 显示已接受的 generation。`dsh-platform trust reset` 只能在容器控制台使用：先停止服务，将其 platform-data Volume 挂到一个以 `dsh-platform` 为 entrypoint 的一次性容器，以交互式 TTY 执行 `trust reset` 并输入完整确认文本。该操作清除已接受的信任状态，但不会修改镜像内 Recovery Root。

日常轮换或 Release Key 泄露时，使用离线 Recovery Key 签署 generation+1：将原 next 提升为 current、吊销旧 current，并放入新的 next。吊销集合只能累积。只有 Recovery Root 本身失陷或密码学算法迁移时，才需要换镜像或显式 trust reset。Recovery 私钥绝不能进入 GitHub secrets；CI 只接收已签好的公开 keyring bundle 和受保护的 current Release 私钥。

## **发布自动化**

`DSH Upstream Update` 每日及手动检查 npm `latest`，与 [`release/supported-target.json`](release/supported-target.json) 比较，在保持当前 Environment 不变的前提下创建或更新一个用于晋升 Latest Supported 的候选 PR；它不是 Experimental 客户端更新链路。候选 CI 会验证 npm integrity，在镜像构建中应用当前 Environment，运行两套项目测试，并执行标准版与 devtools 容器 smoke。相关 job 不拥有 Docker、Release 或 Recovery 凭据；人工 Merge 始终是发布闸门。

`Publish Latest Supported DSH` 只在 `main` 的 Supported Target 变更后运行，也可通过明确审批的手动任务触发。需要创建一个仅允许 `main` 部署的受保护 GitHub Environment：`production-release`，并配置：

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

该工作流从当前 Latest Release 接续 `targetSequence`，先创建 draft 并上传全部不可变 Artifact，全部完成后才将其发布为 Latest。Recovery 私钥没有任何工作流输入，始终离线保存。

`Publish Docker Image` 是独立的手动工作流，由仅允许 `main` 的 `production-image` Environment 保护。它使用上述三个公开 trust bundle secret 和 `DOCKER_TOKEN`，不拥有 Release 私钥或 GitHub Release 写权限；默认 `supported` 输入构建已审核的 DSH 版本。仓库或组织 Secret `GOTIFY_URL`、`GOTIFY_TOKEN` 会显式传给 `yjrszcq/github-workflows/.github/workflows/gotify-notify.yml@v1` 发送通知。

## **密码访问**

`DSH_PROXY_PASSWORD` 非空时，gateway 使用 HTTP Basic 认证，由浏览器显示原生认证对话框。`DSH_PROXY_USERNAME` 为空时，gateway 忽略浏览器提交的用户名，只验证密码；两者均非空时，用户名和密码都必须匹配。单独设置 `DSH_PROXY_USERNAME` 不会启用认证。失败尝试受到频率限制。

gateway 不会裁剪、记录或持久化用户名和密码，并会在请求进入 DSH 前删除 `Authorization` 请求头。HTTP Basic 使用 `:` 分隔字段，因此启用认证时用户名不能包含 `:`。浏览器可能在当前浏览会话中保留 Basic 凭据，且没有可靠的 gateway 退出操作。远程访问必须使用 HTTPS，因为 Basic 凭据只是编码而非加密。TLS 终止仍由镜像外部负责。

## **安全模型**

能访问 gateway，就等同于拥有完整 DSH 权限。被放行的用户可能读取或替换模型凭据、执行命令，并读写容器 `node` 用户可访问的所有路径，而不只是 `/workspace`。Host allowlist 用于防御 DNS rebinding，不是用户身份认证。

快速开始示例使用 Docker 短端口语法，可能通过宿主机的所有网络接口访问。允许不可信网络访问前，应配置强 gateway 密码、带认证的反向代理、VPN 或其他可信访问边界。显式绑定 loopback 后可配合 SSH 隧道使用：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose 默认向 Agent 提供容器内不受限制的免密码 root 权限；设置 `DSH_SUDO_ENABLED=false` 可将其关闭。除非明确需要这些权限，否则不要将 sudo 与特权模式、Docker Socket 或敏感宿主机目录挂载同时使用。

## **浏览器兼容**

gateway 默认向 HTML 响应注入经过特性检测的 `crypto.randomUUID` polyfill。它只在 `randomUUID` 不存在时运行，并只使用 `crypto.getRandomValues`，不会降级到 `Math.random`。如果所有客户端都已提供该 API，或后续 DSH 不再需要此兼容，可设置 `DSH_PROXY_POLYFILL=false`。

注入后的 HTML 使用 `Cache-Control: no-cache`，并删除已不能描述修改后响应体的上游缓存校验器。浏览器会重新验证入口文档，避免长期使用旧版本；未修改的静态资源继续沿用上游缓存策略。

## **构建与测试**

```bash
docker build -t deepseek-harness:local .
```

本地构建使用带明确标记的非生产信任 fixture。发布工作流会拒绝该 marker；只有通过受保护 secrets 注入离线 Recovery 签署的公开 trust bundle 后才允许推送镜像。

构建指定的官方包版本：

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
```

构建开发工具版：

```bash
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

使用 Node.js 24 和 Docker Compose 运行本地检查：

```bash
npm test --prefix container/components/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

有可用 Docker daemon 时，`container/test/container-smoke.sh [image]` 会构建或测试镜像，并检查受管理进程、Host/密码流程以及 DSH 仅监听 loopback。`container/test/devtools-smoke.sh <image>` 用于检查开发工具版。

标准运行时镜像基于 Node.js 24，并包含带 `venv` 的 Python 3、`pnpm`、Git、OpenSSH、curl、jq、ripgrep 和可选 sudo 支持。开发工具版还包含 Bash 补全、`build-essential`、DNS 与网络诊断工具、压缩与文件工具、Vim 等交互式终端工具、`pkg-config`，以及固定版本的 uv。

开发工具版使用 uv，不再预创建共享 Python 环境。一次性脚本可使用 `uv run --with requests script.py`，项目可使用 `uv sync` 和 `uv run`。镜像有意不提供裸 `pip`、`pip3` 命令，同时保留 `python3 -m venv` 以兼容传统用法。uv 不会自动下载 Python；如需其他版本，可显式执行 `uv python install <version>`。
