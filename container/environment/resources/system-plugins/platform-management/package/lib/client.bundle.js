window.__ModuleLoader__.load({ id: "@dsh-docker/platform-management", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const css = Object.freeze({"actionHeading":"dshPlatform_actionHeading","actions":"dshPlatform_actions","authRequired":"dshPlatform_authRequired","autoScrollButton":"dshPlatform_autoScrollButton","caption":"dshPlatform_caption","checkSpinner":"dshPlatform_checkSpinner","clearLogsButton":"dshPlatform_clearLogsButton","confirmActions":"dshPlatform_confirmActions","confirmation":"dshPlatform_confirmation","connection":"dshPlatform_connection","dangerButton":"dshPlatform_dangerButton","dangerFilledButton":"dshPlatform_dangerFilledButton","detail":"dshPlatform_detail","disconnected":"dshPlatform_disconnected","emptyLogs":"dshPlatform_emptyLogs","emptyPlugins":"dshPlatform_emptyPlugins","error":"dshPlatform_error","experimentalVersions":"dshPlatform_experimentalVersions","heading":"dshPlatform_heading","hold":"dshPlatform_hold","holds":"dshPlatform_holds","intro":"dshPlatform_intro","live":"dshPlatform_live","logChevron":"dshPlatform_logChevron","logConnection":"dshPlatform_logConnection","logDebug":"dshPlatform_logDebug","logDetails":"dshPlatform_logDetails","logEntry":"dshPlatform_logEntry","logError":"dshPlatform_logError","logFilters":"dshPlatform_logFilters","logInfo":"dshPlatform_logInfo","logLevel":"dshPlatform_logLevel","logList":"dshPlatform_logList","logMessageRow":"dshPlatform_logMessageRow","logMeta":"dshPlatform_logMeta","logSection":"dshPlatform_logSection","logSource":"dshPlatform_logSource","logSummary":"dshPlatform_logSummary","logTools":"dshPlatform_logTools","logWarning":"dshPlatform_logWarning","maintenanceButton":"dshPlatform_maintenanceButton","maintenanceStatus":"dshPlatform_maintenanceStatus","managedBadge":"dshPlatform_managedBadge","notice":"dshPlatform_notice","offline":"dshPlatform_offline","online":"dshPlatform_online","pendingBadge":"dshPlatform_pendingBadge","pluginActions":"dshPlatform_pluginActions","pluginIdentity":"dshPlatform_pluginIdentity","pluginList":"dshPlatform_pluginList","pluginOperation":"dshPlatform_pluginOperation","pluginRestartNotice":"dshPlatform_pluginRestartNotice","pluginRow":"dshPlatform_pluginRow","pluginSection":"dshPlatform_pluginSection","primaryButton":"dshPlatform_primaryButton","progress":"dshPlatform_progress","reminderActions":"dshPlatform_reminderActions","restartConfirmation":"dshPlatform_restartConfirmation","root":"dshPlatform_root","secondaryButton":"dshPlatform_secondaryButton","section":"dshPlatform_section","sectionHeading":"dshPlatform_sectionHeading","segmented":"dshPlatform_segmented","settingRow":"dshPlatform_settingRow","settingRows":"dshPlatform_settingRows","smallButton":"dshPlatform_smallButton","statusActive":"dshPlatform_statusActive","statusDot":"dshPlatform_statusDot","statusFailed":"dshPlatform_statusFailed","statusLabel":"dshPlatform_statusLabel","statusLine":"dshPlatform_statusLine","statusSuccess":"dshPlatform_statusSuccess","tabPanel":"dshPlatform_tabPanel","tabs":"dshPlatform_tabs","title":"dshPlatform_title","titleRow":"dshPlatform_titleRow","toggle":"dshPlatform_toggle","updateReminder":"dshPlatform_updateReminder","updateState":"dshPlatform_updateState","version":"dshPlatform_version","versionCell":"dshPlatform_versionCell","versions":"dshPlatform_versions"});
const styleId = "@dsh-docker/platform-management/style.module.css";
if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-plugin-css]')].some(tag => tag.dataset.pluginCss === styleId)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = "@dsh-docker/platform-management";
  tag.dataset.pluginCss = styleId;
  tag.textContent = ".dshPlatform_root {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  width: 100%;\n  max-width: 760px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_heading {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n\n.dshPlatform_sectionHeading {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n}\n\n.dshPlatform_titleRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.dshPlatform_title {\n  margin: 0;\n  font-size: 18px;\n  line-height: 26px;\n  font-weight: 600;\n}\n\n.dshPlatform_intro {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshPlatform_sectionHeading p {\n  margin: 2px 0 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshPlatform_connection {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 3px 9px;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_connection > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-warn-label);\n}\n\n.dshPlatform_connection.dshPlatform_online > span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_connection.dshPlatform_offline > span { background: var(--dsw-alias-state-error-primary); }\n\n.dshPlatform_authRequired {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-state-warn-border);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dshPlatform_authRequired a { flex: none; text-decoration: none; }\n\n.dshPlatform_tabs {\n  display: flex;\n  align-items: flex-end;\n  gap: 22px;\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  overflow-x: auto;\n  overscroll-behavior-inline: contain;\n  scroll-snap-type: inline proximity;\n  touch-action: pan-x;\n  white-space: nowrap;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  margin-top: 2px;\n  scrollbar-width: none;\n  -webkit-overflow-scrolling: touch;\n}\n\n.dshPlatform_tabs::-webkit-scrollbar { display: none; }\n\n.dshPlatform_tabs button {\n  position: relative;\n  flex: none;\n  padding: 7px 1px 9px;\n  border: 0;\n  color: var(--dsw-alias-label-tertiary);\n  background: transparent;\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  scroll-snap-align: start;\n  cursor: pointer;\n}\n\n.dshPlatform_tabs button:hover,\n.dshPlatform_tabs button[aria-selected='true'] {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_tabs button[aria-selected='true']::after,\n.dshPlatform_tabs button:focus-visible::after {\n  position: absolute;\n  right: 0;\n  bottom: -1px;\n  left: 0;\n  height: 2px;\n  border-radius: 2px 2px 0 0;\n  background: var(--dsw-alias-label-primary);\n  content: '';\n}\n\n.dshPlatform_tabs button:focus-visible {\n  border-radius: 2px;\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_tabPanel {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  min-width: 0;\n  padding-top: 2px;\n}\n\n.dshPlatform_tabPanel[hidden] { display: none; }\n.dshPlatform_tabPanel > .dshPlatform_section:last-child { padding-bottom: 0; border-bottom: 0; }\n\n.dshPlatform_section {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding-bottom: 20px;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshPlatform_sectionHeading h3 {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500;\n}\n\n.dshPlatform_segmented {\n  flex: none;\n  display: inline-flex;\n  padding: 2px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dshPlatform_segmented button {\n  box-sizing: border-box;\n  height: 28px;\n  padding: 0 10px;\n  border: none;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.dshPlatform_segmented button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_segmented button[aria-pressed='true'] {\n  background: var(--dsw-specific-sidebar-nav-item-active);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n.dshPlatform_versions {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  overflow: hidden;\n}\n\n.dshPlatform_experimentalVersions { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n\n.dshPlatform_versionCell {\n  min-width: 0;\n  padding: 12px 14px;\n}\n\n.dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_caption, .dshPlatform_version, .dshPlatform_detail { display: block; overflow-wrap: anywhere; }\n.dshPlatform_caption, .dshPlatform_detail { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_version { margin: 3px 0; font-size: 15px; line-height: 22px; font-weight: 600; }\n\n.dshPlatform_notice,\n.dshPlatform_error {\n  margin: 0;\n  padding: 8px 10px;\n  border-left: 3px solid var(--dsw-alias-state-warn-label);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-state-warn-label);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_error {\n  border-left-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshPlatform_actions {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 8px;\n}\n\n.dshPlatform_primaryButton,\n.dshPlatform_secondaryButton,\n.dshPlatform_dangerButton,\n.dshPlatform_dangerFilledButton,\n.dshPlatform_smallButton {\n  box-sizing: border-box;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  height: 36px;\n  padding: 0 14px;\n  border: none;\n  border-radius: 18px;\n  font: inherit;\n  font-size: 14px;\n  line-height: 22px;\n  cursor: pointer;\n}\n\n.dshPlatform_primaryButton {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n.dshPlatform_primaryButton:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n\n.dshPlatform_secondaryButton,\n.dshPlatform_smallButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n}\n.dshPlatform_secondaryButton:hover:not(:disabled),\n.dshPlatform_smallButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n\na.dshPlatform_secondaryButton { text-decoration: none; }\n\n.dshPlatform_checkSpinner {\n  box-sizing: border-box;\n  width: 14px;\n  height: 14px;\n  margin-right: 7px;\n  border: 2px solid currentColor;\n  border-right-color: transparent;\n  border-radius: 50%;\n  animation: checkSpin .75s linear infinite;\n}\n\n@keyframes checkSpin { to { transform: rotate(360deg); } }\n\n@media (prefers-reduced-motion: reduce) {\n  .dshPlatform_checkSpinner { animation-duration: 1.5s; }\n}\n\n.dshPlatform_dangerButton {\n  background: transparent;\n  color: var(--dsw-alias-state-error-primary);\n}\n.dshPlatform_dangerButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }\n.dshPlatform_dangerFilledButton { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground); }\n\n.dshPlatform_smallButton {\n  height: 28px;\n  padding: 0 10px;\n  border-radius: 14px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_primaryButton:disabled,\n.dshPlatform_secondaryButton:disabled,\n.dshPlatform_dangerButton:disabled,\n.dshPlatform_dangerFilledButton:disabled,\n.dshPlatform_smallButton:disabled,\n.dshPlatform_segmented button:disabled { opacity: .4; cursor: default; }\n\n.dshPlatform_primaryButton:focus-visible,\n.dshPlatform_secondaryButton:focus-visible,\n.dshPlatform_dangerButton:focus-visible,\n.dshPlatform_dangerFilledButton:focus-visible,\n.dshPlatform_smallButton:focus-visible,\n.dshPlatform_segmented button:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshPlatform_actionHeading { align-items: center; }\n.dshPlatform_updateState { display: flex; flex-direction: column; gap: 6px; }\n.dshPlatform_statusLine { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n.dshPlatform_statusLine output { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusLabel { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusDot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-border-l2); }\n.dshPlatform_statusActive .dshPlatform_statusDot { background: var(--dsw-alias-brand-primary); }\n.dshPlatform_statusSuccess .dshPlatform_statusDot { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_statusFailed { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_statusFailed .dshPlatform_statusDot { background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_updateState > p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }\n.dshPlatform_progress { height: 6px; overflow: hidden; border-radius: 3px; background: var(--dsw-alias-border-l2); }\n.dshPlatform_progress span { display: block; height: 100%; background: var(--dsw-alias-state-success-primary); transition: width .2s ease; }\n\n.dshPlatform_holds { display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold div { min-width: 0; }\n.dshPlatform_hold strong, .dshPlatform_hold span { display: block; overflow-wrap: anywhere; }\n.dshPlatform_hold strong { font-size: 13px; line-height: 20px; }\n.dshPlatform_hold span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n\n.dshPlatform_confirmation {\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-module-platform);\n}\n.dshPlatform_confirmation h4 { margin: 0; font-size: 14px; line-height: 22px; }\n.dshPlatform_confirmation p { margin: 4px 0 12px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_confirmation label { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px; }\n.dshPlatform_confirmation input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }\n.dshPlatform_confirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }\n\n.dshPlatform_maintenanceButton { flex: none; }\n.dshPlatform_maintenanceStatus {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n}\n.dshPlatform_restartConfirmation { border-color: var(--dsw-alias-border-l2); }\n\n.dshPlatform_toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_toggle input { position: absolute; opacity: 0; pointer-events: none; }\n.dshPlatform_toggle > span {\n  box-sizing: border-box;\n  width: 34px;\n  height: 20px;\n  padding: 2px;\n  border-radius: 10px;\n  background: var(--dsw-alias-border-l2);\n  transition: background .15s ease;\n}\n.dshPlatform_toggle > span::after {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-primary-foreground);\n  content: '';\n  transition: transform .15s ease;\n}\n.dshPlatform_toggle input:checked + span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_toggle input:checked + span::after { transform: translateX(14px); }\n.dshPlatform_toggle input:focus-visible + span { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dshPlatform_toggle input:disabled ~ * { opacity: .5; cursor: default; }\n.dshPlatform_toggle b { font-weight: 500; }\n\n.dshPlatform_settingRows { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; }\n.dshPlatform_settingRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 8px 12px; font-size: 13px; }\n.dshPlatform_settingRow + .dshPlatform_settingRow { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_settingRow > span { min-width: 0; }\n.dshPlatform_settingRow b, .dshPlatform_settingRow small { display: block; }\n.dshPlatform_settingRow b { font-weight: 500; }\n.dshPlatform_settingRow small { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.dshPlatform_settingRow select {\n  min-width: 120px;\n  height: 32px;\n  padding: 0 30px 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n}\n.dshPlatform_settingRow input[type='checkbox'] { width: 16px; height: 16px; flex: none; accent-color: var(--dsw-alias-brand-primary); }\n\n.dshPlatform_pluginSection { border-bottom: 0; }\n.dshPlatform_pluginList {\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n.dshPlatform_pluginRow {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 10px 16px;\n  min-height: 64px;\n  padding: 10px 12px;\n}\n.dshPlatform_pluginRow + .dshPlatform_pluginRow { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_pluginIdentity { min-width: 0; }\n.dshPlatform_pluginIdentity strong,\n.dshPlatform_pluginIdentity span { display: block; overflow-wrap: anywhere; }\n.dshPlatform_pluginIdentity strong { font-size: 13px; line-height: 20px; font-weight: 500; }\n.dshPlatform_pluginIdentity span { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.dshPlatform_pluginIdentity .dshPlatform_pendingBadge {\n  display: inline-block;\n  width: fit-content;\n  margin-top: 5px;\n  color: var(--dsw-alias-state-warn-label);\n  font-weight: 500;\n}\n.dshPlatform_managedBadge {\n  padding: 3px 9px;\n  border-radius: 12px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n  font-size: 12px;\n  line-height: 18px;\n  white-space: nowrap;\n}\n.dshPlatform_pluginActions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }\n.dshPlatform_pluginActions .dshPlatform_toggle { width: auto; }\n.dshPlatform_pluginOperation {\n  grid-column: 1 / -1;\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_pluginRestartNotice {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 12px 14px;\n  border: 1px solid var(--dsw-alias-state-warn-border);\n  border-radius: 8px;\n  background: var(--dsw-alias-state-warn-bg);\n}\n\n.dshPlatform_pluginRestartNotice div { min-width: 0; }\n.dshPlatform_pluginRestartNotice strong { font-size: 13px; line-height: 20px; }\n.dshPlatform_pluginRestartNotice p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }\n.dshPlatform_pluginRestartNotice button { flex: none; }\n.dshPlatform_emptyPlugins { margin: 0; padding: 24px 12px; color: var(--dsw-alias-label-tertiary); text-align: center; font-size: 13px; }\n\n.dshPlatform_logSection { gap: 10px; }\n\n.dshPlatform_logTools {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.dshPlatform_logConnection {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  min-height: 24px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshPlatform_logConnection > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-warn-label);\n}\n\n.dshPlatform_logConnection.dshPlatform_live > span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_logConnection.dshPlatform_disconnected > span { background: var(--dsw-alias-state-error-primary); }\n\n.dshPlatform_autoScrollButton,\n.dshPlatform_clearLogsButton {\n  min-height: 26px;\n  padding: 2px 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-secondary);\n  background: transparent;\n  font: inherit;\n  font-size: 11px;\n  cursor: pointer;\n}\n\n.dshPlatform_autoScrollButton:hover,\n.dshPlatform_clearLogsButton:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_autoScrollButton[aria-pressed='true'] { color: var(--dsw-alias-label-primary); }\n.dshPlatform_clearLogsButton:disabled { opacity: 0.45; cursor: default; }\n\n.dshPlatform_logFilters {\n  display: grid;\n  grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(110px, auto));\n  gap: 8px;\n}\n\n.dshPlatform_logFilters input,\n.dshPlatform_logFilters select {\n  box-sizing: border-box;\n  min-width: 0;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 7px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n  font-size: 12px;\n}\n\n.dshPlatform_logFilters input::placeholder { color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_logFilters input:focus-visible,\n.dshPlatform_logFilters select:focus-visible {\n  border-color: var(--dsw-alias-state-business-primary);\n  outline: 1px solid var(--dsw-alias-state-business-primary);\n}\n\n.dshPlatform_logSummary {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_logList {\n  display: flex;\n  flex-direction: column;\n  max-height: min(320px, 42dvh);\n  overflow: auto;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dshPlatform_logEntry {\n  min-width: 0;\n  padding: 10px 12px;\n  background: var(--dsw-alias-bg-module-platform);\n  cursor: pointer;\n}\n\n.dshPlatform_logEntry + .dshPlatform_logEntry { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_logEntry:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_logEntry:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }\n.dshPlatform_logMeta { display: flex; align-items: center; gap: 8px; min-width: 0; }\n.dshPlatform_logMessageRow { display: flex; align-items: center; gap: 10px; min-width: 0; }\n.dshPlatform_logMessageRow > pre { flex: 1; min-width: 0; }\n.dshPlatform_logChevron {\n  position: relative;\n  top: 2px;\n  flex: none;\n  width: 10px;\n  height: 10px;\n  margin-right: 1px;\n}\n.dshPlatform_logChevron::before {\n  position: absolute;\n  top: 3px;\n  left: 1px;\n  width: 8px;\n  height: 5px;\n  background: var(--dsw-alias-label-tertiary);\n  clip-path: polygon(0 0, 50% 72%, 100% 0, 100% 28%, 50% 100%, 0 28%);\n  content: \"\";\n  transform-origin: center;\n}\n.dshPlatform_logEntry[aria-expanded='true'] .dshPlatform_logChevron::before { transform: rotate(180deg); }\n.dshPlatform_logLevel { flex: none; font-size: 11px; line-height: 18px; font-weight: 600; }\n.dshPlatform_logDebug { color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_logInfo { color: var(--dsw-alias-state-business-primary); }\n.dshPlatform_logWarning { color: var(--dsw-alias-state-warn-label); }\n.dshPlatform_logError { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_logSource {\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dshPlatform_logMeta time {\n  flex: none;\n  margin-left: auto;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 18px;\n}\n\n.dshPlatform_logEntry pre {\n  margin: 5px 0 0;\n  overflow-wrap: anywhere;\n  color: var(--dsw-alias-label-primary);\n  font: 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  white-space: pre-wrap;\n}\n\n.dshPlatform_logDetails {\n  margin-top: 9px !important;\n  padding-top: 9px;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-secondary) !important;\n}\n\n.dshPlatform_emptyLogs {\n  margin: 0;\n  padding: 28px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  font-size: 13px;\n}\n\n.dshPlatform_updateReminder {\n  position: fixed;\n  right: 20px;\n  bottom: 20px;\n  z-index: 1000;\n  box-sizing: border-box;\n  width: min(360px, calc(100vw - 32px));\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 8px 24px rgb(0 0 0 / 24%);\n  pointer-events: auto;\n}\n.dshPlatform_updateReminder strong { display: block; font-size: 14px; line-height: 22px; }\n.dshPlatform_updateReminder p { margin: 4px 0 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n.dshPlatform_reminderActions { display: flex; justify-content: flex-end; gap: 8px; }\n.dshPlatform_reminderActions button {\n  min-height: 30px;\n  padding: 4px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 15px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_reminderActions button:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n@media (max-width: 640px) {\n  .dshPlatform_sectionHeading { flex-direction: column; gap: 10px; }\n  .dshPlatform_actionHeading { align-items: flex-start; }\n  .dshPlatform_versions { grid-template-columns: 1fr; }\n  .dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); }\n  .dshPlatform_segmented { width: 100%; }\n  .dshPlatform_segmented button { flex: 1; }\n  .dshPlatform_actions > button { flex: 1 1 calc(50% - 8px); }\n  .dshPlatform_actions { width: 100%; justify-content: flex-start; }\n  .dshPlatform_maintenanceButton { width: 100%; }\n  .dshPlatform_toggle { width: 100%; justify-content: space-between; }\n  .dshPlatform_settingRow { align-items: flex-start; }\n  .dshPlatform_pluginRow { grid-template-columns: 1fr; align-items: stretch; }\n  .dshPlatform_pluginActions { justify-content: space-between; }\n  .dshPlatform_pluginActions .dshPlatform_toggle { width: auto; }\n  .dshPlatform_pluginRestartNotice { align-items: stretch; flex-direction: column; }\n  .dshPlatform_pluginRestartNotice button { width: 100%; }\n  .dshPlatform_managedBadge { justify-self: start; }\n  .dshPlatform_logFilters { grid-template-columns: 1fr 1fr; }\n  .dshPlatform_logTools { width: 100%; flex-wrap: wrap; }\n  .dshPlatform_logConnection { margin-right: auto; }\n  .dshPlatform_logFilters input { grid-column: 1 / -1; }\n  .dshPlatform_logMeta { flex-wrap: wrap; }\n  .dshPlatform_logMeta time { width: auto; margin-left: auto; }\n  .dshPlatform_logList { max-height: min(260px, 36dvh); }\n  .dshPlatform_updateReminder { right: 16px; bottom: 16px; }\n}\n\n@media (max-width: 480px) {\n  [role='dialog']:has(.dshPlatform_root) > nav { display: none; }\n  [role='dialog']:has(.dshPlatform_root) > div { min-width: 0; }\n  .dshPlatform_actions > button { flex-basis: 100%; }\n}\n";
  document.head.appendChild(tag);
}
const React = require('react')
const { useCallback, useEffect, useRef, useState } = React

