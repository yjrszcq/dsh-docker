window.__ModuleLoader__.load({ id: "@dsh-docker/platform-management", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const css = Object.freeze({"actionHeading":"dshPlatform_actionHeading","actions":"dshPlatform_actions","autoScrollButton":"dshPlatform_autoScrollButton","caption":"dshPlatform_caption","checkSpinner":"dshPlatform_checkSpinner","clearLogsButton":"dshPlatform_clearLogsButton","confirmActions":"dshPlatform_confirmActions","confirmation":"dshPlatform_confirmation","connection":"dshPlatform_connection","dangerButton":"dshPlatform_dangerButton","dangerFilledButton":"dshPlatform_dangerFilledButton","detail":"dshPlatform_detail","disconnected":"dshPlatform_disconnected","emptyLogs":"dshPlatform_emptyLogs","emptyPlugins":"dshPlatform_emptyPlugins","error":"dshPlatform_error","expandable":"dshPlatform_expandable","expanded":"dshPlatform_expanded","experimentalVersions":"dshPlatform_experimentalVersions","heading":"dshPlatform_heading","hold":"dshPlatform_hold","holds":"dshPlatform_holds","intro":"dshPlatform_intro","listPagination":"dshPlatform_listPagination","live":"dshPlatform_live","logAutoScroll":"dshPlatform_logAutoScroll","logChevron":"dshPlatform_logChevron","logConnection":"dshPlatform_logConnection","logDebug":"dshPlatform_logDebug","logDetails":"dshPlatform_logDetails","logEntry":"dshPlatform_logEntry","logError":"dshPlatform_logError","logFilters":"dshPlatform_logFilters","logInfo":"dshPlatform_logInfo","logLevel":"dshPlatform_logLevel","logList":"dshPlatform_logList","logMessageRow":"dshPlatform_logMessageRow","logMeta":"dshPlatform_logMeta","logResizeFrame":"dshPlatform_logResizeFrame","logResizeHandle":"dshPlatform_logResizeHandle","logSection":"dshPlatform_logSection","logSource":"dshPlatform_logSource","logSummary":"dshPlatform_logSummary","logSummaryRow":"dshPlatform_logSummaryRow","logTools":"dshPlatform_logTools","logWarning":"dshPlatform_logWarning","maintenanceButton":"dshPlatform_maintenanceButton","maintenanceStatus":"dshPlatform_maintenanceStatus","managedBadge":"dshPlatform_managedBadge","notice":"dshPlatform_notice","offline":"dshPlatform_offline","online":"dshPlatform_online","pageArrow":"dshPlatform_pageArrow","pageJump":"dshPlatform_pageJump","pageNavigation":"dshPlatform_pageNavigation","pendingBadge":"dshPlatform_pendingBadge","platformHeader":"dshPlatform_platformHeader","pluginActions":"dshPlatform_pluginActions","pluginDraftActions":"dshPlatform_pluginDraftActions","pluginIdentity":"dshPlatform_pluginIdentity","pluginList":"dshPlatform_pluginList","pluginOperation":"dshPlatform_pluginOperation","pluginRestartNotice":"dshPlatform_pluginRestartNotice","pluginRow":"dshPlatform_pluginRow","pluginSection":"dshPlatform_pluginSection","primaryButton":"dshPlatform_primaryButton","progress":"dshPlatform_progress","progressAutoScroll":"dshPlatform_progressAutoScroll","progressFullLog":"dshPlatform_progressFullLog","progressHeading":"dshPlatform_progressHeading","progressHeadingActions":"dshPlatform_progressHeadingActions","progressLogActions":"dshPlatform_progressLogActions","progressLogChevron":"dshPlatform_progressLogChevron","progressLogEmpty":"dshPlatform_progressLogEmpty","progressLogEntry":"dshPlatform_progressLogEntry","progressLogGroup":"dshPlatform_progressLogGroup","progressLogGroupList":"dshPlatform_progressLogGroupList","progressLogGroupListPopulated":"dshPlatform_progressLogGroupListPopulated","progressLogLevel":"dshPlatform_progressLogLevel","progressLogList":"dshPlatform_progressLogList","progressLogMessage":"dshPlatform_progressLogMessage","progressLogSource":"dshPlatform_progressLogSource","progressStageCount":"dshPlatform_progressStageCount","progressStageDetail":"dshPlatform_progressStageDetail","progressStageError":"dshPlatform_progressStageError","progressStageHeader":"dshPlatform_progressStageHeader","progressStageItem":"dshPlatform_progressStageItem","progressStageItemActive":"dshPlatform_progressStageItemActive","progressStageItemCompleted":"dshPlatform_progressStageItemCompleted","progressStageItemFailed":"dshPlatform_progressStageItemFailed","progressStageItemMarker":"dshPlatform_progressStageItemMarker","progressStageItemPending":"dshPlatform_progressStageItemPending","progressStageItems":"dshPlatform_progressStageItems","progressStageLog":"dshPlatform_progressStageLog","progressStageMarker":"dshPlatform_progressStageMarker","progressStageMarkerActive":"dshPlatform_progressStageMarkerActive","progressStageMarkerCompleted":"dshPlatform_progressStageMarkerCompleted","progressStageMarkerFailed":"dshPlatform_progressStageMarkerFailed","progressStageMetric":"dshPlatform_progressStageMetric","progressStagePercent":"dshPlatform_progressStagePercent","progressStageSummary":"dshPlatform_progressStageSummary","progressStageToggle":"dshPlatform_progressStageToggle","proxyCapability":"dshPlatform_proxyCapability","proxyCheckRow":"dshPlatform_proxyCheckRow","proxyFormGrid":"dshPlatform_proxyFormGrid","proxyHint":"dshPlatform_proxyHint","proxyProvider":"dshPlatform_proxyProvider","proxyProviderList":"dshPlatform_proxyProviderList","proxyRulesGrid":"dshPlatform_proxyRulesGrid","proxyScopeCatalog":"dshPlatform_proxyScopeCatalog","proxyScopeDialog":"dshPlatform_proxyScopeDialog","proxyScopeGrid":"dshPlatform_proxyScopeGrid","proxyScopeSummaries":"dshPlatform_proxyScopeSummaries","proxyTestStages":"dshPlatform_proxyTestStages","reminderActions":"dshPlatform_reminderActions","resourceDescription":"dshPlatform_resourceDescription","resourceHeading":"dshPlatform_resourceHeading","resourceHeadingDetail":"dshPlatform_resourceHeadingDetail","resourceSearch":"dshPlatform_resourceSearch","resourceSectionHeading":"dshPlatform_resourceSectionHeading","restartConfirmation":"dshPlatform_restartConfirmation","root":"dshPlatform_root","secondaryButton":"dshPlatform_secondaryButton","section":"dshPlatform_section","sectionHeading":"dshPlatform_sectionHeading","segmented":"dshPlatform_segmented","settingRow":"dshPlatform_settingRow","settingRows":"dshPlatform_settingRows","smallButton":"dshPlatform_smallButton","statusActive":"dshPlatform_statusActive","statusBadge":"dshPlatform_statusBadge","statusDot":"dshPlatform_statusDot","statusEnabled":"dshPlatform_statusEnabled","statusFailed":"dshPlatform_statusFailed","statusLabel":"dshPlatform_statusLabel","statusLine":"dshPlatform_statusLine","statusPending":"dshPlatform_statusPending","statusSuccess":"dshPlatform_statusSuccess","tabPanel":"dshPlatform_tabPanel","tabs":"dshPlatform_tabs","title":"dshPlatform_title","titleRow":"dshPlatform_titleRow","toggle":"dshPlatform_toggle","updateProgress":"dshPlatform_updateProgress","updateReminder":"dshPlatform_updateReminder","updateState":"dshPlatform_updateState","version":"dshPlatform_version","versionCell":"dshPlatform_versionCell","versions":"dshPlatform_versions","warn":"dshPlatform_warn","warning":"dshPlatform_warning"});
const styleId = "@dsh-docker/platform-management/style.module.css";
if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-plugin-css]')].some(tag => tag.dataset.pluginCss === styleId)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = "@dsh-docker/platform-management";
  tag.dataset.pluginCss = styleId;
  tag.textContent = ".dshPlatform_root {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  width: 100%;\n  height: min(720px, calc(100dvh - 152px));\n  min-height: 0;\n  max-width: 760px;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_platformHeader {\n  z-index: 10;\n  display: flex;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  flex: none;\n  flex-direction: column;\n  gap: 12px;\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.dshPlatform_heading {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n\n.dshPlatform_sectionHeading {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n}\n\n.dshPlatform_titleRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.dshPlatform_title {\n  margin: 0;\n  font-size: 18px;\n  line-height: 26px;\n  font-weight: 600;\n}\n\n.dshPlatform_intro {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshPlatform_sectionHeading p {\n  margin: 2px 0 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshPlatform_connection {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 3px 9px;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_connection > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-warn-label);\n}\n\n.dshPlatform_connection.dshPlatform_online > span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_connection.dshPlatform_offline > span { background: var(--dsw-alias-state-error-primary); }\n\n.dshPlatform_tabs {\n  display: flex;\n  align-items: flex-end;\n  gap: 22px;\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  overflow-x: auto;\n  overscroll-behavior-inline: contain;\n  scroll-snap-type: inline proximity;\n  touch-action: pan-x;\n  white-space: nowrap;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  margin-top: 2px;\n  scrollbar-width: none;\n  -webkit-overflow-scrolling: touch;\n}\n\n.dshPlatform_tabs::-webkit-scrollbar { display: none; }\n\n.dshPlatform_tabs button {\n  position: relative;\n  flex: none;\n  padding: 7px 1px 9px;\n  border: 0;\n  color: var(--dsw-alias-label-tertiary);\n  background: transparent;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  scroll-snap-align: start;\n  cursor: pointer;\n}\n\n.dshPlatform_tabs button:hover,\n.dshPlatform_tabs button[aria-selected='true'] {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_tabs button[aria-selected='true']::after,\n.dshPlatform_tabs button:focus-visible::after {\n  position: absolute;\n  right: 0;\n  bottom: -1px;\n  left: 0;\n  height: 2px;\n  border-radius: 2px 2px 0 0;\n  background: var(--dsw-alias-label-primary);\n  content: '';\n}\n\n.dshPlatform_tabs button:focus-visible {\n  border-radius: 2px;\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n  color: var(--dsw-alias-label-primary);\n}\n\n@media (hover: hover) and (pointer: fine) {\n  .dshPlatform_tabs { scroll-snap-type: none; }\n}\n\n.dshPlatform_tabPanel {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  min-width: 0;\n  min-height: 0;\n  flex: 1;\n  padding: 2px 8px 0 0;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-gutter: stable;\n}\n\n.dshPlatform_tabPanel[hidden] { display: none; }\n.dshPlatform_tabPanel > .dshPlatform_section:last-child { padding-bottom: 0; border-bottom: 0; }\n\n.dshPlatform_section {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding-bottom: 20px;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshPlatform_sectionHeading h3 {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500;\n}\n\n.dshPlatform_segmented {\n  flex: none;\n  display: inline-flex;\n  padding: 2px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dshPlatform_segmented button {\n  box-sizing: border-box;\n  height: 28px;\n  padding: 0 10px;\n  border: none;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.dshPlatform_segmented button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_segmented button[aria-pressed='true'] {\n  background: var(--dsw-specific-sidebar-nav-item-active);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n.dshPlatform_versions {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  overflow: hidden;\n}\n\n.dshPlatform_experimentalVersions { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n\n.dshPlatform_versionCell {\n  min-width: 0;\n  padding: 12px 14px;\n}\n\n.dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_caption, .dshPlatform_version, .dshPlatform_detail { display: block; overflow-wrap: anywhere; }\n.dshPlatform_caption, .dshPlatform_detail { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_version { margin: 3px 0; font-size: 15px; line-height: 22px; font-weight: 600; }\n\n.dshPlatform_notice,\n.dshPlatform_error {\n  margin: 0;\n  padding: 8px 10px;\n  border-left: 3px solid var(--dsw-alias-state-warn-label);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-state-warn-label);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_error {\n  border-left-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshPlatform_actions {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 8px;\n}\n\n.dshPlatform_primaryButton,\n.dshPlatform_secondaryButton,\n.dshPlatform_dangerButton,\n.dshPlatform_dangerFilledButton,\n.dshPlatform_smallButton {\n  box-sizing: border-box;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  height: 36px;\n  padding: 0 14px;\n  border: none;\n  border-radius: 18px;\n  font: inherit;\n  font-size: 14px;\n  line-height: 22px;\n  cursor: pointer;\n}\n\n.dshPlatform_listPagination {\n  position: sticky;\n  bottom: 0;\n  z-index: 2;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto auto auto;\n  align-items: center;\n  gap: 12px;\n  min-height: 42px;\n  padding: 6px 0;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 12px;\n}\n.dshPlatform_listPagination label,\n.dshPlatform_listPagination > div { display: flex; align-items: center; gap: 7px; white-space: nowrap; }\n.dshPlatform_listPagination select {\n  min-width: 64px;\n  min-height: 30px;\n  padding: 3px 22px 3px 7px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n}\n.dshPlatform_pageNavigation strong { min-width: 16px; color: var(--dsw-alias-label-primary); text-align: center; font-weight: 600; }\n.dshPlatform_pageArrow { width: 30px; min-width: 30px; height: 30px; padding: 0; border-radius: 6px; font-size: 0; line-height: 1; }\n.dshPlatform_pageArrow::before {\n  width: 7px;\n  height: 7px;\n  border-top: 1.5px solid currentColor;\n  border-right: 1.5px solid currentColor;\n  content: '';\n}\n.dshPlatform_pageNavigation .dshPlatform_pageArrow:first-child::before { transform: translateX(1px) rotate(-135deg); }\n.dshPlatform_pageNavigation .dshPlatform_pageArrow:last-child::before { transform: translateX(-1px) rotate(45deg); }\n.dshPlatform_pageJump input {\n  box-sizing: border-box;\n  width: 50px;\n  min-height: 30px;\n  padding: 3px 6px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n  text-align: center;\n}\n\n.dshPlatform_primaryButton {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n.dshPlatform_primaryButton:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n\n.dshPlatform_secondaryButton,\n.dshPlatform_smallButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n}\n.dshPlatform_secondaryButton:hover:not(:disabled),\n.dshPlatform_smallButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n\na.dshPlatform_secondaryButton { text-decoration: none; }\n\n.dshPlatform_checkSpinner {\n  box-sizing: border-box;\n  width: 14px;\n  height: 14px;\n  margin-right: 7px;\n  border: 2px solid currentColor;\n  border-right-color: transparent;\n  border-radius: 50%;\n  animation: checkSpin .75s linear infinite;\n}\n\n@keyframes checkSpin { to { transform: rotate(360deg); } }\n\n@media (prefers-reduced-motion: reduce) {\n  .dshPlatform_checkSpinner { animation-duration: 1.5s; }\n}\n\n.dshPlatform_dangerButton {\n  background: transparent;\n  color: var(--dsw-alias-state-error-primary);\n}\n.dshPlatform_dangerButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }\n.dshPlatform_dangerFilledButton { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground); }\n\n.dshPlatform_smallButton {\n  height: 28px;\n  padding: 0 10px;\n  border-radius: 14px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_primaryButton:disabled,\n.dshPlatform_secondaryButton:disabled,\n.dshPlatform_dangerButton:disabled,\n.dshPlatform_dangerFilledButton:disabled,\n.dshPlatform_smallButton:disabled,\n.dshPlatform_segmented button:disabled { opacity: .4; cursor: default; }\n\n.dshPlatform_primaryButton:focus-visible,\n.dshPlatform_secondaryButton:focus-visible,\n.dshPlatform_dangerButton:focus-visible,\n.dshPlatform_dangerFilledButton:focus-visible,\n.dshPlatform_smallButton:focus-visible,\n.dshPlatform_segmented button:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshPlatform_actionHeading { align-items: center; }\n.dshPlatform_updateState { display: flex; flex-direction: column; gap: 8px; }\n.dshPlatform_statusLine { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n.dshPlatform_statusLine output { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusLabel { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusDot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-border-l2); }\n.dshPlatform_statusActive .dshPlatform_statusDot { background: var(--dsw-alias-brand-primary); }\n.dshPlatform_statusSuccess .dshPlatform_statusDot { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_statusFailed { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_statusFailed .dshPlatform_statusDot { background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_updateState > p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }\n.dshPlatform_updateProgress { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); }\n.dshPlatform_progressHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n.dshPlatform_progressHeading strong { font-size: 13px; line-height: 20px; font-weight: 500; }\n.dshPlatform_progressHeading output { color: var(--dsw-alias-label-primary); font: 600 12px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\n.dshPlatform_progressHeadingActions { display: flex; align-items: center; gap: 8px; }\n.dshPlatform_progressStageLog { display: grid; gap: 8px; min-width: 0; }\n.dshPlatform_progressLogActions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 7px; }\n.dshPlatform_progressAutoScroll { display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; }\n.dshPlatform_progressLogList { display: grid; gap: 0; }\n.dshPlatform_progressLogGroup { position: relative; min-width: 0; padding: 0 0 14px 28px; }\n.dshPlatform_progressLogGroup:not(:last-child)::before { position: absolute; top: 22px; bottom: 0; left: 8px; width: 1px; background: var(--dsw-alias-border-l2); content: ''; }\n.dshPlatform_progressStageMarker { --marker-size: 10px; position: absolute; top: 5px; left: 3px; display: grid; width: var(--marker-size); height: var(--marker-size); place-items: center; }\n.dshPlatform_progressStageMarker::before { box-sizing: border-box; width: 100%; height: 100%; border: 1.5px solid var(--dsw-alias-label-tertiary); border-radius: 50%; content: ''; }\n.dshPlatform_progressStageMarkerCompleted::before { border-color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_progressStageMarkerFailed::before { border-color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_progressStageMarkerActive::before { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent); border-top-color: var(--dsw-alias-state-business-primary); animation: checkSpin .8s linear infinite; }\n.dshPlatform_progressStageHeader { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; }\n.dshPlatform_progressStageSummary { display: grid; min-width: 0; gap: 1px; }\n.dshPlatform_progressStageSummary strong { font-size: 13px; line-height: 20px; font-weight: 600; }\n.dshPlatform_progressStageDetail, .dshPlatform_progressStageCount { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; overflow-wrap: anywhere; }\n.dshPlatform_progressStageMetric, .dshPlatform_progressStagePercent { color: var(--dsw-alias-label-primary); font: 11px/17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }\n.dshPlatform_progressStageToggle { align-self: start; padding: 0; border: 0; color: var(--dsw-alias-state-business-primary); background: transparent; font-size: 10px; line-height: 20px; white-space: nowrap; cursor: pointer; }\n.dshPlatform_progressStageItems { display: grid; gap: 4px; margin-top: 8px; padding: 8px 10px; border-left: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_progressStageItem { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; }\n.dshPlatform_progressStageItemCompleted { color: var(--dsw-alias-state-success-primary); }\n.dshPlatform_progressStageItemActive { color: var(--dsw-alias-state-business-primary); }\n.dshPlatform_progressStageItemFailed { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_progressStageItemMarker { --marker-size: 10px; display: inline-grid; width: 14px; height: 17px; place-items: center; }\n.dshPlatform_progressStageItemMarker::before { box-sizing: border-box; width: var(--marker-size); height: var(--marker-size); border: 1.5px solid transparent; border-radius: 50%; content: ''; }\n.dshPlatform_progressStageItemCompleted .dshPlatform_progressStageItemMarker::before { border-color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_progressStageItemFailed .dshPlatform_progressStageItemMarker::before { border-color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_progressStageItemPending .dshPlatform_progressStageItemMarker::before { border: 1.5px solid var(--dsw-alias-label-secondary); }\n.dshPlatform_progressStageItemActive .dshPlatform_progressStageItemMarker::before { border: 1.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent); border-top-color: var(--dsw-alias-state-business-primary); animation: checkSpin .8s linear infinite; }\n.dshPlatform_progressStageItem .dshPlatform_progressStageMetric, .dshPlatform_progressStageItem .dshPlatform_progressStagePercent { grid-column: 2; }\n.dshPlatform_progressStageError { margin: 4px 0 0 21px !important; color: var(--dsw-alias-state-error-primary) !important; font-size: 11px !important; overflow-wrap: anywhere; }\n.dshPlatform_progressLogGroupList { display: grid; gap: 0; max-height: 250px; overflow: auto; margin-top: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); }\n.dshPlatform_progressLogGroupListPopulated { height: clamp(160px, 24dvh, 240px); max-height: none; align-content: start; }\n.dshPlatform_progressLogEntry { border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 7px 9px; background: var(--dsw-alias-bg-layer-2); }\n.dshPlatform_progressLogEntry summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 2px 8px; cursor: pointer; font-size: 11px; line-height: 18px; list-style: none; }\n.dshPlatform_progressLogEntry summary::-webkit-details-marker { display: none; }\n.dshPlatform_progressLogEntry summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dshPlatform_progressLogEntry summary time, .dshPlatform_progressLogSource { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; }\n.dshPlatform_progressLogLevel { color: var(--dsw-alias-state-business-primary); }\n.dshPlatform_progressLogLevel.dshPlatform_error { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_progressLogLevel.dshPlatform_warning, .dshPlatform_progressLogLevel.dshPlatform_warn { color: var(--dsw-alias-state-warning-primary); }\n.dshPlatform_progressLogMessage { grid-column: 1 / 3; color: var(--dsw-alias-label-primary); font: 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\n.dshPlatform_progressLogChevron { position: relative; top: 2px; grid-column: 3; width: 10px; height: 10px; justify-self: end; }\n.dshPlatform_progressLogChevron::before { position: absolute; top: 3px; left: 1px; width: 8px; height: 5px; background: var(--dsw-alias-label-tertiary); clip-path: polygon(0 0, 50% 72%, 100% 0, 100% 28%, 50% 100%, 0 28%); content: ''; transform-origin: center; }\n.dshPlatform_progressLogEntry[open] .dshPlatform_progressLogChevron::before { transform: rotate(180deg); }\n.dshPlatform_progressLogEntry pre { max-height: 160px; overflow: auto; margin: 5px 0 2px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; font: 10px/15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\n.dshPlatform_progressLogEmpty { margin: 0 !important; padding: 8px; color: var(--dsw-alias-label-secondary) !important; font-size: 11px; }\n.dshPlatform_progressFullLog { justify-self: start; padding: 0; border: 0; color: var(--dsw-alias-state-business-primary); background: transparent; cursor: pointer; font-size: 11px; }\n.dshPlatform_progress { height: 8px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-border-l2); }\n.dshPlatform_progress span { display: block; height: 100%; background: var(--dsw-alias-state-success-primary); transition: width .2s ease; }\n.dshPlatform_progress[data-complete='true'] span { width: 100% !important; transition: none; }\n\n.dshPlatform_holds { display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold div { min-width: 0; }\n.dshPlatform_hold strong, .dshPlatform_hold span { display: block; overflow-wrap: anywhere; }\n.dshPlatform_hold strong { font-size: 13px; line-height: 20px; }\n.dshPlatform_hold span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n\n.dshPlatform_confirmation {\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-module-platform);\n}\n.dshPlatform_confirmation h4 { margin: 0; font-size: 14px; line-height: 22px; }\n.dshPlatform_confirmation p { margin: 4px 0 12px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_confirmation label { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px; }\n.dshPlatform_confirmation input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }\n.dshPlatform_confirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }\n\n.dshPlatform_maintenanceButton { flex: none; }\n.dshPlatform_maintenanceStatus {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n}\n.dshPlatform_restartConfirmation { border-color: var(--dsw-alias-border-l2); }\n\n.dshPlatform_toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_toggle input { position: absolute; opacity: 0; pointer-events: none; }\n.dshPlatform_toggle > span {\n  box-sizing: border-box;\n  width: 34px;\n  height: 20px;\n  padding: 2px;\n  border-radius: 10px;\n  background: var(--dsw-alias-border-l2);\n  transition: background .15s ease;\n}\n.dshPlatform_toggle > span::after {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-primary-foreground);\n  content: '';\n  transition: transform .15s ease;\n}\n.dshPlatform_toggle input:checked + span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_toggle input:checked + span::after { transform: translateX(14px); }\n.dshPlatform_toggle input:focus-visible + span { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dshPlatform_toggle input:disabled ~ * { opacity: .5; cursor: default; }\n.dshPlatform_toggle b { font-weight: 500; }\n\n.dshPlatform_settingRows { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; }\n.dshPlatform_proxyFormGrid, .dshPlatform_proxyRulesGrid, .dshPlatform_proxyScopeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }\n.dshPlatform_proxyFormGrid > label, .dshPlatform_proxyRulesGrid > label { display: grid; gap: 5px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }\n.dshPlatform_proxyFormGrid input, .dshPlatform_proxyFormGrid select, .dshPlatform_proxyRulesGrid textarea, .dshPlatform_proxyProvider select { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font: inherit; }\n.dshPlatform_proxyRulesGrid textarea { min-height: 88px; resize: vertical; font: 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\n.dshPlatform_proxyFormGrid label > span, .dshPlatform_proxyRulesGrid label > span { color: var(--dsw-alias-label-primary); font-weight: 500; }\n.dshPlatform_proxyRulesGrid small, .dshPlatform_proxyCheckRow small { display: block; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyCheckRow { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; color: var(--dsw-alias-label-primary); font-size: 12px; }\n.dshPlatform_proxyCheckRow input { flex: none; margin-top: 3px; }\n.dshPlatform_proxyHint { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyScopeGrid > label { display: flex; gap: 9px; min-width: 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-module-platform); }\n.dshPlatform_proxyScopeGrid > label > input { flex: none; margin-top: 3px; }\n.dshPlatform_proxyScopeGrid b, .dshPlatform_proxyScopeGrid small { display: block; }\n.dshPlatform_proxyScopeGrid b { font-size: 13px; line-height: 20px; }\n.dshPlatform_proxyScopeGrid small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyProviderList { overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }\n.dshPlatform_proxyProvider { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 11px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_proxyProvider:last-child { border-bottom: 0; }\n.dshPlatform_proxyProvider b, .dshPlatform_proxyProvider small { display: block; overflow-wrap: anywhere; }\n.dshPlatform_proxyProvider small { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyCapability { padding: 3px 7px; border-radius: 999px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-module-platform); font-size: 10px; white-space: nowrap; }\n.dshPlatform_proxyTestStages { display: grid; gap: 0; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; list-style: none; }\n.dshPlatform_proxyTestStages > li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 7px; align-items: start; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 12px; }\n.dshPlatform_proxyTestStages > li:last-child { border-bottom: 0; }\n.dshPlatform_proxyTestStages > li > span:first-child { width: 9px; height: 9px; margin-top: 4px; border: 1.5px solid var(--dsw-alias-label-tertiary); border-radius: 50%; }\n.dshPlatform_proxyTestStages > li[data-state='running'] > span:first-child { border-color: var(--dsw-alias-brand-primary); border-top-color: transparent; animation: spin .7s linear infinite; }\n.dshPlatform_proxyTestStages > li[data-state='success'] > span:first-child { border-color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_proxyTestStages > li[data-state='failed'] > span:first-child { border-color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_proxyTestStages > li small { display: block; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; }\n.dshPlatform_proxyScopeDialog { box-sizing: border-box; width: min(760px, calc(100vw - 40px)); max-height: min(720px, calc(100dvh - 40px)); padding: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }\n.dshPlatform_proxyScopeDialog::backdrop { background: rgb(0 0 0 / 50%); }\n.dshPlatform_proxyScopeDialog form { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: inherit; }\n.dshPlatform_proxyScopeDialog header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_proxyScopeDialog h3, .dshPlatform_proxyScopeDialog h4 { margin: 0; }\n.dshPlatform_proxyScopeDialog header p { margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }\n.dshPlatform_proxyScopeCatalog { overflow: auto; padding: 8px 16px; }\n.dshPlatform_proxyScopeCatalog section { margin: 10px 0; }\n.dshPlatform_proxyScopeCatalog h4 { margin-bottom: 5px; font-size: 13px; }\n.dshPlatform_proxyScopeCatalog section > div { display: grid; grid-template-columns: minmax(160px, .8fr) minmax(0, 1.2fr); gap: 10px; padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyScopeCatalog section > div span:last-child { color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_proxyScopeSummaries { padding: 9px 16px 14px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }\n.dshPlatform_proxyScopeSummaries p { margin: 3px 0; }\n.dshPlatform_settingRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 8px 12px; font-size: 13px; }\n.dshPlatform_settingRow + .dshPlatform_settingRow { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_settingRow > span { min-width: 0; }\n.dshPlatform_settingRow b, .dshPlatform_settingRow small { display: block; }\n.dshPlatform_settingRow b { font-weight: 500; }\n.dshPlatform_settingRow small { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.dshPlatform_settingRow select {\n  min-width: 120px;\n  height: 32px;\n  padding: 0 30px 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n}\n.dshPlatform_settingRow input[type='checkbox'] { width: 16px; height: 16px; flex: none; accent-color: var(--dsw-alias-brand-primary); }\n\n.dshPlatform_pluginSection { border-bottom: 0; }\n.dshPlatform_resourceSectionHeading { display: block; }\n.dshPlatform_resourceHeadingDetail { display: flex; align-items: center; gap: 16px; margin-top: 2px; }\n.dshPlatform_resourceHeadingDetail p { min-width: 0; flex: 1; margin: 0; }\n.dshPlatform_resourceSearch {\n  display: block;\n  box-sizing: border-box;\n  width: min(320px, 45%);\n  margin: 0 0 0 auto;\n  flex: none;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n  font-size: 12px;\n}\n.dshPlatform_pluginList {\n  max-height: min(46dvh, 420px);\n  overflow-x: hidden;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n.dshPlatform_pluginRow {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 8px 16px;\n  min-height: 52px;\n  padding: 7px 12px;\n}\n.dshPlatform_pluginRow + .dshPlatform_pluginRow { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_pluginIdentity { min-width: 0; }\n.dshPlatform_pluginIdentity strong,\n.dshPlatform_pluginIdentity span { overflow-wrap: anywhere; }\n.dshPlatform_pluginIdentity strong { font-size: 13px; line-height: 20px; font-weight: 500; }\n.dshPlatform_pluginIdentity span { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.dshPlatform_resourceHeading { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }\n.dshPlatform_resourceHeading > strong { flex: 0 1 auto; max-width: 55%; }\n.dshPlatform_statusBadge { flex: 0 0 auto; margin-top: 1px; padding: 1px 6px; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-module-platform); font-size: 10px; line-height: 16px; white-space: nowrap; }\n.dshPlatform_statusEnabled {\n  color: var(--dsw-alias-state-success-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);\n}\n.dshPlatform_statusPending {\n  color: var(--dsw-alias-state-warn-label);\n  background: color-mix(in srgb, var(--dsw-alias-state-warn-label) 12%, transparent);\n}\n.dshPlatform_resourceDescription { position: relative; flex: 1 1 120px; min-width: 0; padding: 0 15px 0 0; overflow: hidden; border: 0; color: var(--dsw-alias-label-tertiary); background: transparent; font: inherit; font-size: 12px; line-height: 20px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: default; }\n.dshPlatform_resourceDescription.dshPlatform_expandable { cursor: pointer; }\n.dshPlatform_resourceDescription.dshPlatform_expandable::after { position: absolute; top: 6px; right: 2px; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); content: ''; }\n.dshPlatform_resourceDescription.dshPlatform_expanded { overflow: visible; text-overflow: clip; white-space: normal; }\n.dshPlatform_resourceDescription.dshPlatform_expanded::after { top: 9px; transform: rotate(225deg); }\n.dshPlatform_pluginIdentity > .dshPlatform_resourceDescription { display: block; width: 100%; margin-top: 2px; }\n.dshPlatform_pluginIdentity .dshPlatform_pendingBadge {\n  display: inline-block;\n  width: fit-content;\n  margin-top: 5px;\n  color: var(--dsw-alias-state-warn-label);\n  font-weight: 500;\n}\n.dshPlatform_managedBadge {\n  padding: 3px 9px;\n  border-radius: 12px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n  font-size: 12px;\n  line-height: 18px;\n  white-space: nowrap;\n}\n.dshPlatform_pluginActions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }\n.dshPlatform_pluginActions .dshPlatform_toggle { width: auto; }\n.dshPlatform_pluginOperation {\n  grid-column: 1 / -1;\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_pluginRestartNotice {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 12px 14px;\n  border: 1px solid var(--dsw-alias-state-warn-border);\n  border-radius: 8px;\n  background: var(--dsw-alias-state-warn-bg);\n}\n\n.dshPlatform_pluginRestartNotice div { min-width: 0; }\n.dshPlatform_pluginRestartNotice strong { font-size: 13px; line-height: 20px; }\n.dshPlatform_pluginRestartNotice p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }\n.dshPlatform_pluginDraftActions { display: flex; flex: none; align-items: center; gap: 8px; }\n.dshPlatform_pluginDraftActions button { flex: none; }\n.dshPlatform_emptyPlugins { margin: 0; padding: 24px 12px; color: var(--dsw-alias-label-tertiary); text-align: center; font-size: 13px; }\n\n.dshPlatform_logSection { gap: 10px; }\n\n.dshPlatform_logTools {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.dshPlatform_logConnection {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  min-height: 24px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshPlatform_logConnection > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-warn-label);\n}\n\n.dshPlatform_logConnection.dshPlatform_live > span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_logConnection.dshPlatform_disconnected > span { background: var(--dsw-alias-state-error-primary); }\n\n.dshPlatform_autoScrollButton,\n.dshPlatform_clearLogsButton {\n  min-height: 26px;\n  padding: 2px 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-secondary);\n  background: transparent;\n  font: inherit;\n  font-size: 11px;\n  cursor: pointer;\n}\n\n.dshPlatform_autoScrollButton:hover,\n.dshPlatform_clearLogsButton:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_autoScrollButton[aria-pressed='true'] { color: var(--dsw-alias-label-primary); }\n.dshPlatform_clearLogsButton:disabled { opacity: 0.45; cursor: default; }\n\n.dshPlatform_logSummaryRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n.dshPlatform_logAutoScroll { display: inline-flex; flex: none; align-items: center; gap: 6px; min-height: 26px; margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }\n.dshPlatform_logAutoScroll input { position: absolute; opacity: 0; pointer-events: none; }\n.dshPlatform_logAutoScroll > span { box-sizing: border-box; width: 28px; height: 16px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-border-l2); }\n.dshPlatform_logAutoScroll > span::after { display: block; width: 12px; height: 12px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); content: ''; transition: transform .15s ease; }\n.dshPlatform_logAutoScroll input:checked + span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_logAutoScroll input:checked + span::after { transform: translateX(12px); }\n.dshPlatform_logAutoScroll input:focus-visible + span { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dshPlatform_logAutoScroll b { font-weight: 400; }\n\n.dshPlatform_logFilters {\n  display: grid;\n  grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(110px, auto));\n  gap: 8px;\n}\n\n.dshPlatform_logFilters input,\n.dshPlatform_logFilters select {\n  box-sizing: border-box;\n  min-width: 0;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 7px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n  font-size: 12px;\n}\n\n.dshPlatform_logFilters input::placeholder { color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_logFilters input:focus-visible,\n.dshPlatform_logFilters select:focus-visible {\n  border-color: var(--dsw-alias-state-business-primary);\n  outline: 1px solid var(--dsw-alias-state-business-primary);\n}\n\n.dshPlatform_logSummary {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_logResizeFrame {\n  position: relative;\n  box-sizing: border-box;\n  height: 280px;\n  min-height: 140px;\n  max-height: min(560px, 70dvh);\n}\n\n.dshPlatform_logList {\n  display: flex;\n  flex-direction: column;\n  box-sizing: border-box;\n  height: 100%;\n  overflow: auto;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dshPlatform_logResizeHandle {\n  position: absolute;\n  right: 0;\n  bottom: 0;\n  left: 0;\n  z-index: 2;\n  height: 16px;\n  cursor: ns-resize;\n  touch-action: none;\n}\n\n.dshPlatform_logEntry {\n  min-width: 0;\n  padding: 10px 12px;\n  background: var(--dsw-alias-bg-module-platform);\n  cursor: pointer;\n}\n\n.dshPlatform_logEntry + .dshPlatform_logEntry { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_logEntry:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_logEntry:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }\n.dshPlatform_logMeta { display: flex; align-items: center; gap: 8px; min-width: 0; }\n.dshPlatform_logMessageRow { display: flex; align-items: center; gap: 10px; min-width: 0; }\n.dshPlatform_logMessageRow > pre { flex: 1; min-width: 0; }\n.dshPlatform_logChevron {\n  position: relative;\n  top: 2px;\n  flex: none;\n  width: 10px;\n  height: 10px;\n  margin-right: 1px;\n}\n.dshPlatform_logChevron::before {\n  position: absolute;\n  top: 3px;\n  left: 1px;\n  width: 8px;\n  height: 5px;\n  background: var(--dsw-alias-label-tertiary);\n  clip-path: polygon(0 0, 50% 72%, 100% 0, 100% 28%, 50% 100%, 0 28%);\n  content: \"\";\n  transform-origin: center;\n}\n.dshPlatform_logEntry[aria-expanded='true'] .dshPlatform_logChevron::before { transform: rotate(180deg); }\n.dshPlatform_logLevel { flex: none; font-size: 11px; line-height: 18px; font-weight: 600; }\n.dshPlatform_logDebug { color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_logInfo { color: var(--dsw-alias-state-business-primary); }\n.dshPlatform_logWarning { color: var(--dsw-alias-state-warn-label); }\n.dshPlatform_logError { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_logSource {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dshPlatform_logMeta time {\n  flex: none;\n  margin-left: auto;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 18px;\n}\n\n.dshPlatform_logEntry pre {\n  margin: 5px 0 0;\n  overflow-wrap: anywhere;\n  color: var(--dsw-alias-label-primary);\n  font: 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  white-space: pre-wrap;\n}\n\n.dshPlatform_logDetails {\n  margin-top: 9px !important;\n  padding-top: 9px;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-secondary) !important;\n}\n\n.dshPlatform_emptyLogs {\n  margin: 0;\n  padding: 28px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  font-size: 13px;\n}\n\n.dshPlatform_updateReminder {\n  position: fixed;\n  right: 20px;\n  bottom: 20px;\n  z-index: 1000;\n  box-sizing: border-box;\n  width: min(360px, calc(100vw - 32px));\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 8px 24px rgb(0 0 0 / 24%);\n  pointer-events: auto;\n}\n.dshPlatform_updateReminder strong { display: block; font-size: 14px; line-height: 22px; }\n.dshPlatform_updateReminder p { margin: 4px 0 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n.dshPlatform_reminderActions { display: flex; justify-content: flex-end; gap: 8px; }\n.dshPlatform_reminderActions button {\n  min-height: 30px;\n  padding: 4px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 15px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_reminderActions button:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n@media (max-width: 640px) {\n  .dshPlatform_progressLogGroupListPopulated { height: 180px; }\n  .dshPlatform_sectionHeading { flex-direction: column; gap: 10px; }\n  .dshPlatform_resourceHeadingDetail { align-items: stretch; flex-direction: column; gap: 8px; }\n  .dshPlatform_resourceSearch { width: 100%; margin-left: 0; }\n  .dshPlatform_proxyFormGrid, .dshPlatform_proxyRulesGrid, .dshPlatform_proxyScopeGrid { grid-template-columns: 1fr; }\n  .dshPlatform_proxyProvider { align-items: start; }\n  .dshPlatform_proxyScopeCatalog section > div { grid-template-columns: 1fr; gap: 2px; }\n  .dshPlatform_proxyScopeDialog { width: 100%; max-width: none; height: 100dvh; max-height: none; border: 0; border-radius: 0; }\n  .dshPlatform_actionHeading { align-items: flex-start; }\n  .dshPlatform_versions { grid-template-columns: 1fr; }\n  .dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); }\n  .dshPlatform_segmented { width: 100%; }\n  .dshPlatform_segmented button { flex: 1; }\n  .dshPlatform_actions > button { flex: 1 1 calc(50% - 8px); }\n  .dshPlatform_actions { width: 100%; justify-content: flex-start; }\n  .dshPlatform_progressHeading { align-items: flex-start; }\n  .dshPlatform_progressHeading output { text-align: right; }\n  .dshPlatform_progressLogGroup { padding-left: 24px; }\n  .dshPlatform_progressLogGroup:not(:last-child)::before { left: 7px; }\n  .dshPlatform_progressStageMarker { left: 2px; }\n  .dshPlatform_progressLogEntry summary { grid-template-columns: auto minmax(0, 1fr) auto; gap: 1px 6px; }\n  .dshPlatform_progressLogActions { align-items: stretch; flex-direction: column; }\n  .dshPlatform_progressLogActions button { width: 100%; }\n  .dshPlatform_maintenanceButton { width: 100%; }\n  .dshPlatform_toggle { width: 100%; justify-content: space-between; }\n  .dshPlatform_settingRow { align-items: flex-start; }\n  .dshPlatform_pluginRow { grid-template-columns: 1fr; align-items: stretch; }\n  .dshPlatform_pluginActions { justify-content: space-between; }\n  .dshPlatform_pluginActions .dshPlatform_toggle { width: auto; }\n  .dshPlatform_pluginRestartNotice { align-items: stretch; flex-direction: column; }\n  .dshPlatform_pluginDraftActions { width: 100%; }\n  .dshPlatform_pluginDraftActions button { flex: 1; }\n  .dshPlatform_managedBadge { justify-self: start; }\n  .dshPlatform_listPagination { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; }\n  .dshPlatform_listPagination > span { grid-column: 1; grid-row: 1; }\n  .dshPlatform_listPagination > label:not(.dshPlatform_pageJump) { grid-column: 2; grid-row: 1; justify-self: end; }\n  .dshPlatform_pageNavigation { grid-column: 1; grid-row: 2; justify-self: start; }\n  .dshPlatform_pageJump { grid-column: 2; grid-row: 2; justify-self: end; }\n  .dshPlatform_logFilters { grid-template-columns: 1fr 1fr; }\n  .dshPlatform_logTools { width: 100%; flex-wrap: wrap; }\n  .dshPlatform_logConnection { margin-right: auto; }\n  .dshPlatform_logFilters input { grid-column: 1 / -1; }\n  .dshPlatform_logMeta { flex-wrap: wrap; }\n  .dshPlatform_logMeta time { width: auto; margin-left: auto; }\n  .dshPlatform_logResizeFrame {\n    height: min(260px, 36dvh);\n    max-height: min(520px, 72dvh);\n  }\n  .dshPlatform_updateReminder { right: 16px; bottom: 16px; }\n}\n\n@media (max-width: 480px) {\n  [role='dialog']:has(.dshPlatform_root) > nav { display: none; }\n  [role='dialog']:has(.dshPlatform_root) > div { min-width: 0; }\n  .dshPlatform_actions > button { flex-basis: 100%; }\n}\n";
  document.head.appendChild(tag);
}
const React = require('react')
const { useCallback, useEffect, useRef, useState } = React

