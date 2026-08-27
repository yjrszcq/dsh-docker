const groups = Object.freeze({
  updates: { zh: '更新管理', en: 'Updates' },
  platform: { zh: '平台组件', en: 'Platform components' },
  dsh: { zh: 'DSH 核心与插件', en: 'DSH core and plugins' },
  agent: { zh: 'Agent 与终端', en: 'Agent and terminals' },
  models: { zh: '模型 API', en: 'Model APIs' },
  direct: { zh: '始终直连或不受平台管理', en: 'Always direct or unmanaged' },
})

function entry(id, group, category, sourceZh, sourceEn, detailZh, detailEn) {
  return Object.freeze({
    id, group, category,
    source: Object.freeze({ zh: sourceZh, en: sourceEn }),
    detail: Object.freeze({ zh: detailZh, en: detailEn }),
  })
}

export const PROXY_SCOPE_CATALOG = Object.freeze({
  schema: 1,
  groups,
  entries: Object.freeze([
    entry('stable-metadata', 'updates', 'updates', 'Stable、keyring、Release metadata 检查', 'Stable, keyring, and Release metadata checks', '仅远程获取走代理。', 'Only remote retrieval uses the proxy.'),
    entry('update-artifacts', 'updates', 'updates', '更新 Artifact 下载', 'Update Artifact downloads', '包括 DSH、Environment 和 Bootstrap 等下载。', 'Includes DSH, Environment, Bootstrap, and related downloads.'),
    entry('experimental-metadata', 'updates', 'updates', 'Experimental 上游版本检查', 'Experimental upstream checks', '包括 npm 和相关 metadata 请求。', 'Includes npm and related metadata requests.'),
    entry('update-remote', 'updates', 'updates', '更新、回滚中的远程请求', 'Remote requests during update and rollback', '本地切换、恢复和校验保持直连。', 'Local switching, recovery, and verification remain direct.'),
    entry('stage0-verification', 'direct', 'direct', 'Stage-0 签名与 Hash 校验', 'Stage-0 signature and Hash verification', '完全本地执行，不接收代理凭据。', 'Runs locally and never receives proxy credentials.'),
    entry('management-external', 'platform', 'platform', 'Management 对外请求', 'Management external requests', '不包括本地 Unix socket 通信。', 'Excludes local Unix socket communication.'),
    entry('gateway-external', 'platform', 'platform', 'Gateway 自身对外请求', 'Gateway external requests', '浏览器到 DSH 的本地反向代理不使用外部代理。', 'The local browser-to-DSH reverse proxy does not use the external proxy.'),
    entry('updater-platform', 'platform', 'platform', 'Updater 的非更新类外部请求', 'Updater non-update external requests', '更新请求优先归入更新管理。', 'Update requests are classified as Updates first.'),
    entry('system-plugins', 'platform', 'platform', 'DSH Docker 系统插件', 'DSH Docker System Plugins', '身份来自签名 Environment Manifest。', 'Identity comes from the signed Environment Manifest.'),
    entry('dsh-core', 'dsh', 'dshCore', 'DSH 核心对外请求', 'DSH core external requests', '不包括模型 Provider API。', 'Excludes model Provider APIs.'),
    entry('official-plugins', 'dsh', 'dshPlugins', 'DSH 官方插件', 'Official DSH plugins', '当前与第三方插件共用一个总开关。', 'Currently shares one switch with third-party plugins.'),
    entry('user-plugins', 'dsh', 'dshPlugins', '用户安装的第三方插件', 'User-installed third-party plugins', '包括插件产生的可识别子进程。', 'Includes identifiable child processes created by plugins.'),
    entry('plugin-terminal', 'dsh', 'dshPlugins', '第三方插件提供的终端', 'Third-party plugin terminals', '通过可识别子进程接口创建时归入插件范围；直接创建的 PTY 跟随共享 DSH 策略。', 'Uses the plugin scope when created through an identifiable subprocess interface; directly created PTYs follow the shared DSH policy.'),
    entry('agent-tools', 'agent', 'agentNetwork', 'Agent 的 web_search、web_fetch 等联网工具', 'Agent network tools such as web_search and web_fetch', '按 Agent 工具执行上下文注入代理。', 'Proxy settings are injected using the Agent execution context.'),
    entry('agent-commands', 'agent', 'agentNetwork', 'Agent 执行的 curl、git、npm 等命令', 'Commands such as curl, git, and npm run by an Agent', '包括 Agent 创建的子进程。', 'Includes child processes created by the Agent.'),
    entry('agent-session', 'agent', 'agentNetwork', 'Agent 持久终端会话', 'Persistent Agent terminal sessions', '会话创建时确定代理范围。', 'The proxy scope is selected when the session is created.'),
    entry('management-terminal', 'agent', 'managementTerminal', '管理中心容器终端', 'Management container terminal', '独立于 Agent 和插件终端。', 'Independent from Agent and plugin terminals.'),
    entry('docker-exec', 'direct', 'unmanaged', '宿主机执行的 docker exec Shell', 'Host-created docker exec Shell', '不受平台管理，用户自行设置代理环境。', 'Not managed by the platform; users configure its environment.'),
    entry('provider-routed', 'models', 'modelApi', '可识别的模型 Provider', 'Identifiable model Providers', '可分别选择直连或独立代理。', 'Can independently select direct access or a dedicated proxy route.'),
    entry('provider-shared', 'models', 'sharedDsh', '无法独立路由的模型请求', 'Model requests without independent routing', '只能选择直连或跟随 DSH 共享流量策略；DSH 核心或 DSH 插件任一范围启用时共享路由使用代理。', 'Can only connect directly or follow the shared DSH policy; the shared route uses the proxy when either DSH Core or DSH Plugins is enabled.'),
    entry('provider-local', 'direct', 'forcedDirect', '本地模型 Provider', 'Local model Providers', '本地地址强制直连。', 'Local addresses are always direct.'),
    entry('gateway-dsh', 'direct', 'direct', 'Gateway 到 DSH 的本地转发', 'Local Gateway-to-DSH forwarding', '容器内部 loopback 通信。', 'Container-internal loopback communication.'),
    entry('platform-sockets', 'direct', 'direct', 'Management、Bootstrap、Stage-0 的 Unix socket', 'Management, Bootstrap, and Stage-0 Unix sockets', '本地控制协议不使用代理。', 'Local control protocols do not use the proxy.'),
    entry('local-files', 'direct', 'direct', '日志、文件、快照、Runtime 构建', 'Logs, files, snapshots, and Runtime builds', '本地文件和进程操作不使用代理。', 'Local file and process operations do not use the proxy.'),
  ]),
  summaries: Object.freeze([
    Object.freeze({ zh: '本地平台通信始终直连。', en: 'Local platform communication is always direct.' }),
    Object.freeze({ zh: '可识别的模型 Provider 可分别选择直连或独立代理；无法独立路由的请求只能选择直连或跟随 DSH。', en: 'Identifiable model Providers independently select direct access or a dedicated proxy; requests without independent routing can only connect directly or follow DSH.' }),
    Object.freeze({ zh: 'docker exec 创建的 Shell 不受平台代理设置管理。', en: 'Shells created with docker exec are not managed by platform proxy settings.' }),
  ]),
})