const API = '/_dsh_platform/api/v1'
const TERMINAL = new Set(['idle', 'success', 'failed'])
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

const inject = ['slots', 'locale']

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function localTime(value, locale) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
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
    const error = new Error(value.error ?? `HTTP ${String(response.status)}`)
    error.statusCode = response.status
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
  if (['debug', 'info', 'warning', 'error'].includes(entry?.level)) return entry.level
  if (entry?.stream === 'stderr') return 'error'
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

function LogViewer({ active, t }) {
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [level, setLevel] = useState('all')
  const [streamState, setStreamState] = useState('connecting')
  const [autoScroll, setAutoScroll] = useState(true)
  const [displayLimit, setDisplayLimit] = useState(readLogDisplayLimit)
  const [expanded, setExpanded] = useState(() => new Set())
  const listRef = useRef(null)
  const clearCutoff = useRef(readLogClearCutoff())
  const logIdentities = useRef(new Set())
  const pendingEntries = useRef([])
  const renderFrame = useRef()

  useEffect(() => {
    if (!active) return undefined
    setStreamState('connecting')
    const stream = new EventSource(`${API}/logs/stream?limit=${String(LOG_STREAM_LIMIT)}`)
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
    stream.onopen = () => setStreamState('live')
    stream.onerror = () => setStreamState('disconnected')
    return () => {
      stream.close()
      if (renderFrame.current !== undefined) window.cancelAnimationFrame(renderFrame.current)
      for (const entry of pendingEntries.current.splice(0)) logIdentities.current.delete(entry.identity)
      renderFrame.current = undefined
    }
  }, [active])

  const visibleEntries = limitProcessedLogEntries(entries, displayLimit)
  const sources = [...new Set(visibleEntries.map(item => item.value.source).filter(Boolean))].sort()
  const normalizedQuery = query.trim().toLocaleLowerCase(t('localeCode') === 'en' ? 'en-US' : 'zh-CN')
  const filtered = visibleEntries.filter(item => {
    const entry = item.value
    return (source === 'all' || entry.source === source)
      && (level === 'all' || logLevel(entry) === level)
      && (normalizedQuery === '' || JSON.stringify(entry).toLocaleLowerCase().includes(normalizedQuery))
  })

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
          'aria-pressed': autoScroll,
          onClick: () => setAutoScroll(value => !value),
        }, autoScroll ? t('pauseAutoScroll') : t('resumeAutoScroll')),
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
    h('div', { className: css.logSummary }, t('logCount').replace('{shown}', String(filtered.length)).replace('{total}', String(displayLimit))),
    filtered.length === 0
      ? h('p', { className: css.emptyLogs }, visibleEntries.length === 0 ? t('noLogs') : t('noMatchingLogs'))
      : h('div', { className: css.logList, ref: listRef }, filtered.map(item => {
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
        })))
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
    } catch {}
  }, [])

  useEffect(() => {
    void refresh()
    const events = new EventSource(`${API}/events`)
    events.addEventListener('state', () => { void refresh() })
    const timer = window.setInterval(() => { void refresh() }, 30_000)
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
      events.close()
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

function SystemPluginManager({ plugins, operation, busy, error, onAction, onRestart, restartBusy, t }) {
  const operationBusy = operation?.status === 'running'
  const visiblePlugins = plugins
  const restartRequired = plugins.some(plugin => plugin.pendingRestart)
  const operationLabel = {
    install: 'pluginActionInstall',
    uninstall: 'pluginActionUninstall',
    enable: 'pluginActionEnable',
    disable: 'pluginActionDisable',
  }[operation?.action] ?? 'pluginActionWorking'
  return h('section', { className: `${css.section} ${css.pluginSection}`, 'aria-labelledby': 'system-plugins-title' },
    h('div', { className: css.sectionHeading },
      h('div', null,
        h('h3', { id: 'system-plugins-title' }, t('systemPlugins')),
        h('p', null, t('systemPluginsDetail')))),
    restartRequired ? h('div', { className: css.pluginRestartNotice, role: 'status' },
      h('div', null,
        h('strong', null, t('pluginRestartRequired')),
        h('p', null, t('pluginRestartRequiredDetail'))),
      h('button', {
        type: 'button',
        className: css.primaryButton,
        disabled: busy,
        onClick: onRestart,
      }, restartBusy ? t('restarting') : t('restartDsh'))) : null,
    h('div', { className: css.pluginList },
      visiblePlugins.length === 0
        ? h('p', { className: css.emptyPlugins }, t('noSystemPlugins'))
        : visiblePlugins.map(plugin => {
            const isActive = operationBusy && operation.pluginId === plugin.id
            const description = plugin.description?.[t('localeCode')] ?? plugin.id
            return h('article', { className: css.pluginRow, key: plugin.id },
              h('div', { className: css.pluginIdentity },
                h('strong', null, `@dsh-docker/${plugin.id}`),
                h('span', null, description),
                plugin.pendingRestart ? h('span', { className: css.pendingBadge }, t('pluginPendingRestart')) : null),
              !plugin.installed
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
                        checked: plugin.enabled,
                        disabled: busy,
                        onChange: event => onAction(plugin, event.target.checked ? 'enable' : 'disable'),
                      }),
                      h('span', { 'aria-hidden': 'true' }),
                      h('b', null, plugin.enabled ? t('enabled') : t('disabled')))),
              isActive ? h('p', { className: css.pluginOperation, 'aria-live': 'polite' }, t(operationLabel)) : null)
          })),
    operation?.status === 'failed'
      ? h('p', { className: css.error, role: 'alert' }, localizedError(operation.error, t))
      : error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t))
      : null)
}