const API = '/_dsh_platform/plugin-api/v1'
const TERMINAL = new Set(['idle', 'success', 'failed'])
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
const h = React.createElement
const LOCALE_COOKIE = 'dsh_locale'
const NOTICE_OWNER_KEY = 'dsh-platform:update-notice-owner'
const NOTICE_SNOOZE_KEY = 'dsh-platform:update-notice-snooze'
const NOTICE_OWNER_TTL = 20_000
const PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'
const LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'
const LOG_DISPLAY_LIMIT_KEY = 'dsh-platform:log-display-limit'
const LOG_DISPLAY_LIMITS = Object.freeze([100, 250, 500, 1_000])
const DEFAULT_LOG_DISPLAY_LIMIT = 500
const LOG_STREAM_LIMIT = 5_000
const LIST_PAGE_SIZES = Object.freeze([5, 10, 20, 50])
const LIST_PAGE_SIZE_KEY_PREFIX = 'dsh-platform:plugin-page-size:'

const inject = ['slots', 'locale', 'connection']

const LIFECYCLE_WAIT_PATH = '/_dsh_gateway/wait'
const LIFECYCLE_READINESS_PATH = '/_dsh_gateway/readiness'
const CONNECTION_LOSS_GRACE_MS = 1_000
const READINESS_RETRY_MS = 500

