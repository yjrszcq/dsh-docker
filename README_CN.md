# DSH-Docker

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像。镜像安装官方 `@deepseek-ai/dsh` 包，并提供持久化更新、回滚、Gateway 访问控制和可选开发工具。

> DeepSeek Harness 目前处于 Developer Preview，可能出现不兼容更新。本项目不隶属于 DeepSeek AI。

## 使用前须知

- **目录权限：** bind mount 的 `data/dsh`、`data/platform` 和 `workspace` 必须允许容器 UID/GID `1000:1000` 写入。替换或升级容器时必须保留两个数据目录。
- **端口暴露：** 快速开始默认绑定 `127.0.0.1:3080`，只能从 Docker 宿主机访问。改成 `3080:3080` 或 `0.0.0.0:3080:3080` 会向宿主机所有网络接口开放服务。
- **远程访问：** 允许局域网或互联网访问前，必须将 `DSH_TRUSTED_HOSTS` 设置为浏览器实际使用的 IP 地址或域名，初始化本地管理员账户，并通过 HTTPS 或其他可信网络边界提供服务；不要向容器暴露 Docker Socket、特权模式或敏感宿主机资源。
- **Root 权限：** `group_add: dsh-sudo-true` 会向 DSH 和 Agent 提供不受限制的免密码 Root 权限。如果不需要这项权限，请从精简 Compose 中删除该 `group_add`（使用 `docker run` 时则不要添加 `--group-add dsh-sudo-true`）；使用仓库 Compose 时可设置 `DSH_SUDO_ENABLED=false`。这个设置不会关闭独立管理中心的 Root 终端和文件管理，因此仍必须通过认证和可信网络边界保护管理中心。
- **DSH 管理中心：** `/_dsh_platform/console/` 在 DSH 停止或启动失败时仍可使用，提供更新与恢复、出站代理设置、实时日志、内置系统插件和系统技能管理、用户插件恢复、用户技能管理、容器文件和 Root 终端。首次浏览器访问会创建本地管理员账户。管理中心使用由当前 DSH 浏览器会话派生的独立会话；可选的管理中心密码构成第二层登录。

| 变体 | 滚动标签 | 固定版本标签 | 内容 |
| --- | --- | --- | --- |
| 标准版 | `latest` | `<version>` | DSH 和正常运行所需工具 |
| 开发工具版 | `latest-devtools` | `<version>-devtools` | 标准版加开发工具 |

Docker Hub 标签跟随 DSH 版本。`ghcr.io/yjrszcq/dsh-docker` 仅备份标准镜像，使用 Environment 版本标签和 `dsh-<version>` 定位标签，不发布 Devtools 镜像。

## 快速开始

创建本地数据目录：

```bash
mkdir -p data/dsh data/platform workspace
```

使用以下精简 `docker-compose.yaml`：

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

也可以使用等价的 `docker run` 命令：

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

打开 <http://127.0.0.1:3080>。

## 数据存储

以下两个持久化位置都必须保留：

| 路径 | 用途 |
| --- | --- |
| `/data/platform` | 平台状态、受管理的回滚资产、快照和日志 |
| `/data/dsh` | DSH 设置、会话、凭据和第三方插件 |
| `/workspace` | 默认工作目录 |

容器工作负载使用 UID/GID `1000:1000`。bind mount 无法访问时执行：

```bash
sudo chown -R 1000:1000 data workspace
```

## 远程访问

通过局域网或反向代理访问时，必须配置浏览器使用的主机：

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
```

将可信主机替换为实际值后，可以使用以下支持远程访问的精简 `docker-compose.yaml`：

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
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

也可以使用等价的 `docker run` 命令：

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -e 'DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com' \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

反向代理必须保留原始 `Host` 请求头，TLS 在容器外终止。如需只监听 Docker 宿主机，请使用 `127.0.0.1:3080:3080`，不要使用 `3080:3080`。

启动后打开浏览器侧地址，创建本地管理员用户名和主密码。初始化完成前，注册页会阻断 DSH 和管理中心。凭据及认证会话拥有完整 DSH 权限，因此远程访问必须使用 HTTPS 或其他可信网络边界。

常用设置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DSH_TRUSTED_HOSTS` | 仅 loopback | 浏览器侧允许的主机 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器和独立文件管理的默认工作目录 |
| `DSH_SUDO_ENABLED` | `false` | 仅供 Compose 使用的 DSH/Agent 免密码 sudo 开关 |

