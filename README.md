# dsh-docker

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像构建仓库。

本仓库不包含、也不复制 DeepSeek Harness 的源码。镜像构建时会从 npm 安装指定版本的官方 `@deepseek-ai/dsh` 包，仓库本身只维护容器化配置和镜像发布工作流。

> DeepSeek Harness 目前处于 Developer Preview，可能会出现不兼容更新。本镜像不隶属于 DeepSeek AI；上游项目及软件许可证以官方仓库为准。

## 快速开始

### Docker Compose

最简 `docker-compose.yaml`：

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "127.0.0.1:3080:3080"
    environment:
      DSH_TRUSTED_HOST: "${DSH_TRUSTED_HOST:-}"
    volumes:
      - ./data:/home/node/.dsh
      - ./workspace:/workspace
```

1. 创建宿主机数据和 workspace 目录：

   ```bash
   mkdir -p data workspace
   ```

   容器以 UID/GID `1000:1000` 的 `node` 用户运行。如果目录曾由 root 或 Docker 自动创建，启动时可能出现 `EACCES: permission denied`。可修复目录所有权后重试：

   ```bash
   sudo chown -R 1000:1000 data workspace
   ```

2. 启动服务：

   ```bash
   docker compose up -d
   ```

3. 打开 <http://127.0.0.1:3080>，点击 **Choose workspace**，添加并选择 `/workspace`。

4. 在 **Settings → Models** 中配置 DeepSeek API Key 或其他兼容模型。

停止服务：

```bash
docker compose down
```

Harness 的配置、凭据和会话数据保存在具名卷 `dsh-data` 中；工作文件默认保存在当前目录的 `workspace` 中。

### Docker CLI

```bash
mkdir -p workspace data

docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/data:/home/node/.dsh" \
  szcq/deepseek-harness:latest
```

> **远程访问注意：** 如果通过局域网 IP 或域名访问，需要把端口映射改为 `-p 0.0.0.0:3080:3080`，并在 `docker run` 参数中增加 `-e DSH_TRUSTED_HOST=192.168.1.100`；请将示例 IP 替换为浏览器实际访问的 IP 或域名，且不要包含协议或路径。

如果 bind mount 出现权限错误，请确保宿主机目录可由容器内的 `node` 用户（UID/GID 1000）读写；或者像 Compose 示例一样使用具名卷保存 `$DSH_HOME`。

## Compose 配置

可以通过 shell 环境变量或同目录下的 `.env` 文件覆盖默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机监听地址 |
| `DSH_PORT` | `3080` | 宿主机端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载为 `/workspace` 的宿主机目录 |
| `DSH_TELEMETRY_DISABLED` | `true` | 是否禁用遥测，仅接受 `true` 或 `false` |
| `DSH_TRUSTED_HOST` | 空 | 浏览器实际访问的 IP 或域名，用于通过 `/api` 信任校验 |

例如：

```dotenv
DSH_IMAGE_TAG=0.1.0-rc.6
DSH_PORT=8080
DSH_WORKSPACE=/path/to/project
DSH_TRUSTED_HOST=192.168.1.100
```

修改后重新启动：

```bash
docker compose up -d
```

## 安全提示

DeepSeek Harness 是编码 Agent，能够在挂载的 workspace 中读写文件并执行命令。当前 Web UI 不应直接暴露到不可信网络。

Compose 默认仅监听宿主机的 `127.0.0.1`。如需从其他设备访问，优先使用带身份认证的反向代理、VPN 或 SSH 隧道。只有在明确了解风险时，才将 `DSH_LISTEN_ADDRESS` 设置为 `0.0.0.0`。

从局域网 IP 或自定义域名访问时，还必须通过 `DSH_TRUSTED_HOST` 声明浏览器实际使用的 IP 或域名，否则 `/api` 请求会返回 HTTP 403。例如在 `.env` 中配置局域网访问：

```dotenv
DSH_LISTEN_ADDRESS=0.0.0.0
DSH_TRUSTED_HOST=192.168.1.100
```

使用反向代理域名时可填写 `DSH_TRUSTED_HOST=dsh.example.com`。不要包含 `http://`、`https://` 或路径；通常无需填写端口，不带端口的值可匹配该地址的任意端口。修改后运行 `docker compose up -d --force-recreate`。

`DSH_TRUSTED_HOST` 只能通过普通 `/api` 请求的 Host 信任校验。上游仍将设置、凭据和宿主机操作等敏感接口限制为仅回环地址可用，因此从局域网 IP 或域名打开时，`settings.describe` 等接口仍可能返回 403。如需完整使用设置界面，建议建立 SSH 隧道并通过本机回环地址访问：

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

然后打开 <http://127.0.0.1:3080>。

容器默认设置 `DSH_TELEMETRY_DISABLED=true`。设置为 `false` 可启用上游遥测；启用前请先了解遥测内容可能包含的会话和 workspace 信息。入口脚本会把布尔值转换为上游实际使用的环境变量语义。

## 自己构建镜像

构建最新 npm 版本：

```bash
docker build -t deepseek-harness:local .
```

构建指定版本：

```bash
docker build \
  --build-arg DSH_VERSION=0.1.0-rc.6 \
  -t deepseek-harness:0.1.0-rc.6 .
```

本地运行：

```bash
docker run --rm \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/workspace:/workspace" \
  deepseek-harness:local
```

镜像基于 Node.js 24，并预装 `pnpm`、Git、OpenSSH Client、curl、jq 和 ripgrep，方便 Harness 在 workspace 内工作和安装插件。

## GitHub Actions 发布到 Docker Hub

工作流位于 `.github/workflows/docker.yaml`，参考了 [`yjrszcq/auto-novel`](https://github.com/yjrszcq/auto-novel/blob/main/.github/workflows/docker.yaml) 的手动发布方式，会构建并推送 `linux/amd64` 和 `linux/arm64` 镜像。

1. 在 Docker Hub 创建 `szcq/deepseek-harness` 仓库。
2. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中新增 Repository Secret：
   - Name：`DOCKER_TOKEN`
   - Value：Docker Hub Access Token
3. 打开 **Actions → Build and Push Docker Image → Run workflow**。
4. 直接确认默认的 `latest`，工作流会从 npm 查询并使用当前确切版本；也可以改为指定版本，例如 `0.1.0-rc.6`。

发布成功后会推送两个标签：

- `szcq/deepseek-harness:<解析后的确切版本>`
- `szcq/deepseek-harness:latest`

无论输入 `latest` 还是确切版本，镜像的版本标签都会使用 npm 返回的确切版本号，因此构建结果仍然可追溯。

## 更新 DeepSeek Harness

查看 npm 上已发布的版本：

```bash
npm view @deepseek-ai/dsh version
```

也可以直接运行 GitHub Actions 并保留默认的 `latest`；工作流会自动完成查询，无需把上游源码同步到本仓库。

## 相关项目

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [yjrszcq/auto-novel Docker workflow](https://github.com/yjrszcq/auto-novel/blob/main/.github/workflows/docker.yaml)
- [yjrszcq/sharelatex](https://github.com/yjrszcq/sharelatex)