let platformStateEventSource
const platformStateEventSubscribers = new Set()

function subscribePlatformStateEvents({ state, open, error }) {
  const subscriber = { state, open, error }
  platformStateEventSubscribers.add(subscriber)
  if (platformStateEventSource === undefined) {
    const stream = new EventSource(`${API}/events`)
    platformStateEventSource = stream
    stream.addEventListener('state', event => {
      for (const current of platformStateEventSubscribers) current.state?.(event)
    })
    stream.onopen = event => {
      for (const current of platformStateEventSubscribers) current.open?.(event)
    }
    stream.onerror = event => {
      for (const current of platformStateEventSubscribers) current.error?.(event)
    }
  }
  return () => {
    platformStateEventSubscribers.delete(subscriber)
    if (platformStateEventSubscribers.size === 0) {
      platformStateEventSource?.close()
      platformStateEventSource = undefined
    }
  }
}

function requiresLifecycleHoldingPage(status) {
  if (['restarting', 'switching', 'recovering', 'restart-failed'].includes(status?.operation)) return true
  if (['snapshotting-data', 'switching', 'probation', 'restoring-data'].includes(status?.update?.status)) return true
  return ['starting', 'stopping', 'stopped', 'restarting', 'recovering', 'failed']
    .includes(status?.dshLifecycle?.state)
}

function lifecycleReturnPath(locationValue = window.location) {
  return `${locationValue.pathname}${locationValue.search}${locationValue.hash}`
}

