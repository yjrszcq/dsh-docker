const API = '/_dsh_platform/api/v1'
const UPDATE_TERMINAL_STATES = new Set(['idle', 'success', 'failed'])
const PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'
const LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'
const LOG_DISPLAY_LIMIT_KEY = 'dsh-platform:log-display-limit'
const LOG_DISPLAY_LIMITS = Object.freeze([100, 250, 500, 1_000])
const DEFAULT_LOG_DISPLAY_LIMIT = 500
const LOG_STREAM_LIMIT = 5_000
const TERMINAL_SESSION_KEY = 'dsh-platform:terminal-session'
const LANGUAGE_KEY = 'dsh-platform:console-language'
const THEME_KEY = 'dsh-platform:console-theme'
const COPY = Object.freeze({
  zh: Object.freeze({
    title: 'DSH 管理中心', consoleLabel: '独立管理控制台', intro: 'DSH Docker 运行、更新与恢复',
    switchLanguage: '语言', themeSystem: '跟随系统', themeLight: '亮色', themeDark: '暗色', themeButtonLabel: '当前为{current}，点击切换为{next}',
    managementSections: 'DSH 管理中心功能', updatesTab: '更新管理', proxyTab: '代理设置', maintenanceTab: '运行维护', pluginsTab: '系统插件', skillsTab: '系统技能', userSkillsTab: '用户技能', userPluginsTab: '用户插件', terminalTab: '容器终端', filesTab: '文件管理',
    proxyTitle: '代理设置', proxyDetail: '为选定的出站流量使用已有的 HTTP 或 SOCKS5 代理。', proxyProtocol: '协议', proxyHost: '主机', proxyPort: '端口', proxyUsername: '用户名', proxyPassword: '密码', proxyPasswordPlaceholder: '留空表示保留已有密码', proxyRemoteDns: '通过 SOCKS5 解析目标 DNS', proxyRemoteDnsDetail: '避免在容器内解析目标域名。', proxyClearPassword: '移除已保存的代理密码', proxyPasswordConfigured: '已保存代理密码；不会从平台回传。', proxyPasswordNotConfigured: '尚未保存代理密码。', proxyTransportWarning: '当前页面未使用 HTTPS，代理凭据仅受现有网络边界保护。', proxyComponentReady: '出站代理组件已就绪', proxyComponentUnavailable: '出站代理组件暂不可用',
    proxyScopes: '流量范围', proxyScopesDetail: '选择哪些受管出站流量使用此代理。', proxyScopeHelp: '范围说明', proxyScopeGuideTitle: '代理范围说明', proxyScopeGuideDetail: '平台如何归类各类联网来源。', proxyScopeUpdates: '更新管理', proxyScopeUpdatesDetail: 'Metadata 检查和远程 Artifact 下载。', proxyScopePlatform: '平台组件', proxyScopePlatformDetail: 'DSH Docker 组件与系统插件的外部请求。', proxyScopeDshCore: 'DSH 核心', proxyScopeDshCoreDetail: '不含模型 Provider API 的 DSH 核心流量。', proxyScopeDshPlugins: 'DSH 插件', proxyScopeDshPluginsDetail: 'DSH 官方插件与用户安装的第三方插件。', proxyScopeAgent: 'Agent 联网操作', proxyScopeAgentDetail: 'Agent 联网工具、命令及其子进程。', proxyScopeTerminal: '容器终端', proxyScopeTerminalDetail: '此管理中心创建的 Shell 会话。',
    proxyRules: '直连规则', proxyRulesDetail: '列出的目标不会使用外部代理。', proxyDirectRules: '附加直连规则', proxyDirectRulesDetail: '每行一个主机、域后缀、IP 地址或 CIDR；使用 .example.com，不使用 *.example.com。', proxyDirectRulesPlaceholder: '.example.com\n10.0.0.0/8', proxySystemRules: '内置规则', proxySystemRulesTitle: '内置直连规则', proxySystemRulesDetail: '以下平台托管的本地目标始终直连，无需重复填写。', proxyAllProxy: '在已验证支持的客户端中设置 ALL_PROXY', proxyAllProxyDetail: '只向已确认支持 ALL_PROXY 的客户端注入。',
    proxyProviders: '模型 Provider', proxyProvidersDetail: '仅已验证接入 dispatcher 的 Provider 支持独立路由。', proxyNoProviders: '没有找到模型 Provider。', proxyProviderDirect: '强制直连', proxyProviderIndependent: '可独立配置', proxyProviderShared: '跟随 DSH', proxyProviderInfo: '查看 {name} 的路由说明', proxyProviderReasonLocal: '本地 Provider 始终直连。', proxyProviderReasonShared: '当前客户端无法稳定携带 Provider 身份。',
    proxyTest: '连接测试', proxyTestDetail: '使用当前表单测试，不保存也不激活配置。', proxyTestStart: '测试连接', proxySave: '保存并应用', proxySaving: '正在保存代理设置', proxySaved: '代理设置已保存并应用', proxyTestRunning: '正在测试代理连接', proxyTestSuccess: '代理连接测试通过', proxyTestFailed: '代理连接测试失败', proxyTestCancelled: '代理连接测试已取消', proxyStageAddress: '解析代理地址', proxyStageConnect: '连接代理服务器', proxyStageHandshake: '验证代理协议与认证', proxyStageDns: '解析目标地址', proxyStageTls: '验证目标 TLS', proxyStageHttp: '请求 GitHub 与 npm', proxyStagePending: '等待', proxyStageRunning: '进行中', proxyStageSuccess: '通过', proxyStageFailed: '失败', proxyStageSkipped: '无需执行',
    channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
    stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
    actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中',
    updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
    updateProgress: '更新进度', rollbackProgress: '回滚进度', returnStableProgress: '返回稳定通道', updateToTarget: '更新到 {target}', rollbackToTarget: '回滚到 {target}', returnStableToTarget: '返回稳定通道·{target}', progressPrepare: '准备更新', progressAcquire: '下载与验证', progressBuild: '构建 Runtime', progressActivate: '切换与健康检查',
    stageLogs: '阶段日志', hideStageLogs: '收起日志 · {count} 条', showStageLogs: '查看日志 · {count} 条', copyStageLogs: '复制当前日志', logsCopied: '日志已复制', viewFullTransactionLog: '查看完整事务日志', noStageLogs: '当前阶段暂无日志', dismissProgress: '关闭',
    stageCompleted: '阶段已完成。', stageWaiting: '等待前一阶段完成。', stageProgress: '阶段进度 {progress}%', stageItemsCompleted: '已完成 {completed}/{total} 项', expandStage: '展开 · 日志 {count} 条', collapseStage: '收起 · 日志 {count} 条', stageItemCompleted: '已完成：{item}', stageItemActive: '正在执行：{item}', stageItemPending: '待执行：{item}', stageItemFailed: '执行失败：{item}',
    itemVerifyMetadata: '验证 metadata', itemVerifyKeyring: '验证 keyring', itemVerifyTarget: '验证目标清单', itemDownloadArtifacts: '下载 Artifact', itemVerifyArtifacts: '验证 Artifact 签名、引用、大小和 Hash', itemImportObjects: '导入可信对象库', itemMaterializePristine: '物化 Pristine DSH', itemPrepareEnvironment: '准备 Environment', itemBuildRuntime: '构建 Runtime 并应用完整 Patch Set', itemPreparePlugins: '准备 System Plugin Set', itemSwitchDeployment: '原子切换 Deployment', itemCheckHealth: '检查服务健康状态', itemObserveProbation: '观察候选 Runtime', itemValidateRollback: '验证回滚计划和上一完整 Deployment', itemPauseRuntime: '暂停当前 DSH Runtime', itemSwitchPrevious: '切换上一完整 Deployment', itemVerifySnapshot: '验证数据快照', itemRestoreSnapshot: '恢复数据快照', itemStartRuntime: '启动上一 DSH Runtime',
    metadataVerified: 'metadata 已验证。', keyringVerified: 'keyring 已验证。', targetManifestVerified: '目标清单已验证。', artifactDownloadCompleted: 'Artifact 下载已完成。', artifactVerificationCompleted: 'Artifact 签名、引用和 Hash 已验证。', runtimeMaterialized: 'Pristine DSH 已物化。', patchSetApplied: '完整 Patch Set 已应用。', systemPluginsPrepared: 'System Plugin Set 已准备。', deploymentSwitched: 'Deployment 已原子切换。', healthChecksPassed: '服务健康检查已通过。',
    rollbackPrepareCompleted: 'Snapshot 与回滚计划已验证。', rollbackSwitchCompleted: 'Previous Runtime 已激活。', rollbackDataCompleted: '用户数据已恢复。', rollbackVerifyCompleted: '系统健康检查已通过。',
    metricBytesRead: '已读取 {processed} / {total}', metricBytesCopied: '已复制 {processed} / {total}', metricBytesRestored: '已恢复 {processed} / {total}', metricBytesProcessed: '已处理 {processed} / {total}',
    metricArtifacts: '已验证 {processed} / {total} 个 Artifact', metricFiles: '已完成 {processed} / {total} 个文件', metricItems: '已完成 {processed} / {total} 项', metricServices: '已就绪 {ready} / {total} 个服务', metricProbationRemaining: '剩余观察 {seconds} 秒',
    rollbackPrepare: '准备回滚', rollbackSwitch: '切换上一版本', rollbackData: '恢复数据', rollbackVerify: '启动与检查',
    progressDetailChecking: '正在获取并验证最新的签名更新信息。', progressDetailPlanning: '正在计算需要收敛的完整目标状态。', progressDetailUpstream: '正在查询 npm 官方源中的最新 DSH。',
    progressDetailDownloading: '正在下载 Artifact，并通过 Stage-0 导入可信对象库。', progressDetailValidating: '正在验证签名、Artifact 引用、大小和内容 Hash。', progressDetailBuilding: '正在从 Pristine DSH、补丁和系统插件构建不可变 Runtime。',
    progressDetailSnapshot: 'DSH 已暂停，正在为实验更新创建完整数据快照。', progressDetailSwitching: '正在原子切换完整 Deployment，并检查 DSH 是否就绪。', progressDetailProbation: '候选 Runtime 正在持续接受健康检查，观察至 {until}。',
    rollbackDetailPreparing: '正在验证回滚计划与上一完整 Deployment。', rollbackDetailStopping: '正在暂停 DSH，准备恢复上一完整状态。', rollbackDetailSwitching: '正在切换上一 Runtime、Environment 和系统插件集合。', rollbackDetailData: '正在校验并恢复更新前的数据快照。', rollbackDetailVerifying: '正在启动 DSH 并执行健康检查。',
    statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本',
    statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据',
    statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusRollingBack: '正在回滚', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
    outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新',
    outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
    requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。',
    holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。', metadataUnavailable: '正式更新信息暂未发布，请稍后再试。', remoteCheckFailed: '远程检查失败，继续显示上次已验证结果。', remoteCheckFailedNoResult: '远程检查失败，暂无已验证结果。', upstreamCheckFailed: 'DSH 官方版本检查失败，继续显示上次已验证结果。', upstreamCheckFailedNoResult: 'DSH 官方版本检查失败，暂无已验证结果。',
    aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
    returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：',
    confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
    automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭',
    checkInterval: '检查频率', updateNotifications: '更新提醒', updateNotificationsDetail: '自动检查发现新版本时，在 DSH 页面弹窗提醒更新。',
    interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
    maintenance: 'DSH 生命周期', maintenanceDetail: '启动、停止或重新启动 DSH，容器和管理中心服务保持运行。', startDsh: '启动 DSH', stopDsh: '停止 DSH', restartDsh: '重新启动 DSH',
    starting: '正在启动 DSH', stopping: '正在停止 DSH', stopped: 'DSH 已停止', restarting: '正在重新启动 DSH', lifecycleRunning: 'DSH 正在运行', lifecycleFailed: 'DSH 操作失败',
    restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，此独立控制台保持可用。', confirmRestart: '确认重启',
    stopTitle: '确认停止 DSH', stopWarning: 'DSH 将保持停止，直到在此重新启动或容器重启。管理中心保持可用。', confirmStop: '确认停止',
    runtimeReset: '重置运行时', runtimeResetDetail: '从已验证的 DSH 原始文件和当前平台补丁重新构建运行时，不会删除配置、会话、用户插件或工作区。',
    cancelRuntimeReset: '取消重置', runtimeResetConfirmTitle: '重置当前运行时', runtimeResetWarning: 'DSH 会短暂停止，当前版本和用户数据保持不变。', confirmRuntimeReset: '重置并重启 DSH',
    runtimeResetting: '正在重置运行时', runtimeResetBuilding: '正在从已验证文件重建运行时', runtimeResetVerifying: '正在验证重建结果', runtimeResetSwitching: '正在切换运行时', runtimeResetStarting: '正在启动并检查 DSH', runtimeResetRecovering: '重置失败，正在恢复原运行时', runtimeResetProgress: '运行时重置进度', runtimeResetComplete: '运行时已重置并重新启动 DSH', runtimeResetFailed: '运行时重置失败',
    logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块',
    logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误',
    logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', autoScroll: '自动滚动',
    refreshLogs: '刷新日志', exportLogs: '导出日志', clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
    systemPlugins: '系统插件', systemPluginsConsoleDetail: '管理当前环境提供的所有系统插件，也可恢复 DSH 中的平台管理集成。',
    noSystemPlugins: '当前环境没有提供系统插件。', managementIntegration: '平台管理集成，可从此独立页面恢复。',
    notInstalled: '未安装', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', pluginPendingRestart: '待重启',
    installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置',
    pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载',
    pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginActionComplete: '插件设置已保存',
    pluginChangesPending: '有待应用的修改', pluginChangesPendingDetail: '插件修改尚未应用。应用后将重新启动 DSH 并生效。', pendingSystemPluginChanges: '有 {count} 项修改待应用',
    systemPluginApplyingItem: '{action} @dsh-docker/{id}（{current}/{total}）', systemPluginRestarting: '插件修改已应用，正在重新启动 DSH',
    systemSkills: '系统技能', systemSkillsConsoleDetail: '管理当前 Bootstrap 提供的已签名 Agent 操作指引。', noSystemSkills: '当前 Bootstrap 没有提供系统技能。', skillEnabled: '已安装并启用', skillDisabled: '已安装但已禁用', skillActionWorking: '正在应用技能设置', skillActionComplete: '技能设置已应用',
    userSkills: '用户技能', userSkillsDetail: '管理 DSH 用户目录中的技能，无需重新启动 DSH。', noUserSkills: '没有找到用户技能。', userSkillEnabled: '已启用', userSkillDisabled: '已禁用', userSkillDamaged: '元数据损坏', userSkillSource: '来源', userSkillEntry: '目录项', userSkillSourceDsh: 'DSH 用户目录', userSkillSourceAgents: 'Agents 用户目录', deleteUserSkill: '删除', deleteUserSkillTitle: '永久删除用户技能', deleteUserSkillDetail: '将永久删除“{name}”及其文件，此操作无法撤销。', userSkillActionWorking: '正在应用用户技能设置', userSkillActionComplete: '用户技能设置已应用', userSkillActionFailed: '用户技能操作失败',
    userPlugins: '用户插件', userPluginsDetail: '无需启动 DSH，即可恢复 Web Profile 中由用户安装的插件。',
    noUserPlugins: 'Web Profile 中没有可管理的用户插件。', dshUnavailable: 'DSH 当前不可用',
    userPluginVersion: '版本', userPluginSpec: '依赖规格', userPluginSource: '来源', userPluginSourceRegistry: '软件包源',
    userPluginSourceFile: '本地文件', userPluginSourceGit: 'Git', userPluginSourceUrl: 'URL', userPluginSourceOther: '其他',
    userPluginEnabled: '已启用', userPluginDisabled: '已禁用', userPluginDamaged: '元数据损坏', userPluginReserved: '与系统插件重名',
    pendingInstall: '待安装', pendingEnable: '待启用', pendingDisable: '待禁用', pendingUninstall: '待卸载', statusInstalling: '安装中', statusEnabling: '启用中', statusDisabling: '禁用中', statusUninstalling: '卸载中', resourceEnabled: '已启用', resourceDisabled: '已禁用', uninstallUserPlugin: '卸载', cancelUninstall: '取消卸载',
    noPendingUserPluginChanges: '没有待应用的修改', pendingUserPluginChanges: '有 {count} 项修改待应用', cancelChanges: '取消修改',
    applyUserPluginChanges: '应用并重新启动 DSH', userPluginApplying: '正在应用用户插件修改', userPluginApplyComplete: '用户插件修改已应用',
    userPluginApplyFailed: '用户插件恢复失败', userPluginRevisionConflict: '插件状态已发生变化，已重新载入最新状态，请重新选择修改。',
    userPluginRestartRequired: '需要重新启动 DSH', userPluginRestartRequiredDetail: '用户插件已在终端或其他位置发生变化，重新启动 DSH 后生效。',
    userPluginMetadataError: '无法读取已安装插件的元数据。', userPluginRecoveryDetail: 'DSH 启动或运行失败，可在运行维护中查看日志。',
    userPluginPhaseValidated: '正在验证修改', userPluginPhasePaused: '正在暂停 DSH', userPluginPhaseSnapshotted: '已备份 Web Profile',
    userPluginPhaseMutating: '正在修改插件', userPluginPhaseCommitted: '修改已保存', userPluginPhaseRestarting: '正在重新启动 DSH', userPluginPhaseRestoring: '正在恢复 Web Profile',
    terminal: '容器终端', terminalDetail: '使用管理员权限打开交互式容器 Shell；仅重新启动 DSH 时终端会话保持运行。',
    newTerminal: '新建会话', closeTerminal: '关闭会话', terminalIdle: '没有活动会话', terminalLoading: '正在加载终端组件', terminalLoadFailed: '终端组件加载失败，请重试', terminalStarting: '正在创建会话',
    terminalConnecting: '正在连接终端', terminalConnected: '终端已连接', terminalReconnecting: '连接中断，正在重连',
    terminalExited: 'Shell 已退出（状态 {status}）', terminalFailed: '终端连接失败', terminalClosed: '终端会话已关闭',
    terminalPlaceholder: '新建会话后将在此打开交互式 Bash Shell。', terminalScreen: '容器终端',
    files: '文件管理', filesDetail: '使用管理员权限查看和管理容器文件。', newItem: '新建', upload: '上传', uploadFiles: '上传文件', uploadDirectory: '上传文件夹', dropToUpload: '拖放到此处上传', dropUploadDestination: '文件和文件夹将上传到当前目录。', download: '下载', refresh: '刷新', back: '返回', forward: '前进', parentDirectory: '上级目录', path: '路径',
    itemType: '新建类型', itemName: '名称', createItem: '创建', createLocation: '创建位置：{path}', invalidFileName: '名称不能为空，不能是 . 或 ..，不能包含 / 或控制字符，且不能超过 255 字节。',
    filterFiles: '筛选当前目录', searchDirectory: '搜索此目录', showHidden: '显示隐藏文件', managedPathWarning: '此路径由平台管理，修改可能在重启、更新或运行时重建时被覆盖，也可能损坏当前部署。',
    locations: '快捷位置', selectAll: '全选', fileName: '名称', fileSize: '大小', fileOwner: '用户:用户组', fileModified: '修改时间', fileMode: '权限', calculateSize: '计算', calculatingSize: '计算中', sizeCalculationFailed: '计算失败', emptyDirectory: '此目录为空。', loadMore: '加载更多', itemsPerPage: '每页数量', itemsPerPageSuffix: '条/页', previousPage: '上一页', nextPage: '下一页', totalItems: '共 {total} 条', goToPage: '前往', pageUnit: '页',
    searchSystemPlugins: '搜索系统插件', searchSystemSkills: '搜索系统技能', searchUserPlugins: '搜索用户插件', searchUserSkills: '搜索用户技能', noMatchingResources: '没有符合搜索条件的项目。',
    noFilesSelected: '未选择文件', filesSelected: '已选择 {count} 项', copy: '复制', cut: '剪切', paste: '粘贴', compress: '压缩', extract: '解压', rename: '重命名', deletePermanently: '永久删除',
    compressItems: '压缩所选项目', extractArchive: '解压归档', archiveFormat: '归档格式', archiveName: '归档名称', invalidArchiveName: '请输入有效的归档名称。', unsupportedArchive: '请选择 ZIP、7z 或 tar.gz 文件。',
    editPermissions: '编辑权限', permissions: '权限', permissionRead: '读取', permissionWrite: '写入', permissionExecute: '可执行', permissionOwner: '所有者', permissionGroup: '用户组', permissionOthers: '其他用户',
    fileUser: '用户', fileGroup: '用户组', recursiveAttributes: '同时修改子项属性', applyPermissions: '应用权限', attributesInvalid: '请填写有效的用户、用户组和 3 或 4 位八进制权限。', attributesOperation: '修改文件属性',
    newFile: '新建文件', newDirectory: '新建目录', enterName: '请输入名称', searchRunning: '正在搜索目录', taskRunning: '正在执行 {operation}', uploadProgress: '正在上传 {current} / {total}', fileOperations: '文件任务', queuedOperation: '排队第 {position} 位', processingOperation: '正在处理', cancelOperation: '取消操作',
    operationComplete: '文件操作已完成', operationFailed: '文件操作失败', attributesUnsupported: '当前挂载不支持修改 Unix 用户、用户组或权限。请改用支持 Unix metadata 的 Linux/WSL 路径或 named volume。', confirmDeleteFiles: '永久删除选中的 {count} 项？此操作无法撤销。',
    operationSucceeded: '已完成', operationCancelled: '已取消', operationFailedState: '失败',
    editFile: '编辑文件', fileContent: '文件内容', close: '关闭', reload: '重新加载', saveAs: '另存为', save: '保存', renameItem: '重命名项目', renameItemDetail: '为所选项目输入新名称。', saveAsTitle: '另存为', saveAsDetail: '输入要保存到的容器绝对路径。', discardChangesTitle: '放弃未保存修改', unsavedFile: '有未保存的文件修改，确定丢弃吗？', discardChanges: '放弃修改', deleteFilesTitle: '永久删除', confirmDelete: '确认删除', fileEditorUnsaved: '有未保存的修改', fileEditorSaved: '所有修改均已保存', fileEditorSaving: '正在保存',
    fileSaved: '文件已保存', fileRevisionChanged: '文件已被其他程序修改，请重新加载或另存为。', clipboardCopy: '已复制 {count} 项，进入目标目录后点击粘贴。', clipboardMove: '已剪切 {count} 项，进入目标目录后点击粘贴。',
    fileConflictTitle: '目标已存在', fileConflictDetail: '请选择处理方式：', conflictOverwrite: '覆盖', conflictOverwriteDetail: '替换已有项目。', conflictRename: '自动重命名', conflictRenameDetail: '使用新名称保留两个项目。', conflictSkip: '跳过', conflictSkipDetail: '保留已有项目，不执行本项操作。', conflictApplyAll: '应用到之后的所有冲突', confirmChoice: '确认', operationCompleteWithSkipped: '文件操作已完成，已跳过 {count} 个冲突项。',
    online: '已连接', connecting: '正在重连', offline: '连接中断',
  }),
  en: Object.freeze({
    title: 'DSH Management Console', consoleLabel: 'Standalone console', intro: 'DSH Docker runtime, updates, and recovery',
    switchLanguage: 'Language', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', themeButtonLabel: '{current}; switch to {next}',
    managementSections: 'Platform management sections', updatesTab: 'Updates', proxyTab: 'Proxy', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins', skillsTab: 'System skills', userSkillsTab: 'User skills', userPluginsTab: 'User plugins', terminalTab: 'Container terminal', filesTab: 'Files',
    proxyTitle: 'Proxy settings', proxyDetail: 'Use an existing HTTP or SOCKS5 proxy for selected outbound traffic.', proxyProtocol: 'Protocol', proxyHost: 'Host', proxyPort: 'Port', proxyUsername: 'Username', proxyPassword: 'Password', proxyPasswordPlaceholder: 'Leave blank to keep the saved password', proxyRemoteDns: 'Resolve target DNS through SOCKS5', proxyRemoteDnsDetail: 'Avoids resolving target names inside the container.', proxyClearPassword: 'Remove the saved proxy password', proxyPasswordConfigured: 'A proxy password is saved and is never returned by the platform.', proxyPasswordNotConfigured: 'No proxy password is saved.', proxyTransportWarning: 'This page is not using HTTPS. Proxy credentials are protected only by the current network boundary.', proxyComponentReady: 'Outbound Proxy is ready', proxyComponentUnavailable: 'Outbound Proxy is unavailable',
    proxyScopes: 'Traffic scopes', proxyScopesDetail: 'Select which managed outbound traffic uses this proxy.', proxyScopeHelp: 'Scope guide', proxyScopeGuideTitle: 'Proxy scope guide', proxyScopeGuideDetail: 'How managed network sources are classified.', proxyScopeUpdates: 'Updates', proxyScopeUpdatesDetail: 'Metadata checks and remote Artifact downloads.', proxyScopePlatform: 'Platform components', proxyScopePlatformDetail: 'External requests from DSH Docker components and System Plugins.', proxyScopeDshCore: 'DSH core', proxyScopeDshCoreDetail: 'DSH core traffic excluding model Provider APIs.', proxyScopeDshPlugins: 'DSH plugins', proxyScopeDshPluginsDetail: 'Official and user-installed DSH plugins.', proxyScopeAgent: 'Agent network operations', proxyScopeAgentDetail: 'Agent network tools, commands, and child processes.', proxyScopeTerminal: 'Container terminal', proxyScopeTerminalDetail: 'Shell sessions created by this Management Console.',
    proxyRules: 'Direct rules', proxyRulesDetail: 'Listed destinations bypass the external proxy.', proxyDirectRules: 'Additional direct rules', proxyDirectRulesDetail: 'One host, domain suffix, IP address, or CIDR per line. Use .example.com, not *.example.com.', proxyDirectRulesPlaceholder: '.example.com\n10.0.0.0/8', proxySystemRules: 'Built-in rules', proxySystemRulesTitle: 'Built-in direct rules', proxySystemRulesDetail: 'These platform-managed local destinations are always direct and do not need to be entered again.', proxyAllProxy: 'Set ALL_PROXY where support is verified', proxyAllProxyDetail: 'Injected only into clients with verified ALL_PROXY support.',
    proxyProviders: 'Model Providers', proxyProvidersDetail: 'Independent routing is available only for Providers with verified dispatcher integration.', proxyNoProviders: 'No model Providers were found.', proxyProviderDirect: 'Forced direct', proxyProviderIndependent: 'Independent routing', proxyProviderShared: 'Follow DSH', proxyProviderInfo: 'View routing information for {name}', proxyProviderReasonLocal: 'Local Providers are always direct.', proxyProviderReasonShared: 'The current client cannot carry a stable Provider identity.',
    proxyTest: 'Connection test', proxyTestDetail: 'Tests the current form without saving or activating it.', proxyTestStart: 'Test connection', proxySave: 'Save and apply', proxySaving: 'Saving proxy settings', proxySaved: 'Proxy settings saved and applied', proxyTestRunning: 'Testing proxy connection', proxyTestSuccess: 'Proxy connection test passed', proxyTestFailed: 'Proxy connection test failed', proxyTestCancelled: 'Proxy connection test cancelled', proxyStageAddress: 'Resolve proxy address', proxyStageConnect: 'Connect to proxy server', proxyStageHandshake: 'Verify proxy protocol and authentication', proxyStageDns: 'Resolve target addresses', proxyStageTls: 'Verify target TLS', proxyStageHttp: 'Request GitHub and npm', proxyStagePending: 'Pending', proxyStageRunning: 'Running', proxyStageSuccess: 'Passed', proxyStageFailed: 'Failed', proxyStageSkipped: 'Not required',
    channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
    stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
    actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking',
    updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
    updateProgress: 'Update progress', rollbackProgress: 'Rollback progress', returnStableProgress: 'Return to Stable', updateToTarget: 'Update to {target}', rollbackToTarget: 'Roll back to {target}', returnStableToTarget: 'Return to Stable · {target}', progressPrepare: 'Prepare update', progressAcquire: 'Download and verify', progressBuild: 'Build Runtime', progressActivate: 'Switch and health check',
    stageLogs: 'Stage logs', hideStageLogs: 'Hide logs · {count}', showStageLogs: 'View logs · {count}', copyStageLogs: 'Copy current logs', logsCopied: 'Logs copied', viewFullTransactionLog: 'View full transaction log', noStageLogs: 'No logs for this phase yet', dismissProgress: 'Close',
    stageCompleted: 'Stage completed.', stageWaiting: 'Waiting for the previous stage.', stageProgress: 'Stage progress {progress}%', stageItemsCompleted: '{completed}/{total} items completed', expandStage: 'Expand · {count} log entries', collapseStage: 'Collapse · {count} log entries', stageItemCompleted: 'Completed: {item}', stageItemActive: 'In progress: {item}', stageItemPending: 'Pending: {item}', stageItemFailed: 'Failed: {item}',
    itemVerifyMetadata: 'Verify metadata', itemVerifyKeyring: 'Verify keyring', itemVerifyTarget: 'Verify target manifest', itemDownloadArtifacts: 'Download Artifacts', itemVerifyArtifacts: 'Verify Artifact signatures, references, sizes, and hashes', itemImportObjects: 'Import trusted objects', itemMaterializePristine: 'Materialize Pristine DSH', itemPrepareEnvironment: 'Prepare Environment', itemBuildRuntime: 'Build Runtime and apply the complete Patch Set', itemPreparePlugins: 'Prepare System Plugin Set', itemSwitchDeployment: 'Switch Deployment atomically', itemCheckHealth: 'Check service health', itemObserveProbation: 'Observe candidate Runtime', itemValidateRollback: 'Validate rollback plan and previous complete Deployment', itemPauseRuntime: 'Pause current DSH Runtime', itemSwitchPrevious: 'Switch previous complete Deployment', itemVerifySnapshot: 'Verify data snapshot', itemRestoreSnapshot: 'Restore data snapshot', itemStartRuntime: 'Start previous DSH Runtime',
    metadataVerified: 'Metadata verified.', keyringVerified: 'Keyring verified.', targetManifestVerified: 'Target manifest verified.', artifactDownloadCompleted: 'Artifact download completed.', artifactVerificationCompleted: 'Artifact signatures, references, and hashes verified.', runtimeMaterialized: 'Pristine DSH materialized.', patchSetApplied: 'Complete Patch Set applied.', systemPluginsPrepared: 'System Plugin Set prepared.', deploymentSwitched: 'Deployment switched atomically.', healthChecksPassed: 'Service health checks passed.',
    rollbackPrepareCompleted: 'Snapshot and rollback plan verified.', rollbackSwitchCompleted: 'Previous Runtime activated.', rollbackDataCompleted: 'User data restored.', rollbackVerifyCompleted: 'System health checks passed.',
    metricBytesRead: 'Read {processed} / {total}', metricBytesCopied: 'Copied {processed} / {total}', metricBytesRestored: 'Restored {processed} / {total}', metricBytesProcessed: 'Processed {processed} / {total}',
    metricArtifacts: 'Verified {processed} / {total} Artifacts', metricFiles: 'Completed {processed} / {total} files', metricItems: 'Completed {processed} / {total} items', metricServices: '{ready} / {total} services ready', metricProbationRemaining: '{seconds} seconds of observation remaining',
    rollbackPrepare: 'Prepare rollback', rollbackSwitch: 'Switch previous version', rollbackData: 'Restore data', rollbackVerify: 'Start and check',
    progressDetailChecking: 'Fetching and verifying the latest signed update metadata.', progressDetailPlanning: 'Calculating the complete target state to reconcile.', progressDetailUpstream: 'Checking the official npm registry for the latest DSH.',
    progressDetailDownloading: 'Downloading Artifacts and importing them through Stage-0 into the trusted object store.', progressDetailValidating: 'Verifying signatures, Artifact references, sizes, and content hashes.', progressDetailBuilding: 'Building an immutable Runtime from Pristine DSH, patches, and System Plugins.',
    progressDetailSnapshot: 'DSH is paused while a complete data snapshot is created for the Experimental update.', progressDetailSwitching: 'Atomically switching the complete Deployment and checking DSH readiness.', progressDetailProbation: 'The candidate Runtime remains under health observation until {until}.',
    rollbackDetailPreparing: 'Validating the rollback plan and previous complete Deployment.', rollbackDetailStopping: 'Pausing DSH before restoring the previous complete state.', rollbackDetailSwitching: 'Switching the previous Runtime, Environment, and System Plugin set.', rollbackDetailData: 'Verifying and restoring the pre-update data snapshot.', rollbackDetailVerifying: 'Starting DSH and running health checks.',
    statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream',
    statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data',
    statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusRollingBack: 'Rolling back', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
    outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold',
    outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
    requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.',
    holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.', metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.', remoteCheckFailed: 'Remote check failed. Showing the last verified result.', remoteCheckFailedNoResult: 'Remote check failed. No verified result is available yet.', upstreamCheckFailed: 'The official DSH version check failed. Showing the last verified result.', upstreamCheckFailedNoResult: 'The official DSH version check failed. No verified result is available yet.',
    aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
    returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:',
    confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
    automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off',
    checkInterval: 'Check frequency', updateNotifications: 'Update notifications', updateNotificationsDetail: 'Show an update notification popup on DSH pages when an automatic check finds a new version.',
    interval3600: 'Every hour', interval10800: 'Every 3 hours', interval21600: 'Every 6 hours', interval43200: 'Every 12 hours', interval86400: 'Every 24 hours',
    maintenance: 'DSH lifecycle', maintenanceDetail: 'Start, stop, or restart DSH while the container and management console services remain running.', startDsh: 'Start DSH', stopDsh: 'Stop DSH', restartDsh: 'Restart DSH',
    starting: 'Starting DSH', stopping: 'Stopping DSH', stopped: 'DSH stopped', restarting: 'Restarting DSH', lifecycleRunning: 'DSH is running', lifecycleFailed: 'DSH operation failed',
    restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This standalone console remains available.', confirmRestart: 'Restart',
    stopTitle: 'Stop DSH?', stopWarning: 'DSH remains stopped until it is started here or the container restarts. The management console remains available.', confirmStop: 'Stop DSH',
    runtimeReset: 'Reset runtime', runtimeResetDetail: 'Rebuild the runtime from verified DSH files and current platform patches without deleting configuration, sessions, user plugins, or workspaces.',
    cancelRuntimeReset: 'Cancel reset', runtimeResetConfirmTitle: 'Reset the current runtime', runtimeResetWarning: 'DSH stops briefly. The current version and user data remain unchanged.', confirmRuntimeReset: 'Reset and restart DSH',
    runtimeResetting: 'Resetting runtime', runtimeResetBuilding: 'Rebuilding runtime from verified files', runtimeResetVerifying: 'Verifying rebuilt runtime', runtimeResetSwitching: 'Switching runtime', runtimeResetStarting: 'Starting and checking DSH', runtimeResetRecovering: 'Reset failed; restoring the previous runtime', runtimeResetProgress: 'Runtime reset progress', runtimeResetComplete: 'Runtime reset and DSH restarted', runtimeResetFailed: 'Runtime reset failed',
    logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module',
    logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error',
    logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', autoScroll: 'Auto-scroll',
    refreshLogs: 'Refresh logs', exportLogs: 'Export logs', clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
    systemPlugins: 'System plugins', systemPluginsConsoleDetail: 'Manage every bundled System Plugin, including recovery of the Platform Management integration in DSH.',
    noSystemPlugins: 'The current Environment provides no System Plugins.', managementIntegration: 'Platform Management integration, recoverable from this standalone page.',
    notInstalled: 'Not installed', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', pluginPendingRestart: 'Restart required',
    installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings',
    pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling',
    pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginActionComplete: 'Plugin settings saved',
    pluginChangesPending: 'Changes pending', pluginChangesPendingDetail: 'Plugin changes have not been applied. Apply them to restart DSH and make them effective.', pendingSystemPluginChanges: '{count} pending changes',
    systemPluginApplyingItem: '{action} @dsh-docker/{id} ({current}/{total})', systemPluginRestarting: 'Plugin changes applied; restarting DSH',
    systemSkills: 'System skills', systemSkillsConsoleDetail: 'Manage signed Agent guidance supplied by the current Bootstrap.', noSystemSkills: 'The current Bootstrap provides no System Skills.', skillEnabled: 'Installed and enabled', skillDisabled: 'Installed but disabled', skillActionWorking: 'Applying skill settings', skillActionComplete: 'Skill settings applied',
    userSkills: 'User skills', userSkillsDetail: 'Manage skills in the DSH user roots without restarting DSH.', noUserSkills: 'No user skills were found.', userSkillEnabled: 'Enabled', userSkillDisabled: 'Disabled', userSkillDamaged: 'Damaged metadata', userSkillSource: 'Source', userSkillEntry: 'Entry', userSkillSourceDsh: 'DSH user directory', userSkillSourceAgents: 'Agents user directory', deleteUserSkill: 'Delete', deleteUserSkillTitle: 'Permanently delete user skill', deleteUserSkillDetail: 'Permanently delete “{name}” and its files? This cannot be undone.', userSkillActionWorking: 'Applying User Skill settings', userSkillActionComplete: 'User Skill settings applied', userSkillActionFailed: 'User Skill operation failed',
    userPlugins: 'User plugins', userPluginsDetail: 'Recover user-installed Web Profile plugins without starting DSH.',
    noUserPlugins: 'No managed user plugins were found in the Web Profile.', dshUnavailable: 'DSH is unavailable',
    userPluginVersion: 'Version', userPluginSpec: 'Dependency spec', userPluginSource: 'Source', userPluginSourceRegistry: 'Registry',
    userPluginSourceFile: 'Local file', userPluginSourceGit: 'Git', userPluginSourceUrl: 'URL', userPluginSourceOther: 'Other',
    userPluginEnabled: 'Enabled', userPluginDisabled: 'Disabled', userPluginDamaged: 'Damaged metadata', userPluginReserved: 'Conflicts with a System Plugin',
    pendingInstall: 'Pending install', pendingEnable: 'Pending enable', pendingDisable: 'Pending disable', pendingUninstall: 'Pending uninstall', statusInstalling: 'Installing', statusEnabling: 'Enabling', statusDisabling: 'Disabling', statusUninstalling: 'Uninstalling', resourceEnabled: 'Enabled', resourceDisabled: 'Disabled', uninstallUserPlugin: 'Uninstall', cancelUninstall: 'Cancel uninstall',
    noPendingUserPluginChanges: 'No pending changes', pendingUserPluginChanges: '{count} changes pending', cancelChanges: 'Cancel changes',
    applyUserPluginChanges: 'Apply and restart DSH', userPluginApplying: 'Applying user plugin changes', userPluginApplyComplete: 'User plugin changes applied',
    userPluginApplyFailed: 'User plugin recovery failed', userPluginRevisionConflict: 'Plugin state changed. The latest inventory has been loaded; select your changes again.',
    userPluginRestartRequired: 'Restart DSH required', userPluginRestartRequiredDetail: 'User plugins changed in the terminal or elsewhere and take effect after DSH restarts.',
    userPluginMetadataError: 'Installed plugin metadata could not be read.', userPluginRecoveryDetail: 'DSH failed to start or stopped unexpectedly. Review the Maintenance logs for details.',
    userPluginPhaseValidated: 'Validating changes', userPluginPhasePaused: 'Pausing DSH', userPluginPhaseSnapshotted: 'Web Profile backed up',
    userPluginPhaseMutating: 'Changing plugins', userPluginPhaseCommitted: 'Changes saved', userPluginPhaseRestarting: 'Restarting DSH', userPluginPhaseRestoring: 'Restoring Web Profile',
    terminal: 'Container terminal', terminalDetail: 'Open an interactive container shell with administrator privileges. The session remains running when only DSH restarts.',
    newTerminal: 'New session', closeTerminal: 'Close session', terminalIdle: 'No active session', terminalLoading: 'Loading terminal components', terminalLoadFailed: 'Terminal components failed to load. Try again.', terminalStarting: 'Creating session',
    terminalConnecting: 'Connecting terminal', terminalConnected: 'Terminal connected', terminalReconnecting: 'Connection lost, reconnecting',
    terminalExited: 'Shell exited ({status})', terminalFailed: 'Terminal connection failed', terminalClosed: 'Terminal session closed',
    terminalPlaceholder: 'Start a session to open an interactive Bash shell.', terminalScreen: 'Container terminal',
    files: 'File management', filesDetail: 'View and manage container files with administrator privileges.', newItem: 'New', upload: 'Upload', uploadFiles: 'Upload files', uploadDirectory: 'Upload folder', dropToUpload: 'Drop to upload here', dropUploadDestination: 'Files and folders will be uploaded to the current directory.', download: 'Download', refresh: 'Refresh', back: 'Back', forward: 'Forward', parentDirectory: 'Parent directory', path: 'Path',
    itemType: 'Item type', itemName: 'Name', createItem: 'Create', createLocation: 'Create in: {path}', invalidFileName: 'The name cannot be empty, . or .., contain / or control characters, or exceed 255 bytes.',
    filterFiles: 'Filter this directory', searchDirectory: 'Search this directory', showHidden: 'Show hidden files', managedPathWarning: 'This path is platform-managed. Changes may be replaced by restart, update, or runtime rebuild and can damage the current deployment.',
    locations: 'Locations', selectAll: 'Select all', fileName: 'Name', fileSize: 'Size', fileOwner: 'User:group', fileModified: 'Modified', fileMode: 'Mode', calculateSize: 'Calculate', calculatingSize: 'Calculating', sizeCalculationFailed: 'Failed', emptyDirectory: 'This directory is empty.', loadMore: 'Load more', itemsPerPage: 'Items per page', itemsPerPageSuffix: '/ page', previousPage: 'Previous', nextPage: 'Next', totalItems: '{total} total', goToPage: 'Go to', pageUnit: 'page',
    searchSystemPlugins: 'Search System Plugins', searchSystemSkills: 'Search System Skills', searchUserPlugins: 'Search User Plugins', searchUserSkills: 'Search User Skills', noMatchingResources: 'No items match this search.',
    noFilesSelected: 'No files selected', filesSelected: '{count} selected', copy: 'Copy', cut: 'Cut', paste: 'Paste', compress: 'Compress', extract: 'Extract', rename: 'Rename', deletePermanently: 'Delete permanently',
    compressItems: 'Compress selected items', extractArchive: 'Extract archive', archiveFormat: 'Archive format', archiveName: 'Archive name', invalidArchiveName: 'Enter a valid archive name.', unsupportedArchive: 'Select a ZIP, 7z, or tar.gz file.',
    editPermissions: 'Edit permissions', permissions: 'Permissions', permissionRead: 'Read', permissionWrite: 'Write', permissionExecute: 'Execute', permissionOwner: 'Owner', permissionGroup: 'Group', permissionOthers: 'Others',
    fileUser: 'User', fileGroup: 'Group', recursiveAttributes: 'Also change child attributes', applyPermissions: 'Apply permissions', attributesInvalid: 'Enter a valid user, group, and a 3- or 4-digit octal mode.', attributesOperation: 'Changing file attributes',
    newFile: 'New file', newDirectory: 'New directory', enterName: 'Enter a name', searchRunning: 'Searching directory', taskRunning: 'Running {operation}', uploadProgress: 'Uploading {current} / {total}', fileOperations: 'File operations', queuedOperation: 'Queue position {position}', processingOperation: 'Processing', cancelOperation: 'Cancel operation',
    operationComplete: 'File operation completed', operationFailed: 'File operation failed', attributesUnsupported: 'This mount does not support changing Unix ownership or permissions. Use a Linux/WSL path or named volume with Unix metadata support.', confirmDeleteFiles: 'Permanently delete {count} selected items? This cannot be undone.',
    operationSucceeded: 'Completed', operationCancelled: 'Cancelled', operationFailedState: 'Failed',
    editFile: 'Edit file', fileContent: 'File content', close: 'Close', reload: 'Reload', saveAs: 'Save as', save: 'Save', renameItem: 'Rename item', renameItemDetail: 'Enter a new name for the selected item.', saveAsTitle: 'Save as', saveAsDetail: 'Enter the absolute container path to save.', discardChangesTitle: 'Discard unsaved changes', unsavedFile: 'Discard unsaved file changes?', discardChanges: 'Discard changes', deleteFilesTitle: 'Delete permanently', confirmDelete: 'Delete',
    fileSaved: 'File saved', fileRevisionChanged: 'The file changed in another process. Reload it or save as a new file.', clipboardCopy: '{count} items copied. Open the destination and choose Paste.', clipboardMove: '{count} items cut. Open the destination and choose Paste.', fileEditorUnsaved: 'Unsaved changes', fileEditorSaved: 'All changes saved', fileEditorSaving: 'Saving',
    fileConflictTitle: 'Destination already exists', fileConflictDetail: 'Choose how to handle:', conflictOverwrite: 'Overwrite', conflictOverwriteDetail: 'Replace the existing item.', conflictRename: 'Auto rename', conflictRenameDetail: 'Keep both items with a new name.', conflictSkip: 'Skip', conflictSkipDetail: 'Leave the existing item unchanged.', conflictApplyAll: 'Apply to all remaining conflicts', confirmChoice: 'Confirm', operationCompleteWithSkipped: 'File operation completed; skipped {count} conflicting items.',
    online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
  }),
})