function PlatformManagement({ t }) {
  const [activeTab, setActiveTab] = useState('updates')
  const [status, setStatus] = useState(null)
  const [plugins, setPlugins] = useState([])
  const [error, setError] = useState('')
  const [authRequired, setAuthRequired] = useState(false)
  const [connection, setConnection] = useState('connecting')
  const [acting, setActing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [confirmStable, setConfirmStable] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [dataLossAccepted, setDataLossAccepted] = useState(false)
  const statusLoad = useRef()
  const statusLoadRevision = useRef(0)
  const requestedRestart = useRef(null)

  const refresh = useCallback(() => {
    statusLoadRevision.current += 1
    if (statusLoad.current !== undefined) return statusLoad.current
    statusLoad.current = (async () => {
      let value
      let loadedRevision
      do {
        loadedRevision = statusLoadRevision.current
        try {
          const [nextStatus, bundled] = await Promise.all([request('status'), request('bundled-plugins')])
          value = nextStatus
          setStatus(nextStatus)
          setPlugins(bundled.plugins ?? [])
          setError('')
          setAuthRequired(false)
          setConnection('online')
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
          setAuthRequired(nextError?.statusCode === 401)
          setConnection('offline')
          value = undefined
        }
      } while (loadedRevision !== statusLoadRevision.current)
      return value
    })().finally(() => { statusLoad.current = undefined })
    return statusLoad.current
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
      setAuthRequired(nextError?.statusCode === 401)
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
      setError(nextError instanceof Error ? nextError.message : String(nextError))
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
      const task = await request('restart-dsh', { method: 'POST' })
      requestedRestart.current = task.taskId
      setConfirmRestart(false)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setActing(false)
    }
  }, [refresh])

  const manageSystemPlugin = useCallback(async (plugin, action) => {
    const path = action === 'install'
      ? (plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action')
      : 'bundled-plugins/toggle'
    window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
    if (!await act(path, { method: 'POST', body: { id: plugin.id, action } })) {
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
    }
  }, [act])

  useEffect(() => {
    const stateEvents = new EventSource(`${API}/events`)
    stateEvents.addEventListener('state', () => { void refresh() })
    stateEvents.onopen = () => setConnection('online')
    stateEvents.onerror = () => setConnection('connecting')

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
      const value = await refresh()
      if (TERMINAL.has(value?.update?.status ?? 'idle')) void checkUpdates('page-open')
    })()

    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => {
      window.clearInterval(timer)
      stateEvents.close()
    }
  }, [checkUpdates, refresh])

  useEffect(() => {
    const restart = status?.dshRestart
    if (restart?.taskId !== requestedRestart.current) return
    if (restart.status === 'success') {
      requestedRestart.current = null
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      window.location.reload()
    } else if (restart.status === 'failed') {
      requestedRestart.current = null
    }
  }, [status?.dshRestart])

  const update = status?.update ?? {}
  const restart = status?.dshRestart ?? {}
  const pluginOperation = status?.systemPluginOperation ?? {}
  const checkingUpdates = checking || update.status === 'checking'
  const rollbackPlan = status?.rollbackPlan
  const restartBusy = restart.status === 'restarting'
  const busy = (acting && !checking) || restartBusy || pluginOperation.status === 'running'
    || (!TERMINAL.has(update.status ?? 'idle') && update.status !== 'checking')
  const updateActive = !TERMINAL.has(update.status ?? 'idle')
  const hasSupportedTarget = status?.supported !== null && status?.supported !== undefined
  const updateStatus = STATUS_LABELS[update.status ?? 'idle'] ?? 'statusUnknown'
  const updateStatusClass = update.status === 'failed'
    ? css.statusFailed
    : update.status === 'success'
      ? css.statusSuccess
      : updateActive ? css.statusActive : ''
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
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

  const returnStable = async () => {
    const restored = await act('return-stable', {
      method: 'POST',
      body: { planId: rollbackPlan?.planId, confirmDataLoss: true },
    })
    if (!restored) return
    setConfirmStable(false)
    setDataLossAccepted(false)
  }

  return h('div', { className: css.root },
    h('div', { className: css.heading },
      h('div', { className: css.titleRow },
        h('h2', { className: css.title }, t('title')),
        h('span', { className: `${css.connection} ${css[connection]}`, role: 'status' },
          h('span', { 'aria-hidden': 'true' }),
          t(connection))),
      h('p', { className: css.intro }, t('intro'))),

    authRequired ? h('div', { className: css.authRequired, role: 'alert' },
      h('span', null, t('platformAuthRequired')),
      h('a', {
        className: css.secondaryButton,
        href: '/_dsh_platform/auth/?next=/_dsh_platform/ui/',
        target: '_blank',
        rel: 'noopener noreferrer',
      }, t('platformSignIn'))) : null,

    h('div', { className: css.tabs, role: 'tablist', 'aria-label': t('managementSections') },
      ['updates', 'maintenance', 'plugins'].map(tab => h('button', {
        key: tab,
        id: `platform-tab-${tab}-button`,
        type: 'button',
        role: 'tab',
        'aria-selected': activeTab === tab,
        'aria-controls': `platform-tab-${tab}`,
        tabIndex: activeTab === tab ? 0 : -1,
        onClick: () => setActiveTab(tab),
      }, t(`${tab}Tab`)))),

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
          rollbackPlan ? h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void act('rollback', { method: 'POST', body: { planId: rollbackPlan.planId } }) } }, t('rollback')) : null,
          rollbackPlan?.returnStableAvailable ? h('button', { type: 'button', className: css.dangerButton, disabled: busy, onClick: () => setConfirmStable(true) }, t('returnStable')) : null)),
      h('div', { className: css.updateState, 'aria-live': 'polite' },
        h('div', { className: css.statusLine },
          h('span', { className: `${css.statusLabel} ${updateStatusClass}` },
            h('span', { className: css.statusDot, 'aria-hidden': 'true' }),
            t(updateStatus)),
          updateActive ? h('output', null, `${String(progress)}%`) : null),
        update.error || update.outcome ? h('p', null, update.error ? localizedError(update.error, t) : updateOutcome(update.outcome, t)) : null,
        updateActive ? h('div', { className: css.progress, role: 'progressbar', 'aria-label': t('progress'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress },
          h('span', { style: { width: `${String(progress)}%` } })) : null),
      update.metadataUnavailable ? h('p', { className: css.notice }, t('metadataUnavailable')) : null,
      holds.length > 0 ? h('div', { className: css.holds },
        holds.map(hold => h('div', { className: css.hold, key: hold.id },
          h('div', null,
            h('strong', null, `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${displayEnvironment(hold.environmentVersion)}` : ''}`),
            h('span', null, localizedHoldReason(hold, t))),
          h('button', { type: 'button', className: css.smallButton, disabled: busy, onClick: () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) } }, t('retry'))))) : null,
      confirmStable ? h('div', { className: css.confirmation, role: 'alertdialog', 'aria-labelledby': 'return-stable-title' },
        h('h4', { id: 'return-stable-title' }, t('returnStableTitle')),
        h('p', null, `${t('returnStableWarning')} ${localTime(rollbackPlan?.snapshot?.createdAt, t('localeCode'))}`),
        h('label', null,
          h('input', { type: 'checkbox', checked: dataLossAccepted, onChange: event => setDataLossAccepted(event.target.checked) }),
          h('span', null, t('confirmDataLoss'))),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => { setConfirmStable(false); setDataLossAccepted(false) } }, t('cancel')),
          h('button', { type: 'button', className: css.dangerFilledButton, disabled: !dataLossAccepted || busy, onClick: () => { void returnStable() } }, t('confirm')))) : null),

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
          href: '/_dsh_platform/ui/',
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
      restart.status === 'failed'
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
    h(LogViewer, { active: activeTab === 'maintenance', t })),

    h('div', {
      id: 'platform-tab-plugins',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-plugins-button',
      hidden: activeTab !== 'plugins',
    }, h(SystemPluginManager, {
      plugins,
      operation: pluginOperation,
      busy,
      error,
      onAction: (plugin, action) => { void manageSystemPlugin(plugin, action) },
      onRestart: () => { void restartDsh() },
      restartBusy,
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
      managementSections: '平台管理功能', updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件',
      platformAuthRequired: 'DSH 管理中心访问已锁定，请先完成独立验证。', platformSignIn: '验证管理中心访问',
      channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
      stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
      actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中', updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
      statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本', statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据', statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
      outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新', outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
      requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。', holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。',
      metadataUnavailable: '正式更新信息暂未发布，请稍后再试。',
      aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
      returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：', confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
      standaloneManagement: 'DSH 管理中心', standaloneManagementDetail: 'DSH 不可用时仍可进行更新、插件恢复、日志查看和终端操作。', openPlatformManagement: '打开 DSH 管理中心', restartDshSection: '重启 DSH', restartDshDetail: '仅重新启动 DSH，容器和管理中心服务保持运行。', restartDsh: '重新启动 DSH', cancelRestartDsh: '取消重启 DSH', restarting: '正在重新启动 DSH', restartFailed: 'DSH 重启失败', restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，重启完成后页面将自动刷新。', confirmRestart: '确认重启',
      automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭', checkInterval: '检查频率', updateNotifications: '网页更新提醒', updateNotificationsDetail: '仅自动检查发现新版本时提醒。',
      systemPlugins: '系统插件', systemPluginsDetail: '管理 DSH Docker 提供的系统插件。', noSystemPlugins: '当前环境没有提供系统插件。', platformManaged: '平台核心组件，始终保持安装和启用。', managed: '平台托管', notInstalled: '未安装', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置', pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载', pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginPendingRestart: '待重启', pluginRestartRequired: '需要重新启动 DSH', pluginRestartRequiredDetail: '插件设置已保存，重新启动 DSH 后生效。可以继续修改其他插件，最后只需重启一次。',
      logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块', logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误', logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', pauseAutoScroll: '暂停自动滚动', resumeAutoScroll: '继续自动滚动', clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
      interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
      stableNoticeTitle: '正式版本可更新', stableNoticeBody: '最新支持版本 {version} 已可用。', upstreamNoticeTitle: '上游版本可更新', upstreamNoticeBody: 'DSH 官方版本 {version} 已可用。', later: '稍后提醒', dismissVersion: '不再提醒此版本',
      online: '已连接', connecting: '正在重连', offline: '连接中断',
    },
    en: {
      localeCode: 'en',
      nav: 'Platform Management', title: 'Platform Management', intro: 'DSH Docker runtime, updates, and recovery',
      managementSections: 'Platform management sections', updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins',
      platformAuthRequired: 'DSH Management Console is locked. Complete its separate sign-in first.', platformSignIn: 'Sign in to DSH Management Console',
      channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
      stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
      actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking', updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
      statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream', statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data', statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
      outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold', outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
      requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.', holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.',
      metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.',
      aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
      returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:', confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
      standaloneManagement: 'DSH Management Console', standaloneManagementDetail: 'Updates, plugin recovery, logs, and terminal tools remain available when DSH is unavailable.', openPlatformManagement: 'Open DSH Management Console', restartDshSection: 'Restart DSH', restartDshDetail: 'Restart DSH only. The container and management console services remain running.', restartDsh: 'Restart DSH', cancelRestartDsh: 'Cancel DSH restart', restarting: 'Restarting DSH', restartFailed: 'DSH restart failed', restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This page reloads when DSH is ready.', confirmRestart: 'Restart',
      automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off', checkInterval: 'Check frequency', updateNotifications: 'Web update notifications', updateNotificationsDetail: 'Shown only when an automatic check finds a new version.',
      systemPlugins: 'System plugins', systemPluginsDetail: 'Manage the System Plugins provided by DSH Docker.', noSystemPlugins: 'No System Plugins are provided by the current Environment.', platformManaged: 'Core platform component. It is always installed and enabled.', managed: 'Platform managed', notInstalled: 'Not installed', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings', pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling', pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginPendingRestart: 'Pending restart', pluginRestartRequired: 'Restart DSH required', pluginRestartRequiredDetail: 'Plugin settings are saved and take effect after DSH restarts. You can make more changes and restart only once when finished.',
      logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module', logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error', logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', pauseAutoScroll: 'Pause auto-scroll', resumeAutoScroll: 'Resume auto-scroll', clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
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
}
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
