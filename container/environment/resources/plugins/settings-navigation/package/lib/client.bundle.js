window.__ModuleLoader__.load({ id: "@dsh-docker/settings-navigation", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const css = Object.freeze({"backButton":"dshSettingsNavigation_backButton","backMount":"dshSettingsNavigation_backMount","content":"dshSettingsNavigation_content","header":"dshSettingsNavigation_header","nav":"dshSettingsNavigation_nav","navList":"dshSettingsNavigation_navList","navTitle":"dshSettingsNavigation_navTitle","options":"dshSettingsNavigation_options","panel":"dshSettingsNavigation_panel"});
const styleId = "@dsh-docker/settings-navigation/style.module.css";
if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-plugin-css]')].some(tag => tag.dataset.pluginCss === styleId)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = "@dsh-docker/settings-navigation";
  tag.dataset.pluginCss = styleId;
  tag.textContent = ".dshSettingsNavigation_panel {\n  --dsh-settings-navigation-header-height: 54px;\n}\n\n.dshSettingsNavigation_nav,\n.dshSettingsNavigation_navList,\n.dshSettingsNavigation_content,\n.dshSettingsNavigation_options {\n  min-height: 0;\n}\n\n.dshSettingsNavigation_navList {\n  flex: 1;\n  overflow-x: hidden;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-gutter: stable;\n  padding-bottom: 18px;\n}\n\n.dshSettingsNavigation_backMount {\n  display: none;\n  flex: none;\n}\n\n.dshSettingsNavigation_backButton {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: 0;\n  border-radius: 50%;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  cursor: pointer;\n}\n\n.dshSettingsNavigation_backButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshSettingsNavigation_backButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] {\n  display: grid;\n  grid-template: var(--dsh-settings-navigation-header-height) minmax(0, 1fr) / minmax(0, 1fr);\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_nav,\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_content {\n  grid-area: 1 / 1 / 3 / 2;\n  width: auto;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_nav {\n  padding-right: 16px;\n  padding-left: 16px;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_navTitle {\n  padding-left: 0;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_navList {\n  padding-right: 0;\n  padding-bottom: 22px;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_content {\n  pointer-events: none;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_header {\n  position: relative;\n  z-index: 1;\n  pointer-events: none;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'] .dshSettingsNavigation_header > * {\n  pointer-events: auto;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'][data-dsh-settings-navigation-view='directory'] .dshSettingsNavigation_options {\n  display: none;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'][data-dsh-settings-navigation-view='detail'] .dshSettingsNavigation_nav {\n  display: none;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'][data-dsh-settings-navigation-view='detail'] .dshSettingsNavigation_content {\n  pointer-events: auto;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'][data-dsh-settings-navigation-view='detail'] .dshSettingsNavigation_backMount {\n  display: inline-flex;\n  align-items: center;\n  margin-right: auto;\n}\n\n.dshSettingsNavigation_panel[data-dsh-settings-navigation-mode='compact'][data-dsh-settings-navigation-view='detail'] .dshSettingsNavigation_options {\n  display: block;\n}\n";
  document.head.appendChild(tag);
}
const React = require('react')
const { useCallback, useEffect, useRef, useState } = React
const { createPortal } = require('react-dom')
const { IconChevronLeftOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')

const h = React.createElement
const COMPACT_WIDTH = 640
const NS = 'settings.dshSettingsNavigation'

const inject = ['slots', 'locale']

function directChildren(element) {
  return Array.from(element?.children ?? [])
}

function matchSettingsDialog(dialog) {
  if (dialog?.getAttribute?.('role') !== 'dialog'
    || dialog.getAttribute('aria-modal') !== 'true') return null
  const labelledBy = dialog.getAttribute('aria-labelledby')
  const title = labelledBy ? dialog.ownerDocument?.getElementById(labelledBy) : null
  if (!title || !dialog.contains(title)) return null

  const [nav, content, ...extra] = directChildren(dialog)
  if (extra.length !== 0 || nav?.tagName !== 'NAV' || content === undefined
    || !nav.contains(title)) return null
  const [navTitle, navList, ...navExtra] = directChildren(nav)
  const [header, options, ...contentExtra] = directChildren(content)
  if (navExtra.length !== 0 || contentExtra.length !== 0 || navTitle !== title
    || navList === undefined || header === undefined || options === undefined) return null
  const buttons = Array.from(navList.querySelectorAll?.('button') ?? [])
  const current = buttons.find(button => button.getAttribute('aria-current') === 'true')
  if (buttons.length === 0 || current === undefined || header.querySelector?.('button') === null) return null
  return { dialog, nav, navTitle, navList, content, header, options, buttons, current }
}

function findSettingsDialog(root) {
  for (const dialog of root.querySelectorAll?.('[role="dialog"][aria-modal="true"][aria-labelledby]') ?? []) {
    const match = matchSettingsDialog(dialog)
    if (match !== null) return match
  }
  return null
}

class SettingsNavigationController {
  constructor({ root, ResizeObserverImpl, MutationObserverImpl, requestFrame, classes, onChange }) {
    this.root = root
    this.ResizeObserverImpl = ResizeObserverImpl
    this.MutationObserverImpl = MutationObserverImpl
    this.requestFrame = requestFrame
    this.classes = classes
    this.onChange = onChange
    this.match = null
    this.compact = false
    this.view = 'directory'
    this.backMount = null
    this.resizeObserver = null
    this.mutationObserver = null
    this.scanQueued = false
  }

  start() {
    this.scan()
    this.mutationObserver = new this.MutationObserverImpl(() => this.queueScan())
    this.mutationObserver.observe(this.root.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-current', 'aria-labelledby'],
    })
  }

  stop() {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    this.detach()
  }

  queueScan() {
    if (this.scanQueued) return
    this.scanQueued = true
    queueMicrotask(() => {
      this.scanQueued = false
      this.scan()
    })
  }

  scan() {
    const next = findSettingsDialog(this.root)
    if (next?.dialog === this.match?.dialog) {
      this.match.current = next.current
      this.match.buttons = next.buttons
      return
    }
    this.detach()
    if (next !== null) this.attach(next)
  }

  attach(match) {
    this.match = match
    const roles = [
      ['dialog', match.dialog, this.classes.panel],
      ['nav', match.nav, this.classes.nav],
      ['nav-title', match.navTitle, this.classes.navTitle],
      ['nav-list', match.navList, this.classes.navList],
      ['content', match.content, this.classes.content],
      ['header', match.header, this.classes.header],
      ['options', match.options, this.classes.options],
    ]
    for (const [role, node, className] of roles) {
      node.dataset.dshSettingsNavigationRole = role
      node.classList.add(className)
    }
    this.backMount = this.root.createElement('span')
    this.backMount.className = this.classes.backMount
    this.backMount.dataset.dshSettingsNavigationRole = 'back'
    match.header.prepend(this.backMount)
    match.navList.addEventListener('click', this.onNavClick)

    this.view = match.buttons.indexOf(match.current) > 0 ? 'detail' : 'directory'
    this.resizeObserver = new this.ResizeObserverImpl(entries => {
      const width = entries.at(-1)?.contentRect?.width ?? match.dialog.getBoundingClientRect().width
      this.setCompact(width < COMPACT_WIDTH)
    })
    this.resizeObserver.observe(match.dialog)
    this.setCompact(match.dialog.getBoundingClientRect().width < COMPACT_WIDTH)
  }

  detach() {
    if (this.match === null) return
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.match.navList.removeEventListener('click', this.onNavClick)
    for (const node of [
      this.match.dialog, this.match.nav, this.match.navTitle, this.match.navList,
      this.match.content, this.match.header, this.match.options,
    ]) {
      delete node.dataset.dshSettingsNavigationRole
      node.classList.remove(...Object.values(this.classes))
    }
    this.backMount?.remove()
    this.backMount = null
    this.match = null
    this.compact = false
    this.view = 'directory'
    this.onChange()
  }

  setCompact(compact) {
    if (this.match === null) return
    this.compact = compact
    this.match.dialog.dataset.dshSettingsNavigationMode = compact ? 'compact' : 'wide'
    this.match.dialog.dataset.dshSettingsNavigationView = this.view
    this.onChange()
  }

  onNavClick = event => {
    if (!this.compact || this.match === null) return
    const button = event.target.closest?.('button')
    if (!button || !this.match.navList.contains(button)) return
    this.match.current = button
    this.view = 'detail'
    this.match.dialog.dataset.dshSettingsNavigationView = this.view
    this.onChange()
    this.requestFrame(() => this.backMount?.querySelector('button')?.focus())
  }

  back() {
    if (!this.compact || this.match === null) return
    this.view = 'directory'
    this.match.dialog.dataset.dshSettingsNavigationView = this.view
    this.onChange()
    const current = this.match.current
    this.requestFrame(() => current?.focus())
  }

  snapshot() {
    return {
      active: this.match !== null,
      compact: this.compact,
      view: this.view,
      backMount: this.backMount,
    }
  }
}

function SettingsNavigationOverlay({ t }) {
  const [, render] = useState(0)
  const forceRender = useCallback(() => render(value => value + 1), [])
  const controllerRef = useRef(null)

  useEffect(() => {
    const controller = new SettingsNavigationController({
      root: document,
      ResizeObserverImpl: ResizeObserver,
      MutationObserverImpl: MutationObserver,
      requestFrame: requestAnimationFrame,
      classes: css,
      onChange: forceRender,
    })
    controllerRef.current = controller
    controller.start()
    return () => {
      controller.stop()
      controllerRef.current = null
    }
  }, [forceRender])

  const state = controllerRef.current?.snapshot()
  if (!state?.active || !state.compact || state.view !== 'detail' || state.backMount === null) return null
  return createPortal(h('button', {
    type: 'button',
    className: css.backButton,
    'aria-label': t('back'),
    onClick: () => controllerRef.current?.back(),
  }, h(IconChevronLeftOutline14, { size: 18 })), state.backMount)
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, {
    zh: { back: '返回设置目录' },
    en: { back: 'Back to Settings directory' },
  }), 'dsh-settings-navigation: locale')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-settings-navigation',
    order: 70,
    locale: NS,
  }, SettingsNavigationOverlay))
}
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