function preferredLocale() {
  const override = storageValue(LANGUAGE_KEY)
  if (override === 'zh' || override === 'en') return override
  return String(navigator.language ?? '').toLowerCase().split('-', 1)[0] === 'zh' ? 'zh' : 'en'
}

const locale = preferredLocale()
let themePreference = (() => {
  const value = storageValue(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
})()
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const channelButtons = [...document.querySelectorAll('[data-channel]')]
const tabButtons = [...document.querySelectorAll('[data-tab]')]
makeHorizontalTabStripScrollable(document.querySelector('.tabs'))
makeLogListVerticallyResizable(elements['log-resize-frame'], elements['log-resize-handle'])
const RUNTIME_RESET_PHASES = Object.freeze({
  'runtime-reset-building': Object.freeze({ progress: 20, label: 'runtimeResetBuilding' }),
  'runtime-reset-verifying': Object.freeze({ progress: 55, label: 'runtimeResetVerifying' }),
  'runtime-reset-switching': Object.freeze({ progress: 70, label: 'runtimeResetSwitching' }),
  'runtime-reset-starting': Object.freeze({ progress: 85, label: 'runtimeResetStarting' }),
  'runtime-reset-recovering': Object.freeze({ progress: 90, label: 'runtimeResetRecovering' }),
})
let status
let plugins = []
let systemSkills = []
let userSkillInventory = { revision: null, skills: [] }
let userPluginInventory = { revision: null, plugins: [] }
let proxyConfiguration
let proxyProviderInventory = { providers: [] }
let proxyLoaded = false
let proxyLoading
let proxyTestTask
let proxyTestPollTimer
const inventoriesLoaded = { plugins: false, systemSkills: false, userSkills: false, userPlugins: false }
const inventoryLoadRevisions = { plugins: 0, systemSkills: 0, userSkills: 0, userPlugins: 0 }
const LIST_PAGE_SIZES = Object.freeze([5, 10, 20, 50])
const LIST_PAGE_SIZE_KEY_PREFIX = 'dsh-platform:console-page-size:'
const listPages = { plugins: 0, systemSkills: 0, userSkills: 0, userPlugins: 0 }
const listQueries = { plugins: '', systemSkills: '', userSkills: '', userPlugins: '' }
const listPageSizes = Object.fromEntries(Object.keys(listPages).map(key => {
  const value = Number(storageValue(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`))
  return [key, LIST_PAGE_SIZES.includes(value) ? value : 10]
}))
const userPluginDraft = new Map()
const userPluginApplyingDraft = new Map()
const expandedUserPluginDescriptions = new Set()
const expandedUserPluginMetadata = new Set()
const systemPluginDraft = new Map()
const expandedUserSkillDescriptions = new Set()
const expandedUserSkillMetadata = new Set()
const expandedSystemPluginDescriptions = new Set()
const expandedSystemSkillDescriptions = new Set()
let rollbackPlan
let statusLoad
let statusLoadRevision = 0
const inventoryLoads = { plugins: undefined, systemSkills: undefined, userSkills: undefined, userPlugins: undefined }
let checking = false
let acting = false
let discardingPluginDraft = false
let userPluginSubmitting = false
let systemPluginSubmitting = false
let systemPluginProgress
const systemPluginApplyingDraft = new Map()
let userPluginFeedback = null
const visibleOperationTasks = new Set()
const operationResultTimers = new Map()
let eventSource
let logSource
let progressLogSource
let progressLogKey
let progressLogEntries = []
const progressLogIdentities = new Set()
let progressLogUpdate
const progressLogStageExpansion = new Map()
const progressLogStageTouched = new Set()
let progressLogAutoScroll = true
let progressSuccessTimer
let progressSuccessTimerKey
let progressSuccessDismissedKey
let dismissedProgressTaskId
let logLastActivity = 0
let logWatchdogTimer
let logRenderFrame
let autoScroll = true
let terminalRuntime
let terminalRuntimeLoad
let terminalStyleLoad
let terminalRestore
let terminalEmulator
let terminalFit
let terminalSocket
let terminalSessionId
let terminalSessionState = 'idle'
let terminalReconnectTimer
let terminalReconnectDeadline
let terminalResizeObserver
let terminalResizeFrame
let terminalRestored = false
let terminalLeaving = false
let runtimeResetExpanded = false
let runtimeResetProgress = 0
let filesLoaded = false
let fileConfigLoad
let fileLoading = false
let filePath = '/workspace'
let fileListing = { revision: null, entries: [], nextCursor: null, total: 0 }
let fileSort = 'name'
let fileOrder = 'asc'
let filePageSize = 100
let filePageIndex = 0
let fileHistory = []
let fileFuture = []
let fileCreateExpanded = false
let fileCreateKind = 'touch'
let fileSelected = new Set()
let fileClipboard = null
const fileDirectorySizes = new Map()
let fileActiveTask = null
let fileTasksActive = []
let fileUploadQueue = []
let fileDragDepth = 0
let fileTaskRefreshTimer
let fileArchiveMode = null
let fileEditor = null
let fileEditorOriginal = ''
let fileEditorDirty = false
let fileEditorSaving = false
let fileOperationTimer
let fileAttributesEntry = null
let fileConflictResolve = null
let textInputResolve
let textInputValidate
let confirmationResolve
const logEntries = []
const logIdentities = new Set()
const expandedLogIdentities = new Set()
let logDisplayLimit = (() => {
  const value = Number(storageValue(LOG_DISPLAY_LIMIT_KEY))
  return LOG_DISPLAY_LIMITS.includes(value) ? value : DEFAULT_LOG_DISPLAY_LIMIT
})()
let logClearCutoff = (() => {
  try {
    const value = window.sessionStorage.getItem(LOG_CLEAR_CUTOFF_KEY)
    return Number.isFinite(Date.parse(value)) ? value : null
  } catch { return null }
})()

function t(key, values = {}) {
  let result = COPY[locale][key] ?? COPY.en[key] ?? key
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, String(value))
  return result
}

function applyTranslations() {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  document.title = t('title')
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder)
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.setAttribute('title', t(node.dataset.i18nTitle))
  for (const node of document.querySelectorAll('[data-log-limit]')) node.textContent = t('logDisplayLimitValue', { count: node.dataset.logLimit })
  elements['language-switch'].value = locale
  renderThemeControl()
  refreshProxyDescriptions()
}

const THEME_ORDER = Object.freeze(['system', 'light', 'dark'])

function renderThemeControl() {
  const currentIndex = THEME_ORDER.indexOf(themePreference)
  const next = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]
  const label = t('themeButtonLabel', { current: t(`theme${themePreference[0].toUpperCase()}${themePreference.slice(1)}`), next: t(`theme${next[0].toUpperCase()}${next.slice(1)}`) })
  elements['theme-switch'].dataset.themePreference = themePreference
  elements['theme-switch'].setAttribute('aria-label', label)
  elements['theme-switch'].title = label
}

function applyTheme(preference) {
  if (preference === 'light' || preference === 'dark') document.documentElement.dataset.theme = preference
  else delete document.documentElement.dataset.theme
  if (terminalEmulator !== undefined) terminalEmulator.options.theme = terminalTheme()
}

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function makeHorizontalTabStripScrollable(tablist) {
  let pointerId
  let pointerStartX = 0
  let scrollStart = 0
  let wheelTarget = tablist.scrollLeft
  let wheelFrame
  let wheelFrameTime
  let dragged = false
  let dragTarget
  let suppressClickTarget

  const stopWheelAnimation = () => {
    if (wheelFrame !== undefined) window.cancelAnimationFrame(wheelFrame)
    wheelFrame = undefined
    wheelFrameTime = undefined
    wheelTarget = tablist.scrollLeft
  }
  const animateWheel = timestamp => {
    const elapsed = wheelFrameTime === undefined ? 16 : Math.min(timestamp - wheelFrameTime, 32)
    const remaining = wheelTarget - tablist.scrollLeft
    if (Math.abs(remaining) < 0.5) {
      tablist.scrollLeft = wheelTarget
      wheelFrame = undefined
      wheelFrameTime = undefined
      return
    }
    tablist.scrollLeft += remaining * (1 - Math.exp(-elapsed / 45))
    wheelFrameTime = timestamp
    wheelFrame = window.requestAnimationFrame(animateWheel)
  }

  const finishDrag = event => {
    if (pointerId === undefined || (event.pointerId !== undefined && event.pointerId !== pointerId)) return
    if (tablist.hasPointerCapture?.(pointerId)) tablist.releasePointerCapture(pointerId)
    const displacedClickTarget = !dragged && event.target !== dragTarget ? dragTarget : undefined
    suppressClickTarget = dragged ? dragTarget : undefined
    if (suppressClickTarget !== undefined) window.setTimeout(() => { suppressClickTarget = undefined }, 0)
    pointerId = undefined
    dragged = false
    dragTarget = undefined
    displacedClickTarget?.click()
  }

  tablist.addEventListener('wheel', event => {
    if (tablist.scrollWidth <= tablist.clientWidth) return
    if (event.deltaX !== 0) return
    let delta = event.deltaY
    if (delta === 0) return
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= tablist.clientWidth
    if (wheelFrame === undefined) wheelTarget = tablist.scrollLeft
    const nextTarget = Math.max(0, Math.min(tablist.scrollWidth - tablist.clientWidth, wheelTarget + delta))
    if (nextTarget === wheelTarget) return
    wheelTarget = nextTarget
    if (wheelFrame === undefined) wheelFrame = window.requestAnimationFrame(animateWheel)
    event.preventDefault()
  }, { passive: false })
  tablist.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch' || tablist.scrollWidth <= tablist.clientWidth) return
    stopWheelAnimation()
    pointerId = event.pointerId
    pointerStartX = event.clientX
    scrollStart = tablist.scrollLeft
    dragged = false
    dragTarget = event.target
  })
  tablist.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return
    const distance = event.clientX - pointerStartX
    if (Math.abs(distance) >= 4 && !dragged) {
      dragged = true
      tablist.setPointerCapture?.(pointerId)
    }
    if (!dragged) return
    tablist.scrollLeft = scrollStart - distance
    event.preventDefault()
  })
  tablist.addEventListener('pointerup', finishDrag)
  tablist.addEventListener('pointercancel', finishDrag)
  tablist.addEventListener('click', event => {
    if (event.target !== suppressClickTarget) return
    suppressClickTarget = undefined
    event.preventDefault()
    event.stopPropagation()
  }, true)
}

function makeLogListVerticallyResizable(element, handle) {
  let pointerId
  let startY = 0
  let startHeight = 0
  let startScrollTop = 0
  let lastClientY = 0
  let minimumHeight = 0
  let maximumHeight = 0
  let scrollFrame
  let previousCursor = ''
  let previousUserSelect = ''
  const scrollContainer = (() => {
    for (let candidate = element.parentElement; candidate !== null; candidate = candidate.parentElement) {
      const overflowY = window.getComputedStyle(candidate).overflowY
      if (/(auto|scroll)/u.test(overflowY)) return candidate
    }
    return document.scrollingElement
  })()
  const keepBottomVisible = () => {
    if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = undefined
      if (scrollContainer === null) return
      const viewportBottom = scrollContainer === document.scrollingElement
        ? window.innerHeight
        : scrollContainer.getBoundingClientRect().bottom
      const overflow = element.getBoundingClientRect().bottom - viewportBottom + 8
      if (overflow <= 0) return
      const previousScrollTop = scrollContainer.scrollTop
      scrollContainer.scrollTop += Math.min(overflow, 24)
      const height = Math.min(maximumHeight, Math.max(minimumHeight,
        startHeight + lastClientY - startY + scrollContainer.scrollTop - startScrollTop))
      element.style.height = `${String(height)}px`
      if (scrollContainer.scrollTop > previousScrollTop
        && (pointerId === undefined || lastClientY >= viewportBottom - 24)) keepBottomVisible()
    })
  }
  handle.addEventListener('pointerdown', event => {
    event.preventDefault()
    pointerId = event.pointerId
    startY = event.clientY
    lastClientY = event.clientY
    startHeight = element.getBoundingClientRect().height
    startScrollTop = scrollContainer?.scrollTop ?? 0
    const style = window.getComputedStyle(element)
    minimumHeight = Number.parseFloat(style.minHeight)
    maximumHeight = Number.parseFloat(style.maxHeight)
    previousCursor = document.body.style.cursor
    previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    handle.setPointerCapture?.(pointerId)
  })
  window.addEventListener('pointermove', event => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    lastClientY = event.clientY
    const height = Math.min(maximumHeight, Math.max(minimumHeight,
      startHeight + lastClientY - startY + (scrollContainer?.scrollTop ?? 0) - startScrollTop))
    element.style.height = `${String(height)}px`
    keepBottomVisible()
  })
  const finishResize = event => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    pointerId = undefined
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    keepBottomVisible()
  }
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
}

function localTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

const UPDATE_PROGRESS_STEPS = Object.freeze(['progressPrepare', 'progressAcquire', 'progressBuild', 'progressActivate'])
const UPDATE_PROGRESS_STAGE = Object.freeze({
  checking: 0,
  planning: 0,
  'checking-upstream': 0,
  downloading: 1,
  validating: 1,
  'building-candidate': 2,
  'snapshotting-data': 3,
  switching: 3,
  probation: 3,
  'restoring-data': 3,
})
const ROLLBACK_PROGRESS_STEPS = Object.freeze(['rollbackPrepare', 'rollbackSwitch', 'rollbackData', 'rollbackVerify'])
const ROLLBACK_PROGRESS_STAGE = Object.freeze({ preparing: 0, stopping: 0, switching: 1, 'restoring-data': 2, verifying: 3 })

function isRecoveryOperation(operation) {
  return operation === 'rollback' || operation === 'return-stable'
}

function probationRemainingSeconds(update) {
  const detail = String(update?.detail ?? '').match(/^probation:(\d+)$/u)
  if (detail !== null) return Number(detail[1])
  const deadline = Date.parse(update?.probationUntil ?? '')
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)) : undefined
}

function progressLogPhase(update) {
  return update?.phase ?? (isRecoveryOperation(update?.operation) ? update?.rollbackPhase : update?.status)
}

function progressLogStage(phase, update = progressLogUpdate) {
  const rollback = isRecoveryOperation(update?.operation)
  const stageMap = rollback ? ROLLBACK_PROGRESS_STAGE : UPDATE_PROGRESS_STAGE
  const labels = rollback ? ROLLBACK_PROGRESS_STEPS : UPDATE_PROGRESS_STEPS
  let index = stageMap[phase]
  if (index === undefined) return { key: `phase:${String(phase ?? 'unknown')}`, label: String(phase ?? t('stageLogs')), index: labels.length }
  if (rollback && update?.rollbackIncludesSnapshot === false && index > 2) index -= 1
  const visibleLabels = rollback && update?.rollbackIncludesSnapshot === false
    ? labels.filter(key => key !== 'rollbackData')
    : labels
  return { key: `${rollback ? 'rollback' : 'update'}:${String(index)}`, label: t(visibleLabels[index] ?? 'stageLogs'), index }
}

function progressLogText(entry) {
  const message = entry?.message ?? entry?.event ?? ''
  return String(message).replace(/\s+/gu, ' ').trim() || '-'
}

function progressStageDefinitions(update) {
  const rollback = isRecoveryOperation(update?.operation)
  const labels = rollback
    ? ROLLBACK_PROGRESS_STEPS.filter(key => update.rollbackIncludesSnapshot !== false || key !== 'rollbackData')
    : UPDATE_PROGRESS_STEPS
  return labels.map((label, index) => ({
    key: `${rollback ? 'rollback' : 'update'}:${String(index)}`,
    label: t(label),
    labelKey: label,
    index,
  }))
}

const UPDATE_STAGE_ITEMS = Object.freeze({
  progressPrepare: ['itemVerifyMetadata', 'itemVerifyKeyring', 'itemVerifyTarget'],
  progressAcquire: ['itemDownloadArtifacts', 'itemVerifyArtifacts', 'itemImportObjects'],
  progressBuild: ['itemMaterializePristine', 'itemPrepareEnvironment', 'itemBuildRuntime', 'itemPreparePlugins'],
  progressActivate: ['itemSwitchDeployment', 'itemCheckHealth', 'itemObserveProbation'],
})

const UPDATE_RECOVERY_STAGE_ITEMS = Object.freeze([
  'itemSwitchPrevious', 'itemRestoreSnapshot', 'itemStartRuntime', 'itemCheckHealth',
])

const ROLLBACK_STAGE_ITEMS = Object.freeze({
  rollbackPrepare: ['itemValidateRollback', 'itemPauseRuntime'],
  rollbackSwitch: ['itemSwitchPrevious'],
  rollbackData: ['itemVerifySnapshot', 'itemRestoreSnapshot'],
  rollbackVerify: ['itemStartRuntime', 'itemCheckHealth'],
})

function activeStageItemIndex(stage, update) {
  const phase = progressLogPhase(update)
  if (stage.labelKey === 'progressPrepare') return phase === 'planning' ? 2 : 0
  if (stage.labelKey === 'progressAcquire') return phase === 'validating' ? 2 : 0
  if (stage.labelKey === 'progressBuild') {
    const progress = Number(update?.progress) || 0
    if (Number(update?.totalBytes) > 0 || Number(update?.totalItems) > 0) return progress >= 87 ? 3 : 2
    if (progress < 80) return 0
    if (progress < 82) return 1
    if (progress < 87) return 2
    return 3
  }
  if (stage.labelKey === 'progressActivate') {
    if (phase === 'restoring-data') {
      return {
        'recovery:suspend': 0,
        'recovery:deployment': 0,
        'recovery:snapshot': 1,
        'recovery:runtime': 2,
        'recovery:health': 3,
      }[update?.detail] ?? 0
    }
    if (phase === 'probation') return 2
    if (Number(update?.totalServices) > 0) return 1
    return update?.rollbackIncludesSnapshot === true && phase === 'snapshotting-data' ? 0 : 0
  }
  if (stage.labelKey === 'rollbackPrepare') return phase === 'stopping' ? 1 : 0
  if (stage.labelKey === 'rollbackSwitch') return 0
  if (stage.labelKey === 'rollbackData') return Number(update?.totalItems) > 0 || Number(update?.totalBytes) > 0 ? 1 : 0
  if (stage.labelKey === 'rollbackVerify') return Number(update?.totalServices) > 0 ? 1 : 0
  return 0
}

function stageItems(stage, update, state) {
  const keys = stage.labelKey === 'progressActivate' && progressLogPhase(update) === 'restoring-data'
    ? UPDATE_RECOVERY_STAGE_ITEMS
    : (stage.key.startsWith('rollback') ? ROLLBACK_STAGE_ITEMS : UPDATE_STAGE_ITEMS)[stage.labelKey] ?? ['stageCompleted']
  const active = activeStageItemIndex(stage, update)
  return keys.map((key, index) => ({
    key,
    label: t(key),
    state: state === 'completed' ? 'completed'
      : state === 'pending' ? 'pending'
        : index < active ? 'completed'
          : index === active ? (state === 'failed' ? 'failed' : 'active') : 'pending',
  }))
}

function stageMetricLines(value, stage, state) {
  const lines = []
  const bytes = Number(value?.processedBytes)
  const totalBytes = Number(value?.totalBytes)
  const items = Number(value?.processedItems)
  const totalItems = Number(value?.totalItems)
  const ready = Number(value?.readyServices)
  const totalServices = Number(value?.totalServices)
  const completeEnough = state !== 'completed' || stageMetricProgress(value) === 100
  if (stage.index > 0 && completeEnough && Number.isFinite(bytes) && Number.isFinite(totalBytes) && totalBytes > 0) {
    const key = stage.index === 1 && !stage.key.startsWith('rollback')
      ? 'metricBytesRead'
      : stage.index === 2 && !stage.key.startsWith('rollback')
        ? 'metricBytesCopied'
        : stage.key.startsWith('rollback') && stage.label === t('rollbackData')
          ? 'metricBytesRestored'
          : 'metricBytesProcessed'
    lines.push(t(key, { processed: fileSize(bytes), total: fileSize(totalBytes) }))
  }
  if (stage.index > 0 && completeEnough && Number.isFinite(items) && Number.isFinite(totalItems) && totalItems > 0) {
    const key = stage.index === 1 && !stage.key.startsWith('rollback') ? 'metricArtifacts'
      : stage.index >= 2 || stage.key.startsWith('rollback') ? 'metricFiles' : 'metricItems'
    lines.push(t(key, { processed: String(items), total: String(totalItems) }))
  }
  if (Number.isFinite(ready) && Number.isFinite(totalServices) && totalServices > 0) {
    lines.push(t('metricServices', { ready: String(ready), total: String(totalServices) }))
  }
  if (stage.labelKey === 'progressActivate' && progressLogPhase(value) === 'probation') {
    const seconds = probationRemainingSeconds(value)
    if (seconds !== undefined) lines.push(t('metricProbationRemaining', { seconds: String(seconds) }))
  }
  return lines
}

function stageMetricProgress(value) {
  for (const [processedKey, totalKey] of [['processedBytes', 'totalBytes'], ['processedItems', 'totalItems'], ['readyServices', 'totalServices']]) {
    const processed = Number(value?.[processedKey])
    const total = Number(value?.[totalKey])
    if (Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
      return Math.max(0, Math.min(100, Math.round(processed / total * 100)))
    }
  }
  return undefined
}

function progressLogTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '-' : localTime(value)
}

function transactionStageState(index, currentIndex, status) {
  if (index < currentIndex || (index === currentIndex && status === 'success')) return 'completed'
  if (index === currentIndex) return status === 'failed' ? 'failed' : 'active'
  return 'pending'
}

function renderProgressLogs() {
  const panel = elements['progress-stage-log']
  if (!panel) return
  panel.hidden = progressLogKey === undefined
  if (panel.hidden) return
  const activeStage = progressLogStage(progressLogPhase(progressLogUpdate))
  elements['progress-log-list'].replaceChildren()
  const groups = new Map()
  for (const entry of progressLogEntries) {
    const stage = progressLogStage(entry.phase)
    const group = groups.get(stage.key) ?? { ...stage, entries: [] }
    group.entries.push(entry)
    groups.set(stage.key, group)
  }
  const failed = progressLogUpdate?.status === 'failed'
  const definitions = progressStageDefinitions(progressLogUpdate)
  for (const definition of definitions) {
    const group = groups.get(definition.key) ?? { ...definition, entries: [] }
    const state = transactionStageState(group.index, activeStage.index, progressLogUpdate?.status)
    group.labelKey = definition.labelKey
    const latest = group.entries.at(-1)
    const metricSource = state === 'active' || state === 'failed' ? { ...latest, ...progressLogUpdate } : latest
    const metricLines = stageMetricLines(metricSource, group, state)
    const items = stageItems(group, progressLogUpdate, state)
    const completedItems = items.filter(item => item.state === 'completed').length
    const stageDetails = document.createElement('details')
    stageDetails.className = `progress-log-group ${state}`
    stageDetails.dataset.stageKey = group.key
    const defaultExpanded = state === 'active' || state === 'failed'
    stageDetails.open = progressLogStageExpansion.get(group.key) ?? defaultExpanded
    const stageSummary = document.createElement('summary')
    const marker = document.createElement('span')
    marker.className = `progress-stage-marker ${state}`
    marker.setAttribute('aria-hidden', 'true')
    const summaryBody = document.createElement('span')
    summaryBody.className = 'progress-stage-summary'
    const stageName = document.createElement('strong')
    stageName.textContent = group.label
    summaryBody.append(stageName)
    const count = document.createElement('span')
    count.className = 'progress-stage-count'
    count.textContent = t('stageItemsCompleted', { completed: String(completedItems), total: String(items.length) })
    summaryBody.append(count)
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'progress-stage-toggle'
    toggle.setAttribute('aria-expanded', String(stageDetails.open))
    toggle.textContent = t(stageDetails.open ? 'collapseStage' : 'expandStage', { count: String(group.entries.length) })
    toggle.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      progressLogStageTouched.add(group.key)
      const nextOpen = !stageDetails.open
      progressLogStageExpansion.set(group.key, nextOpen)
      stageDetails.open = nextOpen
      toggle.setAttribute('aria-expanded', String(nextOpen))
      toggle.textContent = t(nextOpen ? 'collapseStage' : 'expandStage', { count: String(group.entries.length) })
    })
    stageSummary.append(marker, summaryBody, toggle)
    const checklist = document.createElement('div')
    checklist.className = 'progress-stage-items'
    for (const item of items) {
      const row = document.createElement('div')
      row.className = `progress-stage-item ${item.state}`
      const itemMarker = document.createElement('span')
      itemMarker.className = 'progress-stage-item-marker'
      itemMarker.textContent = ''
      const itemBody = document.createElement('span')
      itemBody.textContent = t({ completed: 'stageItemCompleted', active: 'stageItemActive', failed: 'stageItemFailed', pending: 'stageItemPending' }[item.state], { item: item.label })
      row.append(itemMarker, itemBody)
      if (item.state === 'active' || item.state === 'failed') {
        for (const text of metricLines) {
          const metric = document.createElement('span')
          metric.className = 'progress-stage-metric'
          metric.textContent = text
          row.append(metric)
        }
        const value = item.state === 'active' ? stageMetricProgress(metricSource) : undefined
        if (value !== undefined) {
          const metric = document.createElement('span')
          metric.className = 'progress-stage-percent'
          metric.textContent = t('stageProgress', { progress: String(value) })
          row.append(metric)
        }
      }
      checklist.append(row)
    }
    if (state === 'failed') {
      const error = document.createElement('p')
      error.className = 'progress-stage-error'
      error.textContent = localizedError(progressLogUpdate?.error ?? latest?.error ?? t('statusFailed'))
      checklist.append(error)
    }
    const entries = document.createElement('div')
    entries.className = `progress-log-group-list${group.entries.length > 0 ? ' populated' : ''}`
    if (group.entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'progress-log-empty'
      empty.textContent = t('noStageLogs')
      entries.append(empty)
    }
    for (const entry of group.entries.slice(-200)) {
      const details = document.createElement('details')
      details.className = 'progress-log-entry'
      const summary = document.createElement('summary')
      const time = document.createElement('time')
      time.textContent = progressLogTime(entry.timestamp)
      const level = document.createElement('span')
      level.className = `progress-log-level ${String(entry.level ?? 'info').toLowerCase()}`
      const levelValue = String(entry.level ?? 'info').toLowerCase()
      level.textContent = t(`level${levelValue[0].toUpperCase()}${levelValue.slice(1)}`)
      const source = document.createElement('span')
      source.className = 'progress-log-source'
      source.textContent = String(entry.source ?? '-')
      const message = document.createElement('span')
      message.className = 'progress-log-message'
      message.textContent = progressLogText(entry)
      const chevron = document.createElement('span')
      chevron.className = 'progress-log-chevron'
      chevron.setAttribute('aria-hidden', 'true')
      summary.append(level, source, time, message, chevron)
      const body = document.createElement('pre')
      body.textContent = JSON.stringify(entry, null, 2)
      details.append(summary, body)
      entries.append(details)
    }
    const actions = document.createElement('div')
    actions.className = 'progress-log-actions'
    const autoScroll = document.createElement('label')
    autoScroll.className = 'progress-auto-scroll'
    const autoScrollInput = document.createElement('input')
    autoScrollInput.type = 'checkbox'
    autoScrollInput.checked = progressLogAutoScroll
    autoScrollInput.addEventListener('change', event => {
      progressLogAutoScroll = event.target.checked
      if (progressLogAutoScroll) renderProgressLogs()
    })
    const autoScrollText = document.createElement('span')
    autoScrollText.textContent = t('autoScroll')
    autoScroll.append(autoScrollInput, autoScrollText)
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'secondary'
    copy.disabled = group.entries.length === 0
    copy.textContent = t('copyStageLogs')
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(group.entries.map(entry => JSON.stringify(entry)).join('\n'))
        copy.textContent = t('logsCopied')
        window.setTimeout(() => { copy.textContent = t('copyStageLogs') }, 1_500)
      } catch {}
    })
    actions.append(autoScroll, copy)
    stageDetails.append(stageSummary, checklist, entries, actions)
    stageSummary.addEventListener('click', () => {
      progressLogStageTouched.add(group.key)
    })
    stageDetails.addEventListener('toggle', () => {
      progressLogStageExpansion.set(group.key, stageDetails.open)
      toggle.setAttribute('aria-expanded', String(stageDetails.open))
      toggle.textContent = t(stageDetails.open ? 'collapseStage' : 'expandStage', { count: String(group.entries.length) })
    })
    elements['progress-log-list'].append(stageDetails)
  }
  const activeExpanded = progressLogStageExpansion.get(activeStage.key) ?? true
  if (progressLogAutoScroll && activeExpanded) {
    window.requestAnimationFrame(() => {
      const activeGroup = [...elements['progress-log-list'].querySelectorAll('.progress-log-group')]
        .find(group => group.dataset.stageKey === activeStage.key)
      const list = activeGroup?.querySelector('.progress-log-group-list')
      if (list) list.scrollTop = list.scrollHeight
    })
  }
}

function closeProgressLogs() {
  progressLogSource?.close()
  progressLogSource = undefined
  progressLogKey = undefined
  progressLogEntries = []
  progressLogIdentities.clear()
  progressLogUpdate = undefined
  progressLogStageExpansion.clear()
  progressLogStageTouched.clear()
  renderProgressLogs()
}

function connectProgressLogs(update) {
  const phase = progressLogPhase(update)
  const taskId = update.taskId
  if (!taskId || !phase) {
    closeProgressLogs()
    return
  }
  const key = String(taskId)
  const previousStatus = progressLogUpdate?.status
  const previousActiveStage = progressLogUpdate === undefined ? undefined : progressLogStage(progressLogPhase(progressLogUpdate)).key
  progressLogUpdate = update
  const activeStage = progressLogStage(phase)
  if (update.status === 'success') {
    if (previousStatus !== 'success') {
      progressLogStageTouched.delete(activeStage.key)
      progressLogStageExpansion.set(activeStage.key, false)
    }
  } else if (!progressLogStageTouched.has(activeStage.key)) {
    progressLogStageExpansion.set(activeStage.key, true)
  }
  if (previousActiveStage !== undefined && previousActiveStage !== activeStage.key && !progressLogStageTouched.has(previousActiveStage)) {
    progressLogStageExpansion.set(previousActiveStage, false)
  }
  if (progressLogKey === key && progressLogSource !== undefined) {
    renderProgressLogs()
    return
  }
  progressLogSource?.close()
  progressLogEntries = []
  progressLogIdentities.clear()
  progressLogStageExpansion.clear()
  progressLogStageTouched.clear()
  progressLogStageExpansion.set(activeStage.key, update.status !== 'success')
  progressLogKey = key
  const params = new URLSearchParams({ taskId: String(taskId), operation: String(update.operation ?? 'update'), limit: '1000' })
  progressLogSource = new EventSource(`${API}/logs/stream?${params.toString()}`)
  progressLogSource.addEventListener('log', event => {
    try {
      const entry = JSON.parse(event.data)
      const identity = JSON.stringify(entry)
      if (progressLogIdentities.has(identity)) return
      progressLogIdentities.add(identity)
      progressLogEntries.push(entry)
      renderProgressLogs()
    } catch {}
  })
  progressLogSource.onerror = () => {}
  renderProgressLogs()
}

function fileSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return '-'
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KiB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MiB`
  return `${(size / 1024 ** 3).toFixed(1)} GiB`
}

function progressMetrics(update) {
  const metrics = []
  const processedBytes = Number(update.processedBytes)
  const totalBytes = Number(update.totalBytes)
  const processedItems = Number(update.processedItems)
  const totalItems = Number(update.totalItems)
  const readyServices = Number(update.readyServices)
  const totalServices = Number(update.totalServices)
  if (Number.isFinite(processedBytes) && Number.isFinite(totalBytes) && totalBytes > 0) {
    metrics.push(t('metricBytes', { processed: fileSize(processedBytes), total: fileSize(totalBytes) }))
  }
  if (Number.isFinite(processedItems) && Number.isFinite(totalItems) && totalItems > 0) {
    metrics.push(t('metricItems', { processed: String(processedItems), total: String(totalItems) }))
  }
  if (Number.isFinite(readyServices) && Number.isFinite(totalServices) && totalServices > 0) {
    metrics.push(t('metricServices', { ready: String(readyServices), total: String(totalServices) }))
  }
  return metrics.join(' · ')
}

function updateOutcome(value) {
  const key = {
    none: 'outcomeNone', frozen: 'outcomeFrozen', held: 'outcomeHeld', blocked: 'outcomeBlocked',
    stable: 'outcomeStable', experimental: 'outcomeExperimental',
  }[value]
  return key === undefined ? display(value) : t(key)
}

function localizedError(value) {
  const message = value instanceof Error ? value.message : String(value)
  if (locale === 'en') return message
  const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1]
  return httpStatus === undefined ? t('operationError') : `${t('requestError')}（HTTP ${httpStatus}）`
}

function setText(id, value) {
  elements[id].textContent = display(value)
}

function setConnection(state) {
  elements.connection.dataset.state = state
  elements.connection.querySelector('strong').textContent = t(state)
}

function showError(error) {
  elements.error.textContent = localizedError(error)
  elements.error.hidden = false
}

function clearError() {
  elements.error.hidden = true
  elements.error.textContent = ''
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) {
    const detail = value?.error
    const error = new Error(typeof detail === 'object' && detail !== null
      ? detail.message ?? `HTTP ${String(response.status)}`
      : detail ?? `HTTP ${String(response.status)}`)
    error.statusCode = response.status
    error.code = detail?.code ?? value.code
    error.stage = detail?.stage
    error.retryable = detail?.retryable === true
    throw error
  }
  return value
}

function runtimeBusy(next = status) {
  const update = next?.update ?? {}
  return (acting && !checking)
    || (!UPDATE_TERMINAL_STATES.has(update.status ?? 'idle') && update.status !== 'checking')
    || next?.systemPluginOperation?.status === 'running'
    || next?.systemSkillOperation?.status === 'running'
    || next?.userSkillOperation?.status === 'running'
    || next?.userPluginOperation?.status === 'running'
    || ['starting', 'stopping', 'restarting', 'recovering'].includes(next?.dshLifecycle?.state)
    || next?.runtimeReset?.status === 'resetting'
}

function setRuntimeResetExpanded(expanded) {
  runtimeResetExpanded = expanded
  elements['runtime-reset-confirmation'].hidden = !expanded
  elements['runtime-reset'].setAttribute('aria-expanded', String(expanded))
  elements['runtime-reset'].textContent = t(expanded ? 'cancelRuntimeReset' : 'runtimeReset')
}

function operationResultVisible(operation, activeStatus) {
  const operationState = operation?.status ?? operation?.state
  if (operationState === activeStatus) {
    if (operation.taskId) {
      visibleOperationTasks.add(operation.taskId)
      window.clearTimeout(operationResultTimers.get(operation.taskId))
      operationResultTimers.delete(operation.taskId)
    }
    return true
  }
  const taskId = operation?.taskId
  const visible = taskId !== null && taskId !== undefined && visibleOperationTasks.has(taskId)
  if (visible && (operationState === 'success' || operation?.state === 'running') && !operationResultTimers.has(taskId)) {
    operationResultTimers.set(taskId, window.setTimeout(() => {
      operationResultTimers.delete(taskId)
      visibleOperationTasks.delete(taskId)
      if (status !== undefined) render(status)
    }, 3_000))
  }
  return visible
}

function hasTaskId(operation) {
  return typeof operation?.taskId === 'string' && operation.taskId.length > 0
}

function holdReason(hold) {
  return locale === 'en' ? display(hold.reason) : t(hold.type === 'combination' ? 'holdCombination' : 'holdVersion')
}

function renderHolds(values, busy) {
  elements.holds.replaceChildren()
  elements.holds.hidden = values.length === 0
  for (const hold of values) {
    const row = document.createElement('div')
    row.className = 'hold'
    const copy = document.createElement('div')
    const identity = document.createElement('strong')
    identity.textContent = `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${displayEnvironment(hold.environmentVersion)}` : ''}`
    const reason = document.createElement('span')
    reason.textContent = holdReason(hold)
    copy.append(identity, reason)
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'compact'
    retry.textContent = t('retry')
    retry.disabled = busy
    retry.addEventListener('click', () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) })
    row.append(copy, retry)
    elements.holds.append(row)
  }
}

function pluginDescription(plugin) {
  return plugin.description?.[locale] ?? plugin.id
}

function resourceSearchValues(key, value) {
  if (key === 'plugins' || key === 'systemSkills') return [value.id, value.description?.zh, value.description?.en]
  if (key === 'userSkills') return [value.name, value.entryName, value.description, value.source]
  return [value.name, value.version, value.spec, value.description, value.source]
}

function filteredResources(key, values) {
  const query = listQueries[key].trim().toLocaleLowerCase(locale)
  if (query === '') return values
  return values.filter(value => resourceSearchValues(key, value)
    .some(part => String(part ?? '').toLocaleLowerCase(locale).includes(query)))
}

function toggleExpandedElement(element, identity, expanded) {
  const isExpanded = !expanded.has(identity)
  preserveScrollableAncestors(element, () => {
    if (isExpanded) expanded.add(identity)
    else expanded.delete(identity)
    element.classList.toggle('expanded', isExpanded)
    element.setAttribute('aria-expanded', String(isExpanded))
  })
}

function preserveScrollableAncestors(element, update) {
  const positions = []
  for (let current = element.parentElement; current !== null; current = current.parentElement) {
    if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
      positions.push([current, current.scrollLeft, current.scrollTop])
    }
  }
  const restore = () => {
    for (const [current, left, top] of positions) {
      current.scrollLeft = left
      current.scrollTop = top
    }
  }
  update()
  restore()
  window.requestAnimationFrame(() => window.requestAnimationFrame(restore))
}

function refreshProxyDescriptions() {
  for (const description of document.querySelectorAll('.proxy-scope-description')) {
    if (description.dataset.expandListener !== 'true') {
      description.dataset.expandListener = 'true'
      description.setAttribute('aria-expanded', 'false')
      description.addEventListener('click', () => {
        if (!description.classList.contains('expandable')) return
        preserveScrollableAncestors(description, () => {
          const expanded = !description.classList.contains('expanded')
          description.classList.toggle('expanded', expanded)
          description.setAttribute('aria-expanded', String(expanded))
        })
      })
    }
    window.requestAnimationFrame(() => {
      if (!description.isConnected || description.classList.contains('expanded')) return
      const clone = description.cloneNode(true)
      clone.classList.remove('expandable', 'expanded')
      Object.assign(clone.style, {
        position: 'fixed', visibility: 'hidden', width: `${description.clientWidth}px`,
        height: 'auto', maxHeight: 'none', overflow: 'visible', display: 'block',
        webkitLineClamp: 'unset', pointerEvents: 'none',
      })
      document.body.append(clone)
      const fullHeight = clone.scrollHeight
      clone.remove()
      description.classList.toggle('expandable', fullHeight > description.clientHeight + 1)
    })
  }
}

function expandableResourceDescription(text, identity, expanded) {
  const description = document.createElement('button')
  const isExpanded = expanded.has(identity)
  description.type = 'button'
  description.className = `resource-description${isExpanded ? ' expanded expandable' : ''}`
  description.textContent = text
  description.title = text
  description.setAttribute('aria-expanded', String(isExpanded))
  description.addEventListener('click', () => {
    if (!description.classList.contains('expandable')) return
    toggleExpandedElement(description, identity, expanded)
  })
  if (!isExpanded) window.requestAnimationFrame(() => {
    if (description.isConnected && description.scrollWidth > description.clientWidth) description.classList.add('expandable')
  })
  return description
}

function expandableUserMetadata(metadata, identity, expanded) {
  const isExpanded = expanded.has(identity)
  metadata.className = `user-plugin-metadata${isExpanded ? ' expanded expandable' : ''}`
  metadata.setAttribute('aria-expanded', String(isExpanded))
  const toggle = event => {
    if (!metadata.classList.contains('expandable')) return
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleExpandedElement(metadata, identity, expanded)
  }
  metadata.addEventListener('click', toggle)
  metadata.addEventListener('keydown', toggle)
  const enable = () => {
    metadata.classList.add('expandable')
    metadata.tabIndex = 0
    metadata.setAttribute('role', 'button')
  }
  if (isExpanded) enable()
  else window.requestAnimationFrame(() => {
    if (metadata.isConnected && [...metadata.querySelectorAll('dd')].some(value => value.scrollWidth > value.clientWidth)) enable()
  })
  return metadata
}

function paginated(key, values) {
  const pageSize = listPageSizes[key]
  const lastPage = Math.max(0, Math.ceil(values.length / pageSize) - 1)
  listPages[key] = Math.min(listPages[key], lastPage)
  const start = listPages[key] * pageSize
  const prefix = { plugins: 'plugins', systemSkills: 'system-skills', userSkills: 'user-skills', userPlugins: 'user-plugins' }[key]
  elements[`${prefix}-pagination`].hidden = false
  elements[`${prefix}-page-size`].value = String(pageSize)
  elements[`${prefix}-page-status`].textContent = t('totalItems', { total: values.length })
  elements[`${prefix}-page-current`].textContent = String(listPages[key] + 1)
  elements[`${prefix}-page-jump`].max = String(lastPage + 1)
  if (document.activeElement !== elements[`${prefix}-page-jump`]) elements[`${prefix}-page-jump`].value = String(listPages[key] + 1)
  elements[`${prefix}-page-previous`].disabled = listPages[key] === 0
  elements[`${prefix}-page-next`].disabled = listPages[key] === lastPage
  return values.slice(start, start + pageSize)
}

function projectedSystemPlugin(plugin) {
  const action = systemPluginDraft.get(plugin.id)
  if (action === 'install') return { ...plugin, installed: true, enabled: true }
  if (action === 'uninstall') return { ...plugin, installed: false, enabled: false }
  if (action === 'enable') return { ...plugin, enabled: true }
  if (action === 'disable') return { ...plugin, enabled: false }
  return plugin
}

function setSystemPluginDraft(plugin, action) {
  systemPluginProgress = undefined
  systemPluginApplyingDraft.clear()
  if (
    (action === 'install' && plugin.installed)
    || (action === 'uninstall' && !plugin.installed)
    || (action === 'enable' && plugin.installed && plugin.enabled)
    || (action === 'disable' && plugin.installed && !plugin.enabled)
  ) systemPluginDraft.delete(plugin.id)
  else systemPluginDraft.set(plugin.id, action)
  if (status !== undefined) render(status)
  else renderBundledPlugins(plugins, runtimeBusy())
}

function systemPluginSummary() {
  if (systemPluginProgress?.phase === 'restarting') return t('systemPluginRestarting')
  if (systemPluginProgress?.phase === 'applying') {
    const actionKey = {
      install: 'pluginActionInstall', uninstall: 'pluginActionUninstall', enable: 'pluginActionEnable', disable: 'pluginActionDisable',
    }[systemPluginProgress.action]
    return t('systemPluginApplyingItem', {
      action: t(actionKey ?? 'pluginActionWorking'),
      id: systemPluginProgress.id,
      current: systemPluginProgress.current,
      total: systemPluginProgress.total,
    })
  }
  return systemPluginDraft.size > 0
    ? t('pendingSystemPluginChanges', { count: systemPluginDraft.size })
    : t('pluginChangesPendingDetail')
}

function reconcileSystemPluginProgress(next) {
  if (systemPluginProgress?.phase !== 'restarting' || systemPluginProgress.taskId === undefined) return
  const lifecycle = next?.dshLifecycle
  if (lifecycle?.taskId !== systemPluginProgress.taskId) return
  if (['running', 'failed', 'stopped'].includes(lifecycle.state)) systemPluginProgress = undefined
}

function pluginButton(label, plugin, action, busy, className = 'secondary') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.disabled = busy
  button.addEventListener('click', () => setSystemPluginDraft(plugin, action))
  return button
}

function renderBundledPlugins(values, busy) {
  const filtered = filteredResources('plugins', values)
  const restartRequired = systemPluginDraft.size > 0 || values.some(plugin => plugin.pendingRestart)
  elements['bundled-plugins'].replaceChildren()
  elements['empty-plugins'].hidden = filtered.length !== 0
  elements['empty-plugins'].textContent = values.length === 0 ? t('noSystemPlugins') : t('noMatchingResources')
  elements['bundled-plugins'].hidden = filtered.length === 0
  const operation = status?.systemPluginOperation ?? {}
  for (const plugin of paginated('plugins', filtered)) {
    const action = systemPluginDraft.get(plugin.id)
    const projected = projectedSystemPlugin(plugin)
    const isActive = operation.status === 'running' && operation.pluginId === plugin.id
    const applyingAction = restartRequired
      ? systemPluginApplyingDraft.get(plugin.id) ?? (isActive ? operation.action : undefined)
      : isActive ? operation.action : undefined
    const row = document.createElement('article')
    row.className = 'plugin-row'
    const identity = document.createElement('div')
    identity.className = 'plugin-identity'
    const name = document.createElement('strong')
    name.textContent = `@dsh-docker/${plugin.id}`
    const heading = document.createElement('div')
    heading.className = 'resource-heading'
    const stateKey = applyingAction !== undefined
      ? { install: 'statusInstalling', uninstall: 'statusUninstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[applyingAction]
      : action !== undefined
        ? { install: 'pendingInstall', uninstall: 'pendingUninstall', enable: 'pendingEnable', disable: 'pendingDisable' }[action]
      : plugin.installed ? (plugin.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
    heading.append(
      userPluginBadge(t(stateKey ?? 'pluginActionWorking'), applyingAction !== undefined || action !== undefined ? 'pending' : plugin.enabled ? 'enabled' : ''),
      name,
    )
    identity.append(
      heading,
      expandableResourceDescription(pluginDescription(plugin), plugin.id, expandedSystemPluginDescriptions),
    )
    const controls = document.createElement('div')
    controls.className = 'plugin-actions'
    if (!projected.installed) {
      controls.append(pluginButton(t(action === 'uninstall' ? 'cancelChanges' : 'installPlugin'), plugin, 'install', busy, 'primary'))
    } else {
      const toggle = document.createElement('label')
      toggle.className = 'toggle'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = projected.enabled
      checkbox.disabled = busy || action === 'install'
      checkbox.addEventListener('change', event => setSystemPluginDraft(plugin, event.target.checked ? 'enable' : 'disable'))
      const track = document.createElement('span')
      track.setAttribute('aria-hidden', 'true')
      toggle.append(checkbox, track)
      controls.append(toggle, pluginButton(t(action === 'install' ? 'cancelChanges' : 'uninstallPlugin'), plugin, 'uninstall', busy, 'danger-text'))
    }
    row.append(identity, controls)
    elements['bundled-plugins'].append(row)
  }
}

function renderSystemSkills(values, busy) {
  const filtered = filteredResources('systemSkills', values)
  elements['system-skills'].replaceChildren()
  elements['empty-skills'].hidden = filtered.length !== 0
  elements['empty-skills'].textContent = values.length === 0 ? t('noSystemSkills') : t('noMatchingResources')
  elements['system-skills'].hidden = filtered.length === 0
  const operation = status?.systemSkillOperation ?? {}
  for (const skill of paginated('systemSkills', filtered)) {
    const isActive = operation.status === 'running' && operation.skillId === skill.id
    const row = document.createElement('article')
    row.className = 'plugin-row'
    const identity = document.createElement('div')
    identity.className = 'plugin-identity'
    const name = document.createElement('strong')
    name.textContent = skill.id
    const heading = document.createElement('div')
    heading.className = 'resource-heading'
    const stateKey = isActive
      ? { install: 'statusInstalling', uninstall: 'statusUninstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[operation.action]
      : skill.installed ? (skill.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
    heading.append(
      userPluginBadge(t(stateKey ?? 'skillActionWorking'), isActive ? 'pending' : skill.enabled ? 'enabled' : ''),
      name,
    )
    identity.append(
      heading,
      expandableResourceDescription(skill.description?.[locale] ?? skill.id, skill.id, expandedSystemSkillDescriptions),
    )
    const controls = document.createElement('div')
    controls.className = 'plugin-actions'
    const actionButton = (label, action, className = 'secondary') => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = className
      button.textContent = label
      button.disabled = busy
      button.addEventListener('click', () => { void runSkillTask('system-skills/action', { skillId: skill.id, action }, 'systemSkillOperation') })
      return button
    }
    if (!skill.installed) controls.append(actionButton(t('installPlugin'), 'install', 'primary'))
    else {
      const toggle = document.createElement('label')
      toggle.className = 'toggle'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = skill.enabled
      checkbox.disabled = busy
      checkbox.addEventListener('change', event => {
        void runSkillTask('system-skills/action', {
          skillId: skill.id,
          action: event.target.checked ? 'enable' : 'disable',
        }, 'systemSkillOperation')
      })
      const track = document.createElement('span')
      track.setAttribute('aria-hidden', 'true')
      toggle.append(checkbox, track)
      controls.append(toggle, actionButton(t('uninstallPlugin'), 'uninstall', 'danger-text'))
    }
    row.append(identity, controls)
    elements['system-skills'].append(row)
  }
}

function userSkillSource(source) {
  return t(source === 'user-dsh' ? 'userSkillSourceDsh' : 'userSkillSourceAgents')
}

async function runUserSkillAction(skill, action) {
  if (action === 'delete') {
    const confirmed = await requestConfirmation({
      title: t('deleteUserSkillTitle'),
      detail: t('deleteUserSkillDetail', { name: skill.name ?? skill.entryName }),
      confirmLabel: t('deleteUserSkill'),
      danger: true,
    })
    if (!confirmed) return
  }
  await runSkillTask('user-skills/action', {
    entryId: skill.entryId, revision: userSkillInventory.revision, action,
  }, 'userSkillOperation')
}

function renderUserSkills(busy) {
  const values = userSkillInventory.skills ?? []
  const filtered = filteredResources('userSkills', values)
  const operation = status?.userSkillOperation ?? {}
  const locked = busy || operation.status === 'running'
  elements['user-skills'].replaceChildren()
  elements['empty-user-skills'].hidden = filtered.length !== 0
  elements['empty-user-skills'].textContent = values.length === 0 ? t('noUserSkills') : t('noMatchingResources')
  elements['user-skills'].hidden = filtered.length === 0
  for (const skill of paginated('userSkills', filtered)) {
    const row = document.createElement('article')
    row.className = 'user-plugin-row'
    const identity = document.createElement('div')
    identity.className = 'user-plugin-main'
    const heading = document.createElement('div')
    heading.className = 'user-plugin-heading'
    heading.append(userPluginBadge(t(skill.enabled ? 'userSkillEnabled' : 'userSkillDisabled'), skill.enabled ? 'enabled' : ''))
    const name = document.createElement('strong')
    name.textContent = skill.name ?? skill.entryName
    const description = document.createElement('button')
    const descriptionExpanded = expandedUserSkillDescriptions.has(skill.entryId)
    description.type = 'button'
    description.className = `user-plugin-description${descriptionExpanded ? ' expanded expandable' : ''}`
    description.textContent = skill.description ?? localizedError(skill.metadataError ?? t('userSkillDamaged'))
    description.title = description.textContent
    description.setAttribute('aria-expanded', String(descriptionExpanded))
    description.addEventListener('click', () => {
      if (!description.classList.contains('expandable')) return
      toggleExpandedElement(description, skill.entryId, expandedUserSkillDescriptions)
    })
    heading.append(name)
    if (!descriptionExpanded) window.requestAnimationFrame(() => {
      if (description.isConnected && description.scrollWidth > description.clientWidth) description.classList.add('expandable')
    })
    const metadata = document.createElement('dl')
    for (const [label, value] of [[t('userSkillSource'), userSkillSource(skill.source)], [t('userSkillEntry'), skill.entryName]]) {
      const field = document.createElement('div')
      const term = document.createElement('dt')
      term.textContent = label
      const detail = document.createElement('dd')
      detail.textContent = value
      field.append(term, detail)
      metadata.append(field)
    }
    expandableUserMetadata(metadata, skill.entryId, expandedUserSkillMetadata)
    identity.append(heading, description, metadata)
    const controls = document.createElement('div')
    controls.className = 'plugin-actions'
    const toggle = document.createElement('label')
    toggle.className = 'toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = skill.enabled
    checkbox.disabled = locked
    checkbox.setAttribute('aria-label', `${skill.enabled ? t('userSkillEnabled') : t('userSkillDisabled')}: ${skill.name ?? skill.entryName}`)
    checkbox.addEventListener('change', () => { void runUserSkillAction(skill, checkbox.checked ? 'enable' : 'disable') })
    const track = document.createElement('span')
    track.setAttribute('aria-hidden', 'true')
    const label = document.createElement('strong')
    label.textContent = skill.enabled ? t('userSkillEnabled') : t('userSkillDisabled')
    toggle.append(checkbox, track, label)
    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'danger-text'
    deleteButton.textContent = t('deleteUserSkill')
    deleteButton.disabled = locked
    deleteButton.addEventListener('click', () => { void runUserSkillAction(skill, 'delete') })
    controls.append(toggle, deleteButton)
    row.append(identity, controls)
    elements['user-skills'].append(row)
  }
}

function userPluginSource(value) {
  return t({
    registry: 'userPluginSourceRegistry', file: 'userPluginSourceFile', git: 'userPluginSourceGit',
    url: 'userPluginSourceUrl', other: 'userPluginSourceOther',
  }[value] ?? 'userPluginSourceOther')
}

function setUserPluginDraft(plugin, action) {
  if ((action === 'enable' && plugin.enabled) || (action === 'disable' && !plugin.enabled)) userPluginDraft.delete(plugin.name)
  else userPluginDraft.set(plugin.name, action)
  userPluginFeedback = null
  renderUserPlugins(runtimeBusy())
}

function userPluginBadge(label, className = '') {
  const badge = document.createElement('span')
  badge.className = `user-plugin-badge ${className}`.trim()
  badge.textContent = label
  return badge
}

function renderUserPlugins(busy) {
  const values = userPluginInventory.plugins ?? []
  const filtered = filteredResources('userPlugins', values)
  const operation = status?.userPluginOperation ?? {}
  const locked = busy || userPluginSubmitting || operation.status === 'running'
  elements['user-plugin-list'].replaceChildren()
  elements['user-plugin-list'].hidden = filtered.length === 0
  elements['empty-user-plugins'].hidden = filtered.length !== 0
  elements['empty-user-plugins'].textContent = values.length === 0 ? t('noUserPlugins') : t('noMatchingResources')
  for (const plugin of paginated('userPlugins', filtered)) {
    const action = userPluginDraft.get(plugin.name)
    const applyingAction = userPluginApplyingDraft.get(plugin.name)
    const row = document.createElement('article')
    row.className = `user-plugin-row${action ? ' pending' : ''}`
    const identity = document.createElement('div')
    identity.className = 'user-plugin-main'
    const heading = document.createElement('div')
    heading.className = 'user-plugin-heading'
    const name = document.createElement('strong')
    name.textContent = plugin.name
    const badge = applyingAction
      ? userPluginBadge(t({ enable: 'statusEnabling', disable: 'statusDisabling', uninstall: 'statusUninstalling' }[applyingAction]), 'pending')
      : action
        ? userPluginBadge(t({ enable: 'pendingEnable', disable: 'pendingDisable', uninstall: 'pendingUninstall' }[action]), 'pending')
      : plugin.pendingRestart
        ? userPluginBadge(t('pluginPendingRestart'), 'pending')
        : plugin.reservedNameConflict
          ? userPluginBadge(t('userPluginReserved'), 'danger')
          : plugin.damaged
            ? userPluginBadge(t('userPluginDamaged'), 'warning')
            : userPluginBadge(plugin.enabled ? t('userPluginEnabled') : t('userPluginDisabled'), plugin.enabled ? 'enabled' : '')
    heading.append(badge, name)
    identity.append(heading)
    if (plugin.description) {
      const description = document.createElement('button')
      const descriptionExpanded = expandedUserPluginDescriptions.has(plugin.name)
      description.type = 'button'
      description.className = `user-plugin-description${descriptionExpanded ? ' expanded expandable' : ''}`
      description.textContent = plugin.description
      description.title = plugin.description
      description.setAttribute('aria-expanded', String(descriptionExpanded))
      description.addEventListener('click', () => {
        if (!description.classList.contains('expandable')) return
        toggleExpandedElement(description, plugin.name, expandedUserPluginDescriptions)
      })
      identity.append(description)
      if (!descriptionExpanded) window.requestAnimationFrame(() => {
        if (description.isConnected && description.scrollWidth > description.clientWidth) description.classList.add('expandable')
      })
    }
    const metadata = document.createElement('dl')
    for (const [label, value] of [
      [t('userPluginVersion'), plugin.version], [t('userPluginSpec'), plugin.spec], [t('userPluginSource'), userPluginSource(plugin.source)],
    ]) {
      const field = document.createElement('div')
      const term = document.createElement('dt')
      term.textContent = label
      const description = document.createElement('dd')
      description.textContent = display(value)
      field.append(term, description)
      metadata.append(field)
    }
    expandableUserMetadata(metadata, plugin.name, expandedUserPluginMetadata)
    identity.append(metadata)
    if (plugin.metadataError) {
      const detail = document.createElement('p')
      detail.className = 'user-plugin-error'
      detail.textContent = locale === 'en' ? plugin.metadataError : t('userPluginMetadataError')
      identity.append(detail)
    }
    const controls = document.createElement('div')
    controls.className = 'user-plugin-controls'
    const toggle = document.createElement('label')
    toggle.className = 'toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = action === 'enable' || (action !== 'disable' && plugin.enabled)
    checkbox.disabled = locked || action === 'uninstall' || (!plugin.enabled && (plugin.damaged || plugin.reservedNameConflict))
    checkbox.setAttribute('aria-label', `${plugin.name}: ${checkbox.checked ? t('userPluginEnabled') : t('userPluginDisabled')}`)
    checkbox.addEventListener('change', event => setUserPluginDraft(plugin, event.target.checked ? 'enable' : 'disable'))
    const track = document.createElement('span')
    track.setAttribute('aria-hidden', 'true')
    toggle.append(checkbox, track)
    const uninstall = document.createElement('button')
    uninstall.type = 'button'
    uninstall.className = action === 'uninstall' ? 'secondary' : 'danger-text'
    uninstall.textContent = t(action === 'uninstall' ? 'cancelUninstall' : 'uninstallUserPlugin')
    uninstall.setAttribute('aria-label', `${uninstall.textContent}: ${plugin.name}`)
    uninstall.disabled = locked
    uninstall.addEventListener('click', () => {
      if (action === 'uninstall') userPluginDraft.delete(plugin.name)
      else userPluginDraft.set(plugin.name, 'uninstall')
      userPluginFeedback = null
      renderUserPlugins(runtimeBusy())
    })
    controls.append(toggle, uninstall)
    row.append(identity, controls)
    elements['user-plugin-list'].append(row)
  }
  const phaseKey = {
    validated: 'userPluginPhaseValidated', paused: 'userPluginPhasePaused', snapshotted: 'userPluginPhaseSnapshotted',
    mutating: 'userPluginPhaseMutating', committed: 'userPluginPhaseCommitted', restarting: 'userPluginPhaseRestarting', restoring: 'userPluginPhaseRestoring',
  }[operation.phase]
  const count = userPluginDraft.size
  const restartRequired = userPluginInventory.restartRequired === true
  const applying = operation.status === 'running'
  elements['user-plugin-draft-actions'].hidden = count === 0 && !restartRequired && !applying
  elements['user-plugin-draft-summary'].textContent = applying
    ? t(phaseKey ?? 'userPluginApplying')
    : count === 0 ? t('userPluginRestartRequiredDetail') : t('pendingUserPluginChanges', { count })
  elements['cancel-user-plugin-changes'].disabled = locked || count === 0
  elements['apply-user-plugin-changes'].disabled = locked || (count === 0 && !restartRequired)
  elements['user-plugin-recovery'].hidden = status?.recoveryMode === null || status?.recoveryMode === undefined
  elements['user-plugin-recovery-detail'].textContent = locale === 'zh'
    ? t('userPluginRecoveryDetail')
    : typeof status?.recoveryMode === 'string'
      ? status.recoveryMode
      : status?.recoveryMode?.reason ?? status?.recoveryMode?.message ?? t('userPluginRecoveryDetail')
  const operationVisible = operationResultVisible(operation, 'running')
  const feedback = operation.status === 'running' ? t(phaseKey ?? 'userPluginApplying')
    : operationVisible && operation.status === 'failed' ? `${t('userPluginApplyFailed')}: ${localizedError(operation.error ?? '')}`
      : operationVisible && operation.status === 'success' ? t('userPluginApplyComplete') : userPluginFeedback
  elements['user-plugin-operation'].textContent = feedback ?? ''
  elements['user-plugin-operation'].hidden = !feedback
}

function render(next) {
  reconcileSystemPluginProgress(next)
  status = next
  rollbackPlan = next.rollbackPlan
  const update = next.update ?? {}
  const restart = next.dshLifecycle ?? {}
  const runtimeReset = next.runtimeReset ?? {}
  const restartVisible = ['starting', 'stopping', 'restarting'].some(state => operationResultVisible(restart, state))
  const runtimeResetVisible = operationResultVisible(runtimeReset, 'resetting')
  const pluginOperation = next.systemPluginOperation ?? {}
  const skillOperation = next.systemSkillOperation ?? {}
  const userSkillOperation = next.userSkillOperation ?? {}
  const pluginOperationVisible = operationResultVisible(pluginOperation, 'running')
  const busy = runtimeBusy(next)
  const updateActive = !UPDATE_TERMINAL_STATES.has(update.status ?? 'idle')
  const successTimerKey = update.status === 'success' && update.taskId
    ? `${String(update.taskId)}:${String(update.updatedAt)}`
    : undefined
  const failedDismissed = update.status === 'failed' && String(update.taskId ?? '') === dismissedProgressTaskId
  if (successTimerKey !== progressSuccessTimerKey) {
    if (progressSuccessTimer !== undefined) window.clearTimeout(progressSuccessTimer)
    progressSuccessTimer = undefined
    progressSuccessTimerKey = successTimerKey
    if (successTimerKey !== undefined && successTimerKey !== progressSuccessDismissedKey) {
      progressSuccessTimer = window.setTimeout(() => {
        progressSuccessDismissedKey = successTimerKey
        progressSuccessTimer = undefined
        progressSuccessTimerKey = undefined
        if (status !== undefined) render(status)
      }, 3_000)
    }
  }
  const successVisible = successTimerKey !== undefined
    && successTimerKey !== progressSuccessDismissedKey
    && progressSuccessTimer !== undefined
  const progressVisible = updateActive || (update.status === 'failed' && Boolean(update.taskId) && !failedDismissed) || successVisible
  const checkingUpdates = checking || update.status === 'checking'
  if (restart.state === 'running' && hasTaskId(restart) && !plugins.some(plugin => plugin.pendingRestart)) {
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
  }
  const hasSupportedTarget = next.supported !== null && next.supported !== undefined

  setText('current-dsh', next.current?.dsh)
  setText('current-env', displayEnvironment(next.current?.environment))
  setText('supported-dsh', next.supported?.dsh)
  setText('supported-env', displayEnvironment(next.supported?.environment))
  setText('upstream-dsh', next.upstream?.version)
  const experimental = next.updateChannel === 'experimental'
  elements.versions.classList.toggle('experimental', experimental)
  elements['upstream-version'].hidden = !experimental
  for (const button of channelButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.channel === next.updateChannel))
    button.disabled = busy
  }

  elements['checked-at'].textContent = update.checkedAt ? `${t('lastChecked')} ${localTime(update.checkedAt)}` : t('notChecked')
  elements['check-spinner'].hidden = !checkingUpdates
  elements['check-label'].textContent = checkingUpdates ? t('checking') : t('check')
  elements.check.disabled = busy
  elements.update.textContent = experimental ? t('updateUpstream') : t('updateSupported')
  elements.update.disabled = busy || update.metadataUnavailable || !hasSupportedTarget || update.updateAvailable !== true
  elements.rollback.hidden = rollbackPlan === null || rollbackPlan === undefined
  elements.rollback.disabled = busy
  elements['return-stable'].hidden = !rollbackPlan?.returnStableAvailable
  elements['return-stable'].disabled = busy

  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  elements['update-progress'].hidden = !progressVisible
  elements['progress-value'].value = `${String(progress)}%`
  elements['progress-value'].textContent = `${String(progress)}%`
  elements.progress.setAttribute('aria-valuenow', String(progress))
  elements.progress.dataset.complete = String(progress === 100)
  elements['progress-bar'].style.width = `${String(progress)}%`
  elements['progress-dismiss'].hidden = update.status !== 'failed' || !progressVisible
  if (progressVisible) {
    const recovery = isRecoveryOperation(update.operation)
    const returningStable = update.operation === 'return-stable'
    const checkingProgress = update.operation === 'check'
    const target = recovery
      ? rollbackPlan?.previous?.dsh ?? rollbackPlan?.target?.dsh
      : experimental ? next.upstream?.version ?? next.supported?.dsh : next.supported?.dsh
    elements['progress-title'].textContent = checkingProgress
      ? t('statusChecking')
      : target
      ? t(returningStable ? 'returnStableToTarget' : recovery ? 'rollbackToTarget' : 'updateToTarget', { target: String(target) })
      : t(returningStable ? 'returnStableProgress' : recovery ? 'rollbackProgress' : 'updateProgress')
    elements['progress-value'].textContent = `${String(progress)}%`
    connectProgressLogs(update)
  } else {
    closeProgressLogs()
  }
  const result = progressVisible || failedDismissed ? '' : update.error ? localizedError(update.error) : update.outcome ? updateOutcome(update.outcome) : ''
  elements['update-result'].textContent = result
  elements['update-result'].hidden = result === ''
  elements['metadata-notice'].hidden = !update.metadataUnavailable
  const upstreamCheckFailed = update.remoteCheckSource === 'upstream'
  const hasPreviousCheckResult = upstreamCheckFailed ? Boolean(update.upstream?.version) : Boolean(update.checkedAt)
  elements['remote-check-notice'].textContent = t(upstreamCheckFailed
    ? (hasPreviousCheckResult ? 'upstreamCheckFailed' : 'upstreamCheckFailedNoResult')
    : (hasPreviousCheckResult ? 'remoteCheckFailed' : 'remoteCheckFailedNoResult'))
  elements['remote-check-notice'].hidden = !update.remoteCheckError

  const holds = [...new Map([
    ...(next.holds ?? []),
    ...(next.experimentalBlocked ? [next.experimentalBlocked] : []),
  ].map(hold => [hold.id, hold])).values()]
  renderHolds(holds, busy)
  const notices = []
  if (next.aheadOfStable) notices.push(t('aheadOfStable'))
  if (next.experimentalBlocked) notices.push(t('experimentalBlocked'))
  elements.notice.textContent = notices.join(' ')
  elements.notice.hidden = notices.length === 0

  const automatic = next.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }
  elements['automatic-enabled'].checked = automatic.enabled
  elements['automatic-enabled'].disabled = acting
  elements['automatic-enabled-label'].textContent = automatic.enabled ? t('enabled') : t('disabled')
  elements['automatic-interval'].value = String(automatic.intervalSeconds)
  elements['automatic-interval'].disabled = acting || !automatic.enabled
  elements['notifications-enabled'].checked = automatic.notificationsEnabled
  elements['notifications-enabled'].disabled = acting || !automatic.enabled

  const dshRunning = restart.state === 'running'
  const dshStopped = ['stopped', 'failed'].includes(restart.state)
  elements['start-dsh'].disabled = busy || !dshStopped
  elements['stop-dsh'].disabled = busy || !dshRunning
  elements['restart-dsh'].disabled = busy || !dshRunning
  elements['restart-state'].hidden = !restartVisible
  elements['restart-state'].textContent = restart.state === 'starting' ? t('starting')
    : restart.state === 'stopping' ? t('stopping')
      : restart.state === 'stopped' ? t('stopped')
        : restart.state === 'restarting' ? t('restarting')
          : restart.state === 'running' ? t('lifecycleRunning')
            : restart.state === 'failed' ? `${t('lifecycleFailed')}: ${localizedError(restart.error ?? '')}` : ''
  elements['runtime-reset'].disabled = busy || next.current === null || next.current === undefined
  elements['confirm-runtime-reset'].disabled = busy || next.current === null || next.current === undefined
  elements['runtime-reset'].textContent = runtimeReset.status === 'resetting'
    ? t('runtimeResetting') : t(runtimeResetExpanded ? 'cancelRuntimeReset' : 'runtimeReset')
  const resetActive = runtimeReset.status === 'resetting'
  const resetPhase = RUNTIME_RESET_PHASES[next.operation] ?? { progress: 5, label: 'runtimeResetting' }
  runtimeResetProgress = resetActive ? Math.max(runtimeResetProgress, resetPhase.progress) : 0
  elements['runtime-reset-progress'].hidden = !resetActive
  elements['runtime-reset-state'].textContent = t(resetPhase.label)
  elements['runtime-reset-progress-value'].value = `${String(runtimeResetProgress)}%`
  elements['runtime-reset-progress-value'].textContent = `${String(runtimeResetProgress)}%`
  elements['runtime-reset-progress-track'].setAttribute('aria-valuenow', String(runtimeResetProgress))
  elements['runtime-reset-progress-bar'].style.width = `${String(runtimeResetProgress)}%`
  elements['runtime-reset-result'].hidden = resetActive || !runtimeResetVisible
  elements['runtime-reset-result'].textContent = runtimeReset.status === 'success'
    ? t('runtimeResetComplete')
    : runtimeReset.status === 'failed'
      ? `${t('runtimeResetFailed')}: ${localizedError(runtimeReset.error ?? '')}`
      : ''
  elements['plugin-operation'].hidden = !pluginOperationVisible || pluginOperation.status !== 'failed'
  elements['plugin-operation'].textContent = pluginOperation.status === 'failed' ? localizedError(pluginOperation.error ?? '') : ''
  const systemPluginRestartRequired = systemPluginDraft.size > 0
    || plugins.some(plugin => plugin.pendingRestart)
    || systemPluginSubmitting
    || systemPluginProgress !== undefined
  elements['plugin-restart-required'].hidden = !systemPluginRestartRequired
  elements['system-plugin-draft-summary'].textContent = systemPluginSummary()
  if (!systemPluginRestartRequired) systemPluginProgress = undefined
  const pluginBusy = busy || discardingPluginDraft
  elements['cancel-system-plugin-changes'].disabled = pluginBusy || systemPluginSubmitting
  elements['apply-system-plugin-changes'].disabled = pluginBusy || systemPluginSubmitting
  const skillOperationVisible = operationResultVisible(skillOperation, 'running')
  elements['skill-operation'].hidden = !skillOperationVisible || skillOperation.status !== 'failed'
  elements['skill-operation'].textContent = skillOperation.status === 'failed' ? localizedError(skillOperation.error ?? '') : ''
  const userSkillOperationVisible = operationResultVisible(userSkillOperation, 'running')
  elements['user-skill-operation'].hidden = !userSkillOperationVisible
  elements['user-skill-operation'].textContent = userSkillOperation.status === 'running'
    ? t('userSkillActionWorking')
    : userSkillOperation.status === 'failed'
      ? `${t('userSkillActionFailed')}: ${localizedError(userSkillOperation.error ?? '')}`
      : t('userSkillActionComplete')
  if (inventoriesLoaded.plugins) renderBundledPlugins(plugins, pluginBusy)
  if (inventoriesLoaded.systemSkills) renderSystemSkills(systemSkills, busy)
  if (inventoriesLoaded.userSkills) renderUserSkills(busy)
  if (inventoriesLoaded.userPlugins) renderUserPlugins(busy)
}

const INVENTORY_LOADERS = Object.freeze({
  plugins: Object.freeze({ path: 'bundled-plugins', apply: value => { plugins = value.plugins ?? [] } }),
  systemSkills: Object.freeze({ path: 'system-skills', apply: value => { systemSkills = value.skills ?? [] } }),
  userSkills: Object.freeze({ path: 'user-skills', apply: value => { userSkillInventory = value } }),
  userPlugins: Object.freeze({ path: 'user-plugins', apply: value => { userPluginInventory = value } }),
})

function loadInventory(key) {
  inventoryLoadRevisions[key] += 1
  if (inventoryLoads[key] !== undefined) return inventoryLoads[key]
  const loader = INVENTORY_LOADERS[key]
  inventoryLoads[key] = (async () => {
    let loadedRevision
    do {
      loadedRevision = inventoryLoadRevisions[key]
      try {
        loader.apply(await api(loader.path))
        inventoriesLoaded[key] = true
        if (status !== undefined) render(status)
      } catch {
        // Bootstrap-backed inventories can lag the Management service during startup.
      }
    } while (loadedRevision !== inventoryLoadRevisions[key])
  })().finally(() => { inventoryLoads[key] = undefined })
  return inventoryLoads[key]
}

async function refreshInventory(key) {
  if (inventoryLoads[key] !== undefined) await inventoryLoads[key]
  await loadInventory(key)
}

function inventoryKeyForTab(tab = tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.dataset.tab) {
  return { plugins: 'plugins', skills: 'systemSkills', 'user-skills': 'userSkills', 'user-plugins': 'userPlugins' }[tab]
}

function renderInventory(key) {
  const busy = runtimeBusy()
  if (key === 'plugins') renderBundledPlugins(plugins, busy || discardingPluginDraft)
  else if (key === 'systemSkills') renderSystemSkills(systemSkills, busy)
  else if (key === 'userSkills') renderUserSkills(busy)
  else renderUserPlugins(busy)
}

function loadStatus() {
  statusLoadRevision += 1
  if (statusLoad !== undefined) return statusLoad
  statusLoad = (async () => {
    let next
    let loadedRevision
    do {
      loadedRevision = statusLoadRevision
      try {
        next = await api('status')
        render(next)
        clearError()
        setConnection('online')
      } catch (error) {
        showError(error)
        setConnection('offline')
        next = undefined
      }
    } while (loadedRevision !== statusLoadRevision)
    return next
  })().finally(() => { statusLoad = undefined })
  return statusLoad
}

async function discardSystemPluginDraft() {
  if (window.sessionStorage.getItem(PLUGIN_DRAFT_KEY) !== '1') return
  discardingPluginDraft = true
  if (status !== undefined) render(status)
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await api('bundled-plugins/discard', { method: 'POST' })
        window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
        await Promise.all([loadStatus(), refreshInventory('plugins')])
        return
      } catch {
        await new Promise(resolve => window.setTimeout(resolve, 100))
      }
    }
  } finally {
    discardingPluginDraft = false
    if (status !== undefined) render(status)
  }
}

async function act(path, options) {
  acting = true
  clearError()
  try {
    const result = await api(path, options)
    if (result?.taskId) visibleOperationTasks.add(result.taskId)
    await loadStatus()
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    acting = false
    if (status !== undefined) render(status)
  }
}

async function waitForManagementTask(taskId, operationKey) {
  let lastError
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    try {
      const operation = operationKey === 'systemPluginOperation'
        ? await api(`bundled-plugins/task/${taskId}`)
        : (await api('status'))?.[operationKey]
      setConnection('online')
      if (operation?.taskId === taskId && operation.status !== 'running') return operation
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  throw lastError ?? new Error('Management task timed out')
}

async function cancelSystemPluginDraft() {
  if (systemPluginSubmitting) return
  systemPluginProgress = undefined
  systemPluginApplyingDraft.clear()
  systemPluginDraft.clear()
  if (plugins.some(plugin => plugin.pendingRestart)) {
    await act('bundled-plugins/discard', { method: 'POST' })
    await refreshInventory('plugins')
  }
  window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
  if (status !== undefined) render(status)
}

async function applySystemPluginDraft() {
  if (systemPluginSubmitting) return
  if (systemPluginDraft.size === 0) {
    if (plugins.some(plugin => plugin.pendingRestart)) await act('restart-dsh', { method: 'POST' })
    return
  }
  systemPluginSubmitting = true
  systemPluginApplyingDraft.clear()
  for (const [id, action] of systemPluginDraft) systemPluginApplyingDraft.set(id, action)
  acting = true
  clearError()
  if (status !== undefined) render(status)
  let changed = false
  try {
    const changes = [...systemPluginDraft]
    for (const [index, [id, action]] of changes.entries()) {
      systemPluginProgress = { phase: 'applying', id, action, current: index + 1, total: changes.length }
      if (status !== undefined) render(status)
      const plugin = plugins.find(item => item.id === id)
      if (plugin === undefined) throw new Error(`System Plugin ${id} is no longer available`)
      const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
      const task = await api(path, { method: 'POST', body: { id, action } })
      changed = true
      window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
      visibleOperationTasks.add(task.taskId)
      const operation = await waitForManagementTask(task.taskId, 'systemPluginOperation')
      if (operation.status !== 'success') throw new Error(operation.error ?? 'System Plugin operation failed')
    }
    systemPluginDraft.clear()
    const restart = await api('restart-dsh', { method: 'POST' })
    systemPluginProgress = { phase: 'restarting', total: changes.length, taskId: restart.taskId }
    if (status !== undefined) render(status)
    visibleOperationTasks.add(restart.taskId)
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
    await loadStatus()
  } catch (error) {
    systemPluginProgress = undefined
    if (changed) await api('bundled-plugins/discard', { method: 'POST' }).catch(() => {})
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
    showError(error)
  } finally {
    await refreshInventory('plugins')
    systemPluginSubmitting = false
    acting = false
    if (status !== undefined) render(status)
  }
}

async function runSkillTask(path, body, operationKey) {
  if (acting) return false
  acting = true
  clearError()
  if (status !== undefined) render(status)
  try {
    const task = await api(path, { method: 'POST', body })
    visibleOperationTasks.add(task.taskId)
    const operation = await waitForManagementTask(task.taskId, operationKey)
    if (operation.status !== 'success') throw new Error(operation.error ?? 'Skill operation failed')
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    await refreshInventory(operationKey === 'systemSkillOperation' ? 'systemSkills' : 'userSkills')
    await loadStatus()
    acting = false
    if (status !== undefined) render(status)
  }
}

async function waitForUserPluginTask(taskId) {
  let lastError
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    try {
      const task = await api(`user-plugins/task/${taskId}`)
      if (task.status !== 'running') return task
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => window.setTimeout(resolve, 250))
  }
  throw lastError ?? new Error('User Plugin task timed out')
}

async function applyUserPluginDraft() {
  if (userPluginSubmitting) return
  if (userPluginDraft.size === 0) {
    if (userPluginInventory.restartRequired === true) await act('restart-dsh', { method: 'POST' })
    return
  }
  userPluginSubmitting = true
  userPluginApplyingDraft.clear()
  for (const [name, action] of userPluginDraft) userPluginApplyingDraft.set(name, action)
  userPluginFeedback = null
  clearError()
  renderUserPlugins(runtimeBusy())
  try {
    const task = await api('user-plugins/apply', {
      method: 'POST',
      body: {
        profile: 'web', revision: userPluginInventory.revision,
        actions: [...userPluginDraft].map(([name, action]) => ({ name, action })),
      },
    })
    visibleOperationTasks.add(task.taskId)
    userPluginDraft.clear()
    await loadStatus()
    await waitForUserPluginTask(task.taskId)
    await loadStatus()
  } catch (error) {
    if (error.statusCode === 409) {
      userPluginDraft.clear()
      await loadStatus()
      userPluginFeedback = t('userPluginRevisionConflict')
    } else {
      userPluginFeedback = `${t('userPluginApplyFailed')}: ${localizedError(error)}`
      showError(error)
    }
  } finally {
    await refreshInventory('userPlugins')
    userPluginApplyingDraft.clear()
    userPluginSubmitting = false
    renderUserPlugins(runtimeBusy())
  }
}

async function checkUpdates(source = 'manual') {
  checking = true
  clearError()
  if (status !== undefined) render(status)
  try {
    await api('check', { method: 'POST', body: { source } })
    await loadStatus()
    return true
  } catch (error) {
    try { await loadStatus() } catch { showError(error) }
    return false
  } finally {
    checking = false
    if (status !== undefined) render(status)
  }
}

async function saveAutomaticCheck(change) {
  const current = status?.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }
  await act('automatic-check', { method: 'PUT', body: { ...current, ...change } })
}

function storageValue(key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStorage(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {}
}

function logLevel(entry) {
  if (entry?.stream === 'stderr') {
    const message = String(entry?.message ?? '').trim()
    if (/^(?:\s*at\s+|.*\b(?:error|fatal|failed|failure|exception|panic|unhandled)\b)|错误|失败|异常|致命/iu.test(message)) return 'error'
    if (/\b(?:warn|warning|deprecated|deprecation)\b|警告|已弃用/iu.test(message)) return 'warning'
    return 'info'
  }
  if (['debug', 'info', 'warning', 'error'].includes(entry?.level)) return entry.level
  return /^\s*(warn(?:ing)?)[\s:]/i.test(entry?.message ?? '') ? 'warning' : 'info'
}

function isJsonFragment(message) {
  return /^(?:[{}\[\]],?|"(?:[^"\\]|\\.)+"\s*:\s*.*)$/.test(message.trim())
}

function compactLogEntries(entries) {
  const compacted = []
  for (let index = 0; index < entries.length; index += 1) {
    const first = entries[index]
    const opening = first.value.message?.trim()
    if (opening !== '{' && opening !== '[') {
      if (!isJsonFragment(first.value.message ?? '')) compacted.push(first)
      continue
    }
    const lines = [first.value.message]
    const startedAt = Date.parse(first.value.timestamp)
    let merged = false
    for (let end = index + 1; end < entries.length; end += 1) {
      const next = entries[end]
      if (next.value.source !== first.value.source || next.value.stream !== first.value.stream
        || logLevel(next.value) !== logLevel(first.value) || Date.parse(next.value.timestamp) - startedAt > 2_000) break
      lines.push(next.value.message)
      try {
        const value = JSON.parse(lines.join('\n'))
        compacted.push({ identity: entries.slice(index, end + 1).map(item => item.identity).join('|'), value: { ...first.value, message: JSON.stringify(value) } })
        index = end
        merged = true
        break
      } catch {}
    }
    if (!merged && !isJsonFragment(first.value.message)) compacted.push(first)
  }
  return compacted
}

function limitProcessedLogEntries(entries, limit) {
  return compactLogEntries(entries).slice(-limit)
}

function updateLogSources(entries) {
  const selected = elements['log-source'].value
  const values = [...new Set(entries.map(item => item.value.source).filter(Boolean))].sort()
  elements['log-source'].replaceChildren()
  const all = document.createElement('option')
  all.value = 'all'
  all.textContent = t('allSources')
  elements['log-source'].append(all)
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    elements['log-source'].append(option)
  }
  elements['log-source'].value = values.includes(selected) ? selected : 'all'
}

function filteredRawLogs() {
  const query = elements['log-search'].value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en-US')
  const source = elements['log-source'].value
  const level = elements['log-level'].value
  return logEntries.slice(-logDisplayLimit).map(item => item.value).filter(entry => (source === 'all' || entry.source === source)
    && (level === 'all' || logLevel(entry) === level)
    && (query === '' || JSON.stringify(entry).toLocaleLowerCase().includes(query)))
}

function downloadLogJsonl(entries) {
  if (entries.length === 0) return
  const content = `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `dsh-platform-logs-${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function renderLogs() {
  const entries = limitProcessedLogEntries(logEntries, logDisplayLimit)
  updateLogSources(entries)
  const query = elements['log-search'].value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en-US')
  const source = elements['log-source'].value
  const level = elements['log-level'].value
  const filtered = entries.filter(item => (source === 'all' || item.value.source === source)
    && (level === 'all' || logLevel(item.value) === level)
    && (query === '' || JSON.stringify(item.value).toLocaleLowerCase().includes(query)))
  elements['export-logs'].disabled = filteredRawLogs().length === 0
  elements['log-summary'].textContent = t('logCount', { shown: filtered.length, total: logDisplayLimit })
  elements['log-list'].replaceChildren()
  elements['log-list'].hidden = filtered.length === 0
  elements['empty-logs'].hidden = filtered.length !== 0
  elements['empty-logs'].textContent = entries.length === 0 ? t('noLogs') : t('noMatchingLogs')
  for (const item of filtered) {
    const entry = item.value
    const levelValue = logLevel(entry)
    const article = document.createElement('article')
    article.className = 'log-entry'
    const meta = document.createElement('div')
    meta.className = 'log-meta'
    const levelLabel = document.createElement('strong')
    levelLabel.className = `log-level ${levelValue}`
    levelLabel.textContent = t(`level${levelValue[0].toUpperCase()}${levelValue.slice(1)}`)
    const sourceLabel = document.createElement('span')
    sourceLabel.className = 'log-source'
    sourceLabel.textContent = display(entry.source)
    const time = document.createElement('time')
    time.dateTime = entry.timestamp
    time.textContent = localTime(entry.timestamp)
    const message = document.createElement('pre')
    message.textContent = display(entry.message)
    const messageRow = document.createElement('div')
    messageRow.className = 'log-message-row'
    const details = document.createElement('pre')
    details.className = 'log-details'
    details.textContent = JSON.stringify(entry, null, 2)
    const expanded = expandedLogIdentities.has(item.identity)
    details.hidden = !expanded
    article.tabIndex = 0
    article.setAttribute('role', 'button')
    article.setAttribute('aria-expanded', String(expanded))
    const toggle = () => {
      const next = !expandedLogIdentities.has(item.identity)
      if (next) expandedLogIdentities.add(item.identity)
      else expandedLogIdentities.delete(item.identity)
      article.setAttribute('aria-expanded', String(next))
      details.hidden = !next
    }
    article.addEventListener('click', toggle)
    article.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      toggle()
    })
    const chevron = document.createElement('span')
    chevron.className = 'log-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    meta.append(levelLabel, sourceLabel, time)
    messageRow.append(message, chevron)
    article.append(meta, messageRow, details)
    elements['log-list'].append(article)
  }
  if (autoScroll) elements['log-list'].scrollTop = elements['log-list'].scrollHeight
}

function scheduleLogRender() {
  if (logRenderFrame !== undefined) return
  logRenderFrame = window.requestAnimationFrame(() => {
    logRenderFrame = undefined
    renderLogs()
  })
}

function appendLog(entry) {
  const identity = JSON.stringify(entry)
  const timestamp = Date.parse(entry.timestamp)
  if ((logClearCutoff !== null && Number.isFinite(timestamp) && timestamp <= Date.parse(logClearCutoff))
    || logIdentities.has(identity)) return
  logEntries.push({ identity, value: entry })
  logIdentities.add(identity)
  if (logEntries.length > LOG_STREAM_LIMIT) {
    for (const removed of logEntries.splice(0, logEntries.length - LOG_STREAM_LIMIT)) {
      logIdentities.delete(removed.identity)
      expandedLogIdentities.delete(removed.identity)
    }
  }
  scheduleLogRender()
}

function terminalTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
    || (document.documentElement.dataset.theme === undefined && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark
    ? { background: '#18181a', foreground: '#f0f0f1', cursor: '#f0f0f1', selectionBackground: '#4b5f80', black: '#18181a', brightBlack: '#85858b' }
    : { background: '#ffffff', foreground: '#202124', cursor: '#202124', selectionBackground: '#c9d9f4', black: '#202124', brightBlack: '#6f7177' }
}

function setTerminalStatus(key, state, values = {}) {
  terminalSessionState = state
  elements['terminal-status'].dataset.state = state
  elements['terminal-status'].querySelector('strong').textContent = t(key, values)
  const active = terminalSessionId !== undefined
  elements['new-terminal'].disabled = active || ['loading', 'starting'].includes(state)
  elements['close-terminal'].disabled = !active
  elements['terminal-frame'].classList.toggle('active', active)
  elements['terminal-placeholder'].hidden = active
}

function setTerminalPlaceholder(key, loading = false) {
  elements['terminal-placeholder-label'].textContent = t(key)
  elements['terminal-loader'].hidden = !loading
}

function loadTerminalStyles() {
  if (terminalStyleLoad !== undefined) return terminalStyleLoad
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = './vendor/xterm.css'
  terminalStyleLoad = new Promise((resolve, reject) => {
    stylesheet.addEventListener('load', resolve, { once: true })
    stylesheet.addEventListener('error', () => {
      stylesheet.remove()
      terminalStyleLoad = undefined
      reject(new Error('terminal stylesheet failed to load'))
    }, { once: true })
    document.head.append(stylesheet)
  })
  return terminalStyleLoad
}

async function loadTerminalRuntime() {
  if (terminalRuntime !== undefined) return terminalRuntime
  if (terminalRuntimeLoad === undefined) {
    setTerminalStatus('terminalLoading', 'loading')
    setTerminalPlaceholder('terminalLoading', true)
    terminalRuntimeLoad = Promise.all([
      import('./vendor/xterm.mjs'),
      import('./vendor/addon-fit.mjs'),
      loadTerminalStyles(),
    ]).then(([xterm, fit]) => Object.freeze({ Terminal: xterm.Terminal, FitAddon: fit.FitAddon }))
  }
  try {
    terminalRuntime = await terminalRuntimeLoad
    return terminalRuntime
  } catch (error) {
    terminalRuntimeLoad = undefined
    setTerminalStatus('terminalLoadFailed', 'failed')
    setTerminalPlaceholder('terminalLoadFailed')
    throw error
  }
}

function saveTerminalSession(value) {
  terminalSessionId = value
  try {
    if (value === undefined) window.sessionStorage.removeItem(TERMINAL_SESSION_KEY)
    else window.sessionStorage.setItem(TERMINAL_SESSION_KEY, value)
  } catch {}
}

function storedTerminalSession() {
  try { return window.sessionStorage.getItem(TERMINAL_SESSION_KEY) ?? undefined } catch { return undefined }
}

function terminalWebSocketUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${API}/terminal/sessions/${sessionId}/stream`
}

function terminalDimensions() {
  return {
    cols: Math.max(2, Math.min(500, terminalEmulator?.cols ?? 80)),
    rows: Math.max(1, Math.min(200, terminalEmulator?.rows ?? 24)),
  }
}

function sendTerminalResize() {
  if (terminalSocket?.readyState !== WebSocket.OPEN) return
  terminalSocket.send(JSON.stringify({ type: 'resize', ...terminalDimensions() }))
}

function fitTerminal() {
  if (terminalEmulator === undefined || elements['panel-terminal'].hidden) return
  window.cancelAnimationFrame(terminalResizeFrame)
  terminalResizeFrame = window.requestAnimationFrame(() => {
    try {
      terminalFit.fit()
      sendTerminalResize()
    } catch {}
  })
}

async function initializeTerminal() {
  if (terminalEmulator !== undefined) return
  const { Terminal, FitAddon } = await loadTerminalRuntime()
  terminalFit = new FitAddon()
  terminalEmulator = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5_000,
    theme: terminalTheme(),
  })
  terminalEmulator.loadAddon(terminalFit)
  terminalEmulator.open(elements['terminal-screen'])
  terminalEmulator.onData(data => {
    if (terminalSocket?.readyState === WebSocket.OPEN && terminalSessionState === 'connected') {
      terminalSocket.send(JSON.stringify({ type: 'input', data }))
    }
  })
  terminalResizeObserver = new ResizeObserver(fitTerminal)
  terminalResizeObserver.observe(elements['terminal-frame'])
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', () => {
    if (document.documentElement.dataset.theme === undefined) terminalEmulator.options.theme = terminalTheme()
  })
  setTerminalPlaceholder('terminalPlaceholder')
  fitTerminal()
}