function lifecycleWaitUrl(locationValue = window.location) {
  return `${LIFECYCLE_WAIT_PATH}?return=${encodeURIComponent(lifecycleReturnPath(locationValue))}`
}

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function formatBytes(value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KiB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MiB`
  return `${(size / 1024 ** 3).toFixed(1)} GiB`
}

function stageMetricLines(update, stage, state, t) {
  const values = []
  const bytes = Number(update?.processedBytes)
  const totalBytes = Number(update?.totalBytes)
  const items = Number(update?.processedItems)
  const totalItems = Number(update?.totalItems)
  const ready = Number(update?.readyServices)
  const totalServices = Number(update?.totalServices)
  const completeEnough = state !== 'completed' || stageMetricProgress(update) === 100
  if (stage.index > 0 && completeEnough && Number.isFinite(bytes) && Number.isFinite(totalBytes) && totalBytes > 0) {
    const key = stage.key.startsWith('rollback') && stage.labelKey === 'rollbackData'
      ? 'metricBytesRestored'
      : stage.index === 1 ? 'metricBytesRead' : stage.index === 2 ? 'metricBytesCopied' : 'metricBytesProcessed'
    values.push(t(key).replace('{processed}', formatBytes(bytes)).replace('{total}', formatBytes(totalBytes)))
  }
  if (stage.index > 0 && completeEnough && Number.isFinite(items) && Number.isFinite(totalItems) && totalItems > 0) {
    const key = stage.index === 1 ? 'metricArtifacts' : stage.index >= 2 ? 'metricFiles' : 'metricItems'
    values.push(t(key).replace('{processed}', String(items)).replace('{total}', String(totalItems)))
  }
  if (Number.isFinite(ready) && Number.isFinite(totalServices) && totalServices > 0) values.push(t('metricServices').replace('{ready}', String(ready)).replace('{total}', String(totalServices)))
  if (stage.labelKey === 'progressActivate' && (update?.phase ?? update?.status) === 'probation') {
    const seconds = probationRemainingSeconds(update)
    if (seconds !== undefined) values.push(t('metricProbationRemaining').replace('{seconds}', String(seconds)))
  }
  return values
}

function probationRemainingSeconds(update) {
  const detail = String(update?.detail ?? '').match(/^probation:(\d+)$/u)
  if (detail !== null) return Number(detail[1])
  const deadline = Date.parse(update?.probationUntil ?? '')
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)) : undefined
}

function stageMetricProgress(update) {
  for (const [processedKey, totalKey] of [['processedBytes', 'totalBytes'], ['processedItems', 'totalItems'], ['readyServices', 'totalServices']]) {
    const processed = Number(update?.[processedKey])
    const total = Number(update?.[totalKey])
    if (Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
      return Math.max(0, Math.min(100, Math.round(processed / total * 100)))
    }
  }
  return undefined
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
  const phase = update?.phase ?? update?.status
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
  }
  if (stage.labelKey === 'rollbackPrepare') return phase === 'stopping' ? 1 : 0
  if (stage.labelKey === 'rollbackSwitch') return 0
  if (stage.labelKey === 'rollbackData') return Number(update?.totalItems) > 0 || Number(update?.totalBytes) > 0 ? 1 : 0
  if (stage.labelKey === 'rollbackVerify') return Number(update?.totalServices) > 0 ? 1 : 0
  return 0
}

function stageItems(stage, update, state, t) {
  const keys = stage.labelKey === 'progressActivate' && (update?.phase ?? update?.status) === 'restoring-data'
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
  const wheel = event => {
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
  }
  const pointerDown = event => {
    if (event.button !== 0 || event.pointerType === 'touch' || tablist.scrollWidth <= tablist.clientWidth) return
    stopWheelAnimation()
    pointerId = event.pointerId
    pointerStartX = event.clientX
    scrollStart = tablist.scrollLeft
    dragged = false
    dragTarget = event.target
  }
  const pointerMove = event => {
    if (event.pointerId !== pointerId) return
    const distance = event.clientX - pointerStartX
    if (Math.abs(distance) >= 4 && !dragged) {
      dragged = true
      tablist.setPointerCapture?.(pointerId)
    }
    if (!dragged) return
    tablist.scrollLeft = scrollStart - distance
    event.preventDefault()
  }
  const click = event => {
    if (event.target !== suppressClickTarget) return
    suppressClickTarget = undefined
    event.preventDefault()
    event.stopPropagation()
  }

  tablist.addEventListener('wheel', wheel, { passive: false })
  tablist.addEventListener('pointerdown', pointerDown)
  tablist.addEventListener('pointermove', pointerMove)
  tablist.addEventListener('pointerup', finishDrag)
  tablist.addEventListener('pointercancel', finishDrag)
  tablist.addEventListener('click', click, true)
  return () => {
    stopWheelAnimation()
    tablist.removeEventListener('wheel', wheel)
    tablist.removeEventListener('pointerdown', pointerDown)
    tablist.removeEventListener('pointermove', pointerMove)
    tablist.removeEventListener('pointerup', finishDrag)
    tablist.removeEventListener('pointercancel', finishDrag)
    tablist.removeEventListener('click', click, true)
  }
}

function localTime(value, locale) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
}

function updateProgressModel(update, t) {
  const rollback = isRecoveryOperation(update.operation)
  const phase = update.phase ?? (rollback ? update.rollbackPhase : update.status)
  const labels = rollback
    ? ROLLBACK_PROGRESS_STEPS.filter(key => update.rollbackIncludesSnapshot !== false || key !== 'rollbackData')
    : UPDATE_PROGRESS_STEPS
  const rawStage = rollback
    ? ROLLBACK_PROGRESS_STAGE[phase] ?? 0
    : UPDATE_PROGRESS_STAGE[phase] ?? 0
  const stage = rollback && update.rollbackIncludesSnapshot === false && rawStage > 2 ? rawStage - 1 : rawStage
  return {
    title: t(update.operation === 'return-stable' ? 'returnStableProgress' : rollback ? 'rollbackProgress' : 'updateProgress'),
    labels,
    stage,
  }
}

function transactionLogStage(phase, update, t) {
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

function updateOutcome(value, t) {
  const key = {
    none: 'outcomeNone', frozen: 'outcomeFrozen', held: 'outcomeHeld', blocked: 'outcomeBlocked',
    stable: 'outcomeStable', experimental: 'outcomeExperimental',
  }[value]
  return key === undefined ? display(value) : t(key)
}

function localizedError(value, t) {
  const message = value instanceof Error ? value.message : String(value)
  if (t('localeCode') === 'en') return message
  const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1]
  return httpStatus === undefined ? t('operationError') : `${t('requestError')}（HTTP ${httpStatus}）`
}

function localizedHoldReason(hold, t) {
  if (t('localeCode') === 'en') return display(hold.reason)
  return t(hold.type === 'combination' ? 'holdCombination' : 'holdVersion')
}

function usePaginatedItems(key, items) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(() => {
    const value = Number(storageValue(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`))
    return LIST_PAGE_SIZES.includes(value) ? value : 10
  })
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  useEffect(() => { if (page !== currentPage) setPage(currentPage) }, [currentPage, page])
  const start = currentPage * pageSize
  const changePageSize = value => {
    if (!LIST_PAGE_SIZES.includes(value)) return
    setPageSize(value)
    setPage(0)
    writeStorage(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`, String(value))
  }
  const goToPage = value => setPage(Math.min(lastPage, Math.max(0, value)))
  return {
    items: items.slice(start, start + pageSize), page: currentPage, pageSize, lastPage, start,
    setPage: goToPage, setPageSize: changePageSize,
  }
}

function ListPagination({ pagination, total, t }) {
  const [jumpValue, setJumpValue] = useState(String(pagination.page + 1))
  useEffect(() => { setJumpValue(String(pagination.page + 1)) }, [pagination.page])
  const commitJump = () => {
    const value = Number(jumpValue)
    const page = Number.isSafeInteger(value)
      ? Math.min(pagination.lastPage, Math.max(0, value - 1))
      : pagination.page
    pagination.setPage(page)
    setJumpValue(String(page + 1))
  }
  return h('div', { className: css.listPagination },
    h('span', null, t('totalItems').replace('{total}', String(total))),
    h('label', null,
      h('select', {
        'aria-label': t('itemsPerPage'),
        value: pagination.pageSize,
        onChange: event => pagination.setPageSize(Number(event.target.value)),
      }, LIST_PAGE_SIZES.map(value => h('option', { key: value, value }, String(value)))),
      h('span', null, t('itemsPerPageSuffix'))),
    h('div', { className: css.pageNavigation },
      h('button', { type: 'button', className: `${css.smallButton} ${css.pageArrow}`, 'aria-label': t('previousPage'), disabled: pagination.page === 0, onClick: () => pagination.setPage(pagination.page - 1) }),
      h('strong', null, String(pagination.page + 1)),
      h('button', { type: 'button', className: `${css.smallButton} ${css.pageArrow}`, 'aria-label': t('nextPage'), disabled: pagination.page === pagination.lastPage, onClick: () => pagination.setPage(pagination.page + 1) })),
    h('label', { className: css.pageJump },
      h('span', null, t('goToPage')),
      h('input', {
        type: 'number', min: 1, max: pagination.lastPage + 1, value: jumpValue,
        onChange: event => setJumpValue(event.target.value), onBlur: commitJump,
        onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); commitJump() } },
      }),
      h('span', null, t('pageUnit'))))
}

function ExpandableDescription({ text, identity }) {
  const element = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [expandable, setExpandable] = useState(false)
  useEffect(() => {
    const node = element.current
    if (node !== null && !expanded) setExpandable(node.scrollWidth > node.clientWidth)
  }, [expanded, identity, text])
  return h('button', {
    ref: element,
    type: 'button',
    className: `${css.resourceDescription}${expandable ? ` ${css.expandable}` : ''}${expanded ? ` ${css.expanded}` : ''}`,
    title: text,
    'aria-expanded': expanded,
    onClick: event => {
      if (!expandable) return
      preserveScrollableAncestors(event.currentTarget, () => setExpanded(value => !value))
    },
  }, text)
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

function matchesResourceSearch(query, values) {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized === '' || values.some(value => String(value ?? '').toLocaleLowerCase().includes(normalized))
}

function ResourceStatusBadge({ label, enabled = false, pending = false }) {
  return h('span', {
    className: `${css.statusBadge}${enabled ? ` ${css.statusEnabled}` : ''}${pending ? ` ${css.statusPending}` : ''}`,
    'aria-live': pending ? 'polite' : undefined,
  }, label)
}

function persistLocale(locale) {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
}

async function request(path, { method = 'GET', body } = {}) {
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
    throw error
  }
  return value
}

function VersionCell({ label, version, detail }) {
  return h('div', { className: css.versionCell },
    h('span', { className: css.caption }, label),
    h('strong', { className: css.version }, display(version)),
    h('span', { className: css.detail }, display(detail)))
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
  const value = message.trim()
  return /^(?:[{}\[\]],?|"(?:[^"\\]|\\.)+"\s*:\s*.*)$/.test(value)
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
      if (
        next.value.source !== first.value.source
        || next.value.stream !== first.value.stream
        || logLevel(next.value) !== logLevel(first.value)
        || Date.parse(next.value.timestamp) - startedAt > 2_000
      ) break
      lines.push(next.value.message)
      try {
        const value = JSON.parse(lines.join('\n'))
        compacted.push({
          identity: entries.slice(index, end + 1).map(item => item.identity).join('|'),
          value: { ...first.value, message: JSON.stringify(value) },
        })
        index = end
        merged = true
        break
      } catch {}
    }
    if (!merged && !isJsonFragment(first.value.message)) compacted.push(first)
  }
  return compacted
}

function readLogDisplayLimit() {
  try {
    const value = Number(window.localStorage.getItem(LOG_DISPLAY_LIMIT_KEY))
    return LOG_DISPLAY_LIMITS.includes(value) ? value : DEFAULT_LOG_DISPLAY_LIMIT
  } catch { return DEFAULT_LOG_DISPLAY_LIMIT }
}

function limitProcessedLogEntries(entries, limit) {
  return compactLogEntries(entries).slice(-limit)
}

function readLogClearCutoff() {
  try {
    const value = window.sessionStorage.getItem(LOG_CLEAR_CUTOFF_KEY)
    return Number.isFinite(Date.parse(value)) ? value : null
  } catch { return null }
}

function latestLogCutoff(entries, now = Date.now()) {
  const latest = entries.reduce((value, entry) => {
    const timestamp = Date.parse(entry.value.timestamp)
    return Number.isFinite(timestamp) ? Math.max(value, timestamp) : value
  }, now)
  return new Date(latest).toISOString()
}

function isClearedLog(entry, cutoff) {
  const timestamp = Date.parse(entry.timestamp)
  return cutoff !== null && Number.isFinite(timestamp) && timestamp <= Date.parse(cutoff)
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

function LogViewer({ active, focusTaskId, t }) {
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [level, setLevel] = useState('all')
  const [streamState, setStreamState] = useState('connecting')
  const [streamRevision, setStreamRevision] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [displayLimit, setDisplayLimit] = useState(readLogDisplayLimit)
  const [expanded, setExpanded] = useState(() => new Set())
  const listRef = useRef(null)
  const resizeFrameRef = useRef(null)
  const clearCutoff = useRef(readLogClearCutoff())
  const logIdentities = useRef(new Set())
  const pendingEntries = useRef([])
  const renderFrame = useRef()

  useEffect(() => {
    if (focusTaskId) setQuery(String(focusTaskId))
  }, [focusTaskId])

  useEffect(() => {
    if (!active) return undefined
    setStreamState('connecting')
    const stream = new EventSource(`${API}/logs/stream?limit=${String(LOG_STREAM_LIMIT)}`)
    let lastActivity = Date.now()
    const commitPendingEntries = () => {
      renderFrame.current = undefined
      const pending = pendingEntries.current.splice(0)
      if (pending.length === 0) return
      setEntries(previous => {
        const combined = [...previous, ...pending]
        const removed = combined.slice(0, Math.max(0, combined.length - LOG_STREAM_LIMIT))
        for (const entry of removed) logIdentities.current.delete(entry.identity)
        return combined.slice(-LOG_STREAM_LIMIT)
      })
    }
    stream.addEventListener('log', event => {
      lastActivity = Date.now()
      try {
        const entry = JSON.parse(event.data)
        const identity = JSON.stringify(entry)
        if (isClearedLog(entry, clearCutoff.current) || logIdentities.current.has(identity)) return
        logIdentities.current.add(identity)
        pendingEntries.current.push({ identity, value: entry })
        if (renderFrame.current === undefined) {
          renderFrame.current = window.requestAnimationFrame(commitPendingEntries)
        }
      } catch {}
    })
    stream.addEventListener('heartbeat', () => { lastActivity = Date.now() })
    stream.onopen = () => {
      lastActivity = Date.now()
      setStreamState('live')
    }
    stream.onerror = () => setStreamState('disconnected')
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastActivity > 35_000) setStreamRevision(value => value + 1)
    }, 5_000)
    return () => {
      window.clearInterval(watchdog)
      stream.close()
      if (renderFrame.current !== undefined) window.cancelAnimationFrame(renderFrame.current)
      for (const entry of pendingEntries.current.splice(0)) logIdentities.current.delete(entry.identity)
      renderFrame.current = undefined
    }
  }, [active, streamRevision])

  const visibleEntries = limitProcessedLogEntries(entries, displayLimit)
  const sources = [...new Set(visibleEntries.map(item => item.value.source).filter(Boolean))].sort()
  const normalizedQuery = query.trim().toLocaleLowerCase(t('localeCode') === 'en' ? 'en-US' : 'zh-CN')
  const filtered = visibleEntries.filter(item => {
    const entry = item.value
    return (source === 'all' || entry.source === source)
      && (level === 'all' || logLevel(entry) === level)
      && (normalizedQuery === '' || JSON.stringify(entry).toLocaleLowerCase().includes(normalizedQuery))
  })
  const hasFilteredEntries = filtered.length > 0
  const exportEntries = entries.slice(-displayLimit).map(item => item.value).filter(entry => (source === 'all' || entry.source === source)
    && (level === 'all' || logLevel(entry) === level)
    && (normalizedQuery === '' || JSON.stringify(entry).toLocaleLowerCase().includes(normalizedQuery)))

  useEffect(() => {
    const frame = resizeFrameRef.current
    if (!active || !hasFilteredEntries || frame === null) return undefined
    const handle = frame.querySelector(`.${css.logResizeHandle}`)
    const scrollContainer = frame.closest(`.${css.tabPanel}`)
    if (handle === null) return undefined
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
    const keepBottomVisible = () => {
      if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = undefined
        if (scrollContainer === null) return
        const overflow = frame.getBoundingClientRect().bottom - scrollContainer.getBoundingClientRect().bottom + 8
        if (overflow <= 0) return
        const previousScrollTop = scrollContainer.scrollTop
        scrollContainer.scrollTop += Math.min(overflow, 24)
        const height = Math.min(maximumHeight, Math.max(minimumHeight,
          startHeight + lastClientY - startY + scrollContainer.scrollTop - startScrollTop))
        frame.style.height = `${String(height)}px`
        if (scrollContainer.scrollTop > previousScrollTop
          && (pointerId === undefined || lastClientY >= scrollContainer.getBoundingClientRect().bottom - 24)) keepBottomVisible()
      })
    }
    const startResize = event => {
      event.preventDefault()
      pointerId = event.pointerId
      startY = event.clientY
      lastClientY = event.clientY
      startHeight = frame.getBoundingClientRect().height
      startScrollTop = scrollContainer?.scrollTop ?? 0
      const style = window.getComputedStyle(frame)
      minimumHeight = Number.parseFloat(style.minHeight)
      maximumHeight = Number.parseFloat(style.maxHeight)
      previousCursor = document.body.style.cursor
      previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)
    }
    const resize = event => {
      if (pointerId === undefined || event.pointerId !== pointerId) return
      lastClientY = event.clientY
      const height = Math.min(maximumHeight, Math.max(minimumHeight,
        startHeight + lastClientY - startY + (scrollContainer?.scrollTop ?? 0) - startScrollTop))
      frame.style.height = `${String(height)}px`
      keepBottomVisible()
    }
    const finishResize = event => {
      if (pointerId === undefined || event.pointerId !== pointerId) return
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      pointerId = undefined
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      keepBottomVisible()
    }
    handle.addEventListener('pointerdown', startResize)
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      handle.removeEventListener('pointerdown', startResize)
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
      if (pointerId !== undefined) {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
      }
    }
  }, [active, hasFilteredEntries])

  useEffect(() => {
    if (!active || !autoScroll || listRef.current === null) return undefined
    let layoutFrame
    const visibilityFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        if (listRef.current !== null) listRef.current.scrollTop = listRef.current.scrollHeight
      })
    })
    return () => {
      window.cancelAnimationFrame(visibilityFrame)
      if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame)
    }
  }, [active, autoScroll, displayLimit, entries, level, query, source])

  const clearLogView = () => {
    clearCutoff.current = latestLogCutoff([...entries, ...pendingEntries.current])
    try { window.sessionStorage.setItem(LOG_CLEAR_CUTOFF_KEY, clearCutoff.current) } catch {}
    if (renderFrame.current !== undefined) window.cancelAnimationFrame(renderFrame.current)
    renderFrame.current = undefined
    pendingEntries.current.length = 0
    logIdentities.current.clear()
    setExpanded(new Set())
    setEntries([])
  }

  const changeDisplayLimit = event => {
    const value = Number(event.target.value)
    if (!LOG_DISPLAY_LIMITS.includes(value)) return
    setDisplayLimit(value)
    try { window.localStorage.setItem(LOG_DISPLAY_LIMIT_KEY, String(value)) } catch {}
  }

  return h('section', { className: `${css.section} ${css.logSection}`, 'aria-labelledby': 'platform-logs-title' },
    h('div', { className: css.sectionHeading },
      h('div', null,
        h('h3', { id: 'platform-logs-title' }, t('logs')),
        h('p', null, t('logsDetail'))),
      h('div', { className: css.logTools },
        h('span', { className: `${css.logConnection} ${css[streamState]}`, role: 'status' },
          h('span', { 'aria-hidden': 'true' }),
          t(`logs${streamState[0].toUpperCase()}${streamState.slice(1)}`)),
        h('button', {
          type: 'button',
          className: css.autoScrollButton,
          onClick: () => setStreamRevision(value => value + 1),
        }, t('refreshLogs')),
        h('button', {
          type: 'button',
          className: css.clearLogsButton,
          disabled: exportEntries.length === 0,
          onClick: () => downloadLogJsonl(exportEntries),
        }, t('exportLogs')),
        h('button', {
          type: 'button',
          className: css.clearLogsButton,
          disabled: entries.length === 0,
          onClick: clearLogView,
        }, t('clearLogView')))),
    h('div', { className: css.logFilters },
      h('input', {
        type: 'search',
        value: query,
        placeholder: t('searchLogs'),
        'aria-label': t('searchLogs'),
        onChange: event => setQuery(event.target.value),
      }),
      h('select', { value: source, 'aria-label': t('logSource'), onChange: event => setSource(event.target.value) },
        h('option', { value: 'all' }, t('allSources')),
        sources.map(value => h('option', { key: value, value }, value))),
      h('select', { value: level, 'aria-label': t('logLevel'), onChange: event => setLevel(event.target.value) },
        ['all', 'debug', 'info', 'warning', 'error'].map(value => h('option', { key: value, value }, t(`level${value[0].toUpperCase()}${value.slice(1)}`)))),
      h('select', { value: displayLimit, 'aria-label': t('logDisplayLimit'), onChange: changeDisplayLimit },
        LOG_DISPLAY_LIMITS.map(value => h('option', { key: value, value }, t('logDisplayLimitValue').replace('{count}', String(value))))),
    ),
    h('div', { className: css.logSummaryRow },
      h('div', { className: css.logSummary }, t('logCount').replace('{shown}', String(filtered.length)).replace('{total}', String(displayLimit))),
      h('label', { className: css.logAutoScroll },
        h('input', {
          type: 'checkbox',
          checked: autoScroll,
          'aria-label': t('autoScroll'),
          onChange: event => setAutoScroll(event.target.checked),
        }),
        h('span', { 'aria-hidden': 'true' }),
        h('b', null, t('autoScroll')))),
    filtered.length === 0
      ? h('p', { className: css.emptyLogs }, visibleEntries.length === 0 ? t('noLogs') : t('noMatchingLogs'))
      : h('div', { className: css.logResizeFrame, ref: resizeFrameRef },
        h('div', { className: css.logList, ref: listRef }, filtered.map(item => {
          const entry = item.value
          const entryLevel = logLevel(entry)
          const isExpanded = expanded.has(item.identity)
          const toggle = () => setExpanded(value => {
            const next = new Set(value)
            if (next.has(item.identity)) next.delete(item.identity); else next.add(item.identity)
            return next
          })
          return h('article', {
            className: css.logEntry,
            key: item.identity,
            role: 'button',
            tabIndex: 0,
            'aria-expanded': isExpanded,
            onClick: toggle,
            onKeyDown: event => {
              if (!['Enter', ' '].includes(event.key)) return
              event.preventDefault()
              toggle()
          },
            },
            h('div', { className: css.logMeta },
              h('strong', { className: `${css.logLevel} ${css[`log${entryLevel[0].toUpperCase()}${entryLevel.slice(1)}`]}` }, t(`level${entryLevel[0].toUpperCase()}${entryLevel.slice(1)}`)),
              h('span', { className: css.logSource }, display(entry.source)),
              h('time', { dateTime: entry.timestamp }, localTime(entry.timestamp, t('localeCode')))),
            h('div', { className: css.logMessageRow },
              h('pre', null, display(entry.message)),
              h('span', { className: css.logChevron, 'aria-hidden': true })),
            isExpanded ? h('pre', { className: css.logDetails }, JSON.stringify(entry, null, 2)) : null)
        })),
        h('span', { className: css.logResizeHandle, 'aria-hidden': true })))
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

function parsedStorage(key) {
  try { return JSON.parse(storageValue(key) ?? 'null') } catch { return null }
}

function candidateIdentity(candidate) {
  return candidate.kind === 'stable'
    ? `stable:${String(candidate.targetSequence)}`
    : `upstream:${candidate.version}`
}

function eligibleCandidates(status) {
  if (status?.automaticCheck?.notificationsEnabled !== true) return []
  const candidates = []
  if (status?.latestAutomatic?.stable !== null && status?.latestAutomatic?.stable !== undefined) {
    candidates.push({ kind: 'stable', ...status.latestAutomatic.stable })
  }
  const upstream = status?.latestAutomatic?.upstream
  const held = upstream !== null && upstream !== undefined && (status?.holds ?? []).some(hold => hold.dshVersion === upstream.version)
  if (status?.updateChannel === 'experimental' && upstream !== null && upstream !== undefined && !held) {
    candidates.push({ kind: 'upstream', ...upstream })
  }
  return candidates.filter(candidate => storageValue(`dsh-platform:update-notice-dismissed:${candidate.kind}`) !== candidateIdentity(candidate))
}

function clearSatisfiedDismissals(status) {
  if (status?.update?.status !== 'success') return
  const completion = status.update.taskId ?? status.update.updatedAt
  if (completion === undefined || completion === null || storageValue('dsh-platform:update-notice-cleared-completion') === completion) return
  writeStorage('dsh-platform:update-notice-dismissed:stable', null)
  writeStorage('dsh-platform:update-notice-dismissed:upstream', null)
  writeStorage('dsh-platform:update-notice-cleared-completion', completion)
}

function UpdateReminder({ t }) {
  const [status, setStatus] = useState(null)
  const [tick, setTick] = useState(0)
  const [ownsNotice, setOwnsNotice] = useState(false)
  const ownerId = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

  const refresh = useCallback(async () => {
    try {
      const value = await request('status')
      clearSatisfiedDismissals(value)
      setStatus(value)
      return value
    } catch {}
    return undefined
  }, [])

  useEffect(() => {
    const unsubscribeEvents = subscribePlatformStateEvents({ state: () => { void refresh() } })
    const refreshAndConnect = async () => {
      await refresh()
    }
    void refreshAndConnect()
    const timer = window.setInterval(() => { void refreshAndConnect() }, 30_000)
    const changed = () => setTick(value => value + 1)
    const visibilityChanged = () => {
      if (document.visibilityState !== 'visible' && parsedStorage(NOTICE_OWNER_KEY)?.id === ownerId.current) {
        writeStorage(NOTICE_OWNER_KEY, null)
      }
      changed()
    }
    const leaseTimer = window.setInterval(changed, NOTICE_OWNER_TTL / 2)
    window.addEventListener('storage', changed)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      unsubscribeEvents()
      window.clearInterval(timer)
      window.clearInterval(leaseTimer)
      window.removeEventListener('storage', changed)
      document.removeEventListener('visibilitychange', visibilityChanged)
      const owner = parsedStorage(NOTICE_OWNER_KEY)
      if (owner?.id === ownerId.current) writeStorage(NOTICE_OWNER_KEY, null)
    }
  }, [refresh])

  const candidate = eligibleCandidates(status)[0]
  const identity = candidate === undefined ? null : candidateIdentity(candidate)

  useEffect(() => {
    if (identity === null || document.visibilityState !== 'visible') {
      setOwnsNotice(false)
      return
    }
    const now = Date.now()
    const snooze = parsedStorage(NOTICE_SNOOZE_KEY)
    const owner = parsedStorage(NOTICE_OWNER_KEY)
    const available = !(snooze?.identity === identity && snooze.until > now)
      && (owner?.id === ownerId.current || owner?.expiresAt <= now || owner === null)
    if (available) writeStorage(NOTICE_OWNER_KEY, JSON.stringify({ id: ownerId.current, expiresAt: now + NOTICE_OWNER_TTL }))
    setOwnsNotice(available)
  }, [identity, tick])

  useEffect(() => {
    if (!ownsNotice) return undefined
    const timer = window.setInterval(() => {
      writeStorage(NOTICE_OWNER_KEY, JSON.stringify({ id: ownerId.current, expiresAt: Date.now() + NOTICE_OWNER_TTL }))
    }, NOTICE_OWNER_TTL / 2)
    return () => window.clearInterval(timer)
  }, [identity, ownsNotice])

  if (!ownsNotice || candidate === undefined) return null
  const dismiss = permanent => {
    if (permanent) writeStorage(`dsh-platform:update-notice-dismissed:${candidate.kind}`, identity)
    else writeStorage(NOTICE_SNOOZE_KEY, JSON.stringify({ identity, until: Date.now() + 3_600_000 }))
    writeStorage(NOTICE_OWNER_KEY, null)
    setTick(tick + 1)
  }
  return h('aside', { className: css.updateReminder, role: 'status', 'aria-live': 'polite' },
    h('strong', null, candidate.kind === 'stable' ? t('stableNoticeTitle') : t('upstreamNoticeTitle')),
    h('p', null, candidate.kind === 'stable'
      ? t('stableNoticeBody').replace('{version}', candidate.dsh)
      : t('upstreamNoticeBody').replace('{version}', candidate.version)),
    h('div', { className: css.reminderActions },
      h('button', { type: 'button', onClick: () => dismiss(false) }, t('later')),
      h('button', { type: 'button', onClick: () => dismiss(true) }, t('dismissVersion'))))
}

function LifecycleGuard({ connection }) {
  useEffect(() => {
    let stopped = false
    let navigating = false
    let hadConnection = connection.hostDescription.getSnapshot() !== undefined
    let graceTimer
    let retryTimer

    const clearTimers = () => {
      window.clearTimeout(graceTimer)
      window.clearTimeout(retryTimer)
      graceTimer = undefined
      retryTimer = undefined
    }
    const navigate = () => {
      if (stopped || navigating || window.location.pathname === LIFECYCLE_WAIT_PATH) return
      navigating = true
      window.location.replace(lifecycleWaitUrl())
    }
    const scheduleReadiness = () => {
      if (stopped || retryTimer !== undefined) return
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        void verifyReadiness()
      }, READINESS_RETRY_MS)
    }
    const verifyReadiness = async () => {
      if (stopped || connection.hostDescription.getSnapshot() !== undefined) return
      try {
        const response = await fetch(LIFECYCLE_READINESS_PATH, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (response.status === 503) {
          const value = await response.json().catch(() => ({}))
          if (value.state !== undefined && value.state !== 'unknown') navigate()
          else scheduleReadiness()
          return
        }
      } catch {}
      scheduleReadiness()
    }
    const inspectPlatformState = async () => {
      try {
        if (requiresLifecycleHoldingPage(await request('status'))) navigate()
      } catch {}
    }
    const connectionChanged = () => {
      if (connection.hostDescription.getSnapshot() !== undefined) {
        hadConnection = true
        clearTimers()
        return
      }
      if (!hadConnection || graceTimer !== undefined) return
      graceTimer = window.setTimeout(() => {
        graceTimer = undefined
        void verifyReadiness()
      }, CONNECTION_LOSS_GRACE_MS)
    }

    const unsubscribe = connection.hostDescription.subscribe(connectionChanged)
    const unsubscribeEvents = subscribePlatformStateEvents({ state: () => { void inspectPlatformState() } })
    void inspectPlatformState()
    connectionChanged()
    return () => {
      stopped = true
      clearTimers()
      unsubscribe()
      unsubscribeEvents()
    }
  }, [connection])
  return null
}

function systemPluginSummary(progress, draft, t) {
  if (progress?.phase === 'restarting') return t('systemPluginRestarting')
  if (progress?.phase === 'applying') {
    const actionKey = {
      install: 'pluginActionInstall', uninstall: 'pluginActionUninstall', enable: 'pluginActionEnable', disable: 'pluginActionDisable',
    }[progress.action]
    return t('systemPluginApplyingItem', {
      action: t(actionKey ?? 'pluginActionWorking'), id: progress.id, current: progress.current, total: progress.total,
    })
  }
  return draft.size > 0 ? t('pendingSystemPluginChanges', { count: draft.size }) : t('pluginChangesPendingDetail')
}

function SystemPluginManager({ plugins, draft, applyingDraft, progress, operation, busy, error, onAction, onCancel, onApply, t }) {
  const operationBusy = operation?.status === 'running'
  const [query, setQuery] = useState('')
  const filteredPlugins = plugins.filter(plugin => matchesResourceSearch(query, [plugin.id, plugin.description?.zh, plugin.description?.en]))
  const pagination = usePaginatedItems('system-plugins', filteredPlugins)
  const visiblePlugins = pagination.items
  const restartRequired = draft.size > 0 || plugins.some(plugin => plugin.pendingRestart) || progress !== null
  return h('section', { className: `${css.section} ${css.pluginSection}`, 'aria-labelledby': 'system-plugins-title' },
    h('div', { className: `${css.sectionHeading} ${css.resourceSectionHeading}` },
      h('h3', { id: 'system-plugins-title' }, t('systemPlugins')),
      h('div', { className: css.resourceHeadingDetail },
        h('p', null, t('systemPluginsDetail')),
        h('input', {
          type: 'search', className: css.resourceSearch, value: query, placeholder: t('searchSystemPlugins'), 'aria-label': t('searchSystemPlugins'),
          onChange: event => { setQuery(event.target.value); pagination.setPage(0) },
        }))),
    restartRequired ? h('div', { className: css.pluginRestartNotice, role: 'status' },
      h('div', null,
        h('strong', null, t('pluginChangesPending')),
        h('p', null, systemPluginSummary(progress, draft, t))),
      h('div', { className: css.pluginDraftActions },
        h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: onCancel }, t('cancelChanges')),
        h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: onApply }, t('applyPluginChanges')))) : null,
    h('div', { className: css.pluginList },
      visiblePlugins.length === 0
        ? h('p', { className: css.emptyPlugins }, plugins.length === 0 ? t('noSystemPlugins') : t('noMatchingResources'))
        : visiblePlugins.map(plugin => {
            const action = draft.get(plugin.id)
            const projected = action === 'install' ? { ...plugin, installed: true, enabled: true }
              : action === 'enable' ? { ...plugin, enabled: true }
                : action === 'disable' ? { ...plugin, enabled: false } : plugin
            const isActive = operationBusy && operation.pluginId === plugin.id
            const applyingAction = restartRequired
              ? applyingDraft.get(plugin.id) ?? (isActive ? operation.action : undefined)
              : isActive ? operation.action : undefined
            const description = plugin.description?.[t('localeCode')] ?? plugin.id
            const stateKey = applyingAction !== undefined
              ? { install: 'statusInstalling', uninstall: 'statusUninstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[applyingAction]
              : action !== undefined
                ? { install: 'pendingInstall', uninstall: 'pendingUninstall', enable: 'pendingEnable', disable: 'pendingDisable' }[action]
              : plugin.installed ? (plugin.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
            return h('article', { className: css.pluginRow, key: plugin.id },
              h('div', { className: css.pluginIdentity },
                h('div', { className: css.resourceHeading },
                  h(ResourceStatusBadge, { label: t(stateKey ?? 'pluginActionWorking'), enabled: applyingAction === undefined && action === undefined && plugin.enabled, pending: applyingAction !== undefined || action !== undefined }),
                  h('strong', null, `@dsh-docker/${plugin.id}`)),
                h(ExpandableDescription, { text: description, identity: plugin.id })),
              !projected.installed
                ? h('div', { className: css.pluginActions },
                    h('button', {
                      type: 'button',
                      className: css.primaryButton,
                      disabled: busy,
                      onClick: () => onAction(plugin, 'install'),
                    }, t('installPlugin')))
                : plugin.protected
                ? h('span', { className: css.managedBadge }, t('managed'))
                : h('div', { className: css.pluginActions },
                    h('label', { className: css.toggle },
                      h('input', {
                        type: 'checkbox',
                        checked: projected.enabled,
                        disabled: busy || action === 'install',
                        onChange: event => onAction(plugin, event.target.checked ? 'enable' : 'disable'),
                      }),
                      h('span', { 'aria-hidden': 'true' }))))
          })),
    h(ListPagination, { pagination, total: filteredPlugins.length, t }),
    operation?.status === 'failed'
      ? h('p', { className: css.error, role: 'alert' }, localizedError(operation.error, t))
      : error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t))
      : null)
}

function SystemSkillManager({ skills, operation, busy, error, onAction, t }) {
  const operationBusy = operation?.status === 'running'
  const [query, setQuery] = useState('')
  const filteredSkills = skills.filter(skill => matchesResourceSearch(query, [skill.id, skill.description?.zh, skill.description?.en]))
  const pagination = usePaginatedItems('system-skills', filteredSkills)
  return h('section', { className: `${css.section} ${css.pluginSection}`, 'aria-labelledby': 'system-skills-title' },
    h('div', { className: `${css.sectionHeading} ${css.resourceSectionHeading}` },
      h('h3', { id: 'system-skills-title' }, t('systemSkills')),
      h('div', { className: css.resourceHeadingDetail },
        h('p', null, t('systemSkillsDetail')),
        h('input', {
          type: 'search', className: css.resourceSearch, value: query, placeholder: t('searchSystemSkills'), 'aria-label': t('searchSystemSkills'),
          onChange: event => { setQuery(event.target.value); pagination.setPage(0) },
        }))),
    h('div', { className: css.pluginList },
      filteredSkills.length === 0
        ? h('p', { className: css.emptyPlugins }, skills.length === 0 ? t('noSystemSkills') : t('noMatchingResources'))
        : pagination.items.map(skill => {
            const isActive = operationBusy && operation.skillId === skill.id
            const stateKey = isActive
              ? { install: 'statusInstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[operation.action]
              : skill.installed ? (skill.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
            return h('article', { className: css.pluginRow, key: skill.id },
              h('div', { className: css.pluginIdentity },
                h('div', { className: css.resourceHeading },
                  h(ResourceStatusBadge, { label: t(stateKey ?? 'skillActionWorking'), enabled: !isActive && skill.enabled, pending: isActive }),
                  h('strong', null, skill.id)),
                h(ExpandableDescription, { text: skill.description?.[t('localeCode')] ?? skill.id, identity: skill.id })),
              !skill.installed
                ? h('div', { className: css.pluginActions },
                    h('button', {
                      type: 'button', className: css.primaryButton, disabled: busy,
                      onClick: () => onAction(skill, 'install'),
                    }, t('installPlugin')))
                : h('div', { className: css.pluginActions },
                    h('label', { className: css.toggle },
                      h('input', {
                        type: 'checkbox', checked: skill.enabled, disabled: busy,
                        onChange: event => onAction(skill, event.target.checked ? 'enable' : 'disable'),
                      }),
                      h('span', { 'aria-hidden': 'true' }))))
          })),
    h(ListPagination, { pagination, total: filteredSkills.length, t }),
    operation?.status === 'failed'
      ? h('p', { className: css.error, role: 'alert' }, localizedError(operation.error, t))
      : error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t)) : null)
}

function transactionStageState(index, currentIndex, status) {
  if (index < currentIndex || (index === currentIndex && status === 'success')) return 'completed'
  if (index === currentIndex) return status === 'failed' ? 'failed' : 'active'
  return 'pending'
}

function TransactionStageLogs({ update, visible, t, onViewFullLog }) {
  const [entries, setEntries] = useState([])
  const [expanded, setExpanded] = useState({})
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const touched = useRef(new Set())
  const identities = useRef(new Set())
  const previousStage = useRef()
  const activeList = useRef(null)
  const phase = update?.phase ?? (isRecoveryOperation(update?.operation) ? update.rollbackPhase : update?.status)
  const model = updateProgressModel(update ?? {}, t)
  const currentStage = transactionLogStage(phase, update, t)
  useEffect(() => {
    if (!visible || !update?.taskId || !phase) {
      setEntries([])
      return undefined
    }
    setEntries([])
    setExpanded({ [currentStage.key]: update.status !== 'success' })
    touched.current.clear()
    identities.current.clear()
    previousStage.current = currentStage.key
    const params = new URLSearchParams({ taskId: String(update.taskId), operation: String(update.operation ?? 'update'), limit: '1000' })
    const stream = new EventSource(`${API}/logs/stream?${params.toString()}`)
    stream.addEventListener('log', event => {
      try {
        const entry = JSON.parse(event.data)
        const identity = JSON.stringify(entry)
        if (identities.current.has(identity)) return
        identities.current.add(identity)
        setEntries(previous => [...previous, entry].slice(-1000))
      } catch {}
    })
    return () => stream.close()
  }, [update?.taskId, visible])
  useEffect(() => {
    const prior = previousStage.current
    setExpanded(value => {
      const next = { ...value }
      if (prior !== undefined && prior !== currentStage.key && !touched.current.has(prior)) next[prior] = false
      if (update.status === 'success') {
        touched.current.delete(currentStage.key)
        next[currentStage.key] = false
      } else if (!touched.current.has(currentStage.key)) {
        next[currentStage.key] = true
      }
      return next
    })
    previousStage.current = currentStage.key
  }, [currentStage.key, update.status])
  useEffect(() => {
    if (!autoScroll || !expanded[currentStage.key]) return
    activeList.current?.scrollTo({ top: activeList.current.scrollHeight })
  }, [autoScroll, currentStage.key, entries, expanded])
  if (!visible || !update?.taskId || !phase) return null
  const groupPrefix = isRecoveryOperation(update?.operation) ? 'rollback' : 'update'
  const groups = new Map(model.labels.map((label, index) => [`${groupPrefix}:${String(index)}`, {
    key: `${groupPrefix}:${String(index)}`,
    label: t(label),
    labelKey: label,
    index,
    entries: [],
  }]))
  for (const entry of entries) {
    const stage = transactionLogStage(entry.phase, update, t)
    const group = groups.get(stage.key) ?? { ...stage, entries: [] }
    group.entries.push(entry)
    groups.set(stage.key, group)
  }
  const orderedGroups = [...groups.values()].sort((left, right) => left.index - right.index)
  const currentEntries = groups.get(currentStage.key)?.entries ?? []
  const toggleStage = key => {
    touched.current.add(key)
    setExpanded(value => ({ ...value, [key]: !(value[key] ?? key === currentStage.key) }))
  }
  const copyCurrent = async () => {
    if (currentEntries.length === 0) return
    try {
      await navigator.clipboard.writeText(currentEntries.map(entry => JSON.stringify(entry)).join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {}
  }
  return h('div', { className: css.progressStageLog },
    h('div', { className: css.progressLogList, role: 'log' }, orderedGroups.map(group => {
      const state = transactionStageState(group.index, model.stage, update.status)
      const isExpanded = expanded[group.key] ?? (state === 'active' || state === 'failed')
      const latest = group.entries.at(-1)
      const metricSource = state === 'active' || state === 'failed' ? { ...latest, ...update } : latest
      const metricLines = stageMetricLines(metricSource, group, state, t)
      const metricProgress = state === 'active' ? stageMetricProgress(metricSource) : undefined
      const items = stageItems(group, update, state, t)
      const completedItems = items.filter(item => item.state === 'completed').length
      return h('section', { className: `${css.progressLogGroup} ${css[`progressStage${state[0].toUpperCase()}${state.slice(1)}`]}`, key: group.key },
        h('span', { className: `${css.progressStageMarker} ${css[`progressStageMarker${state[0].toUpperCase()}${state.slice(1)}`]}`, 'aria-hidden': 'true' }),
        h('div', { className: css.progressStageHeader },
          h('div', { className: css.progressStageSummary },
            h('strong', null, group.label),
            h('span', { className: css.progressStageCount }, t('stageItemsCompleted').replace('{completed}', String(completedItems)).replace('{total}', String(items.length)))),
          h('button', { type: 'button', className: css.progressStageToggle, 'aria-expanded': isExpanded, onClick: () => toggleStage(group.key) },
            t(isExpanded ? 'collapseStage' : 'expandStage').replace('{count}', String(group.entries.length)))),
        isExpanded ? h(React.Fragment, null,
          h('div', { className: css.progressStageItems }, items.map(item => h('div', { className: `${css.progressStageItem} ${css[`progressStageItem${item.state[0].toUpperCase()}${item.state.slice(1)}`]}`, key: item.key },
            h('span', { className: css.progressStageItemMarker, 'aria-hidden': 'true' }),
            h('span', null, t({ completed: 'stageItemCompleted', active: 'stageItemActive', failed: 'stageItemFailed', pending: 'stageItemPending' }[item.state]).replace('{item}', item.label)),
            item.state === 'active' || item.state === 'failed' ? metricLines.map(line => h('span', { className: css.progressStageMetric, key: line }, line)) : null,
            item.state === 'active' && metricProgress !== undefined ? h('span', { className: css.progressStagePercent }, t('stageProgress').replace('{progress}', String(metricProgress))) : null))),
          state === 'failed' ? h('p', { className: css.progressStageError }, localizedError(update.error ?? latest?.error ?? t('statusFailed'), t)) : null,
          h('div', { className: `${css.progressLogGroupList}${group.entries.length > 0 ? ` ${css.progressLogGroupListPopulated}` : ''}`, ref: group.key === currentStage.key ? activeList : undefined }, group.entries.length === 0
            ? h('p', { className: css.progressLogEmpty }, t('noStageLogs'))
            : group.entries.slice(-200).map((entry, index) => h('details', { className: css.progressLogEntry, key: `${entry.timestamp ?? ''}-${index}` },
              h('summary', null,
                h('span', { className: `${css.progressLogLevel} ${css[String(entry.level ?? 'info').toLowerCase()] ?? ''}` }, (() => { const level = String(entry.level ?? 'info').toLowerCase(); return t(`level${level[0].toUpperCase()}${level.slice(1)}`) })()),
                h('span', { className: css.progressLogSource }, String(entry.source ?? '-')),
                h('time', null, localTime(entry.timestamp, t('localeCode'))),
                h('span', { className: css.progressLogMessage }, String(entry.message ?? '-').replace(/\s+/gu, ' ')),
                h('span', { className: css.progressLogChevron, 'aria-hidden': 'true' })),
              h('pre', null, JSON.stringify(entry, null, 2))))),
          group.key === currentStage.key ? h('div', { className: css.progressLogActions },
            h('label', { className: css.progressAutoScroll },
              h('input', { type: 'checkbox', checked: autoScroll, onChange: event => setAutoScroll(event.target.checked) }),
              h('span', null, t('autoScroll'))),
            h('button', { type: 'button', className: css.smallButton, disabled: currentEntries.length === 0, onClick: copyCurrent }, t(copied ? 'logsCopied' : 'copyStageLogs'))) : null) : null)
    })),
    h('button', { type: 'button', className: css.progressFullLog, onClick: onViewFullLog }, t('viewFullTransactionLog')))
}

const PROXY_SCOPES = Object.freeze([
  ['updates', 'proxyScopeUpdates', 'proxyScopeUpdatesDetail'],
  ['platform', 'proxyScopePlatform', 'proxyScopePlatformDetail'],
  ['dshCore', 'proxyScopeDshCore', 'proxyScopeDshCoreDetail'],
  ['dshPlugins', 'proxyScopeDshPlugins', 'proxyScopeDshPluginsDetail'],
  ['agentNetwork', 'proxyScopeAgent', 'proxyScopeAgentDetail'],
  ['managementTerminal', 'proxyScopeTerminal', 'proxyScopeTerminalDetail'],
])
const PROXY_TEST_LABELS = Object.freeze({
  'proxy-address': 'proxyStageAddress', 'proxy-connect': 'proxyStageConnect',
  'proxy-handshake': 'proxyStageHandshake', 'target-dns': 'proxyStageDns',
  'target-tls': 'proxyStageTls', 'target-http': 'proxyStageHttp',
})

function proxyLines(value) {
  return String(value ?? '').split(/\r?\n/u).map(entry => entry.trim()).filter(Boolean)
}

function ProxySettings({ active, t }) {
  const [configuration, setConfiguration] = useState(null)
  const [providers, setProviders] = useState([])
  const [noProxyText, setNoProxyText] = useState('')
  const [bypassText, setBypassText] = useState('')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [task, setTask] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const scopeDialog = useRef(null)

  const load = useCallback(async () => {
    try {
      const [next, inventory, platformStatus] = await Promise.all([
        request('proxy'), request('proxy/provider-inventory'), request('status'),
      ])
      setConfiguration(next)
      setNoProxyText((next.noProxy?.user ?? []).join('\n'))
      setBypassText((next.bypass?.additional ?? []).join('\n'))
      setProviders(inventory.providers ?? [])
      setError('')
      const activeTask = platformStatus?.proxyTestOperation
      if (activeTask?.status === 'running' && activeTask.taskId) {
        setTask(await request(`proxy/test/tasks/${activeTask.taskId}`))
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  useEffect(() => {
    if (active) void load()
    else {
      setPassword('')
      setClearPassword(false)
    }
  }, [active, load])

  useEffect(() => {
    if (task?.status !== 'running') return undefined
    const timer = window.setTimeout(async () => {
      try { setTask(await request(`proxy/test/tasks/${task.taskId}`)) } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [task])

  useEffect(() => {
    if (task && task.status !== 'running') {
      setPassword('')
      setClearPassword(false)
    }
  }, [task])

  const patch = useCallback((path, value) => {
    setConfiguration(current => {
      const next = structuredClone(current)
      let target = next
      for (const part of path.slice(0, -1)) target = target[part]
      target[path.at(-1)] = value
      return next
    })
  }, [])

  if (configuration === null) return h('section', { className: css.section },
    h('h3', null, t('proxyTitle')),
    h('p', { className: error ? css.error : undefined }, error || t('proxyLoading')))

  const candidate = () => {
    const proxy = {
      protocol: configuration.proxy.protocol,
      host: configuration.proxy.host.trim(),
      port: configuration.proxy.port === '' ? null : Number(configuration.proxy.port),
      username: configuration.proxy.username,
      passwordConfigured: configuration.proxy.passwordConfigured === true,
      remoteDns: configuration.proxy.remoteDns === true,
    }
    if (clearPassword) proxy.clearPassword = true
    else if (password !== '') proxy.password = password
    return {
      schema: 1, enabled: configuration.enabled === true, proxy,
      scopes: Object.fromEntries(PROXY_SCOPES.map(([id]) => [id, configuration.scopes[id] === true])),
      environment: { allProxy: configuration.environment.allProxy },
      modelApi: configuration.modelApi,
      noProxy: { user: proxyLines(noProxyText) },
      bypass: { additional: proxyLines(bypassText) },
    }
  }

  const save = async () => {
    setBusy(true); setError(''); setResult(t('proxySaving'))
    try {
      const next = await request('proxy', { method: 'PUT', body: { baseRevision: configuration.revision, value: candidate() } })
      setConfiguration(next)
      setNoProxyText((next.noProxy?.user ?? []).join('\n'))
      setBypassText((next.bypass?.additional ?? []).join('\n'))
      setPassword('')
      setClearPassword(false)
      setResult(t('proxySaved'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError)); setResult('')
      if (nextError?.statusCode === 409) await load()
    } finally { setBusy(false) }
  }

  const startTest = async () => {
    setBusy(true); setError(''); setResult('')
    try {
      const started = await request('proxy/test', { method: 'POST', body: { baseRevision: configuration.revision, value: candidate() } })
      setTask(await request(`proxy/test/tasks/${started.taskId}`))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      if (nextError?.statusCode === 409) await load()
    } finally { setBusy(false) }
  }

  const cancelTest = async () => {
    if (!task?.taskId) return
    try { setTask(await request(`proxy/test/tasks/${task.taskId}`, { method: 'DELETE' })) } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  const taskRunning = task?.status === 'running'
  const localize = value => value?.[t('localeCode')] ?? value?.en ?? ''
  const catalog = configuration.scopeCatalog
  const catalogGroups = Object.entries(catalog?.groups ?? {})
  const catalogNodes = catalogGroups.map(([group, groupValue]) => h('section', { key: group },
    h('h4', null, localize(groupValue)),
    ...(catalog?.entries ?? []).filter(entry => entry.group === group).map(entry => h('div', { key: entry.id },
      h('span', null, localize(entry.source)), h('span', null, localize(entry.detail))))))
  const summaryNodes = (catalog?.summaries ?? []).map((summary, index) => h('p', { key: index }, localize(summary)))
  return h(React.Fragment, null,
    h('section', { className: css.section, 'aria-labelledby': 'platform-proxy-title' },
      h('div', { className: css.sectionHeading },
        h('div', null, h('h3', { id: 'platform-proxy-title' }, t('proxyTitle')), h('p', null, t('proxyDetail'))),
        h('label', { className: css.toggle },
          h('input', { type: 'checkbox', checked: configuration.enabled, onChange: event => patch(['enabled'], event.target.checked) }),
          h('span', { 'aria-hidden': 'true' }), h('b', null, t(configuration.enabled ? 'enabled' : 'disabled')))),
      h('p', { className: css.proxyHint }, t(configuration.componentReady ? 'proxyComponentReady' : 'proxyComponentUnavailable')),
      h('div', { className: css.proxyFormGrid },
        h('label', null, h('span', null, t('proxyProtocol')), h('select', { value: configuration.proxy.protocol, onChange: event => patch(['proxy', 'protocol'], event.target.value) }, h('option', { value: 'http' }, 'HTTP'), h('option', { value: 'socks5' }, 'SOCKS5'))),
        h('label', null, h('span', null, t('proxyHost')), h('input', { value: configuration.proxy.host, maxLength: 253, spellCheck: false, placeholder: '172.17.0.1', onChange: event => patch(['proxy', 'host'], event.target.value) })),
        h('label', null, h('span', null, t('proxyPort')), h('input', { type: 'number', min: 1, max: 65535, value: configuration.proxy.port ?? '', placeholder: '7890', onChange: event => patch(['proxy', 'port'], event.target.value) })),
        h('label', null, h('span', null, t('proxyUsername')), h('input', { value: configuration.proxy.username, maxLength: 255, autoComplete: 'off', onChange: event => patch(['proxy', 'username'], event.target.value) })),
        h('label', null, h('span', null, t('proxyPassword')), h('input', { type: 'password', value: password, disabled: clearPassword, maxLength: 255, autoComplete: 'new-password', placeholder: t('proxyPasswordPlaceholder'), onChange: event => setPassword(event.target.value) })),
        configuration.proxy.protocol === 'socks5' ? h('label', { className: css.proxyCheckRow }, h('input', { type: 'checkbox', checked: configuration.proxy.remoteDns, onChange: event => patch(['proxy', 'remoteDns'], event.target.checked) }), h('span', null, h('b', null, t('proxyRemoteDns')), h('small', null, t('proxyRemoteDnsDetail')))) : null),
      configuration.proxy.passwordConfigured ? h('label', { className: css.proxyCheckRow }, h('input', { type: 'checkbox', checked: clearPassword, onChange: event => { setClearPassword(event.target.checked); if (event.target.checked) setPassword('') } }), h('span', null, t('proxyClearPassword'))) : null,
      h('p', { className: css.proxyHint }, t(configuration.proxy.passwordConfigured ? 'proxyPasswordConfigured' : 'proxyPasswordNotConfigured')),
      location.protocol !== 'https:' && (password !== '' || configuration.proxy.username !== '') ? h('p', { className: css.notice }, t('proxyTransportWarning')) : null),

    h('section', { className: css.section, 'aria-labelledby': 'platform-proxy-scopes-title' },
      h('div', { className: css.sectionHeading }, h('div', null, h('h3', { id: 'platform-proxy-scopes-title' }, t('proxyScopes')), h('p', null, t('proxyScopesDetail'))), h('button', { type: 'button', className: css.secondaryButton, onClick: () => scopeDialog.current?.showModal() }, t('proxyScopeHelp'))),
      h('div', { className: css.proxyScopeGrid }, PROXY_SCOPES.map(([id, title, detail]) => h('label', { key: id }, h('input', { type: 'checkbox', checked: configuration.scopes[id], onChange: event => patch(['scopes', id], event.target.checked) }), h('span', null, h('b', null, t(title)), h('small', null, t(detail))))))),

    h('section', { className: css.section, 'aria-labelledby': 'platform-proxy-rules-title' },
      h('div', { className: css.sectionHeading }, h('div', null, h('h3', { id: 'platform-proxy-rules-title' }, t('proxyRules')), h('p', null, t('proxyRulesDetail')))),
      h('div', { className: css.proxyRulesGrid },
        h('label', null, h('span', null, t('proxyNoProxy')), h('textarea', { rows: 4, value: noProxyText, spellCheck: false, onChange: event => setNoProxyText(event.target.value) }), h('small', null, t('proxyNoProxyDetail'))),
        h('label', null, h('span', null, t('proxyBypass')), h('textarea', { rows: 4, value: bypassText, spellCheck: false, onChange: event => setBypassText(event.target.value) }), h('small', null, t('proxyBypassDetail')))),
      h('label', { className: css.proxyCheckRow }, h('input', { type: 'checkbox', checked: configuration.environment.allProxy === 'scope-proxy', onChange: event => patch(['environment', 'allProxy'], event.target.checked ? 'scope-proxy' : null) }), h('span', null, h('b', null, t('proxyAllProxy')), h('small', null, t('proxyAllProxyDetail'))))),

    h('section', { className: css.section, 'aria-labelledby': 'platform-proxy-providers-title' },
      h('div', { className: css.sectionHeading }, h('div', null, h('h3', { id: 'platform-proxy-providers-title' }, t('proxyProviders')), h('p', null, t('proxyProvidersDetail')))),
      providers.length === 0 ? h('p', { className: css.emptyPlugins }, t('proxyNoProviders')) : h('div', { className: css.proxyProviderList }, providers.map(provider => h('div', { className: css.proxyProvider, key: provider.id },
        h('div', null, h('b', null, provider.displayName), h('small', null, provider.routingCapability === 'forced-direct' ? t('proxyProviderReasonLocal') : provider.routingCapability === 'shared-dsh' ? t('proxyProviderReasonShared') : provider.id)),
        provider.routingCapability === 'provider' ? h('select', { value: configuration.modelApi.providers[provider.id] ?? configuration.modelApi.default, onChange: event => patch(['modelApi', 'providers', provider.id], event.target.value) }, h('option', { value: 'direct' }, t('proxyProviderDirect')), h('option', { value: 'proxy' }, t('proxyProviderIndependent'))) : h('span', { className: css.proxyCapability }, t(provider.routingCapability === 'forced-direct' ? 'proxyProviderDirect' : 'proxyProviderShared')))))),

    h('section', { className: css.section, 'aria-labelledby': 'platform-proxy-test-title' },
      h('div', { className: css.sectionHeading }, h('div', null, h('h3', { id: 'platform-proxy-test-title' }, t('proxyTest')), h('p', null, t('proxyTestDetail'))), h('div', { className: css.actions }, taskRunning ? h('button', { type: 'button', className: css.secondaryButton, onClick: () => { void cancelTest() } }, t('cancel')) : null, h('button', { type: 'button', className: css.secondaryButton, disabled: busy || taskRunning, onClick: () => { void startTest() } }, t('proxyTestStart')), h('button', { type: 'button', className: css.primaryButton, disabled: busy || taskRunning, onClick: () => { void save() } }, t('proxySave')))),
      task ? h('ol', { className: css.proxyTestStages }, task.stages.map(stage => h('li', { key: stage.stage, 'data-state': stage.status }, h('span', { 'aria-hidden': 'true' }), h('span', null, h('b', null, t(PROXY_TEST_LABELS[stage.stage])), h('small', null, stage.detail ?? stage.errorCode ?? '')), h('small', null, t(`proxyStage${stage.status[0].toUpperCase()}${stage.status.slice(1)}`))))) : null,
      result ? h('p', { className: css.proxyHint, role: 'status' }, result) : null,
      task && !taskRunning ? h('p', { className: task.status === 'success' ? css.proxyHint : css.error, role: 'status' }, task.status === 'success' ? t('proxyTestSuccess') : task.status === 'cancelled' ? t('proxyTestCancelled') : `${t('proxyTestFailed')}: ${task.error?.detail ?? task.error?.errorCode ?? ''}`) : null,
      error ? h('p', { className: css.error, role: 'alert' }, error) : null),

    h('dialog', { ref: scopeDialog, className: css.proxyScopeDialog },
      h('form', { method: 'dialog' },
        h('header', null,
          h('div', null, h('h3', null, t('proxyScopeGuideTitle')), h('p', null, t('proxyScopeGuideDetail'))),
          h('button', { value: 'cancel', className: css.secondaryButton }, t('close'))),
        h('div', { className: css.proxyScopeCatalog }, catalogNodes),
        h('div', { className: css.proxyScopeSummaries }, summaryNodes))))
}

function PlatformManagement({ t }) {
  const [activeTab, setActiveTab] = useState('maintenance')
  const [status, setStatus] = useState(null)
  const [plugins, setPlugins] = useState([])
  const [systemPluginDraft, setSystemPluginDraft] = useState(() => new Map())
  const [systemPluginApplyingDraft, setSystemPluginApplyingDraft] = useState(() => new Map())
  const [systemPluginProgress, setSystemPluginProgress] = useState(null)
  const [skills, setSkills] = useState([])
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [acting, setActing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [showSuccessfulProgress, setShowSuccessfulProgress] = useState(false)
  const [dismissedProgressTaskId, setDismissedProgressTaskId] = useState(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [focusedLogTaskId, setFocusedLogTaskId] = useState(null)
  const statusLoad = useRef()
  const statusLoadRevision = useRef(0)
  const inventoryLoads = useRef({ plugins: undefined, skills: undefined })
  const inventoryLoadRevisions = useRef({ plugins: 0, skills: 0 })
  const activeTabRef = useRef(activeTab)
  const tabsRef = useRef(null)
  activeTabRef.current = activeTab

  useEffect(() => makeHorizontalTabStripScrollable(tabsRef.current), [])

  const refresh = useCallback(() => {
    statusLoadRevision.current += 1
    if (statusLoad.current !== undefined) return statusLoad.current
    statusLoad.current = (async () => {
      let value
      let loadedRevision
      do {
        loadedRevision = statusLoadRevision.current
        try {
          const nextStatus = await request('status')
          value = nextStatus
          setStatus(nextStatus)
          setError('')
          setConnection('online')
        } catch (nextError) {
          setStatus(null)
          setError(nextError instanceof Error ? nextError.message : String(nextError))
          setConnection('offline')
          value = undefined
        }
      } while (loadedRevision !== statusLoadRevision.current)
      return value
    })().finally(() => { statusLoad.current = undefined })
    return statusLoad.current
  }, [])

  const refreshInventory = useCallback(key => {
    inventoryLoadRevisions.current[key] += 1
    if (inventoryLoads.current[key] !== undefined) return inventoryLoads.current[key]
    const loader = key === 'plugins'
      ? { path: 'bundled-plugins', apply: value => setPlugins(value.plugins ?? []) }
      : { path: 'system-skills', apply: value => setSkills(value.skills ?? []) }
    inventoryLoads.current[key] = (async () => {
      let loadedRevision
      do {
        loadedRevision = inventoryLoadRevisions.current[key]
        try {
          loader.apply(await request(loader.path))
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
        }
      } while (loadedRevision !== inventoryLoadRevisions.current[key])
    })().finally(() => { inventoryLoads.current[key] = undefined })
    return inventoryLoads.current[key]
  }, [])

  const act = useCallback(async (path, options) => {
    setActing(true)
    setError('')
    try {
      await request(path, options)
      await refresh()
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    } finally {
      setActing(false)
    }
  }, [refresh])

  const checkUpdates = useCallback(async (source = 'manual') => {
    setChecking(true)
    setError('')
    try {
      await request('check', { method: 'POST', body: { source } })
      await refresh()
      return true
    } catch (nextError) {
      const nextStatus = await refresh()
      if (nextStatus === undefined) setError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    } finally {
      setChecking(false)
    }
  }, [refresh])

  const changeChannel = useCallback(async channel => {
    if (await act('channel', { method: 'PUT', body: { channel } })) void checkUpdates('channel-change')
  }, [act, checkUpdates])

  const restartDsh = useCallback(async () => {
    setActing(true)
    setError('')
    try {
      await request('restart-dsh', { method: 'POST' })
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      setConfirmRestart(false)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setActing(false)
    }
  }, [refresh])

  const manageSystemPlugin = useCallback((plugin, action) => {
    setSystemPluginProgress(null)
    setSystemPluginApplyingDraft(new Map())
    setSystemPluginDraft(current => {
      const next = new Map(current)
      if ((action === 'install' && plugin.installed)
        || (action === 'enable' && plugin.enabled)
        || (action === 'disable' && !plugin.enabled)) next.delete(plugin.id)
      else next.set(plugin.id, action)
      return next
    })
  }, [])

  const waitForSystemPluginTask = useCallback(async taskId => {
    for (let attempt = 0; attempt < 2_400; attempt += 1) {
      const operation = await request(`bundled-plugins/task/${taskId}`)
      if (operation?.taskId === taskId && operation.status !== 'running') return operation
      await new Promise(resolve => window.setTimeout(resolve, 250))
    }
    throw new Error('System Plugin task timed out')
  }, [])

  const cancelSystemPluginChanges = useCallback(async () => {
    setSystemPluginProgress(null)
    setSystemPluginApplyingDraft(new Map())
    setSystemPluginDraft(new Map())
    if (plugins.some(plugin => plugin.pendingRestart)) {
      await act('bundled-plugins/discard', { method: 'POST' })
      await refreshInventory('plugins')
    }
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
  }, [act, plugins, refreshInventory])

  const applySystemPluginChanges = useCallback(async () => {
    if (systemPluginDraft.size === 0) {
      if (plugins.some(plugin => plugin.pendingRestart)) await restartDsh()
      return
    }
    setActing(true)
    setSystemPluginApplyingDraft(new Map(systemPluginDraft))
    setError('')
    let changed = false
    try {
      const changes = [...systemPluginDraft]
      for (const [index, [id, action]] of changes.entries()) {
        setSystemPluginProgress({ phase: 'applying', id, action, current: index + 1, total: changes.length })
        const plugin = plugins.find(item => item.id === id)
        if (plugin === undefined) throw new Error(`System Plugin ${id} is no longer available`)
        const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
        const task = await request(path, { method: 'POST', body: { id, action } })
        changed = true
        window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
        const operation = await waitForSystemPluginTask(task.taskId)
        if (operation.status !== 'success') throw new Error(operation.error ?? 'System Plugin operation failed')
      }
      setSystemPluginDraft(new Map())
      const restartTask = await request('restart-dsh', { method: 'POST' })
      setSystemPluginProgress({ phase: 'restarting', total: changes.length, taskId: restartTask.taskId })
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      await refresh()
    } catch (nextError) {
      setSystemPluginProgress(null)
      if (changed) await request('bundled-plugins/discard', { method: 'POST' }).catch(() => {})
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      await refreshInventory('plugins')
      setActing(false)
    }
  }, [plugins, refresh, refreshInventory, restartDsh, systemPluginDraft, waitForSystemPluginTask])

  useEffect(() => {
    if (systemPluginProgress?.phase !== 'restarting' || systemPluginProgress.taskId === undefined) return
    const lifecycle = status?.dshLifecycle
    if (lifecycle?.taskId !== systemPluginProgress.taskId) return
    if (['running', 'failed', 'stopped'].includes(lifecycle.state)) setSystemPluginProgress(null)
  }, [status?.dshLifecycle, systemPluginProgress])

  const manageSystemSkill = useCallback(async (skill, action) => {
    if (await act('system-skills/action', { method: 'POST', body: { skillId: skill.id, action } })) {
      await refreshInventory('skills')
    }
  }, [act, refreshInventory])

  useEffect(() => {
    if (activeTab === 'plugins' || activeTab === 'skills') void refreshInventory(activeTab)
  }, [activeTab, refreshInventory])

  useEffect(() => {
    let checkedOnOpen = false
    const unsubscribeEvents = subscribePlatformStateEvents({
      state: () => {
        void refresh()
        const inventoryKey = activeTabRef.current
        if (inventoryKey === 'plugins' || inventoryKey === 'skills') void refreshInventory(inventoryKey)
      },
      open: () => setConnection('online'),
      error: () => {
        setConnection('connecting')
        void refresh()
      },
    })
    const refreshAndConnect = async () => {
      const value = await refresh()
      if (value !== undefined) {
        if (!checkedOnOpen && TERMINAL.has(value.update?.status ?? 'idle')) {
          checkedOnOpen = true
          void checkUpdates('page-open')
        }
      }
      return value
    }

    void (async () => {
      if (window.sessionStorage.getItem(PLUGIN_DRAFT_KEY) === '1') {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          try {
            await request('bundled-plugins/discard', { method: 'POST' })
            window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
            break
          } catch {
            await new Promise(resolve => window.setTimeout(resolve, 100))
          }
        }
      }
      await refreshAndConnect()
    })()

    const timer = window.setInterval(() => { void refreshAndConnect() }, 15_000)
    const focus = () => { void refreshAndConnect() }
    window.addEventListener('focus', focus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', focus)
      unsubscribeEvents()
    }
  }, [checkUpdates, refresh, refreshInventory])

  const update = status?.update ?? {}
  const restart = status?.dshLifecycle ?? {}
  const pluginOperation = status?.systemPluginOperation ?? {}
  const skillOperation = status?.systemSkillOperation ?? {}
  const checkingUpdates = checking || update.status === 'checking'
  const restartBusy = restart.state === 'restarting'
  const busy = (acting && !checking) || restartBusy || pluginOperation.status === 'running' || skillOperation.status === 'running'
    || (!TERMINAL.has(update.status ?? 'idle') && update.status !== 'checking')
  const updateActive = !TERMINAL.has(update.status ?? 'idle')
  useEffect(() => {
    if (update.status !== 'success' || !update.taskId) {
      setShowSuccessfulProgress(false)
      return undefined
    }
    setShowSuccessfulProgress(true)
    const timer = window.setTimeout(() => setShowSuccessfulProgress(false), 3_000)
    return () => window.clearTimeout(timer)
  }, [update.status, update.taskId, update.updatedAt])
  const failedDismissed = update.status === 'failed' && String(update.taskId ?? '') === dismissedProgressTaskId
  const progressVisible = updateActive || (update.status === 'failed' && Boolean(update.taskId) && !failedDismissed) || showSuccessfulProgress
  const hasSupportedTarget = status?.supported !== null && status?.supported !== undefined
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  const progressModel = updateProgressModel(update, t)
  const recoveryProgress = isRecoveryOperation(update.operation)
  const checkingProgress = update.operation === 'check'
  const progressTarget = status?.updateChannel === 'experimental' ? status?.upstream?.version : status?.supported?.dsh
  const holds = [...new Map([
    ...(status?.holds ?? []),
    ...(status?.experimentalBlocked ? [status.experimentalBlocked] : []),
  ].map(hold => [hold.id, hold])).values()]
  const notices = []
  if (status?.aheadOfStable) notices.push(t('aheadOfStable'))
  if (status?.experimentalBlocked) notices.push(t('experimentalBlocked'))
  const automaticCheck = status?.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }

  const saveAutomaticCheck = async change => {
    await act('automatic-check', {
      method: 'PUT',
      body: { ...automaticCheck, ...change },
    })
  }

  return h('div', { className: css.root },
    h('div', { className: css.platformHeader },
      h('div', { className: css.heading },
        h('div', { className: css.titleRow },
          h('h2', { className: css.title }, t('title')),
          h('span', { className: `${css.connection} ${css[connection]}`, role: 'status' },
            h('span', { 'aria-hidden': 'true' }),
            t(connection))),
        h('p', { className: css.intro }, t('intro'))),

      h('div', { ref: tabsRef, className: css.tabs, role: 'tablist', 'aria-label': t('managementSections') },
        ['maintenance', 'plugins', 'skills', 'proxy', 'updates'].map(tab => h('button', {
          key: tab,
          id: `platform-tab-${tab}-button`,
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === tab,
          'aria-controls': `platform-tab-${tab}`,
          tabIndex: activeTab === tab ? 0 : -1,
          onClick: () => setActiveTab(tab),
        }, t(`${tab}Tab`))))),

    h('div', {
      id: 'platform-tab-proxy',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-proxy-button',
      hidden: activeTab !== 'proxy',
    }, h(ProxySettings, { active: activeTab === 'proxy', t })),

    h('div', {
      id: 'platform-tab-updates',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-updates-button',
      hidden: activeTab !== 'updates',
    },
    h('section', { className: css.section, 'aria-labelledby': 'platform-channel-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-channel-title' }, t('channel')),
          h('p', null, t('channelDetail'))),
        h('div', { className: css.segmented, role: 'group', 'aria-label': t('channel') },
          ['stable', 'experimental'].map(channel => h('button', {
            key: channel,
            type: 'button',
            'aria-pressed': status?.updateChannel === channel,
            disabled: busy,
            onClick: () => { void changeChannel(channel) },
          }, t(channel))))),
      h('div', { className: `${css.versions} ${status?.updateChannel === 'experimental' ? css.experimentalVersions : ''}` },
        h(VersionCell, { label: t('current'), version: status?.current?.dsh, detail: displayEnvironment(status?.current?.environment) }),
        h(VersionCell, { label: t('supported'), version: status?.supported?.dsh, detail: displayEnvironment(status?.supported?.environment) }),
        status?.updateChannel === 'experimental'
          ? h(VersionCell, { label: t('upstream'), version: status?.upstream?.version, detail: t('officialNpm') })
          : null),
      notices.length > 0 ? h('p', { className: css.notice }, notices.join(' ')) : null,
      error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t)) : null),

    h('section', { className: css.section, 'aria-labelledby': 'platform-actions-title' },
      h('div', { className: `${css.sectionHeading} ${css.actionHeading}` },
        h('div', null,
          h('h3', { id: 'platform-actions-title' }, t('actions')),
          h('p', null, update.checkedAt ? `${t('lastChecked')} ${localTime(update.checkedAt, t('localeCode'))}` : t('notChecked'))),
        h('div', { className: css.actions },
          h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void checkUpdates('manual') } },
            checkingUpdates ? h('span', { className: css.checkSpinner, 'aria-hidden': 'true' }) : null,
            checkingUpdates ? t('checking') : t('check')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy || update.metadataUnavailable || !hasSupportedTarget || update.updateAvailable !== true, onClick: () => { void act('update', { method: 'POST' }) } }, status?.updateChannel === 'experimental' ? t('updateUpstream') : t('updateSupported')),
          )),
      h('div', { className: css.updateState, 'aria-live': 'polite' },
        !progressVisible && !failedDismissed && (update.error || update.outcome) ? h('p', null, update.error ? localizedError(update.error, t) : updateOutcome(update.outcome, t)) : null,
        progressVisible ? h('div', { className: css.updateProgress },
          h('div', { className: css.progressHeading },
            h('strong', null, checkingProgress
              ? t('statusChecking')
              : recoveryProgress ? progressModel.title : progressTarget ? t('updateToTarget').replace('{target}', String(progressTarget)) : progressModel.title),
            h('span', { className: css.progressHeadingActions },
              h('output', null, `${String(progress)}%`),
              update.status === 'failed' ? h('button', { type: 'button', className: css.smallButton, onClick: () => setDismissedProgressTaskId(String(update.taskId ?? '')) }, t('dismissProgress')) : null)),
          h('div', { className: css.progress, 'data-complete': progress === 100, role: 'progressbar', 'aria-label': t('progress'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress },
            h('span', { style: { width: `${String(progress)}%` } })),
          h(TransactionStageLogs, {
            update,
            visible: progressVisible,
            t,
            onViewFullLog: () => {
              setFocusedLogTaskId(update.taskId ?? null)
              setActiveTab('maintenance')
            },
          })) : null),
      update.metadataUnavailable ? h('p', { className: css.notice }, t('metadataUnavailable')) : null,
      update.remoteCheckError ? h('p', { className: css.notice, role: 'status' }, t(update.remoteCheckSource === 'upstream'
        ? (update.upstream?.version ? 'upstreamCheckFailed' : 'upstreamCheckFailedNoResult')
        : (update.checkedAt ? 'remoteCheckFailed' : 'remoteCheckFailedNoResult'))) : null,
      holds.length > 0 ? h('div', { className: css.holds },
        holds.map(hold => h('div', { className: css.hold, key: hold.id },
          h('div', null,
            h('strong', null, `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${displayEnvironment(hold.environmentVersion)}` : ''}`),
            h('span', null, localizedHoldReason(hold, t))),
          h('button', { type: 'button', className: css.smallButton, disabled: busy, onClick: () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) } }, t('retry'))))) : null,
      null),

    h('section', { className: css.section, 'aria-labelledby': 'automatic-check-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'automatic-check-title' }, t('automaticChecks')),
          h('p', null, t('automaticChecksDetail'))),
        h('label', { className: css.toggle },
          h('input', { type: 'checkbox', checked: automaticCheck.enabled, disabled: acting, onChange: event => { void saveAutomaticCheck({ enabled: event.target.checked }) } }),
          h('span', { 'aria-hidden': 'true' }),
          h('b', null, automaticCheck.enabled ? t('enabled') : t('disabled')))),
      h('div', { className: css.settingRows },
        h('label', { className: css.settingRow },
          h('span', null, t('checkInterval')),
          h('select', { value: automaticCheck.intervalSeconds, disabled: acting || !automaticCheck.enabled, onChange: event => { void saveAutomaticCheck({ intervalSeconds: Number(event.target.value) }) } },
            [3_600, 10_800, 21_600, 43_200, 86_400].map(seconds => h('option', { key: seconds, value: seconds }, t(`interval${String(seconds)}`))))),
        h('label', { className: css.settingRow },
          h('span', null,
            h('b', null, t('updateNotifications')),
            h('small', null, t('updateNotificationsDetail'))),
          h('input', { type: 'checkbox', checked: automaticCheck.notificationsEnabled, disabled: acting, onChange: event => { void saveAutomaticCheck({ notificationsEnabled: event.target.checked }) } }))))),

    h('div', {
      id: 'platform-tab-maintenance',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-maintenance-button',
      hidden: activeTab !== 'maintenance',
    },
    h('section', { className: css.section, 'aria-labelledby': 'platform-maintenance-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-maintenance-title' }, t('standaloneManagement')),
          h('p', null, t('standaloneManagementDetail'))),
        h('a', {
          className: `${css.secondaryButton} ${css.maintenanceButton}`,
          href: '/_dsh_platform/console',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, t('openPlatformManagement')))),
    h('section', { className: css.section, 'aria-labelledby': 'platform-restart-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-restart-title' }, t('restartDshSection')),
          h('p', null, t('restartDshDetail'))),
        h('button', {
          type: 'button',
          className: `${css.secondaryButton} ${css.maintenanceButton}`,
          disabled: busy,
          'aria-controls': 'restart-dsh-confirmation',
          'aria-expanded': confirmRestart,
          onClick: () => setConfirmRestart(value => !value),
        }, restartBusy ? t('restarting') : t(confirmRestart ? 'cancelRestartDsh' : 'restartDsh'))),
      restart.state === 'failed'
        ? h('p', { className: css.error, role: 'alert' }, `${t('restartFailed')}: ${localizedError(restart.error, t)}`)
        : restartBusy
          ? h('p', { className: css.maintenanceStatus, 'aria-live': 'polite' }, t('restarting'))
          : null,
      confirmRestart ? h('div', { id: 'restart-dsh-confirmation', className: `${css.confirmation} ${css.restartConfirmation}`, role: 'alertdialog', 'aria-labelledby': 'restart-dsh-title' },
        h('h4', { id: 'restart-dsh-title' }, t('restartTitle')),
        h('p', null, t('restartWarning')),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => setConfirmRestart(false) }, t('cancel')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: () => { void restartDsh() } }, t('confirmRestart')))) : null),
    h(LogViewer, { active: activeTab === 'maintenance', focusTaskId: focusedLogTaskId, t })),

    h('div', {
      id: 'platform-tab-plugins',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-plugins-button',
      hidden: activeTab !== 'plugins',
    }, h(SystemPluginManager, {
      plugins,
      draft: systemPluginDraft,
      applyingDraft: systemPluginApplyingDraft,
      progress: systemPluginProgress,
      operation: pluginOperation,
      busy,
      error,
      onAction: (plugin, action) => { void manageSystemPlugin(plugin, action) },
      onCancel: () => { void cancelSystemPluginChanges() },
      onApply: () => { void applySystemPluginChanges() },
      t,
    })),

    h('div', {
      id: 'platform-tab-skills',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-skills-button',
      hidden: activeTab !== 'skills',
    }, h(SystemSkillManager, {
      skills,
      operation: skillOperation,
      busy,
      error,
      onAction: (skill, action) => { void manageSystemSkill(skill, action) },
      t,
    })))
}

