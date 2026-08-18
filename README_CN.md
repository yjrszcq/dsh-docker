# DSH-Docker

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像构建仓库。

镜像构建时安装官方 `@deepseek-ai/dsh` npm 包。本仓库维护的容器适配集中在 [`container/`](container/)：一个轻量 gateway、目录选择器初始路径和浏览器 loopback 判定的精确匹配补丁，以及对应的集成检查。镜像不修改上游服务端特权 API 代码。

> DeepSeek Harness 目前处于 Developer Preview，可能出现不兼容更新。本镜像不隶属于 DeepSeek AI。

## 快速开始

### 一键部署

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v "$(pwd)/data:/home/node/.dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

### Docker Compose

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
      - ./data:/home/node/.dsh
      - ./workspace:/workspace
```

### 使用说明

#### 准备目录

使用任一部署方式前，先创建 bind mount 目录：

```bash
mkdir -p data workspace
```

#### 启动 Compose

直接启动 Compose 部署：

```bash
docker compose up -d
```

需要自定义时，先复制示例环境文件，再重新创建容器：

```bash
cp .env.example .env
docker compose up -d --force-recreate
```

#### 访问与持久化

打开 <http://127.0.0.1:3080>。

- `./data` 保存 DSH 配置、凭据和会话。

- `./workspace` 挂载到 `/workspace`。

### 注意事项

#### 权限

容器以 `node` 用户（UID/GID `1000:1000`）运行。如果 bind mount 无法访问，请修正目录的所有权或权限，例如：

```bash
sudo chown -R 1000:1000 data workspace
```

一键部署时，删除 `--group-add dsh-sudo-true` 即可关闭免密码 sudo；使用 Compose 时设置 `DSH_SUDO_ENABLED=false`。

#### 远程访问

通过局域网地址或反向代理域名访问时，需要放行浏览器实际使用的 authority：

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=请设置一个强密码
```

`DSH_PROXY_PASSWORD` 始终允许留空；留空表示 gateway 不请求浏览器认证。

反向代理必须保留浏览器侧的 `Host` 请求头。TLS 证书和终止由镜像外部负责。

#### 端口暴露

短端口语法 `3080:3080` 通常会将端口发布到宿主机的所有网络接口。如需仅允许从 Docker 宿主机访问，请在 Compose 中使用 `127.0.0.1:3080:3080`：

```yaml
ports:
  - "127.0.0.1:3080:3080"
```

等价的 `docker run` 参数为 `-p 127.0.0.1:3080:3080`。需要进一步限制网络访问时，请配置外部防火墙。`DSH_TRUSTED_HOSTS` 只校验 HTTP authority，不能替代网络隔离或身份认证。

## 配置

### 仅供 Compose 插值的变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机端口发布地址 |
| `DSH_PORT` | `3080` | 宿主机发布端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载到 `/workspace` 的宿主机目录 |
| `DSH_SUDO_ENABLED` | `true` | 是否在容器内提供不受限制的免密码 `sudo`；仅接受 `true` 或 `false` |

### 容器环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `/home/node/.dsh` | DSH 配置和数据目录 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器初始路径；必须是已存在、可访问的绝对目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用上游遥测；仅接受 `true` 或 `false` |
| `DSH_TRUSTED_HOSTS` | 空 | 逗号分隔的外部 `host` 或 `host:port` authority |
| `DSH_PROXY_USERNAME` | 空 | 可选的 HTTP Basic 用户名；密码为空时忽略 |
| `DSH_PROXY_PASSWORD` | 空 | 可选的单一 gateway 密码；留空即禁用 gateway 密码认证 |
| `DSH_PROXY_POLYFILL` | `true` | 是否注入受保护的 `crypto.randomUUID` 兼容代码；仅接受 `true` 或 `false` |

`DSH_TRUSTED_HOSTS` 的语义如下：

- 留空：仅接受 loopback Host。
- 单值：接受 loopback 和该主机；不带端口时匹配任意端口。
- 逗号分隔多值：接受列表中的全部 authority。
- `*`：接受任意 Host。此配置关闭 Host allowlist，但仍保留 Origin、Fetch Metadata 和可选密码检查。

值中不能包含协议、路径、凭据或子域名通配符。例如 `dsh.example.com`、`dsh.example.com:8443`、`192.168.1.100` 和 `[fd00::1]:3080` 均合法。旧的单值变量 `DSH_TRUSTED_HOST` 暂时兼容；不要同时设置新旧变量。