function clearTerminalReconnect() {
  window.clearTimeout(terminalReconnectTimer)
  terminalReconnectTimer = undefined
  terminalReconnectDeadline = undefined
}

function forgetTerminalSession(statusKey = 'terminalIdle', state = 'idle') {
  clearTerminalReconnect()
  terminalSocket?.close()
  terminalSocket = undefined
  saveTerminalSession(undefined)
  terminalEmulator?.reset()
  setTerminalStatus(statusKey, state)
}

function connectTerminal({ reconnect = false } = {}) {
  if (terminalSessionId === undefined || terminalLeaving) return
  clearTimeout(terminalReconnectTimer)
  setTerminalStatus(reconnect ? 'terminalReconnecting' : 'terminalConnecting', reconnect ? 'reconnecting' : 'connecting')
  terminalEmulator.reset()
  const sessionId = terminalSessionId
  const socket = new WebSocket(terminalWebSocketUrl(sessionId))
  terminalSocket = socket
  socket.addEventListener('open', () => {
    if (terminalSocket !== socket || terminalSessionId !== sessionId) return socket.close()
    terminalReconnectDeadline = undefined
    setTerminalStatus('terminalConnected', 'connected')
    sendTerminalResize()
    terminalEmulator.focus()
  })
  socket.addEventListener('message', event => {
    if (terminalSocket !== socket) return
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'output' && typeof message.data === 'string') terminalEmulator.write(message.data)
      else if (message.type === 'exit') {
        const result = message.code === null || message.code === undefined ? `signal ${display(message.signal)}` : String(message.code)
        setTerminalStatus('terminalExited', 'exited', { status: result })
      }
    } catch {
      setTerminalStatus('terminalFailed', 'failed')
    }
  })
  socket.addEventListener('close', () => {
    if (terminalSocket !== socket) return
    terminalSocket = undefined
    if (terminalLeaving || terminalSessionId !== sessionId || terminalSessionState === 'exited') return
    terminalReconnectDeadline ??= Date.now() + 30_000
    if (Date.now() >= terminalReconnectDeadline) {
      forgetTerminalSession('terminalFailed', 'failed')
      return
    }
    setTerminalStatus('terminalReconnecting', 'reconnecting')
    terminalReconnectTimer = window.setTimeout(() => connectTerminal({ reconnect: true }), 1_000)
  })
  socket.addEventListener('error', () => {
    if (terminalSocket === socket) setTerminalStatus('terminalReconnecting', 'reconnecting')
  })
}