function apply(ctx) {
  const syncLocaleCookie = snapshot => { persistLocale(snapshot.active) }
  syncLocaleCookie(ctx.locale.getLocale())
  ctx.on('locale/change', syncLocaleCookie)
  ctx.effect(() => ctx.locale.register('settings.dshPlatformManagement', {
    zh: {
      localeCode: 'zh',
      nav: '平台管理', title: '平台管理', intro: 'DSH Docker 运行、更新与恢复',
      managementSections: '平台管理功能', updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件', skillsTab: '系统技能', proxyTab: '代理设置',
      proxyTitle: '代理设置', proxyDetail: '配置由 DSH Docker 使用的外部 HTTP 或 SOCKS5 代理。', proxyLoading: '正在加载代理配置…', proxyProtocol: '代理协议', proxyHost: '主机', proxyPort: '端口', proxyUsername: '用户名', proxyPassword: '密码', proxyPasswordPlaceholder: '留空则保持当前密码', proxyRemoteDns: '通过代理解析域名', proxyRemoteDnsDetail: '仅适用于 SOCKS5；关闭时由容器本地解析。', proxyClearPassword: '清除已保存的密码', proxyPasswordConfigured: '已保存代理密码；密码不会从平台读取或回显。', proxyPasswordNotConfigured: '尚未保存代理密码。', proxyTransportWarning: '当前页面未使用 HTTPS。代理凭据会受到传输链路保护能力的限制。', proxyComponentReady: '出站代理组件已就绪。配置只影响新建立的连接。', proxyComponentUnavailable: '出站代理组件当前不可用；可以保存配置，但连接测试可能失败。',
      proxyScopes: '代理范围', proxyScopesDetail: '仅勾选需要通过外部代理访问网络的来源。', proxyScopeHelp: '范围说明', proxyScopeGuideTitle: '代理范围说明', proxyScopeGuideDetail: '此表由管理后端提供，两套管理界面使用相同分类。', proxyScopeUpdates: '更新管理', proxyScopeUpdatesDetail: '更新检查、npm metadata 与 Artifact 下载。', proxyScopePlatform: '平台组件', proxyScopePlatformDetail: 'Management、Updater 等平台组件的非本地外部请求。', proxyScopeDshCore: 'DSH 核心', proxyScopeDshCoreDetail: 'DSH 核心联网，不包括模型 Provider API。', proxyScopeDshPlugins: 'DSH 插件', proxyScopeDshPluginsDetail: '官方、第三方及 DSH Docker 系统插件的联网。', proxyScopeAgent: 'Agent 联网操作', proxyScopeAgentDetail: 'Agent 工具、命令与其子进程的联网。', proxyScopeTerminal: '容器终端', proxyScopeTerminalDetail: 'DSH 管理中心提供的容器终端。',
      proxyRules: '直连与兼容规则', proxyRulesDetail: '强制本地直连始终优先；NO_PROXY 优先于 bypass。', proxyNoProxy: 'NO_PROXY', proxyNoProxyDetail: '每行一项；使用 .google.com 表示域后缀，不使用 *.google.com。', proxyBypass: '额外 bypass', proxyBypassDetail: '平台代理可识别的精确主机、域后缀、IP 或 CIDR。', proxyAllProxy: '为兼容客户端注入 ALL_PROXY', proxyAllProxyDetail: '仅对明确支持 ALL_PROXY 的客户端有效；默认关闭。', proxyProviders: '模型 Provider', proxyProvidersDetail: '本地 Provider 强制直连；只有具备稳定独立路由能力的 Provider 才可单独选择。', proxyNoProviders: '当前没有可识别的模型 Provider。', proxyProviderDirect: '直连', proxyProviderIndependent: '独立代理', proxyProviderShared: '跟随 DSH', proxyProviderReasonLocal: '本地 Provider 强制直连。', proxyProviderReasonShared: '当前客户端无法稳定携带 Provider 身份，因此跟随 DSH 共享流量策略。',
      proxyTest: '代理连接测试', proxyTestDetail: '测试当前表单，不会覆盖已保存配置。', proxyTestStart: '测试连接', proxySave: '保存并应用', proxySaving: '正在保存代理设置', proxySaved: '代理设置已保存', proxyTestSuccess: '代理连接测试通过。', proxyTestFailed: '代理连接测试失败', proxyTestCancelled: '代理连接测试已取消。', proxyStageAddress: '解析代理地址', proxyStageConnect: '连接代理', proxyStageHandshake: '代理握手', proxyStageDns: '解析目标域名', proxyStageTls: '建立目标 TLS', proxyStageHttp: '请求目标服务', proxyStagePending: '待测试', proxyStageRunning: '测试中', proxyStageSuccess: '已通过', proxyStageFailed: '失败', proxyStageSkipped: '已跳过',
      channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。', returnStableProgress: '返回稳定通道',
      stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
      actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中', updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
      updateProgress: '更新进度', rollbackProgress: '回滚进度', updateToTarget: '更新到 {target}', progressPrepare: '准备更新', progressAcquire: '下载与验证', progressBuild: '构建 Runtime', progressActivate: '切换与健康检查', stageLogs: '阶段日志', hideStageLogs: '收起日志 · {count} 条', showStageLogs: '查看日志 · {count} 条', noStageLogs: '当前阶段暂无日志', copyStageLogs: '复制当前日志', logsCopied: '已复制', viewFullTransactionLog: '查看完整事务日志', stageCompleted: '阶段已完成。', stageWaiting: '等待前一阶段完成。', stageProgress: '阶段进度 {progress}%', stageItemsCompleted: '已完成 {completed}/{total} 项', expandStage: '展开 · 日志 {count} 条', collapseStage: '收起 · 日志 {count} 条', stageItemCompleted: '已完成：{item}', stageItemActive: '正在执行：{item}', stageItemPending: '待执行：{item}', stageItemFailed: '执行失败：{item}', itemVerifyMetadata: '验证 metadata', itemVerifyKeyring: '验证 keyring', itemVerifyTarget: '验证目标清单', itemDownloadArtifacts: '下载 Artifact', itemVerifyArtifacts: '验证 Artifact 签名、引用、大小和 Hash', itemImportObjects: '导入可信对象库', itemMaterializePristine: '物化 Pristine DSH', itemPrepareEnvironment: '准备 Environment', itemBuildRuntime: '构建 Runtime 并应用完整 Patch Set', itemPreparePlugins: '准备 System Plugin Set', itemSwitchDeployment: '原子切换 Deployment', itemCheckHealth: '检查服务健康状态', itemObserveProbation: '观察候选 Runtime', metadataVerified: 'metadata 已验证。', keyringVerified: 'keyring 已验证。', targetManifestVerified: '目标清单已验证。', artifactDownloadCompleted: 'Artifact 下载已完成。', artifactVerificationCompleted: 'Artifact 签名、引用和 Hash 已验证。', runtimeMaterialized: 'Pristine DSH 已物化。', patchSetApplied: '完整 Patch Set 已应用。', systemPluginsPrepared: 'System Plugin Set 已准备。', deploymentSwitched: 'Deployment 已原子切换。', healthChecksPassed: '服务健康检查已通过。', metricBytesRead: '已读取 {processed} / {total}', metricBytesCopied: '已复制 {processed} / {total}', metricBytesProcessed: '已处理 {processed} / {total}', metricArtifacts: '已验证 {processed} / {total} 个 Artifact', metricFiles: '已完成 {processed} / {total} 个文件', metricItems: '已完成 {processed} / {total} 项', metricServices: '已就绪 {ready} / {total} 个服务', rollbackPrepare: '准备回滚', rollbackSwitch: '切换上一版本', rollbackData: '恢复数据', rollbackVerify: '启动与检查',
      dismissProgress: '关闭', itemValidateRollback: '验证回滚计划和上一完整 Deployment', itemPauseRuntime: '暂停当前 DSH Runtime', itemSwitchPrevious: '切换上一完整 Deployment', itemVerifySnapshot: '验证数据快照', itemRestoreSnapshot: '恢复数据快照', itemStartRuntime: '启动上一 DSH Runtime', metricBytesRestored: '已恢复 {processed} / {total}', metricProbationRemaining: '剩余观察 {seconds} 秒',
      progressDetailChecking: '正在获取并验证最新的签名更新信息。', progressDetailPlanning: '正在计算需要收敛的完整目标状态。', progressDetailUpstream: '正在查询 npm 官方源中的最新 DSH。', progressDetailDownloading: '正在下载 Artifact，并通过 Stage-0 导入可信对象库。', progressDetailValidating: '正在验证签名、Artifact 引用、大小和内容 Hash。', progressDetailBuilding: '正在从 Pristine DSH、补丁和系统插件构建不可变 Runtime。', progressDetailSnapshot: 'DSH 已暂停，正在为实验更新创建完整数据快照。', progressDetailSwitching: '正在原子切换完整 Deployment，并检查 DSH 是否就绪。', progressDetailProbation: '候选 Runtime 正在持续接受健康检查，观察至 {until}。',
      rollbackDetailPreparing: '正在验证回滚计划与上一完整 Deployment。', rollbackDetailStopping: '正在暂停 DSH，准备恢复上一完整状态。', rollbackDetailSwitching: '正在切换上一 Runtime、Environment 和系统插件集合。', rollbackDetailData: '正在校验并恢复更新前的数据快照。', rollbackDetailVerifying: '正在启动 DSH 并执行健康检查。',
      statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本', statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据', statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusRollingBack: '正在回滚', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
      outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新', outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
      requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。', holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。',
      metadataUnavailable: '正式更新信息暂未发布，请稍后再试。', remoteCheckFailed: '远程检查失败，继续显示上次已验证结果。', remoteCheckFailedNoResult: '远程检查失败，暂无已验证结果。', upstreamCheckFailed: 'DSH 官方版本检查失败，继续显示上次已验证结果。', upstreamCheckFailedNoResult: 'DSH 官方版本检查失败，暂无已验证结果。',
      aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
      returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：', confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
      standaloneManagement: 'DSH 管理中心', standaloneManagementDetail: 'DSH 不可用时仍可进行更新、插件恢复、日志查看和终端操作。', openPlatformManagement: '打开 DSH 管理中心', restartDshSection: '重启 DSH', restartDshDetail: '仅重新启动 DSH，容器和管理中心服务保持运行。', restartDsh: '重新启动 DSH', cancelRestartDsh: '取消重启 DSH', restarting: '正在重新启动 DSH', restartFailed: 'DSH 重启失败', restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，重启完成后页面将自动刷新。', confirmRestart: '确认重启',
      automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭', checkInterval: '检查频率', updateNotifications: '更新提醒', updateNotificationsDetail: '自动检查发现新版本时，弹窗提醒更新。',
      systemPlugins: '系统插件', systemPluginsDetail: '管理 DSH Docker 提供的系统插件。', noSystemPlugins: '当前环境没有提供系统插件。', platformManaged: '平台核心组件，始终保持安装和启用。', managed: '平台托管', notInstalled: '未安装', resourceEnabled: '已启用', resourceDisabled: '已禁用', pendingInstall: '待安装', pendingUninstall: '待卸载', pendingEnable: '待启用', pendingDisable: '待禁用', statusInstalling: '安装中', statusUninstalling: '卸载中', statusEnabling: '启用中', statusDisabling: '禁用中', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置', pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载', pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginChangesPending: '有待应用的修改', pluginChangesPendingDetail: '插件修改尚未应用。应用后将重新启动 DSH 并生效。', pendingSystemPluginChanges: '有 {count} 项修改待应用', systemPluginApplyingItem: '{action} @dsh-docker/{id}（{current}/{total}）', systemPluginRestarting: '插件修改已应用，正在重新启动 DSH', cancelChanges: '取消修改', applyPluginChanges: '应用并重新启动 DSH', searchSystemPlugins: '搜索系统插件',
      systemSkills: '系统技能', systemSkillsDetail: '管理 DSH Docker 提供的 Agent 操作指引；修改会立即生效。', noSystemSkills: '当前 Bootstrap 没有提供系统技能。', skillActionWorking: '正在应用技能设置', searchSystemSkills: '搜索系统技能', noMatchingResources: '没有符合搜索条件的项目。', itemsPerPage: '每页数量', itemsPerPageSuffix: '条/页', previousPage: '上一页', nextPage: '下一页', totalItems: '共 {total} 条', goToPage: '前往', pageUnit: '页',
      logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块', logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误', logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', refreshLogs: '刷新日志', exportLogs: '导出日志', autoScroll: '自动滚动', clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
      interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
      stableNoticeTitle: '正式版本可更新', stableNoticeBody: '最新支持版本 {version} 已可用。', upstreamNoticeTitle: '上游版本可更新', upstreamNoticeBody: 'DSH 官方版本 {version} 已可用。', later: '稍后提醒', dismissVersion: '不再提醒此版本',
      online: '已连接', connecting: '正在重连', offline: '连接中断',
    },
    en: {
      localeCode: 'en',
      nav: 'Platform Management', title: 'Platform Management', intro: 'DSH Docker runtime, updates, and recovery',
      managementSections: 'Platform management sections', updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins', skillsTab: 'System skills', proxyTab: 'Proxy',
      proxyTitle: 'Proxy settings', proxyDetail: 'Configure an external HTTP or SOCKS5 proxy used by DSH Docker.', proxyLoading: 'Loading proxy configuration…', proxyProtocol: 'Proxy protocol', proxyHost: 'Host', proxyPort: 'Port', proxyUsername: 'Username', proxyPassword: 'Password', proxyPasswordPlaceholder: 'Leave blank to keep the current password', proxyRemoteDns: 'Resolve names through the proxy', proxyRemoteDnsDetail: 'SOCKS5 only. When off, names are resolved locally in the container.', proxyClearPassword: 'Clear the saved password', proxyPasswordConfigured: 'A proxy password is saved. It cannot be read back or displayed.', proxyPasswordNotConfigured: 'No proxy password is saved.', proxyTransportWarning: 'This page is not using HTTPS. Proxy credentials are limited by the protection of the transport path.', proxyComponentReady: 'The outbound proxy component is ready. Changes affect new connections only.', proxyComponentUnavailable: 'The outbound proxy component is unavailable. Settings can be saved, but connection tests may fail.',
      proxyScopes: 'Proxy scopes', proxyScopesDetail: 'Enable the external proxy only for sources that need it.', proxyScopeHelp: 'Scope guide', proxyScopeGuideTitle: 'Proxy scope guide', proxyScopeGuideDetail: 'The Management backend supplies this table to both management interfaces.', proxyScopeUpdates: 'Update management', proxyScopeUpdatesDetail: 'Update checks, npm metadata, and Artifact downloads.', proxyScopePlatform: 'Platform components', proxyScopePlatformDetail: 'Non-local external requests from Management, Updater, and other platform components.', proxyScopeDshCore: 'DSH core', proxyScopeDshCoreDetail: 'DSH core traffic, excluding model Provider APIs.', proxyScopeDshPlugins: 'DSH plugins', proxyScopeDshPluginsDetail: 'Official, third-party, and DSH Docker System Plugin traffic.', proxyScopeAgent: 'Agent network operations', proxyScopeAgentDetail: 'Agent tools, commands, and their child processes.', proxyScopeTerminal: 'Container terminal', proxyScopeTerminalDetail: 'The container terminal provided by DSH Management Console.',
      proxyRules: 'Direct and compatibility rules', proxyRulesDetail: 'Forced local direct routes always win; NO_PROXY takes priority over bypass.', proxyNoProxy: 'NO_PROXY', proxyNoProxyDetail: 'One entry per line. Use .google.com for a domain suffix, not *.google.com.', proxyBypass: 'Additional bypass', proxyBypassDetail: 'Exact hosts, domain suffixes, IP addresses, or CIDRs understood by the platform proxy.', proxyAllProxy: 'Inject ALL_PROXY for compatible clients', proxyAllProxyDetail: 'Only affects clients known to support ALL_PROXY. Off by default.', proxyProviders: 'Model Providers', proxyProvidersDetail: 'Local Providers are forced direct. Independent selection is available only when Provider identity is stable end to end.', proxyNoProviders: 'No model Providers are currently discoverable.', proxyProviderDirect: 'Direct', proxyProviderIndependent: 'Independent proxy', proxyProviderShared: 'Follow DSH', proxyProviderReasonLocal: 'Local Provider; forced direct.', proxyProviderReasonShared: 'The client cannot carry a stable Provider identity, so this Provider follows shared DSH routing.',
      proxyTest: 'Proxy connection test', proxyTestDetail: 'Tests the current form without replacing saved settings.', proxyTestStart: 'Test connection', proxySave: 'Save and apply', proxySaving: 'Saving proxy settings', proxySaved: 'Proxy settings saved', proxyTestSuccess: 'Proxy connection test passed.', proxyTestFailed: 'Proxy connection test failed', proxyTestCancelled: 'Proxy connection test cancelled.', proxyStageAddress: 'Resolve proxy address', proxyStageConnect: 'Connect to proxy', proxyStageHandshake: 'Proxy handshake', proxyStageDns: 'Resolve target name', proxyStageTls: 'Establish target TLS', proxyStageHttp: 'Request target service', proxyStagePending: 'Pending', proxyStageRunning: 'Testing', proxyStageSuccess: 'Passed', proxyStageFailed: 'Failed', proxyStageSkipped: 'Skipped',
      channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.', returnStableProgress: 'Return to Stable',
      stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
      actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking', updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
      updateProgress: 'Update progress', rollbackProgress: 'Rollback progress', updateToTarget: 'Update to {target}', progressPrepare: 'Prepare update', progressAcquire: 'Download and verify', progressBuild: 'Build Runtime', progressActivate: 'Switch and health check', stageLogs: 'Stage logs', hideStageLogs: 'Hide logs · {count}', showStageLogs: 'View logs · {count}', noStageLogs: 'No logs for this phase yet', copyStageLogs: 'Copy current logs', logsCopied: 'Copied', viewFullTransactionLog: 'View full transaction log', stageCompleted: 'Stage completed.', stageWaiting: 'Waiting for the previous stage.', stageProgress: 'Stage progress {progress}%', stageItemsCompleted: '{completed}/{total} items completed', expandStage: 'Expand · {count} log entries', collapseStage: 'Collapse · {count} log entries', stageItemCompleted: 'Completed: {item}', stageItemActive: 'In progress: {item}', stageItemPending: 'Pending: {item}', stageItemFailed: 'Failed: {item}', itemVerifyMetadata: 'Verify metadata', itemVerifyKeyring: 'Verify keyring', itemVerifyTarget: 'Verify target manifest', itemDownloadArtifacts: 'Download Artifacts', itemVerifyArtifacts: 'Verify Artifact signatures, references, sizes, and hashes', itemImportObjects: 'Import trusted objects', itemMaterializePristine: 'Materialize Pristine DSH', itemPrepareEnvironment: 'Prepare Environment', itemBuildRuntime: 'Build Runtime and apply the complete Patch Set', itemPreparePlugins: 'Prepare System Plugin Set', itemSwitchDeployment: 'Switch Deployment atomically', itemCheckHealth: 'Check service health', itemObserveProbation: 'Observe candidate Runtime', metadataVerified: 'Metadata verified.', keyringVerified: 'Keyring verified.', targetManifestVerified: 'Target manifest verified.', artifactDownloadCompleted: 'Artifact download completed.', artifactVerificationCompleted: 'Artifact signatures, references, and hashes verified.', runtimeMaterialized: 'Pristine DSH materialized.', patchSetApplied: 'Complete Patch Set applied.', systemPluginsPrepared: 'System Plugin Set prepared.', deploymentSwitched: 'Deployment switched atomically.', healthChecksPassed: 'Service health checks passed.', metricBytesRead: 'Read {processed} / {total}', metricBytesCopied: 'Copied {processed} / {total}', metricBytesProcessed: 'Processed {processed} / {total}', metricArtifacts: 'Verified {processed} / {total} Artifacts', metricFiles: 'Completed {processed} / {total} files', metricItems: 'Completed {processed} / {total} items', metricServices: '{ready} / {total} services ready', rollbackPrepare: 'Prepare rollback', rollbackSwitch: 'Switch previous version', rollbackData: 'Restore data', rollbackVerify: 'Start and check',
      dismissProgress: 'Close', itemValidateRollback: 'Validate rollback plan and previous complete Deployment', itemPauseRuntime: 'Pause current DSH Runtime', itemSwitchPrevious: 'Switch previous complete Deployment', itemVerifySnapshot: 'Verify data snapshot', itemRestoreSnapshot: 'Restore data snapshot', itemStartRuntime: 'Start previous DSH Runtime', metricBytesRestored: 'Restored {processed} / {total}', metricProbationRemaining: '{seconds} seconds of observation remaining',
      progressDetailChecking: 'Fetching and verifying the latest signed update metadata.', progressDetailPlanning: 'Calculating the complete target state to reconcile.', progressDetailUpstream: 'Checking the official npm registry for the latest DSH.', progressDetailDownloading: 'Downloading Artifacts and importing them through Stage-0 into the trusted object store.', progressDetailValidating: 'Verifying signatures, Artifact references, sizes, and content hashes.', progressDetailBuilding: 'Building an immutable Runtime from Pristine DSH, patches, and System Plugins.', progressDetailSnapshot: 'DSH is paused while a complete data snapshot is created for the Experimental update.', progressDetailSwitching: 'Atomically switching the complete Deployment and checking DSH readiness.', progressDetailProbation: 'The candidate Runtime remains under health observation until {until}.',
      rollbackDetailPreparing: 'Validating the rollback plan and previous complete Deployment.', rollbackDetailStopping: 'Pausing DSH before restoring the previous complete state.', rollbackDetailSwitching: 'Switching the previous Runtime, Environment, and System Plugin set.', rollbackDetailData: 'Verifying and restoring the pre-update data snapshot.', rollbackDetailVerifying: 'Starting DSH and running health checks.',
      statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream', statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data', statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusRollingBack: 'Rolling back', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
      outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold', outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
      requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.', holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.',
      metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.', remoteCheckFailed: 'Remote check failed. Showing the last verified result.', remoteCheckFailedNoResult: 'Remote check failed. No verified result is available yet.', upstreamCheckFailed: 'The official DSH version check failed. Showing the last verified result.', upstreamCheckFailedNoResult: 'The official DSH version check failed. No verified result is available yet.',
      aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
      returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:', confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
      standaloneManagement: 'DSH Management Console', standaloneManagementDetail: 'Updates, plugin recovery, logs, and terminal tools remain available when DSH is unavailable.', openPlatformManagement: 'Open DSH Management Console', restartDshSection: 'Restart DSH', restartDshDetail: 'Restart DSH only. The container and management console services remain running.', restartDsh: 'Restart DSH', cancelRestartDsh: 'Cancel DSH restart', restarting: 'Restarting DSH', restartFailed: 'DSH restart failed', restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This page reloads when DSH is ready.', confirmRestart: 'Restart',
      automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off', checkInterval: 'Check frequency', updateNotifications: 'Update notifications', updateNotificationsDetail: 'Show an update notification popup when an automatic check finds a new version.',
      systemPlugins: 'System plugins', systemPluginsDetail: 'Manage the System Plugins provided by DSH Docker.', noSystemPlugins: 'No System Plugins are provided by the current Environment.', platformManaged: 'Core platform component. It is always installed and enabled.', managed: 'Platform managed', notInstalled: 'Not installed', resourceEnabled: 'Enabled', resourceDisabled: 'Disabled', pendingInstall: 'Pending install', pendingUninstall: 'Pending uninstall', pendingEnable: 'Pending enable', pendingDisable: 'Pending disable', statusInstalling: 'Installing', statusUninstalling: 'Uninstalling', statusEnabling: 'Enabling', statusDisabling: 'Disabling', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings', pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling', pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginChangesPending: 'Changes pending', pluginChangesPendingDetail: 'Plugin changes have not been applied. Apply them to restart DSH and make them effective.', pendingSystemPluginChanges: '{count} pending changes', systemPluginApplyingItem: '{action} @dsh-docker/{id} ({current}/{total})', systemPluginRestarting: 'Plugin changes applied; restarting DSH', cancelChanges: 'Cancel changes', applyPluginChanges: 'Apply and restart DSH', searchSystemPlugins: 'Search System Plugins',
      systemSkills: 'System skills', systemSkillsDetail: 'Manage Agent guidance supplied by DSH Docker. Changes take effect immediately.', noSystemSkills: 'The current Bootstrap provides no System Skills.', skillActionWorking: 'Applying skill settings', searchSystemSkills: 'Search System Skills', noMatchingResources: 'No items match this search.', itemsPerPage: 'Items per page', itemsPerPageSuffix: '/ page', previousPage: 'Previous', nextPage: 'Next', totalItems: '{total} total', goToPage: 'Go to', pageUnit: 'page',
      logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module', logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error', logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', refreshLogs: 'Refresh logs', exportLogs: 'Export logs', autoScroll: 'Auto-scroll', clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
      interval3600: 'Every hour', interval10800: 'Every 3 hours', interval21600: 'Every 6 hours', interval43200: 'Every 12 hours', interval86400: 'Every 24 hours',
      stableNoticeTitle: 'Supported update available', stableNoticeBody: 'Supported version {version} is now available.', upstreamNoticeTitle: 'Upstream update available', upstreamNoticeBody: 'Official DSH version {version} is now available.', later: 'Remind me later', dismissVersion: 'Do not remind for this version',
      online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
    },
  }), 'dsh-platform-management: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-platform-management',
    order: 90,
    label: () => ctx.locale.bind('settings.dshPlatformManagement')('nav'),
    locale: 'settings.dshPlatformManagement',
  }, PlatformManagement))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-platform-management-reminder',
    order: 90,
    locale: 'settings.dshPlatformManagement',
  }, UpdateReminder))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-platform-lifecycle-guard',
    order: -100,
  }, () => h(LifecycleGuard, { connection: ctx.connection })))
}
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