### Workspace 行为

`DSH_DEFAULT_WORKSPACE` 只影响网页目录选择器未收到显式路径时显示的初始位置，它不是文件系统沙箱。用户仍可选择容器内 `node` 用户有权访问的其他路径。gateway 会在启动前验证该变量；值无效时以状态码 64 退出。

这是镜像对上游编译产物保留的精确匹配补丁之一。补丁必须精确匹配一次，因此遇到不兼容的上游版本时，镜像构建会明确失败，而不会静默修改错误位置。

### 浏览器 loopback 行为

官方 DSH 还会根据页面公开 hostname 判定浏览器是否为 loopback，并在非 loopback 页面禁用 Host 持久化设置。由于本镜像 gateway 放行的浏览器拥有完整 DSH 权限，第二处精确匹配的编译产物补丁会将该浏览器连接标记为 loopback，使前端行为与 gateway 转发给上游的 loopback `Host`/`Origin` 保持一致。服务端特权方法实现不作修改。

## Gateway 工作方式

```text
tini
  └─ gateway        0.0.0.0:3080
       └─ dsh web   127.0.0.1:3079
```

gateway 校验外部 `Host`、`Origin` 和 Fetch Metadata，按需验证单一密码，再将 HTTP、SSE 和 WebSocket 请求以 loopback `Host`/`Origin` 转发给 DSH。因此，任何被 gateway 放行的用户都能使用完整 DSH 功能，包括设置、凭据和宿主机操作接口。

## 密码访问

`DSH_PROXY_PASSWORD` 非空时，gateway 使用 HTTP Basic 认证，由浏览器显示原生认证对话框。`DSH_PROXY_USERNAME` 为空时，gateway 忽略浏览器提交的用户名，只验证密码；两者均非空时，用户名和密码都必须匹配。单独设置 `DSH_PROXY_USERNAME` 不会启用认证。失败尝试受到频率限制。

gateway 不会裁剪、记录或持久化用户名和密码，并会在请求进入 DSH 前删除 `Authorization` 请求头。HTTP Basic 使用 `:` 分隔字段，因此启用认证时用户名不能包含 `:`。浏览器可能在当前浏览会话中保留 Basic 凭据，且没有可靠的 gateway 退出操作。远程访问必须使用 HTTPS，因为 Basic 凭据只是编码而非加密。TLS 终止仍由镜像外部负责。

## 安全模型

能访问 gateway，就等同于拥有完整 DSH 权限。被放行的用户可能读取或替换模型凭据、执行命令，并读写容器 `node` 用户可访问的所有路径，而不只是 `/workspace`。Host allowlist 用于防御 DNS rebinding，不是用户身份认证。

快速开始示例使用 Docker 短端口语法，可能通过宿主机的所有网络接口访问。允许不可信网络访问前，应配置强 gateway 密码、带认证的反向代理、VPN 或其他可信访问边界。显式绑定 loopback 后可配合 SSH 隧道使用：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose 默认向 Agent 提供容器内不受限制的免密码 root 权限；设置 `DSH_SUDO_ENABLED=false` 可将其关闭。除非明确需要这些权限，否则不要将 sudo 与特权模式、Docker Socket 或敏感宿主机目录挂载同时使用。

## 浏览器兼容

gateway 默认向 HTML 响应注入经过特性检测的 `crypto.randomUUID` polyfill。它只在 `randomUUID` 不存在时运行，并只使用 `crypto.getRandomValues`，不会降级到 `Math.random`。如果所有客户端都已提供该 API，或后续 DSH 不再需要此兼容，可设置 `DSH_PROXY_POLYFILL=false`。

注入后的 HTML 使用 `Cache-Control: no-cache`，并删除已不能描述修改后响应体的上游缓存校验器。浏览器会重新验证入口文档，避免长期使用旧版本；未修改的静态资源继续沿用上游缓存策略。

## 构建与测试

```bash
docker build -t deepseek-harness:local .
```

构建指定的官方包版本：

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
```

使用 Node.js 24 和 Docker Compose 运行本地检查：

```bash
npm test --prefix container/gateway
node container/test/compose-config.mjs
```

有可用 Docker daemon 时，`container/test/container-smoke.sh [image]` 会构建或测试镜像，并检查受管理进程、Host/密码流程以及 DSH 仅监听 loopback。

运行时镜像基于 Node.js 24，并包含 `pnpm`、Git、OpenSSH、curl、jq、ripgrep 和可选 sudo 支持。