function restoreTerminalSession() {
  if (terminalRestored) return Promise.resolve()
  if (terminalRestore !== undefined) return terminalRestore
  terminalRestore = (async () => {
    try {
      await initializeTerminal()
    } catch {
      return
    }
    terminalRestored = true
    const sessionId = storedTerminalSession()
    if (sessionId === undefined) return setTerminalStatus('terminalIdle', 'idle')
    saveTerminalSession(sessionId)
    try {
      await api(`terminal/sessions/${sessionId}`)
      connectTerminal()
    } catch (error) {
      if (error.statusCode === 404) forgetTerminalSession()
      else setTerminalStatus('terminalFailed', 'failed')
    }
  })().finally(() => { terminalRestore = undefined })
  return terminalRestore
}

async function createTerminalSession() {
  try {
    await initializeTerminal()
    setTerminalStatus('terminalStarting', 'starting')
    fitTerminal()
    const session = await api('terminal/sessions', { method: 'POST', body: terminalDimensions() })
    saveTerminalSession(session.sessionId)
    connectTerminal()
  } catch (error) {
    if (terminalEmulator !== undefined) {
      forgetTerminalSession('terminalFailed', 'failed')
      showError(error)
    }
  }
}

async function closeTerminalSession() {
  const sessionId = terminalSessionId
  if (sessionId === undefined) return
  elements['close-terminal'].disabled = true
  try { await api(`terminal/sessions/${sessionId}`, { method: 'DELETE' }) } catch (error) {
    if (error.statusCode !== 404) showError(error)
  }
  forgetTerminalSession('terminalClosed', 'closed')
}