全部变量和校验规则见[完整配置参考](docs/cn/guide.md#配置参考)。

## 在线更新

在 DSH 设置中打开“平台管理”，或访问独立的 <http://127.0.0.1:3080/_dsh_platform/console/> DSH 管理中心。检查不会自动下载或激活，必须由用户确认更新。两个界面都可以为选定的受管出站流量配置现有 HTTP 或 SOCKS5 代理；DSH Docker 不会创建或对外开放代理服务。

独立页面在 DSH 无法启动时仍可使用，提供 DSH 生命周期与恢复、实时日志、内置系统插件和系统技能管理、用户插件和用户技能恢复、Root 文件管理及容器终端。

### 升级与认证提示

管理员账户由 Access Manager 持久化管理，DSH 与管理中心使用独立会话，并支持管理中心密码和两步验证。仓库 Compose 默认保持 `DSH_SUDO_ENABLED=false`。替换镜像时必须保留 `/data/dsh` 与 `/data/platform`（尤其是 `/data/platform/state`）。删除 platform volume 会重置管理员账户和认证状态，已有部署可能因此进入迁移或恢复流程。

认证表单只负责传输输入，所有凭据判断由 Access Manager 完成。登录 DSH 只创建 DSH Session；打开管理中心时会从这个有效会话通过一次性交接创建独立的 Management Session。直接访问管理中心也必须先完成 DSH 主密码登录；配置管理中心密码后，再进行第二层验证。DSH 注销或会话过期会同时使其关联的 Management Session 失效。DSH 发生已分类故障时，顶层页面导航会先显示不泄露故障细节的恢复页，使未登录用户仍能找到独立管理中心入口；API 和 WebSocket 继续关闭访问。“认证设置”按登录设备列出浏览器、对端 IP 和活动时间；注销一台设备会同时撤销它的 DSH Session 与关联 Management Session。管理中心也可切换到公开独立 Origin，或使用映射到容器独立入口的本机宿主机端口（默认 `3081`，可自定义）。

同一浏览器连续 5 次输入错误密码后，从等待 30 秒开始，后续失败会使等待时间翻倍，最高 15 分钟。每个浏览器来源还限制为每小时 12 次、每 24 小时 24 次失败；整个 DSH 实例跨所有来源使用更宽的防洪泛限制：每分钟 20 次、每小时 60 次、每 24 小时 120 次失败。浏览器只展示 Access Manager 的判定和剩余时间；密码验证成功会清除当前浏览器的连续失败和来源滚动窗口，不清除实例总量记录。

遗失凭据时只能从交互式 Root 控制台恢复。密码输入会关闭回显，且不接受命令参数或管道输入：

```bash
docker exec -it --user root deepseek-harness dsh-platform access status
docker exec -it --user root deepseek-harness dsh-platform access reset
docker exec -it --user root deepseek-harness dsh-platform access clear-retry
docker exec -it --user root deepseek-harness dsh-platform access clear-retry --global-only
docker exec -it --user root deepseek-harness dsh-platform access generate-key
```

`access clear-retry` 使用 `y/[n]` 确认，会清除全部浏览器的重试等待、来源滚动窗口和实例总量失败窗口。添加 `--global-only` 时只清除实例总量窗口，保留每个浏览器的重试等待与来源滚动限制。两种形式都不修改凭据或会话。

全新空卷直接显示普通管理员注册页，不需要密钥。只有旧部署迁移或认证状态损坏时，才使用 `access generate-key` 生成十分钟有效、单次使用的认证重置密钥；恢复页可据此重新创建管理员账户。

常用命令：

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform stop --wait
docker exec deepseek-harness dsh-platform start --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform rollback
```

Stable 跟随受支持的 DSH 版本。Experimental 可以安装经过验证的更新上游 DSH，并在激活前创建数据快照。返回 Stable 可能丢弃快照之后写入的数据。

## 系统插件

Container Environment 包含以下 DSH-Docker 集成：

| 插件 | 用途 |
| --- | --- |
| `@dsh-docker/platform-management` | 在 DSH 设置中增加“平台管理”，用于更新、运行维护、日志、系统资源和当前浏览器会话退出；该集成由平台托管 |
| `@dsh-docker/settings-navigation` | 让桌面端设置目录独立滚动，并在窄屏提供目录与详情分级导航 |
| `@dsh-docker/settings-document-editor` | 将只能在桌面打开配置文件的操作替换为可选的浏览器 `settings.yaml` 编辑器 |

除“平台管理”本身外，已安装的系统插件可在 DSH 的“平台管理”中启用或禁用；“平台管理”不能修改自身。独立的“DSH 管理中心”可以安装、卸载、启用或禁用 Environment 随附的系统插件，并能在“平台管理”缺失时将其恢复。变更会标记为待重启，并在重新启动 DSH 后生效。安装只使用经过验证的本地 Environment 资产，不会从 GitHub 或 npm 下载。第三方用户插件与系统插件分开管理，不会被视为系统插件。

“平台管理”和“设置文档编辑器”通过已认证的 DSH Session 使用 DSH 侧受限平台接口，不要求用户另行取得 Management Session。“平台管理”可以撤销当前浏览器的 DSH Session 及其关联的 Management Session，但用户名、密码和完整认证设置仍只能在独立管理中心或 Root CLI 中修改。

## 用户插件

独立管理中心会列出 DSH Web Profile 中的 Bundle 用户插件，并可精确启用、禁用或卸载指定插件。应用修改时会为完整 Web Profile 创建快照，并只重启 DSH。插件安装仍使用 DSH 正常插件流程或容器终端；恢复页面不安装任意软件包。

## 系统技能与用户技能

DSH Docker 内置已签名的 `dsh-docker-operations` System Skill，为 Agent 提供文件、开发工具、插件、生命周期、日志、更新、恢复、网络和权限等容器环境操作指引，也可显式调用 `/dsh-docker-operations`。

系统技能可在 DSH 内的“平台管理”和独立管理中心的“系统技能”中管理，变更会立即生效，无需重启 DSH。独立管理中心支持安装、卸载、启用和禁用；“平台管理”可恢复缺失技能并启禁用。项目或用户的同名 Skill 仍按 DSH 原生优先级覆盖内置副本。

独立管理中心还会列出已配置 DSH 与 Agent Skill 根中的原生用户技能，可精确启用、禁用或删除指定条目，不会修改项目级 Skill。

## 安全提醒

已认证的 DSH Session 拥有完整 DSH 权限；Management Session 还可使用 root 容器终端和 root 文件操作，因此管理员可以读取凭据、执行命令并修改容器数据。远程访问必须使用 HTTPS 和可信网络边界。

仓库 Compose 默认关闭 DSH/Agent 的免密码 sudo。只有 Agent 明确需要 root 权限时才设置 `DSH_SUDO_ENABLED=true`。不了解影响时，不要同时使用 sudo、特权模式、Docker Socket 或敏感宿主机挂载。

## 详细文档

[完整指南](docs/cn/guide.md)包括：

- 部署前提、两种 Compose 布局和 Docker Run；
- 全部配置变量、数据存储、Gateway 和远程访问行为；
- 平台架构、在线更新、系统与用户插件、系统与用户技能、日志、信任、恢复和回滚；
- 独立恢复工具、发布自动化、本地构建、测试和开发工具。
