# DSH-Docker

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像。镜像安装官方 `@deepseek-ai/dsh` 包，并提供持久化更新、回滚、Gateway 访问控制和可选开发工具。

> DeepSeek Harness 目前处于 Developer Preview，可能出现不兼容更新。本项目不隶属于 DeepSeek AI。

| 变体 | 滚动标签 | 固定版本标签 | 内容 |
| --- | --- | --- | --- |
| 标准版 | `latest` | `<version>` | DSH 和正常运行所需工具 |
| 开发工具版 | `latest-devtools` | `<version>-devtools` | 标准版加开发工具 |

## 快速开始

创建本地数据目录：

```bash
mkdir -p data workspace
```

运行标准镜像：

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v dsh-platform-data:/data/platform \
  -v "$(pwd)/data:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

也可以使用仓库内的 Compose 配置：

```bash
cp .env.example .env
docker compose up -d
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

通过局域网或反向代理访问时，配置浏览器使用的主机和强密码：

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=请设置一个强密码
```

反向代理必须保留原始 `Host` 请求头，TLS 在容器外终止。如需只监听 Docker 宿主机，请使用 `127.0.0.1:3080:3080`，不要使用 `3080:3080`。

常用设置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DSH_TRUSTED_HOSTS` | 仅 loopback | 浏览器侧允许的主机 |
| `DSH_PROXY_USERNAME` | 空 | 可选 HTTP Basic 用户名 |
| `DSH_PROXY_PASSWORD` | 空 | HTTP Basic 密码；留空关闭认证 |
| `DSH_PLATFORM_PASSWORD` | 空 | Gateway 密码关闭时保护平台管理；留空进入临时密钥模式 |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | 目录选择器初始路径 |
| `DSH_SUDO_ENABLED` | `true` | 仅供 Compose 使用的免密码 sudo 开关 |

全部变量和校验规则见[完整配置参考](docs/README_CN.md#配置参考)。

## 更新

在 DSH 设置中打开“平台管理”，或访问 <http://127.0.0.1:3080/_dsh_platform/ui/>。检查不会自动下载或激活，必须由用户确认更新。

独立页面在 DSH 无法启动时仍可使用，并提供用户插件恢复和容器终端。

Gateway 密码为空时，平台管理使用独立的 `DSH_PLATFORM_PASSWORD`。如果该密码也为空，平台管理默认锁定，可从容器终端生成有效期 10 分钟的临时访问密钥；重新生成会立即废止旧密钥：

```bash
docker exec dsh-test dsh-platform access create
```

常用命令：

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform rollback
```

Stable 跟随受支持的 DSH 版本。Experimental 可以安装经过验证的更新上游 DSH，并在激活前创建数据快照。返回 Stable 可能丢弃快照之后写入的数据。

## 安全提醒

能通过 Gateway 访问，就等同于拥有完整 DSH 权限，可能读取凭据、执行命令，并访问容器 `node` 用户可用的所有路径。远程访问必须使用 HTTPS 和可信网络边界。

Compose 默认开启不受限制的免密码 sudo。Agent 不需要 root 权限时请设置 `DSH_SUDO_ENABLED=false`。不了解影响时，不要同时使用 sudo、特权模式、Docker Socket 或敏感宿主机挂载。

## 详细文档

[完整指南](docs/README_CN.md)包括：

- 全部配置变量和 Gateway 行为；
- 平台架构、在线更新、信任、恢复和回滚；
- 密码和浏览器兼容细节；
- 发布自动化、本地构建、测试和开发工具。