function fileOperationMessage(value, failed = false) {
  window.clearTimeout(fileOperationTimer)
  fileOperationTimer = undefined
  elements['file-operation'].hidden = value === ''
  elements['file-operation'].textContent = value
  elements['file-operation'].classList.toggle('failed', failed)
  if (value !== '' && !failed) {
    fileOperationTimer = window.setTimeout(() => fileOperationMessage(''), 3_000)
  }
}

function finishTextInput(value) {
  if (textInputResolve === undefined) return
  const resolve = textInputResolve
  textInputResolve = undefined
  textInputValidate = undefined
  elements['text-input-dialog'].close()
  resolve(value)
}

function requestTextInput({ title, detail, value = '', validate = next => next.trim() === '' ? t('invalidFileName') : null }) {
  if (textInputResolve !== undefined) return Promise.resolve(null)
  elements['text-input-dialog-title'].textContent = title
  elements['text-input-dialog-detail'].textContent = detail
  elements['text-input-dialog-value'].value = value
  elements['text-input-dialog-value'].setAttribute('aria-label', title)
  elements['text-input-dialog-error'].hidden = true
  elements['text-input-dialog-error'].textContent = ''
  textInputValidate = validate
  elements['text-input-dialog'].showModal()
  elements['text-input-dialog-value'].focus()
  elements['text-input-dialog-value'].select()
  return new Promise(resolve => { textInputResolve = resolve })
}

