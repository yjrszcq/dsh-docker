# dsh-docker

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 Docker 镜像构建仓库。

本仓库不包含、也不复制 DeepSeek Harness 的源码。镜像构建时会从 npm 安装指定版本的官方 `@deepseek-ai/dsh` 包，仓库本身只维护容器化配置和镜像发布工作流。

> DeepSeek Harness 目前处于 Developer Preview，可能会出现不兼容更新。本镜像不隶属于 DeepSeek AI；上游项目及软件许可证以官方仓库为准。

## 快速开始

### Docker Compose

1. 创建宿主机 workspace：

   ```bash
   mkdir -p workspace
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

如果 bind mount 出现权限错误，请确保宿主机目录可由容器内的 `node` 用户（UID/GID 1000）读写；或者像 Compose 示例一样使用具名卷保存 `$DSH_HOME`。

## Compose 配置

可以通过 shell 环境变量或同目录下的 `.env` 文件覆盖默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | 镜像标签 |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | 宿主机监听地址 |
| `DSH_PORT` | `3080` | 宿主机端口 |
| `DSH_WORKSPACE` | `./workspace` | 挂载为 `/workspace` 的宿主机目录 |

例如：

```dotenv
DSH_IMAGE_TAG=0.1.0-rc.6
DSH_PORT=8080
DSH_WORKSPACE=/path/to/project
```

修改后重新启动：

```bash
docker compose up -d
```

## 安全提示

DeepSeek Harness 是编码 Agent，能够在挂载的 workspace 中读写文件并执行命令。当前 Web UI 不应直接暴露到不可信网络。

Compose 默认仅监听宿主机的 `127.0.0.1`。如需从其他设备访问，优先使用带身份认证的反向代理、VPN 或 SSH 隧道。只有在明确了解风险时，才将 `DSH_LISTEN_ADDRESS` 设置为 `0.0.0.0`。

使用自定义域名反向代理时，还需把域名加入上游的浏览器信任列表。例如在 Compose 服务中增加：

```yaml
command:
  - dsh
  - web
  - --patch
  - /opt/dsh/docker.cordis.yml
  - --trusted-host
  - dsh.example.com
```

容器默认设置 `DSH_TELEMETRY_DISABLED=1`。若需要启用上游遥测，请显式修改 Compose 配置，并先了解遥测内容可能包含的会话和 workspace 信息。

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
4. 输入官方 npm 版本，例如 `0.1.0-rc.6`。

发布成功后会推送两个标签：

- `szcq/deepseek-harness:<输入的版本>`
- `szcq/deepseek-harness:latest`

建议填写确切版本号，不要填写 `latest`，这样构建结果可追溯。

## 更新 DeepSeek Harness

查看 npm 上已发布的版本：

```bash
npm view @deepseek-ai/dsh version
```

然后在 GitHub Actions 中以该版本号重新运行工作流即可，无需把上游源码同步到本仓库。

## 相关项目

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [yjrszcq/auto-novel Docker workflow](https://github.com/yjrszcq/auto-novel/blob/main/.github/workflows/docker.yaml)
- [yjrszcq/sharelatex](https://github.com/yjrszcq/sharelatex)
