import React, { useCallback, useEffect, useRef, useState } from 'react'
import css from './style.module.css'
const { createPortal } = require('react-dom')
const { IconChevronLeftOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')

const h = React.createElement
const COMPACT_WIDTH = 640
const NS = 'settings.dshSettingsNavigation'

export const inject = ['slots', 'locale']

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
    this.modeInitialized = false
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
    const sameStructure = next !== null && this.match !== null
      && ['dialog', 'nav', 'navTitle', 'navList', 'content', 'header', 'options']
        .every(key => next[key] === this.match[key])
    if (sameStructure) {
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
    const roles = [
      [this.match.dialog, this.classes.panel],
      [this.match.nav, this.classes.nav],
      [this.match.navTitle, this.classes.navTitle],
      [this.match.navList, this.classes.navList],
      [this.match.content, this.classes.content],
      [this.match.header, this.classes.header],
      [this.match.options, this.classes.options],
    ]
    for (const [node, className] of roles) {
      delete node.dataset.dshSettingsNavigationRole
      node.classList.remove(className)
    }
    delete this.match.dialog.dataset.dshSettingsNavigationMode
    delete this.match.dialog.dataset.dshSettingsNavigationView
    this.backMount?.remove()
    this.backMount = null
    this.match = null
    this.compact = false
    this.modeInitialized = false
    this.view = 'directory'
    this.onChange()
  }

  setCompact(compact) {
    if (this.match === null) return
    if (this.modeInitialized && compact && !this.compact) this.view = 'detail'
    this.compact = compact
    this.modeInitialized = true
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
      requestFrame: callback => requestAnimationFrame(callback),
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

export function apply(ctx) {
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