function finishConfirmation(value) {
  if (confirmationResolve === undefined) return
  const resolve = confirmationResolve
  confirmationResolve = undefined
  elements['confirmation-dialog'].close()
  resolve(value)
}

function requestConfirmation({ title, detail, confirmLabel, danger = false }) {
  if (confirmationResolve !== undefined) return Promise.resolve(false)
  elements['confirmation-dialog-title'].textContent = title
  elements['confirmation-dialog-detail'].textContent = detail
  elements['confirmation-dialog-confirm'].textContent = confirmLabel
  elements['confirmation-dialog-confirm'].className = danger ? 'danger' : 'primary'
  elements['confirmation-dialog'].showModal()
  return new Promise(resolve => { confirmationResolve = resolve })
}

function confirmDiscardChanges() {
  if (!fileEditorDirty) return Promise.resolve(true)
  return requestConfirmation({ title: t('discardChangesTitle'), detail: t('unsavedFile'), confirmLabel: t('discardChanges'), danger: true })
}

async function initializeFiles() {
  if (filesLoaded) return
  scheduleFileTaskRefresh()
  if (fileConfigLoad === undefined) {
    fileConfigLoad = api('files/config').then(config => {
      if (typeof config?.defaultPath !== 'string' || !Array.isArray(config.shortcuts)) throw new Error('file management configuration is invalid')
      filePath = config.defaultPath
      elements['file-path'].value = filePath
      elements['file-shortcuts'].replaceChildren(...config.shortcuts.map(path => {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.fileLocation = path
        button.textContent = path
        button.addEventListener('click', () => { void navigateFiles(path) })
        return button
      }))
      return navigateFiles(filePath, { history: false })
    }).catch(error => {
      fileConfigLoad = undefined
      showError(error)
    })
  }
  return fileConfigLoad
}

function selectedFileEntries() {
  return fileListing.entries.filter(entry => fileSelected.has(entry.path))
}

function renderFileSelection() {
  const count = fileSelected.size
  const selected = selectedFileEntries()
  if (fileAttributesEntry !== null && (selected.length !== 1 || selected[0].path !== fileAttributesEntry.path)) closeFileAttributes()
  elements['file-selection-count'].textContent = count === 0 ? t('noFilesSelected') : t('filesSelected', { count })
  const busy = fileTasksActive.some(task => ['queued', 'running'].includes(task.status))
    || fileUploadQueue.some(task => ['queued', 'running'].includes(task.status))
  for (const id of ['file-copy', 'file-cut', 'file-rename', 'file-delete']) elements[id].disabled = count === 0 || busy
  elements['file-archive'].disabled = count === 0 || busy
  elements['file-extract'].disabled = count !== 1 || selected[0]?.type !== 'file' || busy
  elements['file-rename'].disabled = count !== 1 || busy
  elements['file-download'].disabled = count !== 1 || !['file', 'directory'].includes(selected[0]?.type) || busy
  elements['file-attributes'].disabled = count !== 1 || !['file', 'directory'].includes(selected[0]?.type) || busy
  elements['file-paste'].disabled = fileClipboard === null || busy
  for (const id of ['file-new', 'file-upload', 'file-upload-directory']) elements[id].disabled = busy
  elements['file-select-all'].checked = count > 0 && count === visibleFileEntries().length
  elements['file-select-all'].indeterminate = count > 0 && count !== visibleFileEntries().length
}

function taskLabel(task) {
  const operation = {
    archive: t('compress'), extract: t('extract'), upload: t('upload'), download: t('download'),
    mkdir: t('newDirectory'),
    copy: t('copy'), move: t('cut'), delete: t('deletePermanently'), attributes: t('attributesOperation'),
  }[task.operation] ?? task.operation
  return `${operation}: ${task.currentPath ?? task.path ?? task.destination ?? ''}`
}

function renderFileTasks() {
  const recentCutoff = Date.now() - 10_000
  const localPaths = new Set(fileUploadQueue.map(task => task.path))
  const backend = fileTasksActive.filter(task => !(fileUploadQueue.length > 0 && task.operation === 'mkdir')
    && !(task.operation === 'upload' && localPaths.has(task.path)))
  const visible = [...fileUploadQueue, ...backend].filter(task => ['queued', 'running'].includes(task.status)
    || (task.status === 'failed' && Date.parse(task.updatedAt) >= recentCutoff))
  elements['file-task-state'].hidden = visible.length === 0
  elements['file-task-list'].replaceChildren(...visible.map(task => {
    const row = document.createElement('div')
    row.className = 'file-task-row'
    const label = document.createElement('p')
    label.textContent = taskLabel(task)
    const cancel = document.createElement('button')
    if (['queued', 'running'].includes(task.status)) {
      cancel.type = 'button'
      cancel.className = 'compact'
      cancel.textContent = t('cancelOperation')
      cancel.addEventListener('click', () => {
        if (task.local === true) task.cancel()
        else void api(`files/tasks/${task.taskId}`, { method: 'DELETE' }).then(refreshFileTasks).catch(showError)
      })
    }
    const progress = document.createElement('progress')
    if (Number.isSafeInteger(task.totalBytes) && task.totalBytes > 0) {
      progress.max = task.totalBytes
      progress.value = Math.min(task.totalBytes, task.processedBytes ?? 0)
    }
    const detail = document.createElement('small')
    detail.textContent = task.status === 'queued' ? t('queuedOperation', { position: task.queuePosition })
      : task.status === 'success' ? t('operationSucceeded')
        : task.status === 'failed' ? `${t('operationFailedState')}: ${task.error ?? t('operationFailed')}`
          : task.status === 'cancelled' ? t('operationCancelled')
            : Number.isSafeInteger(task.totalBytes) && task.totalBytes > 0
              ? `${fileSize(task.processedBytes ?? 0)} / ${fileSize(task.totalBytes)}` : t('processingOperation')
    row.classList.toggle('failed', task.status === 'failed')
    row.append(label)
    if (cancel.type === 'button') row.append(cancel)
    row.append(progress, detail)
    return row
  }))
  renderFileSelection()
}

async function refreshFileTasks() {
  try {
    const result = await api('files/tasks')
    fileTasksActive = result.tasks ?? []
    renderFileTasks()
  } catch (error) { showError(error) }
}

function scheduleFileTaskRefresh() {
  window.clearInterval(fileTaskRefreshTimer)
  void refreshFileTasks()
  fileTaskRefreshTimer = window.setInterval(() => {
    if (!elements['panel-files'].hidden) void refreshFileTasks()
  }, 500)
}

function inferArchiveFormat(name) {
  const lower = name.toLocaleLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz'
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.7z')) return '7z'
  return null
}

function closeArchivePanel() {
  fileArchiveMode = null
  elements['file-archive-panel'].hidden = true
}

function openArchivePanel(mode) {
  const selected = selectedFileEntries()
  if (mode === 'extract') {
    const format = selected.length === 1 ? inferArchiveFormat(selected[0].name) : null
    if (format === null) return fileOperationMessage(t('unsupportedArchive'), true)
    elements['file-archive-format'].value = format
    elements['file-archive-title'].textContent = t('extractArchive')
    elements['file-archive-name-row'].hidden = true
    elements['file-archive-submit'].textContent = t('extract')
    elements['file-archive-detail'].textContent = selected[0].path
  } else {
    const base = selected.length === 1 ? selected[0].name.replace(/\.(tar\.gz|tgz|zip|7z)$/iu, '') : 'archive'
    elements['file-archive-name'].value = base
    elements['file-archive-title'].textContent = t('compressItems')
    elements['file-archive-name-row'].hidden = false
    elements['file-archive-submit'].textContent = t('compress')
    elements['file-archive-detail'].textContent = t('filesSelected', { count: selected.length })
  }
  fileArchiveMode = mode
  elements['file-archive-panel'].hidden = false
}

async function submitArchive() {
  const runWithConflicts = async body => {
    let conflict = 'reject'
    for (;;) {
      const result = await runFileTask({ ...body, conflict })
      if (result === null || result.status === 'success') return result
      if (result.errorCode !== 'FILE_EXISTS') {
        fileOperationMessage(result.error ?? t('operationFailed'), true)
        return result
      }
      const decision = await chooseFileConflict(body.destination, false)
      if (decision.choice === 'cancel' || decision.choice === 'skip') return result
      conflict = decision.choice
    }
  }
  const selected = selectedFileEntries()
  if (fileArchiveMode === 'extract') {
    const entry = selected[0]
    if (entry === undefined) return closeArchivePanel()
    const task = await runWithConflicts({
      operation: 'extract', archiveFormat: elements['file-archive-format'].value,
      sources: [{ path: entry.path, revision: entry.revision }], destination: filePath,
    })
    if (task?.status === 'success') { closeArchivePanel(); await navigateFiles(filePath, { history: false }); fileOperationMessage(t('operationComplete')) }
    return
  }
  const name = elements['file-archive-name'].value.trim()
  if (!fileNameIsValid(name)) return fileOperationMessage(t('invalidArchiveName'), true)
  const format = elements['file-archive-format'].value
  const extension = format === 'tar.gz' ? '.tar.gz' : `.${format}`
  const task = await runWithConflicts({
    operation: 'archive', archiveFormat: format, sources: sourceDescriptors(),
    destination: fileDestination(name.endsWith(extension) ? name : `${name}${extension}`),
  })
  if (task?.status === 'success') { closeArchivePanel(); await navigateFiles(filePath, { history: false }); fileOperationMessage(t('operationComplete')) }
}

const permissionInputs = [...document.querySelectorAll('[data-permission-bit]')]

function syncPermissionChecks(mode) {
  for (const input of permissionInputs) input.checked = (mode & Number(input.dataset.permissionBit)) !== 0
}

function syncModeFromPermissions() {
  const current = /^[0-7]{3,4}$/u.test(elements['file-attributes-mode'].value)
    ? Number.parseInt(elements['file-attributes-mode'].value, 8) : 0
  const permissions = permissionInputs.reduce((value, input) => value + (input.checked ? Number(input.dataset.permissionBit) : 0), 0)
  elements['file-attributes-mode'].value = ((current & 0o7000) | permissions).toString(8).padStart(4, '0')
}

function closeFileAttributes() {
  fileAttributesEntry = null
  elements['file-attributes-panel'].hidden = true
  elements['file-attributes'].setAttribute('aria-expanded', 'false')
}

function openFileAttributes(entry) {
  fileAttributesEntry = entry
  elements['file-attributes-path'].textContent = entry.path
  elements['file-attributes-mode'].value = entry.mode.toString(8).padStart(4, '0')
  elements['file-attributes-user'].value = entry.user
  elements['file-attributes-group'].value = entry.group
  elements['file-attributes-recursive'].checked = false
  elements['file-attributes-recursive-row'].hidden = entry.type !== 'directory'
  syncPermissionChecks(entry.mode)
  elements['file-attributes-panel'].hidden = false
  elements['file-attributes'].setAttribute('aria-expanded', 'true')
  elements['file-attributes-mode'].focus()
}

async function applyFileAttributes() {
  if (fileAttributesEntry === null) return
  const user = elements['file-attributes-user'].value.trim()
  const group = elements['file-attributes-group'].value.trim()
  const mode = elements['file-attributes-mode'].value.trim()
  if (user === '' || group === '' || !/^[0-7]{3,4}$/u.test(mode)) {
    fileOperationMessage(t('attributesInvalid'), true)
    return
  }
  const task = await startFileTask({
    operation: 'attributes',
    sources: [{ path: fileAttributesEntry.path, revision: fileAttributesEntry.revision }],
    attributes: {
      user, group, mode,
      recursive: fileAttributesEntry.type === 'directory' && elements['file-attributes-recursive'].checked,
    },
  })
  if (task !== undefined) closeFileAttributes()
}

function visibleFileEntries() {
  const query = elements['file-search']?.value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en-US') ?? ''
  const hidden = elements['file-hidden']?.checked ?? true
  return fileListing.entries.filter(entry => (hidden || !entry.name.startsWith('.')) && (query === '' || entry.name.toLocaleLowerCase().includes(query)))
}

function fileTypeMark(type) {
  return { directory: '▣', file: '·', symlink: '↗', fifo: '│', socket: '◉', 'block-device': '◆', 'character-device': '◇' }[type] ?? '?'
}

function directorySizeButton(entry) {
  const cached = fileDirectorySizes.get(entry.path)
  const current = cached?.revision === entry.revision ? cached : undefined
  const calculate = document.createElement('button')
  calculate.type = 'button'
  calculate.className = 'file-size-action'
  calculate.disabled = current?.status === 'running'
  calculate.textContent = current?.status === 'success' ? fileSize(current.bytes)
    : current?.status === 'running' ? t('calculatingSize')
      : current?.status === 'failed' ? t('sizeCalculationFailed') : t('calculateSize')
  calculate.addEventListener('click', event => { event.stopPropagation(); void calculateDirectorySize(entry) })
  return calculate
}

