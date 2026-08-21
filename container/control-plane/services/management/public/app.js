const API = '/_dsh_platform/api/v1'
const UPDATE_TERMINAL_STATES = new Set(['idle', 'success', 'failed'])
const STATUS_LABELS = Object.freeze({
  idle: 'statusIdle',
  checking: 'statusChecking',
  planning: 'statusPlanning',
  'checking-upstream': 'statusCheckingUpstream',
  downloading: 'statusDownloading',
  validating: 'statusValidating',
  'building-candidate': 'statusBuildingCandidate',
  'snapshotting-data': 'statusSnapshottingData',
  switching: 'statusSwitching',
  probation: 'statusProbation',
  'restoring-data': 'statusRestoringData',
  success: 'statusSuccess',
  failed: 'statusFailed',
})
const PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'
const LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'
const LOG_DISPLAY_LIMIT_KEY = 'dsh-platform:log-display-limit'
const LOG_DISPLAY_LIMITS = Object.freeze([100, 250, 500, 1_000])
const DEFAULT_LOG_DISPLAY_LIMIT = 500
const LOG_STREAM_LIMIT = 5_000
const TERMINAL_SESSION_KEY = 'dsh-platform:terminal-session'
const LANGUAGE_KEY = 'dsh-platform:console-language'
const COPY = Object.freeze({
  zh: Object.freeze({
    title: 'DSH 管理中心', consoleLabel: '独立管理控制台', intro: 'DSH Docker 运行、更新与恢复',
    switchLanguage: '切换为英文',
    managementSections: 'DSH 管理中心功能', updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件', userPluginsTab: '用户插件', terminalTab: '容器终端', filesTab: '文件管理',
    channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
    stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
    actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中',
    updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
    statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本',
    statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据',
    statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
    outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新',
    outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
    requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。',
    holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。', metadataUnavailable: '正式更新信息暂未发布，请稍后再试。',
    aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
    returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：',
    confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
    automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭',
    checkInterval: '检查频率', updateNotifications: '更新提醒', updateNotificationsDetail: '自动检查发现新版本时，在 DSH 页面弹窗提醒更新。',
    interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
    maintenance: '重启 DSH', maintenanceDetail: '仅重新启动 DSH，容器和管理中心服务保持运行。', restartDsh: '重新启动 DSH',
    restarting: '正在重新启动 DSH', restartComplete: 'DSH 已重新启动', restartFailed: 'DSH 重启失败',
    restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，此独立控制台保持可用。', confirmRestart: '确认重启',
    runtimeReset: '重置运行时', runtimeResetDetail: '从已验证的 DSH 原始文件和当前平台补丁重新构建运行时，不会删除配置、会话、用户插件或工作区。',
    cancelRuntimeReset: '取消重置', runtimeResetConfirmTitle: '重置当前运行时', runtimeResetWarning: 'DSH 会短暂停止，当前版本和用户数据保持不变。', confirmRuntimeReset: '重置并重启 DSH',
    runtimeResetting: '正在重置运行时', runtimeResetBuilding: '正在从已验证文件重建运行时', runtimeResetVerifying: '正在验证重建结果', runtimeResetSwitching: '正在切换运行时', runtimeResetStarting: '正在启动并检查 DSH', runtimeResetRecovering: '重置失败，正在恢复原运行时', runtimeResetProgress: '运行时重置进度', runtimeResetComplete: '运行时已重置并重新启动 DSH', runtimeResetFailed: '运行时重置失败',
    logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块',
    logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误',
    logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', pauseAutoScroll: '暂停自动滚动', resumeAutoScroll: '继续自动滚动',
    refreshLogs: '刷新日志', clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
    systemPlugins: '系统插件', systemPluginsConsoleDetail: '管理当前环境提供的所有系统插件，也可恢复 DSH 中的平台管理集成。',
    noSystemPlugins: '当前环境没有提供系统插件。', managementIntegration: '平台管理集成，可从此独立页面恢复。',
    notInstalled: '未安装', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', pluginPendingRestart: '待重启',
    installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置',
    pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载',
    pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginActionComplete: '插件设置已保存',
    pluginRestartRequired: '需要重新启动 DSH', pluginRestartRequiredDetail: '插件设置已保存，重新启动 DSH 后生效。可以继续修改其他插件，最后只需重启一次。',
    userPlugins: '用户插件', userPluginsDetail: '无需启动 DSH，即可恢复 Web Profile 中由用户安装的插件。',
    noUserPlugins: 'Web Profile 中没有可管理的用户插件。', dshUnavailable: 'DSH 当前不可用',
    userPluginVersion: '版本', userPluginSpec: '依赖规格', userPluginSource: '来源', userPluginSourceRegistry: '软件包源',
    userPluginSourceFile: '本地文件', userPluginSourceGit: 'Git', userPluginSourceUrl: 'URL', userPluginSourceOther: '其他',
    userPluginEnabled: '已启用', userPluginDisabled: '已禁用', userPluginDamaged: '元数据损坏', userPluginReserved: '与系统插件重名',
    pendingEnable: '待启用', pendingDisable: '待禁用', pendingUninstall: '待卸载', uninstallUserPlugin: '卸载', cancelUninstall: '取消卸载',
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
    files: '文件管理', filesDetail: '使用管理员权限查看和管理容器文件。', newItem: '新建', upload: '上传', uploadFiles: '上传文件', uploadDirectory: '上传文件夹', download: '下载', refresh: '刷新', back: '返回', forward: '前进', parentDirectory: '上级目录', path: '路径',
    itemType: '新建类型', itemName: '名称', createItem: '创建', createLocation: '创建位置：{path}', invalidFileName: '名称不能为空，不能是 . 或 ..，不能包含 / 或控制字符，且不能超过 255 字节。',
    filterFiles: '筛选当前目录', searchDirectory: '搜索此目录', showHidden: '显示隐藏文件', managedPathWarning: '此路径由平台管理，修改可能在重启、更新或运行时重建时被覆盖，也可能损坏当前部署。',
    locations: '快捷位置', selectAll: '全选', fileName: '名称', fileSize: '大小', fileOwner: '用户:用户组', fileModified: '修改时间', fileMode: '权限', calculateSize: '计算', calculatingSize: '计算中', sizeCalculationFailed: '计算失败', emptyDirectory: '此目录为空。', loadMore: '加载更多', itemsPerPage: '每页', previousPage: '上一页', nextPage: '下一页', pageStatus: '第 {page} 页 · {start}-{end} / {total}',
    noFilesSelected: '未选择文件', filesSelected: '已选择 {count} 项', copy: '复制', cut: '剪切', paste: '粘贴', compress: '压缩', extract: '解压', rename: '重命名', deletePermanently: '永久删除',
    compressItems: '压缩所选项目', extractArchive: '解压归档', archiveFormat: '归档格式', archiveName: '归档名称', invalidArchiveName: '请输入有效的归档名称。', unsupportedArchive: '请选择 ZIP、7z 或 tar.gz 文件。',
    editPermissions: '编辑权限', permissions: '权限', permissionRead: '读取', permissionWrite: '写入', permissionExecute: '可执行', permissionOwner: '所有者', permissionGroup: '用户组', permissionOthers: '其他用户',
    fileUser: '用户', fileGroup: '用户组', recursiveAttributes: '同时修改子项属性', applyPermissions: '应用权限', attributesInvalid: '请填写有效的用户、用户组和 3 或 4 位八进制权限。', attributesOperation: '修改文件属性',
    newFile: '新建文件', newDirectory: '新建目录', enterName: '请输入名称', searchRunning: '正在搜索目录', taskRunning: '正在执行 {operation}', uploadProgress: '正在上传 {current} / {total}', fileOperations: '文件任务', queuedOperation: '排队第 {position} 位', processingOperation: '正在处理', cancelOperation: '取消操作',
    operationComplete: '文件操作已完成', operationFailed: '文件操作失败', attributesUnsupported: '当前挂载不支持修改 Unix 用户、用户组或权限。请改用支持 Unix metadata 的 Linux/WSL 路径或 named volume。', confirmDeleteFiles: '永久删除选中的 {count} 项？此操作无法撤销。',
    operationSucceeded: '已完成', operationCancelled: '已取消', operationFailedState: '失败',
    editFile: '编辑文件', fileContent: '文件内容', close: '关闭', reload: '重新加载', saveAs: '另存为', save: '保存', renameItem: '重命名项目', renameItemDetail: '为所选项目输入新名称。', saveAsTitle: '另存为', saveAsDetail: '输入要保存到的容器绝对路径。', discardChangesTitle: '放弃未保存修改', unsavedFile: '有未保存的文件修改，确定丢弃吗？', discardChanges: '放弃修改', deleteFilesTitle: '永久删除', confirmDelete: '确认删除',
    fileSaved: '文件已保存', fileRevisionChanged: '文件已被其他程序修改，请重新加载或另存为。', clipboardCopy: '已复制 {count} 项，进入目标目录后点击粘贴。', clipboardMove: '已剪切 {count} 项，进入目标目录后点击粘贴。',
    fileConflictTitle: '目标已存在', fileConflictDetail: '请选择处理方式：', conflictOverwrite: '覆盖', conflictOverwriteDetail: '替换已有项目。', conflictRename: '自动重命名', conflictRenameDetail: '使用新名称保留两个项目。', conflictSkip: '跳过', conflictSkipDetail: '保留已有项目，不执行本项操作。', conflictApplyAll: '应用到之后的所有冲突', confirmChoice: '确认', operationCompleteWithSkipped: '文件操作已完成，已跳过 {count} 个冲突项。',
    online: '已连接', connecting: '正在重连', offline: '连接中断',
  }),
  en: Object.freeze({
    title: 'DSH Management Console', consoleLabel: 'Standalone console', intro: 'DSH Docker runtime, updates, and recovery',
    switchLanguage: 'Switch to Chinese',
    managementSections: 'Platform management sections', updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins', userPluginsTab: 'User plugins', terminalTab: 'Container terminal', filesTab: 'Files',
    channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
    stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
    actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking',
    updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
    statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream',
    statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data',
    statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
    outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold',
    outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
    requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.',
    holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.', metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.',
    aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
    returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:',
    confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
    automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off',
    checkInterval: 'Check frequency', updateNotifications: 'Update notifications', updateNotificationsDetail: 'Show an update notification popup on DSH pages when an automatic check finds a new version.',
    interval3600: 'Every hour', interval10800: 'Every 3 hours', interval21600: 'Every 6 hours', interval43200: 'Every 12 hours', interval86400: 'Every 24 hours',
    maintenance: 'Restart DSH', maintenanceDetail: 'Restart DSH only. The container and management console services remain running.', restartDsh: 'Restart DSH',
    restarting: 'Restarting DSH', restartComplete: 'DSH restarted', restartFailed: 'DSH restart failed',
    restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This standalone console remains available.', confirmRestart: 'Restart',
    runtimeReset: 'Reset runtime', runtimeResetDetail: 'Rebuild the runtime from verified DSH files and current platform patches without deleting configuration, sessions, user plugins, or workspaces.',
    cancelRuntimeReset: 'Cancel reset', runtimeResetConfirmTitle: 'Reset the current runtime', runtimeResetWarning: 'DSH stops briefly. The current version and user data remain unchanged.', confirmRuntimeReset: 'Reset and restart DSH',
    runtimeResetting: 'Resetting runtime', runtimeResetBuilding: 'Rebuilding runtime from verified files', runtimeResetVerifying: 'Verifying rebuilt runtime', runtimeResetSwitching: 'Switching runtime', runtimeResetStarting: 'Starting and checking DSH', runtimeResetRecovering: 'Reset failed; restoring the previous runtime', runtimeResetProgress: 'Runtime reset progress', runtimeResetComplete: 'Runtime reset and DSH restarted', runtimeResetFailed: 'Runtime reset failed',
    logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module',
    logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error',
    logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', pauseAutoScroll: 'Pause auto-scroll', resumeAutoScroll: 'Resume auto-scroll',
    refreshLogs: 'Refresh logs', clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
    systemPlugins: 'System plugins', systemPluginsConsoleDetail: 'Manage every bundled System Plugin, including recovery of the Platform Management integration in DSH.',
    noSystemPlugins: 'The current Environment provides no System Plugins.', managementIntegration: 'Platform Management integration, recoverable from this standalone page.',
    notInstalled: 'Not installed', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', pluginPendingRestart: 'Pending restart',
    installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings',
    pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling',
    pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginActionComplete: 'Plugin settings saved',
    pluginRestartRequired: 'Restart DSH required', pluginRestartRequiredDetail: 'Plugin settings are saved and take effect after DSH restarts. You can make more changes and restart only once when finished.',
    userPlugins: 'User plugins', userPluginsDetail: 'Recover user-installed Web Profile plugins without starting DSH.',
    noUserPlugins: 'No managed user plugins were found in the Web Profile.', dshUnavailable: 'DSH is unavailable',
    userPluginVersion: 'Version', userPluginSpec: 'Dependency spec', userPluginSource: 'Source', userPluginSourceRegistry: 'Registry',
    userPluginSourceFile: 'Local file', userPluginSourceGit: 'Git', userPluginSourceUrl: 'URL', userPluginSourceOther: 'Other',
    userPluginEnabled: 'Enabled', userPluginDisabled: 'Disabled', userPluginDamaged: 'Damaged metadata', userPluginReserved: 'Conflicts with a System Plugin',
    pendingEnable: 'Pending enable', pendingDisable: 'Pending disable', pendingUninstall: 'Pending uninstall', uninstallUserPlugin: 'Uninstall', cancelUninstall: 'Cancel uninstall',
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
    files: 'File management', filesDetail: 'View and manage container files with administrator privileges.', newItem: 'New', upload: 'Upload', uploadFiles: 'Upload files', uploadDirectory: 'Upload folder', download: 'Download', refresh: 'Refresh', back: 'Back', forward: 'Forward', parentDirectory: 'Parent directory', path: 'Path',
    itemType: 'Item type', itemName: 'Name', createItem: 'Create', createLocation: 'Create in: {path}', invalidFileName: 'The name cannot be empty, . or .., contain / or control characters, or exceed 255 bytes.',
    filterFiles: 'Filter this directory', searchDirectory: 'Search this directory', showHidden: 'Show hidden files', managedPathWarning: 'This path is platform-managed. Changes may be replaced by restart, update, or runtime rebuild and can damage the current deployment.',
    locations: 'Locations', selectAll: 'Select all', fileName: 'Name', fileSize: 'Size', fileOwner: 'User:group', fileModified: 'Modified', fileMode: 'Mode', calculateSize: 'Calculate', calculatingSize: 'Calculating', sizeCalculationFailed: 'Failed', emptyDirectory: 'This directory is empty.', loadMore: 'Load more', itemsPerPage: 'Per page', previousPage: 'Previous', nextPage: 'Next', pageStatus: 'Page {page} · {start}-{end} / {total}',
    noFilesSelected: 'No files selected', filesSelected: '{count} selected', copy: 'Copy', cut: 'Cut', paste: 'Paste', compress: 'Compress', extract: 'Extract', rename: 'Rename', deletePermanently: 'Delete permanently',
    compressItems: 'Compress selected items', extractArchive: 'Extract archive', archiveFormat: 'Archive format', archiveName: 'Archive name', invalidArchiveName: 'Enter a valid archive name.', unsupportedArchive: 'Select a ZIP, 7z, or tar.gz file.',
    editPermissions: 'Edit permissions', permissions: 'Permissions', permissionRead: 'Read', permissionWrite: 'Write', permissionExecute: 'Execute', permissionOwner: 'Owner', permissionGroup: 'Group', permissionOthers: 'Others',
    fileUser: 'User', fileGroup: 'Group', recursiveAttributes: 'Also change child attributes', applyPermissions: 'Apply permissions', attributesInvalid: 'Enter a valid user, group, and a 3- or 4-digit octal mode.', attributesOperation: 'Changing file attributes',
    newFile: 'New file', newDirectory: 'New directory', enterName: 'Enter a name', searchRunning: 'Searching directory', taskRunning: 'Running {operation}', uploadProgress: 'Uploading {current} / {total}', fileOperations: 'File operations', queuedOperation: 'Queue position {position}', processingOperation: 'Processing', cancelOperation: 'Cancel operation',
    operationComplete: 'File operation completed', operationFailed: 'File operation failed', attributesUnsupported: 'This mount does not support changing Unix ownership or permissions. Use a Linux/WSL path or named volume with Unix metadata support.', confirmDeleteFiles: 'Permanently delete {count} selected items? This cannot be undone.',
    operationSucceeded: 'Completed', operationCancelled: 'Cancelled', operationFailedState: 'Failed',
    editFile: 'Edit file', fileContent: 'File content', close: 'Close', reload: 'Reload', saveAs: 'Save as', save: 'Save', renameItem: 'Rename item', renameItemDetail: 'Enter a new name for the selected item.', saveAsTitle: 'Save as', saveAsDetail: 'Enter the absolute container path to save.', discardChangesTitle: 'Discard unsaved changes', unsavedFile: 'Discard unsaved file changes?', discardChanges: 'Discard changes', deleteFilesTitle: 'Delete permanently', confirmDelete: 'Delete',
    fileSaved: 'File saved', fileRevisionChanged: 'The file changed in another process. Reload it or save as a new file.', clipboardCopy: '{count} items copied. Open the destination and choose Paste.', clipboardMove: '{count} items cut. Open the destination and choose Paste.',
    fileConflictTitle: 'Destination already exists', fileConflictDetail: 'Choose how to handle:', conflictOverwrite: 'Overwrite', conflictOverwriteDetail: 'Replace the existing item.', conflictRename: 'Auto rename', conflictRenameDetail: 'Keep both items with a new name.', conflictSkip: 'Skip', conflictSkipDetail: 'Leave the existing item unchanged.', conflictApplyAll: 'Apply to all remaining conflicts', confirmChoice: 'Confirm', operationCompleteWithSkipped: 'File operation completed; skipped {count} conflicting items.',
    online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
  }),
})

function preferredLocale() {
  const override = storageValue(LANGUAGE_KEY)
  if (override === 'zh' || override === 'en') return override
  for (const part of document.cookie.split(';')) {
    const [name, value] = part.trim().split('=', 2)
    if (name === 'dsh_locale' && (value === 'zh' || value === 'en')) return value
  }
  for (const value of navigator.languages ?? [navigator.language]) {
    const primary = String(value).split('-', 1)[0].toLowerCase()
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

const locale = preferredLocale()
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const channelButtons = [...document.querySelectorAll('[data-channel]')]
const tabButtons = [...document.querySelectorAll('[data-tab]')]
const RUNTIME_RESET_PHASES = Object.freeze({
  'runtime-reset-building': Object.freeze({ progress: 20, label: 'runtimeResetBuilding' }),
  'runtime-reset-verifying': Object.freeze({ progress: 55, label: 'runtimeResetVerifying' }),
  'runtime-reset-switching': Object.freeze({ progress: 70, label: 'runtimeResetSwitching' }),
  'runtime-reset-starting': Object.freeze({ progress: 85, label: 'runtimeResetStarting' }),
  'runtime-reset-recovering': Object.freeze({ progress: 90, label: 'runtimeResetRecovering' }),
})
let status
let plugins = []
let userPluginInventory = { revision: null, plugins: [] }
let inventoriesLoaded = false
const userPluginDraft = new Map()
const expandedUserPluginDescriptions = new Set()
let rollbackPlan
let statusLoad
let statusLoadRevision = 0
let inventoryLoad
let checking = false
let acting = false
let discardingPluginDraft = false
let userPluginSubmitting = false
let userPluginFeedback = null
const visibleOperationTasks = new Set()
let eventSource
let logSource
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
let filesLoaded = false
let fileConfigLoad
let fileLoading = false
let filePath = '/workspace'
let fileListing = { revision: null, entries: [], nextCursor: null, total: 0 }
let fileSort = 'name'
let fileOrder = 'asc'
let filePageSize = 100
let filePageIndex = 0
let filePageCursors = [null]
let fileHistory = []
let fileFuture = []
let fileCreateExpanded = false
let fileCreateKind = 'touch'
let fileSelected = new Set()
let fileClipboard = null
const fileDirectorySizes = new Map()
let fileActiveTask = null
let fileTasksActive = []
let fileTaskRefreshTimer
let fileArchiveMode = null
let fileEditor = null
let fileEditorOriginal = ''
let fileEditorDirty = false
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
}

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function localTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

function fileSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return '-'
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KiB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MiB`
  return `${(size / 1024 ** 3).toFixed(1)} GiB`
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
    const error = new Error(value.error ?? `HTTP ${String(response.status)}`)
    error.statusCode = response.status
    error.code = value.code
    throw error
  }
  return value
}

function runtimeBusy(next = status) {
  const update = next?.update ?? {}
  return (acting && !checking)
    || (!UPDATE_TERMINAL_STATES.has(update.status ?? 'idle') && update.status !== 'checking')
    || next?.systemPluginOperation?.status === 'running'
    || next?.userPluginOperation?.status === 'running'
    || next?.dshRestart?.status === 'restarting'
    || next?.runtimeReset?.status === 'resetting'
}

function setRuntimeResetExpanded(expanded) {
  runtimeResetExpanded = expanded
  elements['runtime-reset-confirmation'].hidden = !expanded
  elements['runtime-reset'].setAttribute('aria-expanded', String(expanded))
  elements['runtime-reset'].textContent = t(expanded ? 'cancelRuntimeReset' : 'runtimeReset')
}

function operationResultVisible(operation, activeStatus) {
  if (operation?.status === activeStatus) {
    if (operation.taskId) visibleOperationTasks.add(operation.taskId)
    return true
  }
  return operation?.taskId !== null && operation?.taskId !== undefined && visibleOperationTasks.has(operation.taskId)
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

function pluginButton(label, plugin, action, busy, className = 'secondary') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.disabled = busy
  button.addEventListener('click', () => {
    const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
    window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
    void act(path, { method: 'POST', body: { id: plugin.id, action } }).then(changed => {
      if (!changed) window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
    })
  })
  return button
}

function renderBundledPlugins(values, busy) {
  elements['bundled-plugins'].replaceChildren()
  elements['empty-plugins'].hidden = values.length !== 0
  elements['bundled-plugins'].hidden = values.length === 0
  const operation = status?.systemPluginOperation ?? {}
  for (const plugin of values) {
    const row = document.createElement('article')
    row.className = 'plugin-row'
    const identity = document.createElement('div')
    identity.className = 'plugin-identity'
    const name = document.createElement('strong')
    name.textContent = `@dsh-docker/${plugin.id}`
    const state = document.createElement('span')
    state.textContent = pluginDescription(plugin)
    identity.append(name, state)
    if (plugin.pendingRestart) {
      const badge = document.createElement('span')
      badge.className = 'plugin-pending'
      badge.textContent = t('pluginPendingRestart')
      identity.append(badge)
    }
    const controls = document.createElement('div')
    controls.className = 'plugin-actions'
    if (!plugin.installed) {
      controls.append(pluginButton(t('installPlugin'), plugin, 'install', busy, 'primary'))
    } else {
      const toggle = document.createElement('label')
      toggle.className = 'toggle'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = plugin.enabled
      checkbox.disabled = busy
      checkbox.addEventListener('change', event => {
        const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
        window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
        void act(path, { method: 'POST', body: { id: plugin.id, action: event.target.checked ? 'enable' : 'disable' } }).then(changed => {
          if (!changed) window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
        })
      })
      const track = document.createElement('span')
      track.setAttribute('aria-hidden', 'true')
      const label = document.createElement('strong')
      label.textContent = plugin.enabled ? t('enabled') : t('disabled')
      toggle.append(checkbox, track, label)
      controls.append(toggle, pluginButton(t('uninstallPlugin'), plugin, 'uninstall', busy, 'danger-text'))
    }
    row.append(identity, controls)
    if (operation.status === 'running' && operation.pluginId === plugin.id) {
      const state = document.createElement('p')
      state.className = 'plugin-action-state'
      state.textContent = t({
        install: 'pluginActionInstall', uninstall: 'pluginActionUninstall',
        enable: 'pluginActionEnable', disable: 'pluginActionDisable',
      }[operation.action] ?? 'pluginActionWorking')
      row.append(state)
    }
    elements['bundled-plugins'].append(row)
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
  const operation = status?.userPluginOperation ?? {}
  const locked = busy || userPluginSubmitting || operation.status === 'running'
  elements['user-plugin-list'].replaceChildren()
  elements['user-plugin-list'].hidden = values.length === 0
  elements['empty-user-plugins'].hidden = values.length !== 0
  for (const plugin of values) {
    const action = userPluginDraft.get(plugin.name)
    const row = document.createElement('article')
    row.className = `user-plugin-row${action ? ' pending' : ''}`
    const identity = document.createElement('div')
    identity.className = 'user-plugin-main'
    const heading = document.createElement('div')
    heading.className = 'user-plugin-heading'
    const name = document.createElement('strong')
    name.textContent = plugin.name
    const badge = action
      ? userPluginBadge(t({ enable: 'pendingEnable', disable: 'pendingDisable', uninstall: 'pendingUninstall' }[action]), 'pending')
      : plugin.pendingRestart
        ? userPluginBadge(t('pluginPendingRestart'), 'pending')
        : plugin.reservedNameConflict
          ? userPluginBadge(t('userPluginReserved'), 'danger')
          : plugin.damaged
            ? userPluginBadge(t('userPluginDamaged'), 'warning')
            : userPluginBadge(plugin.enabled ? t('userPluginEnabled') : t('userPluginDisabled'), plugin.enabled ? 'enabled' : '')
    heading.append(badge, name)
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
        if (expandedUserPluginDescriptions.has(plugin.name)) expandedUserPluginDescriptions.delete(plugin.name)
        else expandedUserPluginDescriptions.add(plugin.name)
        renderUserPlugins(runtimeBusy())
      })
      heading.append(description)
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
    identity.append(heading, metadata)
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
  const count = userPluginDraft.size
  elements['user-plugin-draft-summary'].textContent = count === 0 ? t('noPendingUserPluginChanges') : t('pendingUserPluginChanges', { count })
  elements['cancel-user-plugin-changes'].disabled = locked || count === 0
  elements['apply-user-plugin-changes'].disabled = locked || (count === 0 && userPluginInventory.restartRequired !== true)
  elements['user-plugin-recovery'].hidden = status?.recoveryMode === null || status?.recoveryMode === undefined
  elements['user-plugin-recovery-detail'].textContent = locale === 'zh'
    ? t('userPluginRecoveryDetail')
    : typeof status?.recoveryMode === 'string'
      ? status.recoveryMode
      : status?.recoveryMode?.reason ?? status?.recoveryMode?.message ?? t('userPluginRecoveryDetail')
  const phaseKey = {
    validated: 'userPluginPhaseValidated', paused: 'userPluginPhasePaused', snapshotted: 'userPluginPhaseSnapshotted',
    mutating: 'userPluginPhaseMutating', committed: 'userPluginPhaseCommitted', restarting: 'userPluginPhaseRestarting', restoring: 'userPluginPhaseRestoring',
  }[operation.phase]
  const operationVisible = operationResultVisible(operation, 'running')
  const feedback = operation.status === 'running' ? t(phaseKey ?? 'userPluginApplying')
    : operationVisible && operation.status === 'failed' ? `${t('userPluginApplyFailed')}: ${localizedError(operation.error ?? '')}`
      : operationVisible && operation.status === 'success' ? t('userPluginApplyComplete') : userPluginFeedback
  elements['user-plugin-operation'].textContent = feedback ?? ''
  elements['user-plugin-operation'].hidden = !feedback
}

function render(next) {
  status = next
  rollbackPlan = next.rollbackPlan
  const update = next.update ?? {}
  const restart = next.dshRestart ?? {}
  const runtimeReset = next.runtimeReset ?? {}
  const restartVisible = operationResultVisible(restart, 'restarting')
  const runtimeResetVisible = operationResultVisible(runtimeReset, 'resetting')
  const pluginOperation = next.systemPluginOperation ?? {}
  const pluginOperationVisible = operationResultVisible(pluginOperation, 'running')
  const busy = runtimeBusy(next)
  const updateActive = !UPDATE_TERMINAL_STATES.has(update.status ?? 'idle')
  const checkingUpdates = checking || update.status === 'checking'
  if (restart.status === 'success' && !plugins.some(plugin => plugin.pendingRestart)) {
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

  const updateStatusKey = STATUS_LABELS[update.status ?? 'idle'] ?? 'statusUnknown'
  elements['update-status'].querySelector('strong').textContent = t(updateStatusKey)
  elements['update-status'].className = `status-label ${update.status === 'failed' ? 'failed' : update.status === 'success' ? 'success' : updateActive ? 'active' : ''}`
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  elements.progress.hidden = !updateActive
  elements['progress-value'].hidden = !updateActive
  elements['progress-value'].value = `${String(progress)}%`
  elements['progress-value'].textContent = `${String(progress)}%`
  elements.progress.setAttribute('aria-valuenow', String(progress))
  elements['progress-bar'].style.width = `${String(progress)}%`
  const result = update.error ? localizedError(update.error) : update.outcome ? updateOutcome(update.outcome) : ''
  elements['update-result'].textContent = result
  elements['update-result'].hidden = result === ''
  elements['metadata-notice'].hidden = !update.metadataUnavailable

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

  elements['restart-dsh'].disabled = busy
  elements['restart-state'].hidden = !restartVisible
  elements['restart-state'].textContent = restart.status === 'restarting'
    ? t('restarting') : restart.status === 'success' ? t('restartComplete') : restart.status === 'failed' ? t('restartFailed') : ''
  elements['runtime-reset'].disabled = busy || next.current === null || next.current === undefined
  elements['confirm-runtime-reset'].disabled = busy || next.current === null || next.current === undefined
  elements['runtime-reset'].textContent = runtimeReset.status === 'resetting'
    ? t('runtimeResetting') : t(runtimeResetExpanded ? 'cancelRuntimeReset' : 'runtimeReset')
  const resetActive = runtimeReset.status === 'resetting'
  const resetPhase = RUNTIME_RESET_PHASES[next.operation] ?? { progress: 5, label: 'runtimeResetting' }
  elements['runtime-reset-progress'].hidden = !resetActive
  elements['runtime-reset-state'].textContent = t(resetPhase.label)
  elements['runtime-reset-progress-value'].value = `${String(resetPhase.progress)}%`
  elements['runtime-reset-progress-value'].textContent = `${String(resetPhase.progress)}%`
  elements['runtime-reset-progress-track'].setAttribute('aria-valuenow', String(resetPhase.progress))
  elements['runtime-reset-progress-bar'].style.width = `${String(resetPhase.progress)}%`
  elements['runtime-reset-result'].hidden = resetActive || !runtimeResetVisible
  elements['runtime-reset-result'].textContent = runtimeReset.status === 'success'
    ? t('runtimeResetComplete')
    : runtimeReset.status === 'failed'
      ? `${t('runtimeResetFailed')}: ${localizedError(runtimeReset.error ?? '')}`
      : ''
  elements['plugin-operation'].hidden = !pluginOperationVisible
  elements['plugin-operation'].textContent = pluginOperation.status === 'running'
    ? t('pluginActionWorking') : pluginOperation.status === 'failed' ? localizedError(pluginOperation.error ?? '') : ''
  elements['plugin-restart-required'].hidden = !plugins.some(plugin => plugin.pendingRestart)
  const pluginBusy = busy || discardingPluginDraft
  elements['plugin-restart-dsh'].disabled = pluginBusy
  elements['plugin-restart-dsh'].textContent = restart.status === 'restarting' ? t('restarting') : t('restartDsh')
  if (inventoriesLoaded) {
    renderBundledPlugins(plugins, pluginBusy)
    renderUserPlugins(busy)
  }
}

function loadInventories() {
  if (inventoryLoad !== undefined) return inventoryLoad
  inventoryLoad = (async () => {
    try {
      const [bundled, users] = await Promise.all([api('bundled-plugins'), api('user-plugins')])
      plugins = bundled.plugins ?? []
      userPluginInventory = users
      inventoriesLoaded = true
      if (status !== undefined) render(status)
    } catch {
      // Bootstrap-backed inventories can lag the Management service during startup.
    }
  })().finally(() => { inventoryLoad = undefined })
  return inventoryLoad
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
        void loadInventories()
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
        await Promise.all([loadStatus(), loadInventories()])
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
    showError(error)
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
  if (['debug', 'info', 'warning', 'error'].includes(entry?.level)) return entry.level
  if (entry?.stream === 'stderr') return 'error'
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

function renderLogs() {
  const entries = limitProcessedLogEntries(logEntries, logDisplayLimit)
  updateLogSources(entries)
  const query = elements['log-search'].value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en-US')
  const source = elements['log-source'].value
  const level = elements['log-level'].value
  const filtered = entries.filter(item => (source === 'all' || item.value.source === source)
    && (level === 'all' || logLevel(item.value) === level)
    && (query === '' || JSON.stringify(item.value).toLocaleLowerCase().includes(query)))
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
  return window.matchMedia('(prefers-color-scheme: dark)').matches
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
  colorScheme.addEventListener('change', () => { terminalEmulator.options.theme = terminalTheme() })
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
  elements['file-operation'].hidden = value === ''
  elements['file-operation'].textContent = value
  elements['file-operation'].classList.toggle('failed', failed)
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
  for (const id of ['file-copy', 'file-cut', 'file-rename', 'file-delete']) elements[id].disabled = count === 0 || busy
  elements['file-archive'].disabled = count === 0 || busy
  elements['file-extract'].disabled = count !== 1 || selected[0]?.type !== 'file' || busy
  elements['file-rename'].disabled = count !== 1 || busy
  elements['file-download'].disabled = count !== 1 || !['file', 'directory'].includes(selected[0]?.type) || busy
  elements['file-attributes'].disabled = count !== 1 || !['file', 'directory'].includes(selected[0]?.type) || busy
  elements['file-paste'].disabled = fileClipboard === null || busy
  elements['file-select-all'].checked = count > 0 && count === visibleFileEntries().length
  elements['file-select-all'].indeterminate = count > 0 && count !== visibleFileEntries().length
}

function taskLabel(task) {
  const operation = {
    archive: t('compress'), extract: t('extract'), upload: t('upload'), download: t('download'),
    copy: t('copy'), move: t('cut'), delete: t('deletePermanently'), attributes: t('attributesOperation'),
  }[task.operation] ?? task.operation
  return `${operation}: ${task.currentPath ?? task.path ?? task.destination ?? ''}`
}

function renderFileTasks() {
  const recentCutoff = Date.now() - 10_000
  const visible = fileTasksActive.filter(task => ['queued', 'running'].includes(task.status)
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
      cancel.addEventListener('click', () => { void api(`files/tasks/${task.taskId}`, { method: 'DELETE' }).then(refreshFileTasks).catch(showError) })
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
  elements['file-page-status'].textContent = t('pageStatus', { page: filePageIndex + 1, start, end, total: fileListing.total })
  elements['file-page-previous'].disabled = fileLoading || filePageIndex === 0
  elements['file-page-next'].disabled = fileLoading || fileListing.nextCursor === null
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

async function navigateFiles(path, { history = true, cursor = null, pageIndex = 0 } = {}) {
  if (fileLoading) return false
  fileLoading = true
  renderFileNavigation()
  clearError()
  try {
    const query = new URLSearchParams({ path, limit: String(filePageSize), sort: fileSort, order: fileOrder })
    if (cursor !== null) query.set('cursor', cursor)
    const next = await api(`files/list?${query}`)
    if (history && filePath !== next.path) {
      fileHistory.push(filePath)
      fileFuture = []
    }
    filePath = next.path
    elements['file-path'].value = filePath
    fileSelected.clear()
    filePageIndex = pageIndex
    if (pageIndex === 0) filePageCursors = [null]
    if (next.nextCursor !== null) filePageCursors[pageIndex + 1] = next.nextCursor
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
  try {
    const saved = await api('files/content', { method: 'PUT', body: { path, content: elements['file-editor-content'].value, revision, create } })
    fileEditor = { ...fileEditor, ...saved, path, content: elements['file-editor-content'].value }
    fileEditorOriginal = fileEditor.content
    fileEditorDirty = false
    elements['file-editor-path'].textContent = path
    fileOperationMessage(t('fileSaved'))
    await navigateFiles(filePath, { history: false })
  } catch (error) {
    if (error.statusCode === 409) fileOperationMessage(t('fileRevisionChanged'), true)
    else showError(error)
  }
}

async function closeFileEditor() {
  if (!await confirmDiscardChanges()) return false
  elements['file-editor-dialog'].close()
  fileEditor = null
  fileEditorDirty = false
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

async function uploadFiles(files) {
  let conflictForAll = null
  let skipped = 0
  let stopped = false
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const segments = (file.webkitRelativePath || file.name).split('/')
    if (segments.some(segment => !fileNameIsValid(segment))) {
      showError(new Error(t('invalidFileName')))
      stopped = true
      break
    }
    let parent = filePath
    for (const segment of segments.slice(0, -1)) {
      parent = parent === '/' ? `/${segment}` : `${parent}/${segment}`
      try {
        const existing = await api(`files/stat?path=${encodeURIComponent(parent)}`)
        if (existing.type !== 'directory') throw new Error(`${parent}: ${t('operationFailed')}`)
      } catch (error) {
        if (error.statusCode !== 404) { showError(error); stopped = true; break }
        const created = await runFileTask({ operation: 'mkdir', destination: parent })
        if (created?.status !== 'success') {
          fileOperationMessage(created?.error ?? t('operationFailed'), true)
          stopped = true
          break
        }
      }
    }
    if (stopped) break
    const destination = parent === '/' ? `/${segments.at(-1)}` : `${parent}/${segments.at(-1)}`
    let conflict = ['overwrite', 'rename'].includes(conflictForAll) ? conflictForAll : 'reject'
    for (;;) {
      elements['file-task-state'].hidden = false
      elements['file-task-label'].textContent = t('uploadProgress', { current: index + 1, total: files.length })
      try {
        await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest()
          request.open('POST', `${API}/files/upload?path=${encodeURIComponent(destination)}&conflict=${conflict}`)
          request.onload = () => {
            if (request.status >= 200 && request.status < 300) return resolve()
            const value = JSON.parse(request.responseText || '{}')
            const error = new Error(value.error ?? `HTTP ${String(request.status)}`)
            error.statusCode = request.status
            error.code = value.code
            reject(error)
          }
          request.onerror = () => reject(new Error(t('operationFailed')))
          request.send(file)
        })
        break
      } catch (error) {
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
    if (stopped) break
  }
  elements['file-task-state'].hidden = true
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

async function selectTab(tab) {
  const current = tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.dataset.tab
  if (current === 'files' && tab !== 'files') {
    if (!await confirmDiscardChanges()) return false
    fileClipboard = null
    fileSelected.clear()
  }
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
  if (tab === 'user-plugins') void loadInventories()
  if (tab === 'files' && !filesLoaded) void initializeFiles()
  else if (tab === 'files') scheduleFileTaskRefresh()
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
elements['restart-dsh'].addEventListener('click', () => elements['restart-dialog'].showModal())
elements['plugin-restart-dsh'].addEventListener('click', () => elements['restart-dialog'].showModal())
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
  void navigateFiles(filePath, { history: false, cursor: filePageCursors[page] ?? null, pageIndex: page })
})
elements['file-page-next'].addEventListener('click', () => {
  if (fileListing.nextCursor !== null) void navigateFiles(filePath, { history: false, cursor: fileListing.nextCursor, pageIndex: filePageIndex + 1 })
})
elements['file-page-size'].addEventListener('change', event => {
  filePageSize = Number(event.target.value)
  void navigateFiles(filePath, { history: false })
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
for (const type of ['dragenter', 'dragover']) elements['panel-files'].addEventListener(type, event => { event.preventDefault(); elements['panel-files'].classList.add('file-dragging') })
for (const type of ['dragleave', 'drop']) elements['panel-files'].addEventListener(type, event => { event.preventDefault(); elements['panel-files'].classList.remove('file-dragging') })
elements['panel-files'].addEventListener('drop', event => {
  const files = [...event.dataTransfer.files]
  if (files.length > 0) void uploadFiles(files)
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
elements['auto-scroll'].addEventListener('click', () => {
  autoScroll = !autoScroll
  elements['auto-scroll'].setAttribute('aria-pressed', String(autoScroll))
  elements['auto-scroll'].textContent = t(autoScroll ? 'pauseAutoScroll' : 'resumeAutoScroll')
  if (autoScroll) elements['log-list'].scrollTop = elements['log-list'].scrollHeight
})
elements['refresh-logs'].addEventListener('click', () => { void refreshLogs() })
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
applyTranslations()
void selectTab('updates')
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