async function calculateDirectorySize(entry) {
  fileDirectorySizes.set(entry.path, { revision: entry.revision, status: 'running' })
  renderFiles()
  try {
    const task = await api('files/tasks', { method: 'POST', body: { operation: 'size', path: entry.path, revision: entry.revision } })
    for (;;) {
      const state = await api(`files/tasks/${task.taskId}`)
      if (state.status !== 'running') {
        fileDirectorySizes.set(entry.path, state.status === 'success' && state.revision === entry.revision
          ? { revision: entry.revision, status: 'success', bytes: state.bytes }
          : { revision: entry.revision, status: 'failed' })
        renderFiles()
        return
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch (error) {
    fileDirectorySizes.set(entry.path, { revision: entry.revision, status: 'failed' })
    renderFiles()
    showError(error)
  }
}

function renderFiles() {
  const values = visibleFileEntries()
  elements['file-list'].replaceChildren()
  elements['file-empty'].hidden = values.length !== 0 || fileLoading
  const start = fileListing.total === 0 ? 0 : filePageIndex * filePageSize + 1
  const end = Math.min(fileListing.total, start + fileListing.entries.length - 1)
  const lastPage = Math.max(0, Math.ceil(fileListing.total / filePageSize) - 1)
  elements['file-page-status'].textContent = t('totalItems', { total: fileListing.total })
  elements['file-page-current'].textContent = String(filePageIndex + 1)
  elements['file-page-jump'].max = String(lastPage + 1)
  if (document.activeElement !== elements['file-page-jump']) elements['file-page-jump'].value = String(filePageIndex + 1)
  elements['file-page-previous'].disabled = fileLoading || filePageIndex === 0
  elements['file-page-next'].disabled = fileLoading || filePageIndex === lastPage
  elements['file-page-jump'].disabled = fileLoading
  elements['file-managed-warning'].hidden = !fileListing.managed
  for (const entry of values) {
    const row = document.createElement('tr')
    row.dataset.type = entry.type
    row.classList.toggle('selected', fileSelected.has(entry.path))
    const checkCell = document.createElement('td')
    checkCell.className = 'file-check'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = fileSelected.has(entry.path)
    check.setAttribute('aria-label', entry.name)
    check.addEventListener('change', () => {
      if (check.checked) fileSelected.add(entry.path); else fileSelected.delete(entry.path)
      renderFiles()
    })
    checkCell.append(check)
    const name = document.createElement('td')
    const mark = document.createElement('span')
    mark.className = 'file-type-mark'
    mark.textContent = fileTypeMark(entry.type)
    const label = document.createElement('strong')
    label.textContent = entry.name
    const mobileMeta = document.createElement('span')
    mobileMeta.className = 'file-mobile-meta'
    const mobileOwner = document.createElement('span')
    mobileOwner.textContent = `${entry.user}:${entry.group}`
    mobileMeta.append(mobileOwner, document.createTextNode(' · '), entry.type === 'directory' ? directorySizeButton(entry) : document.createTextNode(fileSize(entry.size)))
    name.append(mark, label, mobileMeta)
    const size = document.createElement('td')
    if (entry.type === 'directory') size.append(directorySizeButton(entry)); else size.textContent = fileSize(entry.size)
    const owner = document.createElement('td')
    owner.textContent = `${entry.user}:${entry.group}`
    const modified = document.createElement('td')
    modified.textContent = localTime(entry.modifiedAt)
    const mode = document.createElement('td')
    mode.textContent = (entry.mode ?? 0).toString(8).padStart(3, '0')
    row.append(checkCell, name, size, owner, modified, mode)
    row.addEventListener('click', event => {
      if (event.target === check) return
      if (fileSelected.has(entry.path)) fileSelected.delete(entry.path); else fileSelected.add(entry.path)
      renderFiles()
    })
    row.addEventListener('dblclick', () => { if (entry.type === 'directory') void navigateFiles(entry.path); else if (entry.type === 'file') void openFileEditor(entry) })
    elements['file-list'].append(row)
  }
  renderFileSelection()
  renderFileCreate()
}

function renderFileNavigation() {
  elements['file-back'].disabled = fileLoading || fileHistory.length === 0
  elements['file-forward'].disabled = fileLoading || fileFuture.length === 0
  elements['file-up'].disabled = fileLoading || filePath === '/'
  elements['file-create-location'].textContent = t('createLocation', { path: filePath })
}

function fileNameIsValid(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && value !== '.'
    && value !== '..'
    && !/[\/\u0000-\u001f\u007f]/u.test(value)
    && new TextEncoder().encode(value).byteLength <= 255
}

function renderFileCreate() {
  const value = elements['file-create-name'].value
  const valid = fileNameIsValid(value)
  elements['file-create-panel'].hidden = !fileCreateExpanded
  elements['file-new'].setAttribute('aria-expanded', String(fileCreateExpanded))
  for (const button of document.querySelectorAll('[data-file-create-kind]')) {
    button.setAttribute('aria-pressed', String(button.dataset.fileCreateKind === fileCreateKind))
  }
  elements['file-create-submit'].disabled = !valid || fileActiveTask !== null
  elements['file-create-error'].hidden = value === '' || valid
  elements['file-create-error'].textContent = valid ? '' : t('invalidFileName')
  elements['file-create-location'].textContent = t('createLocation', { path: filePath })
}

function setFileCreateExpanded(expanded) {
  fileCreateExpanded = expanded
  if (!expanded) {
    elements['file-create-name'].value = ''
    fileCreateKind = 'touch'
  }
  renderFileCreate()
  if (expanded) window.requestAnimationFrame(() => elements['file-create-name'].focus())
}

async function createFileEntry() {
  const name = elements['file-create-name'].value
  if (!fileNameIsValid(name)) return renderFileCreate()
  const destination = filePath === '/' ? `/${name}` : `${filePath}/${name}`
  const task = await startFileTask({
    operation: fileCreateKind,
    destination,
    destinationRevision: fileListing.revision,
  })
  if (task !== undefined) setFileCreateExpanded(false)
}

async function navigateFiles(path, { history = true, offset = null, pageIndex = 0 } = {}) {
  if (fileLoading) return false
  fileLoading = true
  renderFileNavigation()
  clearError()
  try {
    const query = new URLSearchParams({ path, limit: String(filePageSize), sort: fileSort, order: fileOrder })
    if (offset !== null) query.set('offset', String(offset))
    const next = await api(`files/list?${query}`)
    if (history && filePath !== next.path) {
      fileHistory.push(filePath)
      fileFuture = []
    }
    filePath = next.path
    elements['file-path'].value = filePath
    fileSelected.clear()
    filePageIndex = pageIndex
    fileListing = next
    filesLoaded = true
    renderFiles()
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    fileLoading = false
    renderFileNavigation()
    renderFiles()
  }
}

function renderFileSort() {
  for (const button of document.querySelectorAll('[data-file-sort]')) {
    const order = button.dataset.fileSort === fileSort ? fileOrder : ''
    if (order === '') delete button.dataset.sortOrder
    else button.dataset.sortOrder = order
    button.closest('th').setAttribute('aria-sort', order === 'asc' ? 'ascending' : order === 'desc' ? 'descending' : 'none')
  }
}

function updateEditorLines() {
  const count = elements['file-editor-content'].value.split('\n').length
  elements['file-editor-lines'].textContent = Array.from({ length: count }, (_, index) => String(index + 1)).join('\n')
  elements['file-editor-lines'].scrollTop = elements['file-editor-content'].scrollTop
}

function renderFileEditorState() {
  elements['file-editor-status'].textContent = t(fileEditorSaving ? 'fileEditorSaving' : fileEditorDirty ? 'fileEditorUnsaved' : 'fileEditorSaved')
  elements['file-editor-status'].classList.toggle('dirty', fileEditorDirty && !fileEditorSaving)
  elements['file-editor-reload'].disabled = fileEditorSaving
  elements['file-editor-save-as'].disabled = fileEditorSaving
  elements['file-editor-save'].disabled = fileEditorSaving || !fileEditorDirty
}

async function openFileEditor(entry) {
  clearError()
  try {
    fileEditor = await api(`files/content?path=${encodeURIComponent(entry.path)}`)
    fileEditorOriginal = fileEditor.content
    fileEditorDirty = false
    elements['file-editor-path'].textContent = fileEditor.path
    elements['file-editor-content'].value = fileEditor.content
    elements['file-editor-meta'].textContent = `${fileEditor.encoding} · ${fileSize(fileEditor.size)} · ${fileEditor.newline.toUpperCase()}`
    updateEditorLines()
    renderFileEditorState()
    elements['file-editor-dialog'].showModal()
    elements['file-editor-content'].focus()
  } catch (error) { showError(error) }
}

async function saveFileEditor(saveAs = false) {
  if (fileEditor === null) return
  let path = fileEditor.path
  let revision = fileEditor.revision
  let create = false
  if (saveAs) {
    const value = await requestTextInput({
      title: t('saveAsTitle'), detail: t('saveAsDetail'), value: fileEditor.path,
      validate: next => next.startsWith('/') && !/[\u0000-\u001f\u007f]/u.test(next) ? null : t('invalidFileName'),
    })
    if (value === null) return
    path = value
    revision = null
    create = true
  }
  fileEditorSaving = true
  renderFileEditorState()
  const content = elements['file-editor-content'].value
  try {
    const saved = await api('files/content', { method: 'PUT', body: { path, content, revision, create } })
    fileEditor = { ...fileEditor, ...saved, path, content }
    fileEditorOriginal = content
    fileEditorDirty = elements['file-editor-content'].value !== fileEditorOriginal
    elements['file-editor-path'].textContent = path
    fileOperationMessage(t('fileSaved'))
    await navigateFiles(filePath, { history: false })
  } catch (error) {
    if (error.statusCode === 409) fileOperationMessage(t('fileRevisionChanged'), true)
    else showError(error)
  } finally {
    fileEditorSaving = false
    renderFileEditorState()
  }
}

async function closeFileEditor() {
  if (!await confirmDiscardChanges()) return false
  elements['file-editor-dialog'].close()
  fileEditor = null
  fileEditorDirty = false
  fileEditorSaving = false
  return true
}

async function waitFileTask(taskId, { report = true, refresh = true } = {}) {
  fileActiveTask = taskId
  elements['file-task-state'].hidden = false
  renderFileSelection()
  let result = null
  try {
    for (;;) {
      const task = await api(`files/tasks/${taskId}`)
      elements['file-task-label'].textContent = t('taskRunning', { operation: task.operation === 'attributes' ? t('attributesOperation') : task.operation })
      if (!['queued', 'running'].includes(task.status)) {
        result = task
        if (report && task.status === 'success') fileOperationMessage(t('operationComplete'))
        else if (report) fileOperationMessage(task.errorCode === 'FILE_ATTRIBUTES_UNSUPPORTED' ? t('attributesUnsupported') : task.error ?? t('operationFailed'), true)
        break
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  } catch (error) { showError(error) } finally {
    fileActiveTask = null
    await refreshFileTasks()
    if (refresh) await navigateFiles(filePath, { history: false })
  }
  return result
}

async function startFileTask(body) {
  clearError()
  try {
    const task = await api('files/tasks', { method: 'POST', body })
    await refreshFileTasks()
    void waitFileTask(task.taskId)
    return task
  } catch (error) { showError(error); return undefined }
}

function sourceDescriptors() {
  return selectedFileEntries().map(entry => ({ path: entry.path, revision: entry.revision }))
}

function fileDestination(name) {
  return filePath === '/' ? `/${name}` : `${filePath}/${name}`
}

function finishFileConflict(value) {
  if (fileConflictResolve === null) return
  const resolve = fileConflictResolve
  fileConflictResolve = null
  elements['file-conflict-dialog'].close()
  resolve(value)
}

function chooseFileConflict(path, multiple) {
  elements['file-conflict-path'].textContent = path
  elements['file-conflict-all-row'].hidden = !multiple
  elements['file-conflict-all'].checked = false
  elements['file-conflict-confirm'].disabled = true
  for (const input of document.querySelectorAll('input[name="file-conflict-choice"]')) input.checked = false
  elements['file-conflict-dialog'].showModal()
  return new Promise(resolve => { fileConflictResolve = resolve })
}

async function runFileTask(body) {
  clearError()
  try {
    const task = await api('files/tasks', { method: 'POST', body })
    return await waitFileTask(task.taskId, { report: false, refresh: false })
  } catch (error) {
    showError(error)
    return null
  }
}

function readDroppedFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function readDroppedDirectory(entry) {
  const reader = entry.createReader()
  const entries = []
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function collectDroppedEntry(entry, parent = '') {
  const relativePath = parent === '' ? entry.name : `${parent}/${entry.name}`
  if (entry.isFile) return [{ file: await readDroppedFile(entry), relativePath }]
  if (!entry.isDirectory) return []
  const children = await readDroppedDirectory(entry)
  const nested = await Promise.all(children.map(child => collectDroppedEntry(child, relativePath)))
  return [{ directory: true, relativePath }, ...nested.flat()]
}

async function droppedUploadItems(dataTransfer) {
  const entries = [...(dataTransfer.items ?? [])]
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean)
  if (entries.length > 0) return (await Promise.all(entries.map(entry => collectDroppedEntry(entry)))).flat()
  return [...dataTransfer.files].map(file => ({ file, relativePath: file.name }))
}

async function uploadFiles(values) {
  if (fileUploadQueue.some(task => ['queued', 'running'].includes(task.status))) return
  const files = values.map(value => value?.directory === true || value?.file instanceof File
    ? value : { file: value, relativePath: value.webkitRelativePath || value.name })
  const total = files.length
  fileUploadQueue = files.map(({ file, relativePath, directory = false }, index) => {
    const destination = filePath === '/' ? `/${relativePath}` : `${filePath}/${relativePath}`
    const task = {
      local: true,
      taskId: `browser-upload-${String(index)}`,
      operation: directory ? 'mkdir' : 'upload',
      path: destination,
      currentPath: destination,
      status: 'queued',
      queuePosition: index + 1,
      processedBytes: 0,
      totalBytes: file?.size ?? 0,
      updatedAt: new Date().toISOString(),
      cancelRequested: false,
      request: null,
    }
    task.cancel = () => {
      task.cancelRequested = true
      task.request?.abort()
      fileUploadQueue = fileUploadQueue.filter(value => value !== task)
      renderFileTasks()
    }
    return task
  })
  renderFileTasks()
  let conflictForAll = null
  let skipped = 0
  let stopped = false
  for (let index = 0; index < files.length; index += 1) {
    const { file, relativePath, directory = false } = files[index]
    const uploadTask = fileUploadQueue.find(task => task.taskId === `browser-upload-${String(index)}`)
    if (uploadTask === undefined || uploadTask.cancelRequested) continue
    uploadTask.status = 'running'
    uploadTask.queuePosition = 0
    for (const [position, task] of fileUploadQueue.filter(task => task.status === 'queued').entries()) task.queuePosition = position + 1
    elements['file-task-label'].textContent = t('uploadProgress', { current: index + 1, total })
    renderFileTasks()
    const segments = relativePath.split('/')
    if (segments.some(segment => !fileNameIsValid(segment))) {
      showError(new Error(t('invalidFileName')))
      stopped = true
      break
    }
    let parent = filePath
    for (const segment of directory ? segments : segments.slice(0, -1)) {
      parent = parent === '/' ? `/${segment}` : `${parent}/${segment}`
      try {
        const existing = await api(`files/stat?path=${encodeURIComponent(parent)}&optional=true`)
        if (existing !== null && existing.type !== 'directory') throw new Error(`${parent}: ${t('operationFailed')}`)
        if (existing !== null) continue
        const created = await runFileTask({ operation: 'mkdir', destination: parent })
        if (created?.status !== 'success') {
          fileOperationMessage(created?.error ?? t('operationFailed'), true)
          stopped = true
          break
        }
      } catch (error) {
        showError(error)
        stopped = true
        break
      }
    }
    if (stopped) break
    if (directory) {
      fileUploadQueue = fileUploadQueue.filter(task => task !== uploadTask)
      renderFileTasks()
      continue
    }
    const destination = parent === '/' ? `/${segments.at(-1)}` : `${parent}/${segments.at(-1)}`
    let conflict = ['overwrite', 'rename'].includes(conflictForAll) ? conflictForAll : 'reject'
    for (;;) {
      elements['file-task-state'].hidden = false
      elements['file-task-label'].textContent = t('uploadProgress', { current: index + 1, total: files.length })
      try {
        await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest()
          uploadTask.request = request
          request.open('POST', `${API}/files/upload?path=${encodeURIComponent(destination)}&conflict=${conflict}`)
          request.upload.onprogress = event => {
            uploadTask.processedBytes = event.loaded
            if (event.lengthComputable) uploadTask.totalBytes = event.total
            uploadTask.updatedAt = new Date().toISOString()
            renderFileTasks()
          }
          request.onload = () => {
            if (request.status >= 200 && request.status < 300) return resolve()
            const value = JSON.parse(request.responseText || '{}')
            const error = new Error(value.error ?? `HTTP ${String(request.status)}`)
            error.statusCode = request.status
            error.code = value.code
            reject(error)
          }
          request.onerror = () => reject(new Error(t('operationFailed')))
          request.onabort = () => reject(Object.assign(new Error(t('operationCancelled')), { code: 'FILE_TASK_CANCELLED' }))
          request.send(file)
        })
        uploadTask.request = null
        fileUploadQueue = fileUploadQueue.filter(task => task !== uploadTask)
        renderFileTasks()
        break
      } catch (error) {
        uploadTask.request = null
        if (uploadTask.cancelRequested || error.code === 'FILE_TASK_CANCELLED') break
        if (error.code === 'FILE_EXISTS') {
          if (conflictForAll === 'skip') { skipped += 1; break }
          const decision = await chooseFileConflict(destination, files.length > 1)
          if (decision.choice === 'cancel') { stopped = true; break }
          if (decision.applyAll) conflictForAll = decision.choice
          if (decision.choice === 'skip') { skipped += 1; break }
          conflict = decision.choice
          continue
        }
        showError(error)
        stopped = true
        break
      }
    }
    fileUploadQueue = fileUploadQueue.filter(task => task !== uploadTask)
    renderFileTasks()
    if (stopped) break
  }
  fileUploadQueue = []
  elements['file-task-label'].textContent = ''
  renderFileTasks()
  await navigateFiles(filePath, { history: false })
  if (!stopped) fileOperationMessage(skipped > 0 ? t('operationCompleteWithSkipped', { count: skipped }) : t('operationComplete'))
}

async function pasteFiles() {
  if (fileClipboard === null) return
  const clipboard = fileClipboard
  fileClipboard = null
  renderFileSelection()
  let conflictForAll = null
  let skipped = 0
  let stopped = false
  for (const source of clipboard.sources) {
    let conflict = ['overwrite', 'rename'].includes(conflictForAll) ? conflictForAll : 'reject'
    for (;;) {
      const task = await runFileTask({ operation: clipboard.operation, sources: [source], destination: filePath, conflict })
      if (task === null) { stopped = true; break }
      if (task.status === 'success') break
      if (task.errorCode === 'FILE_EXISTS') {
        if (conflictForAll === 'skip') { skipped += 1; break }
        const name = source.path.split('/').at(-1)
        const decision = await chooseFileConflict(fileDestination(name), clipboard.sources.length > 1)
        if (decision.choice === 'cancel') { stopped = true; break }
        if (decision.applyAll) conflictForAll = decision.choice
        if (decision.choice === 'skip') { skipped += 1; break }
        conflict = decision.choice
        continue
      }
      fileOperationMessage(task.error ?? t('operationFailed'), true)
      stopped = true
      break
    }
    if (stopped) break
  }
  await navigateFiles(filePath, { history: false })
  if (!stopped) fileOperationMessage(skipped > 0 ? t('operationCompleteWithSkipped', { count: skipped }) : t('operationComplete'))
}

async function recursiveFileSearch() {
  const query = elements['file-search'].value.trim()
  if (query === '') return
  try {
    const task = await api('files/tasks', { method: 'POST', body: { operation: 'search', path: filePath, revision: fileListing.revision, query } })
    fileActiveTask = task.taskId
    elements['file-task-state'].hidden = false
    elements['file-task-label'].textContent = t('searchRunning')
    for (;;) {
      const state = await api(`files/tasks/${task.taskId}?limit=1000`)
      if (state.status !== 'running') {
        if (state.status === 'success') {
          fileListing = { ...fileListing, entries: state.results, nextCursor: null, total: state.results.length }
          elements['file-search'].value = ''
          fileSelected.clear()
          renderFiles()
        } else fileOperationMessage(state.error ?? t('operationFailed'), true)
        break
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch (error) { showError(error) } finally { fileActiveTask = null; elements['file-task-state'].hidden = true }
}

const PROXY_TEST_STAGE_LABELS = Object.freeze({
  'proxy-address': 'proxyStageAddress',
  'proxy-connect': 'proxyStageConnect',
  'proxy-handshake': 'proxyStageHandshake',
  'target-dns': 'proxyStageDns',
  'target-tls': 'proxyStageTls',
  'target-http': 'proxyStageHttp',
})

function proxyLines(value) {
  return String(value ?? '').split(/\r?\n/u).map(entry => entry.trim()).filter(Boolean)
}

function directRuleText(configuration) {
  return [...new Set([
    ...(configuration.noProxy?.user ?? []),
    ...(configuration.bypass?.additional ?? []),
  ])].join('\n')
}

function splitDirectRules(value) {
  const rules = proxyLines(value)
  return {
    noProxy: rules.filter(rule => !/\/\d+$/u.test(rule)),
    bypass: rules.filter(rule => /\/\d+$/u.test(rule)),
  }
}

function clearProxySecrets() {
  elements['proxy-password'].value = ''
  elements['proxy-password'].disabled = false
  elements['proxy-clear-password'].checked = false
  renderProxyTransportWarning()
}

function renderProxyTransportWarning() {
  elements['proxy-transport-warning'].hidden = location.protocol === 'https:'
    || (elements['proxy-password'].value === '' && elements['proxy-username'].value === '')
}

function proxyCandidate() {
  if (proxyConfiguration === undefined) throw new Error(t('proxyComponentUnavailable'))
  const directRules = splitDirectRules(elements['proxy-direct-rules'].value)
  const password = elements['proxy-password'].value
  const clearPassword = elements['proxy-clear-password'].checked
  const providerPolicies = { ...(proxyConfiguration.modelApi?.providers ?? {}) }
  for (const input of elements['proxy-provider-list'].querySelectorAll('[data-provider-policy]')) {
    providerPolicies[input.dataset.providerPolicy] = input.checked ? 'proxy' : 'direct'
  }
  const proxy = {
    protocol: elements['proxy-protocol'].value,
    host: elements['proxy-host'].value.trim(),
    port: elements['proxy-port'].value === '' ? null : Number(elements['proxy-port'].value),
    username: elements['proxy-username'].value,
    passwordConfigured: proxyConfiguration.proxy.passwordConfigured === true,
    remoteDns: elements['proxy-remote-dns'].checked,
  }
  if (clearPassword) proxy.clearPassword = true
  else if (password !== '') proxy.password = password
  return {
    schema: 1,
    enabled: elements['proxy-enabled'].checked,
    proxy,
    scopes: Object.fromEntries([...document.querySelectorAll('[data-proxy-scope]')]
      .map(input => [input.dataset.proxyScope, input.checked])),
    environment: { allProxy: elements['proxy-all-proxy'].checked ? 'scope-proxy' : null },
    modelApi: { default: proxyConfiguration.modelApi?.default ?? 'direct', providers: providerPolicies },
    noProxy: { user: directRules.noProxy },
    bypass: { additional: directRules.bypass },
  }
}

function renderProxyProviders() {
  const container = elements['proxy-provider-list']
  container.replaceChildren()
  const providers = proxyProviderInventory.providers ?? []
  elements['proxy-provider-empty'].hidden = providers.length > 0
  container.hidden = providers.length === 0
  for (const provider of providers) {
    const row = document.createElement('div')
    row.className = 'proxy-provider-item'
    const identity = document.createElement('div')
    identity.className = 'proxy-provider-identity'
    const name = document.createElement('strong')
    const displayName = typeof provider.displayName === 'string' && provider.displayName.trim() !== ''
      ? provider.displayName : provider.id
    name.textContent = displayName
    identity.append(name)
    const information = provider.routingCapability === 'forced-direct'
      ? t('proxyProviderReasonLocal')
      : provider.routingCapability === 'shared-dsh' ? t('proxyProviderReasonShared') : null
    if (information !== null) {
      const info = document.createElement('button')
      info.type = 'button'
      info.className = 'proxy-provider-info'
      info.textContent = 'i'
      info.setAttribute('aria-label', t('proxyProviderInfo', { name: displayName }))
      info.addEventListener('click', () => {
        elements['proxy-provider-info-title'].textContent = displayName
        elements['proxy-provider-info-detail'].textContent = information
        elements['proxy-provider-info-dialog'].showModal()
      })
      identity.append(info)
    }
    if (provider.routingCapability === 'provider') {
      const toggle = document.createElement('label')
      toggle.className = 'toggle'
      toggle.setAttribute('aria-label', displayName)
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.dataset.providerPolicy = provider.id
      input.checked = provider.requestedPolicy === 'proxy'
      const track = document.createElement('span')
      track.setAttribute('aria-hidden', 'true')
      toggle.append(input, track)
      row.append(identity, toggle)
    } else {
      const badge = document.createElement('span')
      badge.className = 'proxy-capability'
      badge.textContent = provider.routingCapability === 'forced-direct'
        ? t('proxyProviderDirect') : t('proxyProviderShared')
      row.append(identity, badge)
    }
    container.append(row)
  }
}

function renderProxyCatalog() {
  const catalog = proxyConfiguration?.scopeCatalog
  const container = elements['proxy-scope-catalog']
  container.replaceChildren()
  if (catalog?.entries === undefined) return
  const groups = new Map()
  for (const entry of catalog.entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry)
  }
  for (const [group, entries] of groups) {
    const section = document.createElement('section')
    section.className = 'proxy-scope-group'
    const heading = document.createElement('h3')
    heading.textContent = catalog.groups?.[group]?.[locale] ?? group
    section.append(heading)
    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'proxy-scope-entry'
      const source = document.createElement('span')
      source.textContent = entry.source?.[locale] ?? entry.source?.en ?? entry.id
      const detail = document.createElement('span')
      detail.textContent = entry.detail?.[locale] ?? entry.detail?.en ?? ''
      row.append(source, detail)
      section.append(row)
    }
    container.append(section)
  }
  const summaries = elements['proxy-scope-summaries']
  summaries.replaceChildren(...(catalog.summaries ?? []).map(value => {
    const paragraph = document.createElement('p')
    paragraph.textContent = value?.[locale] ?? value?.en ?? ''
    return paragraph
  }))
}

function renderProxyConfiguration() {
  if (proxyConfiguration === undefined) return
  const configuration = proxyConfiguration
  elements['proxy-enabled'].checked = configuration.enabled === true
  elements['proxy-enabled-label'].textContent = t(configuration.enabled ? 'enabled' : 'disabled')
  elements['proxy-protocol'].value = configuration.proxy.protocol
  elements['proxy-host'].value = configuration.proxy.host
  elements['proxy-port'].value = configuration.proxy.port ?? ''
  elements['proxy-username'].value = configuration.proxy.username ?? ''
  elements['proxy-remote-dns'].checked = configuration.proxy.remoteDns === true
  elements['proxy-remote-dns-row'].hidden = configuration.proxy.protocol !== 'socks5'
  elements['proxy-password-state'].textContent = t(configuration.proxy.passwordConfigured ? 'proxyPasswordConfigured' : 'proxyPasswordNotConfigured')
  elements['proxy-clear-password-row'].hidden = configuration.proxy.passwordConfigured !== true
  for (const input of document.querySelectorAll('[data-proxy-scope]')) input.checked = configuration.scopes?.[input.dataset.proxyScope] === true
  elements['proxy-direct-rules'].value = directRuleText(configuration)
  elements['proxy-system-rules-list'].textContent = (configuration.noProxy?.system ?? []).join('\n')
  elements['proxy-all-proxy'].checked = configuration.environment?.allProxy === 'scope-proxy'
  elements['proxy-component-state'].textContent = t(configuration.componentReady ? 'proxyComponentReady' : 'proxyComponentUnavailable')
  renderProxyProviders()
  renderProxyCatalog()
  renderProxyTransportWarning()
}

function renderProxyTest(task = proxyTestTask) {
  proxyTestTask = task
  const container = elements['proxy-test-stages']
  container.replaceChildren()
  for (const stage of task?.stages ?? []) {
    const item = document.createElement('li')
    item.className = 'proxy-test-stage'
    item.dataset.state = stage.status
    const marker = document.createElement('span')
    marker.setAttribute('aria-hidden', 'true')
    const content = document.createElement('span')
    const label = document.createElement('strong')
    label.textContent = t(PROXY_TEST_STAGE_LABELS[stage.stage] ?? stage.stage)
    const detail = document.createElement('small')
    detail.textContent = stage.detail ?? stage.errorCode ?? ''
    content.append(label, detail)
    const statusLabel = document.createElement('small')
    statusLabel.textContent = t(`proxyStage${stage.status[0].toUpperCase()}${stage.status.slice(1)}`)
    item.append(marker, content, statusLabel)
    container.append(item)
  }
  const running = task?.status === 'running'
  elements['proxy-test'].disabled = running
  elements['proxy-save'].disabled = running
  elements['proxy-test-cancel'].hidden = !running
  const result = elements['proxy-operation-result']
  result.hidden = task === undefined || running
  if (task !== undefined && !running) {
    result.textContent = task.status === 'success' ? t('proxyTestSuccess')
      : task.status === 'cancelled' ? t('proxyTestCancelled')
        : `${t('proxyTestFailed')}: ${task.error?.detail ?? task.error?.errorCode ?? ''}`
  }
}

function scheduleProxyTestPoll(taskId) {
  window.clearTimeout(proxyTestPollTimer)
  proxyTestPollTimer = window.setTimeout(async () => {
    try {
      const task = await api(`proxy/test/tasks/${taskId}`)
      renderProxyTest(task)
      if (task.status === 'running') scheduleProxyTestPoll(taskId)
      else clearProxySecrets()
    } catch (error) {
      showError(error)
    }
  }, 400)
}

async function loadProxy({ force = false } = {}) {
  if (proxyLoading !== undefined) return proxyLoading
  if (proxyLoaded && !force) return
  proxyLoading = (async () => {
    try {
      const [configuration, providers] = await Promise.all([api('proxy'), api('proxy/provider-inventory')])
      proxyConfiguration = configuration
      proxyProviderInventory = providers
      proxyLoaded = true
      clearProxySecrets()
      renderProxyConfiguration()
      const activeTaskId = status?.proxyTestOperation?.status === 'running' ? status.proxyTestOperation.taskId : undefined
      if (activeTaskId !== undefined) {
        const task = await api(`proxy/test/tasks/${activeTaskId}`)
        renderProxyTest(task)
        scheduleProxyTestPoll(activeTaskId)
      }
    } catch (error) {
      showError(error)
    }
  })().finally(() => { proxyLoading = undefined })
  return proxyLoading
}

async function saveProxyConfiguration() {
  elements['proxy-save'].disabled = true
  elements['proxy-operation-result'].hidden = false
  elements['proxy-operation-result'].textContent = t('proxySaving')
  try {
    proxyConfiguration = await api('proxy', {
      method: 'PUT', body: { baseRevision: proxyConfiguration.revision, value: proxyCandidate() },
    })
    clearProxySecrets()
    renderProxyConfiguration()
    elements['proxy-operation-result'].textContent = t('proxySaved')
    clearError()
  } catch (error) {
    showError(error)
    elements['proxy-operation-result'].textContent = localizedError(error)
    if (error.statusCode === 409) await loadProxy({ force: true })
  } finally {
    elements['proxy-save'].disabled = false
  }
}

async function startProxyTest() {
  try {
    const started = await api('proxy/test', {
      method: 'POST', body: { baseRevision: proxyConfiguration.revision, value: proxyCandidate() },
    })
    const task = await api(`proxy/test/tasks/${started.taskId}`)
    renderProxyTest(task)
    scheduleProxyTestPoll(started.taskId)
    clearError()
  } catch (error) {
    showError(error)
    if (error.statusCode === 409) await loadProxy({ force: true })
  }
}

async function selectTab(tab) {
  const current = tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.dataset.tab
  if (current === 'files' && tab !== 'files') {
    if (!await confirmDiscardChanges()) return false
    fileClipboard = null
    fileSelected.clear()
  }
  if (current === 'proxy' && tab !== 'proxy') clearProxySecrets()
  for (const button of tabButtons) {
    const active = button.dataset.tab === tab
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
    elements[`panel-${button.dataset.tab}`].hidden = !active
  }
  tabButtons.find(button => button.dataset.tab === tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (tab === 'maintenance') {
    connectLogs()
  }
  if (tab === 'maintenance' && autoScroll) {
    window.requestAnimationFrame(() => {
      elements['log-list'].scrollTop = elements['log-list'].scrollHeight
    })
  }
  if (tab === 'terminal') {
    void restoreTerminalSession()
    fitTerminal()
    window.requestAnimationFrame(() => terminalEmulator?.focus())
  }
  const inventoryKey = inventoryKeyForTab(tab)
  if (inventoryKey !== undefined) void loadInventory(inventoryKey)
  if (tab === 'files' && !filesLoaded) void initializeFiles()
  else if (tab === 'files') scheduleFileTaskRefresh()
  if (tab === 'proxy') void loadProxy()
  return true
}

function connectEvents() {
  eventSource?.close()
  eventSource = new EventSource(`${API}/events`)
  eventSource.addEventListener('state', event => {
    try {
      const value = JSON.parse(event.data)
      if (value?.fileTask?.taskId === fileActiveTask) {
        const task = value.fileTask
        elements['file-task-label'].textContent = t('taskRunning', { operation: task.operation })
      }
    } catch {}
    void loadStatus()
    const inventoryKey = inventoryKeyForTab()
    if (inventoryKey !== undefined) void loadInventory(inventoryKey)
  })
  eventSource.onopen = () => setConnection('online')
  eventSource.onerror = () => setConnection('connecting')
}

function connectLogs({ force = false } = {}) {
  if (force) {
    logSource?.close()
    logSource = undefined
  }
  if (logSource !== undefined) return
  logLastActivity = Date.now()
  elements['log-connection'].dataset.state = 'connecting'
  elements['log-connection'].querySelector('strong').textContent = t('logsConnecting')
  logSource = new EventSource(`${API}/logs/stream?limit=${String(LOG_STREAM_LIMIT)}`)
  logSource.addEventListener('log', event => {
    logLastActivity = Date.now()
    try { appendLog(JSON.parse(event.data)) } catch {}
  })
  logSource.addEventListener('heartbeat', () => {
    logLastActivity = Date.now()
  })
  logSource.onopen = () => {
    logLastActivity = Date.now()
    elements['log-connection'].dataset.state = 'live'
    elements['log-connection'].querySelector('strong').textContent = t('logsLive')
  }
  logSource.onerror = () => {
    elements['log-connection'].dataset.state = 'disconnected'
    elements['log-connection'].querySelector('strong').textContent = t('logsDisconnected')
  }
  if (logWatchdogTimer === undefined) {
    logWatchdogTimer = window.setInterval(() => {
      if (logSource !== undefined && Date.now() - logLastActivity > 35_000) connectLogs({ force: true })
    }, 5_000)
  }
}

async function refreshLogs() {
  elements['refresh-logs'].disabled = true
  try {
    const result = await api(`logs?limit=${String(LOG_STREAM_LIMIT)}`)
    for (const entry of result.entries ?? []) appendLog(entry)
    logEntries.sort((left, right) => left.value.timestamp.localeCompare(right.value.timestamp))
    renderLogs()
    connectLogs({ force: true })
  } catch (error) {
    showError(error)
  } finally {
    elements['refresh-logs'].disabled = false
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => { void selectTab(button.dataset.tab) })
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const target = tabButtons[(tabButtons.indexOf(button) + offset + tabButtons.length) % tabButtons.length]
    void selectTab(target.dataset.tab).then(changed => { if (changed) target.focus() })
  })
}

function commitListPageJump(key, prefix) {
  const input = elements[`${prefix}-page-jump`]
  const value = Number(input.value)
  const values = key === 'plugins' ? plugins
    : key === 'systemSkills' ? systemSkills
      : key === 'userSkills' ? userSkillInventory.skills ?? [] : userPluginInventory.plugins ?? []
  const total = filteredResources(key, values).length
  const lastPage = Math.max(0, Math.ceil(total / listPageSizes[key]) - 1)
  listPages[key] = Number.isSafeInteger(value) ? Math.min(lastPage, Math.max(0, value - 1)) : listPages[key]
  renderInventory(key)
  input.value = String(listPages[key] + 1)
}

for (const [key, prefix] of Object.entries({ plugins: 'plugins', systemSkills: 'system-skills', userSkills: 'user-skills', userPlugins: 'user-plugins' })) {
  elements[`${prefix}-page-previous`].addEventListener('click', () => {
    listPages[key] = Math.max(0, listPages[key] - 1)
    renderInventory(key)
  })
  elements[`${prefix}-page-next`].addEventListener('click', () => {
    listPages[key] += 1
    renderInventory(key)
  })
  elements[`${prefix}-page-size`].addEventListener('change', event => {
    const value = Number(event.target.value)
    if (!LIST_PAGE_SIZES.includes(value)) return
    listPageSizes[key] = value
    listPages[key] = 0
    writeStorage(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`, String(value))
    renderInventory(key)
  })
  elements[`${prefix}-page-jump`].addEventListener('blur', () => commitListPageJump(key, prefix))
  elements[`${prefix}-page-jump`].addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitListPageJump(key, prefix)
  })
  elements[`${prefix}-search`].addEventListener('input', event => {
    listQueries[key] = event.target.value
    listPages[key] = 0
    renderInventory(key)
  })
}
elements['proxy-enabled'].addEventListener('change', event => {
  elements['proxy-enabled-label'].textContent = t(event.target.checked ? 'enabled' : 'disabled')
})
elements['proxy-protocol'].addEventListener('change', event => {
  elements['proxy-remote-dns-row'].hidden = event.target.value !== 'socks5'
})
elements['proxy-password'].addEventListener('input', renderProxyTransportWarning)
elements['proxy-username'].addEventListener('input', renderProxyTransportWarning)
elements['proxy-clear-password'].addEventListener('change', event => {
  if (event.target.checked) elements['proxy-password'].value = ''
  elements['proxy-password'].disabled = event.target.checked
  renderProxyTransportWarning()
})
elements['proxy-scope-help'].addEventListener('click', () => elements['proxy-scope-dialog'].showModal())
elements['proxy-save'].addEventListener('click', () => { void saveProxyConfiguration() })
elements['proxy-test'].addEventListener('click', () => { void startProxyTest() })
elements['proxy-test-cancel'].addEventListener('click', async () => {
  if (proxyTestTask?.taskId === undefined) return
  try {
    const task = await api(`proxy/test/tasks/${proxyTestTask.taskId}`, { method: 'DELETE' })
    renderProxyTest(task)
    if (task.status === 'running') scheduleProxyTestPoll(task.taskId)
  } catch (error) { showError(error) }
})
for (const button of channelButtons) {
  button.addEventListener('click', async () => {
    if (await act('channel', { method: 'PUT', body: { channel: button.dataset.channel } })) await checkUpdates('channel-change')
  })
}
elements.check.addEventListener('click', () => { void checkUpdates('manual') })
elements.update.addEventListener('click', () => { void act('update', { method: 'POST' }) })
elements.rollback.addEventListener('click', () => { void act('rollback', { method: 'POST', body: { planId: rollbackPlan?.planId } }) })
elements['return-stable'].addEventListener('click', () => {
  elements['stable-snapshot'].textContent = localTime(rollbackPlan?.snapshot?.createdAt)
  elements['confirm-data-loss'].checked = false
  elements['confirm-stable'].disabled = true
  elements['stable-dialog'].showModal()
})
elements['confirm-data-loss'].addEventListener('change', event => { elements['confirm-stable'].disabled = !event.target.checked })
elements['confirm-stable'].addEventListener('click', async () => {
  const planId = rollbackPlan?.planId
  elements['stable-dialog'].close()
  await act('return-stable', { method: 'POST', body: { planId, confirmDataLoss: true } })
})
elements['automatic-enabled'].addEventListener('change', event => { void saveAutomaticCheck({ enabled: event.target.checked }) })
elements['automatic-interval'].addEventListener('change', event => { void saveAutomaticCheck({ intervalSeconds: Number(event.target.value) }) })
elements['notifications-enabled'].addEventListener('change', event => { void saveAutomaticCheck({ notificationsEnabled: event.target.checked }) })
elements['language-switch'].addEventListener('change', event => { void (async () => {
  if (!await confirmDiscardChanges()) {
    event.target.value = locale
    return
  }
  fileEditorDirty = false
  writeStorage(LANGUAGE_KEY, event.target.value)
  window.location.reload()
})() })
elements['theme-switch'].addEventListener('click', () => {
  const currentIndex = THEME_ORDER.indexOf(themePreference)
  themePreference = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]
  writeStorage(THEME_KEY, themePreference === 'system' ? null : themePreference)
  applyTheme(themePreference)
  renderThemeControl()
})
elements['restart-dsh'].addEventListener('click', () => elements['restart-dialog'].showModal())
elements['start-dsh'].addEventListener('click', () => { void act('start-dsh', { method: 'POST' }) })
elements['stop-dsh'].addEventListener('click', () => elements['stop-dialog'].showModal())
elements['cancel-system-plugin-changes'].addEventListener('click', () => { void cancelSystemPluginDraft() })
elements['apply-system-plugin-changes'].addEventListener('click', () => { void applySystemPluginDraft() })
elements['runtime-reset'].addEventListener('click', () => setRuntimeResetExpanded(!runtimeResetExpanded))
elements['cancel-runtime-reset'].addEventListener('click', () => setRuntimeResetExpanded(false))
elements['confirm-runtime-reset'].addEventListener('click', async () => {
  setRuntimeResetExpanded(false)
  await act('runtime/reset', { method: 'POST' })
})
elements['cancel-user-plugin-changes'].addEventListener('click', () => {
  userPluginDraft.clear()
  userPluginFeedback = null
  renderUserPlugins(runtimeBusy())
})
elements['apply-user-plugin-changes'].addEventListener('click', () => { void applyUserPluginDraft() })
elements['new-terminal'].addEventListener('click', () => { void createTerminalSession() })
elements['close-terminal'].addEventListener('click', () => { void closeTerminalSession() })
elements['terminal-screen'].addEventListener('pointerdown', () => terminalEmulator?.focus())
elements['file-back'].addEventListener('click', async () => {
  const path = fileHistory.at(-1)
  const current = filePath
  if (path !== undefined && await navigateFiles(path, { history: false })) {
    fileHistory.pop()
    fileFuture.push(current)
    renderFileNavigation()
  }
})
elements['file-forward'].addEventListener('click', async () => {
  const path = fileFuture.at(-1)
  const current = filePath
  if (path !== undefined && await navigateFiles(path, { history: false })) {
    fileFuture.pop()
    fileHistory.push(current)
    renderFileNavigation()
  }
})
elements['file-up'].addEventListener('click', () => {
  const parent = filePath === '/' ? '/' : filePath.slice(0, filePath.lastIndexOf('/')) || '/'
  void navigateFiles(parent)
})
elements['file-path'].addEventListener('keydown', event => { if (event.key === 'Enter') void navigateFiles(event.target.value) })
elements['file-refresh'].addEventListener('click', () => { void navigateFiles(filePath, { history: false }) })
for (const button of document.querySelectorAll('[data-file-sort]')) button.addEventListener('click', () => {
  if (fileSort === button.dataset.fileSort) fileOrder = fileOrder === 'asc' ? 'desc' : 'asc'
  else { fileSort = button.dataset.fileSort; fileOrder = 'asc' }
  renderFileSort()
  void navigateFiles(filePath, { history: false })
})
elements['file-search'].addEventListener('input', renderFiles)
elements['file-hidden'].addEventListener('change', renderFiles)
elements['file-search-recursive'].addEventListener('click', () => { void recursiveFileSearch() })
elements['file-select-all'].addEventListener('change', event => {
  fileSelected = event.target.checked ? new Set(visibleFileEntries().map(entry => entry.path)) : new Set()
  renderFiles()
})
elements['file-page-previous'].addEventListener('click', () => {
  const page = Math.max(0, filePageIndex - 1)
  void navigateFiles(filePath, { history: false, offset: page * filePageSize, pageIndex: page })
})
elements['file-page-next'].addEventListener('click', () => {
  const page = filePageIndex + 1
  if (page * filePageSize < fileListing.total) void navigateFiles(filePath, { history: false, offset: page * filePageSize, pageIndex: page })
})
elements['file-page-size'].addEventListener('change', event => {
  filePageSize = Number(event.target.value)
  void navigateFiles(filePath, { history: false })
})
function commitFilePageJump() {
  const input = elements['file-page-jump']
  const requested = Number(input.value)
  const lastPage = Math.max(0, Math.ceil(fileListing.total / filePageSize) - 1)
  const page = Number.isSafeInteger(requested) ? Math.min(lastPage, Math.max(0, requested - 1)) : filePageIndex
  input.value = String(page + 1)
  void navigateFiles(filePath, { history: false, offset: page * filePageSize, pageIndex: page })
}
elements['file-page-jump'].addEventListener('blur', commitFilePageJump)
elements['file-page-jump'].addEventListener('keydown', event => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  commitFilePageJump()
})
elements['file-new'].addEventListener('click', () => setFileCreateExpanded(!fileCreateExpanded))
for (const button of document.querySelectorAll('[data-file-create-kind]')) {
  button.addEventListener('click', () => { fileCreateKind = button.dataset.fileCreateKind; renderFileCreate() })
}
elements['file-create-name'].addEventListener('input', renderFileCreate)
elements['file-create-name'].addEventListener('keydown', event => { if (event.key === 'Escape') setFileCreateExpanded(false) })
elements['file-create-cancel'].addEventListener('click', () => setFileCreateExpanded(false))
elements['file-create-panel'].addEventListener('submit', event => { event.preventDefault(); void createFileEntry() })
elements['file-upload'].addEventListener('click', () => elements['file-upload-input'].click())
elements['file-upload-input'].addEventListener('change', event => {
  const files = [...event.target.files]
  event.target.value = ''
  if (files.length > 0) void uploadFiles(files)
})
elements['file-upload-directory'].addEventListener('click', () => elements['file-upload-directory-input'].click())
elements['file-upload-directory-input'].addEventListener('change', event => {
  const files = [...event.target.files]
  event.target.value = ''
  if (files.length > 0) void uploadFiles(files)
})
const fileDropTarget = document.querySelector('.file-main')
fileDropTarget.addEventListener('dragenter', event => {
  if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return
  event.preventDefault()
  fileDragDepth += 1
  fileDropTarget.classList.add('file-dragging')
})
fileDropTarget.addEventListener('dragover', event => {
  if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
})
fileDropTarget.addEventListener('dragleave', event => {
  event.preventDefault()
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) fileDropTarget.classList.remove('file-dragging')
})
fileDropTarget.addEventListener('drop', event => {
  event.preventDefault()
  fileDragDepth = 0
  fileDropTarget.classList.remove('file-dragging')
  void droppedUploadItems(event.dataTransfer).then(items => {
    if (items.length > 0) return uploadFiles(items)
  }).catch(showError)
})
elements['file-copy'].addEventListener('click', () => {
  fileClipboard = { operation: 'copy', sources: sourceDescriptors() }
  fileOperationMessage(t('clipboardCopy', { count: fileClipboard.sources.length }))
  renderFileSelection()
})
elements['file-cut'].addEventListener('click', () => {
  fileClipboard = { operation: 'move', sources: sourceDescriptors() }
  fileOperationMessage(t('clipboardMove', { count: fileClipboard.sources.length }))
  renderFileSelection()
})
elements['file-paste'].addEventListener('click', () => { void pasteFiles() })
elements['file-archive'].addEventListener('click', () => openArchivePanel('archive'))
elements['file-extract'].addEventListener('click', () => openArchivePanel('extract'))
elements['file-archive-cancel'].addEventListener('click', closeArchivePanel)
elements['file-archive-panel'].addEventListener('submit', event => { event.preventDefault(); void submitArchive() })
for (const input of document.querySelectorAll('input[name="file-conflict-choice"]')) {
  input.addEventListener('change', () => { elements['file-conflict-confirm'].disabled = false })
}
elements['file-conflict-cancel'].addEventListener('click', () => finishFileConflict({ choice: 'cancel', applyAll: false }))
elements['file-conflict-dialog'].addEventListener('cancel', event => { event.preventDefault(); finishFileConflict({ choice: 'cancel', applyAll: false }) })
elements['file-conflict-form'].addEventListener('submit', event => {
  event.preventDefault()
  const choice = new FormData(event.currentTarget).get('file-conflict-choice')
  if (!['overwrite', 'rename', 'skip'].includes(choice)) return
  finishFileConflict({ choice, applyAll: elements['file-conflict-all'].checked })
})
elements['file-rename'].addEventListener('click', () => { void (async () => {
  const entry = selectedFileEntries()[0]
  if (entry === undefined) return
  const name = await requestTextInput({
    title: t('renameItem'), detail: t('renameItemDetail'), value: entry.name,
    validate: value => fileNameIsValid(value) ? null : t('invalidFileName'),
  })
  if (name === null || name === entry.name || name.trim() === '') return
  void startFileTask({ operation: 'rename', sources: [{ path: entry.path, revision: entry.revision }], destination: `${filePath}/${name}`, destinationRevision: fileListing.revision })
})() })
elements['file-delete'].addEventListener('click', () => { void (async () => {
  const sources = sourceDescriptors()
  if (sources.length === 0 || !await requestConfirmation({ title: t('deleteFilesTitle'), detail: t('confirmDeleteFiles', { count: sources.length }), confirmLabel: t('confirmDelete'), danger: true })) return
  void startFileTask({ operation: 'delete', sources })
})() })
elements['file-download'].addEventListener('click', () => {
  const entry = selectedFileEntries()[0]
  if (entry === undefined) return
  const link = document.createElement('a')
  link.href = `${API}/files/download?path=${encodeURIComponent(entry.path)}&revision=${encodeURIComponent(entry.revision)}`
  link.download = entry.type === 'directory' ? `${entry.name}.zip` : entry.name
  link.click()
  window.setTimeout(() => { void refreshFileTasks() }, 100)
})
elements['file-attributes'].addEventListener('click', () => {
  if (fileAttributesEntry !== null) closeFileAttributes()
  else {
    const entry = selectedFileEntries()[0]
    if (entry !== undefined) openFileAttributes(entry)
  }
})
elements['file-attributes-close'].addEventListener('click', closeFileAttributes)
elements['file-attributes-cancel'].addEventListener('click', closeFileAttributes)
elements['file-attributes-save'].addEventListener('click', () => { void applyFileAttributes() })
elements['file-attributes-mode'].addEventListener('input', event => {
  if (/^[0-7]{3,4}$/u.test(event.target.value)) syncPermissionChecks(Number.parseInt(event.target.value, 8))
})
elements['file-attributes-user'].addEventListener('input', event => {
  elements['file-attributes-group'].value = event.target.value
})
for (const input of permissionInputs) input.addEventListener('change', syncModeFromPermissions)
elements['file-task-cancel'].addEventListener('click', () => { if (fileActiveTask !== null) void api(`files/tasks/${fileActiveTask}`, { method: 'DELETE' }).catch(showError) })
elements['file-editor-content'].addEventListener('input', () => {
  fileEditorDirty = elements['file-editor-content'].value !== fileEditorOriginal
  updateEditorLines()
  renderFileEditorState()
})
elements['file-editor-content'].addEventListener('scroll', updateEditorLines)
elements['file-editor-save'].addEventListener('click', () => { void saveFileEditor(false) })
elements['file-editor-save-as'].addEventListener('click', () => { void saveFileEditor(true) })
elements['file-editor-reload'].addEventListener('click', () => { if (fileEditor !== null) void openFileEditor(fileEditor) })
elements['file-editor-close'].addEventListener('click', event => { event.preventDefault(); void closeFileEditor() })
elements['file-editor-dialog'].addEventListener('cancel', event => { event.preventDefault(); void closeFileEditor() })
elements['text-input-dialog-cancel'].addEventListener('click', () => finishTextInput(null))
elements['text-input-dialog'].addEventListener('cancel', event => { event.preventDefault(); finishTextInput(null) })
elements['text-input-dialog-form'].addEventListener('submit', event => {
  event.preventDefault()
  const value = elements['text-input-dialog-value'].value
  const error = textInputValidate?.(value) ?? null
  elements['text-input-dialog-error'].textContent = error ?? ''
  elements['text-input-dialog-error'].hidden = error === null
  if (error === null) finishTextInput(value)
})
elements['confirmation-dialog-cancel'].addEventListener('click', () => finishConfirmation(false))
elements['confirmation-dialog'].addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false) })
elements['confirmation-dialog-form'].addEventListener('submit', event => { event.preventDefault(); finishConfirmation(true) })
elements['confirm-restart'].addEventListener('click', async () => {
  elements['restart-dialog'].close()
  await act('restart-dsh', { method: 'POST' })
})
elements['confirm-stop'].addEventListener('click', async () => {
  elements['stop-dialog'].close()
  await act('stop-dsh', { method: 'POST' })
})
elements['progress-full-log'].addEventListener('click', () => {
  if (progressLogUpdate?.taskId) elements['log-search'].value = String(progressLogUpdate.taskId)
  renderLogs()
  void selectTab('maintenance')
})
elements['progress-dismiss'].addEventListener('click', () => {
  dismissedProgressTaskId = String(status?.update?.taskId ?? '')
  if (status !== undefined) render(status)
})
elements['proxy-system-rules'].addEventListener('click', () => elements['proxy-system-rules-dialog'].showModal())
elements['log-limit'].value = String(logDisplayLimit)
for (const element of [elements['log-search'], elements['log-source'], elements['log-level']]) {
  element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', renderLogs)
}
elements['log-limit'].addEventListener('change', event => {
  const value = Number(event.target.value)
  if (!LOG_DISPLAY_LIMITS.includes(value)) return
  logDisplayLimit = value
  writeStorage(LOG_DISPLAY_LIMIT_KEY, String(value))
  renderLogs()
})
elements['auto-scroll'].addEventListener('change', event => {
  autoScroll = event.target.checked
  if (autoScroll) elements['log-list'].scrollTop = elements['log-list'].scrollHeight
})
elements['refresh-logs'].addEventListener('click', () => { void refreshLogs() })
elements['export-logs'].addEventListener('click', () => downloadLogJsonl(filteredRawLogs()))
elements['clear-logs'].addEventListener('click', () => {
  const latest = logEntries.reduce((value, entry) => {
    const timestamp = Date.parse(entry.value.timestamp)
    return Number.isFinite(timestamp) ? Math.max(value, timestamp) : value
  }, Date.now())
  logClearCutoff = new Date(latest).toISOString()
  try { window.sessionStorage.setItem(LOG_CLEAR_CUTOFF_KEY, logClearCutoff) } catch {}
  logEntries.length = 0
  logIdentities.clear()
  expandedLogIdentities.clear()
  renderLogs()
})
window.addEventListener('beforeunload', () => {
  terminalLeaving = true
  clearTimeout(terminalReconnectTimer)
  terminalSocket?.close()
  eventSource?.close()
  logSource?.close()
  window.clearInterval(logWatchdogTimer)
})
applyTheme(themePreference)
applyTranslations()
void selectTab('maintenance')
renderLogs()
connectEvents()
void (async () => {
  const initial = await loadStatus()
  await discardSystemPluginDraft()
  if (initial !== undefined && UPDATE_TERMINAL_STATES.has(initial.update?.status ?? 'idle')) void checkUpdates('page-open')
})()
window.setInterval(() => { void loadStatus() }, 15_000)
window.setInterval(() => {
  if (status?.runtimeReset?.status === 'resetting') void loadStatus()
}, 1_000)
