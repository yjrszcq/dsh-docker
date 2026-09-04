import React, { useCallback, useEffect, useRef, useState } from 'react'
import css from './style.module.css'
const { createPortal } = require('react-dom')

const API = '/_dsh_platform/plugin-api/v1/settings-document'
const h = React.createElement

export const inject = ['slots', 'locale', 'connection', 'remote']

function browserCookie(name) {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return ''
}

async function request(method, body) {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const response = await fetch(API, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(mutation ? { 'x-dsh-csrf': browserCookie('dsh_gateway_csrf') } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) {
    const error = new Error(value.error ?? `HTTP ${String(response.status)}`)
    error.status = response.status
    throw error
  }
  return value
}

class DocumentController {
  constructor() {
    this.listeners = new Set()
    this.state = {
      open: false,
      loading: false,
      saving: false,
      content: '',
      savedContent: '',
      revision: null,
      error: null,
      conflict: false,
      confirmClose: false,
    }
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(patch) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  async open() {
    if (this.state.open) return
    this.publish({
      open: true,
      loading: true,
      content: '',
      savedContent: '',
      revision: null,
      error: null,
      conflict: false,
      confirmClose: false,
    })
    await this.reload()
  }

  async reload() {
    this.publish({ loading: true, error: null, conflict: false, confirmClose: false })
    try {
      const value = await request('GET')
      this.publish({
        loading: false,
        content: value.content,
        savedContent: value.content,
        revision: value.revision,
      })
    } catch (error) {
      this.publish({ loading: false, error: error.message })
    }
  }

  edit(content) {
    this.publish({ content, error: null, conflict: false })
  }

  requestClose() {
    if (this.state.saving) return
    if (this.state.content !== this.state.savedContent) this.publish({ confirmClose: true })
    else this.close()
  }

  close() {
    this.publish({ open: false, confirmClose: false, error: null, conflict: false })
  }

  async save() {
    if (this.state.saving || this.state.loading || this.state.revision === null
      || this.state.content === this.state.savedContent) return
    this.publish({ saving: true, error: null, conflict: false })
    try {
      const value = await request('PUT', { content: this.state.content, revision: this.state.revision })
      this.publish({
        saving: false,
        content: value.content,
        savedContent: value.content,
        revision: value.revision,
      })
    } catch (error) {
      this.publish({ saving: false, error: error.message, conflict: error.status === 409 })
    }
  }
}

function Editor({ controller, t }) {
  const [state, setState] = useState(controller.state)
  const textarea = useRef(null)
  const lineNumbers = useRef(null)

  useEffect(() => controller.subscribe(setState), [controller])
  useEffect(() => {
    if (state.open && !state.loading && !state.confirmClose) textarea.current?.focus()
  }, [state.open, state.loading, state.confirmClose])

  const keyDown = useCallback(event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void controller.save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      controller.requestClose()
    }
  }, [controller])

  useEffect(() => {
    if (!state.open) return undefined
    document.addEventListener('keydown', keyDown)
    return () => document.removeEventListener('keydown', keyDown)
  }, [keyDown, state.open])

  if (!state.open) return null
  const dirty = state.content !== state.savedContent
  return createPortal(h('div', { className: css.overlay, role: 'presentation' },
    h('div', { className: css.mask, 'aria-hidden': 'true', onClick: () => controller.requestClose() }),
    h('section', { className: css.dialog, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-settings-document-title' },
      h('header', { className: css.header },
        h('div', null,
          h('h2', { id: 'dsh-settings-document-title' }, t('title')),
          h('p', null, t('filename'))),
        h('button', { className: css.close, type: 'button', 'aria-label': t('close'), onClick: () => controller.requestClose() }, '×')),
      h('div', { className: css.body },
        state.loading
          ? h('div', { className: css.loading, role: 'status' }, h('span', null), t('loading'))
          : h('div', { className: css.editorFrame },
              h('pre', { ref: lineNumbers, className: css.lineNumbers, 'aria-hidden': 'true' },
                Array.from({ length: state.content.split('\n').length }, (_, index) => String(index + 1)).join('\n')),
              h('textarea', {
                ref: textarea,
                className: css.editor,
                value: state.content,
                wrap: 'off',
                spellCheck: false,
                'aria-label': t('editorLabel'),
                onChange: event => controller.edit(event.target.value),
                onScroll: event => { lineNumbers.current.scrollTop = event.currentTarget.scrollTop },
              })),
        state.error === null ? null : h('div', { className: css.error, role: 'alert' },
          h('span', null, state.conflict ? t('conflict') : t('loadError')),
          state.conflict ? h('button', { type: 'button', onClick: () => { void controller.reload() } }, t('reload')) : null)),
      h('footer', { className: css.footer },
        h('span', { className: dirty ? css.dirty : css.saved, role: 'status' }, dirty ? t('unsaved') : t('saved')),
        h('div', { className: css.actions },
          h('button', { type: 'button', disabled: dirty || state.loading || state.saving, onClick: () => { void controller.reload() } }, t('reload')),
          h('button', { type: 'button', onClick: () => controller.requestClose() }, t('cancel')),
          h('button', { className: css.primary, type: 'button', disabled: !dirty || state.loading || state.saving, onClick: () => { void controller.save() } }, state.saving ? t('saving') : t('save')))),
      state.confirmClose ? h('div', { className: css.confirmation, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-settings-document-discard-title' },
        h('div', null,
          h('strong', { id: 'dsh-settings-document-discard-title' }, t('discardTitle')),
          h('p', null, t('discardBody')),
          h('div', { className: css.confirmActions },
            h('button', { type: 'button', onClick: () => controller.publish({ confirmClose: false }) }, t('continueEditing')),
            h('button', { className: css.danger, type: 'button', onClick: () => controller.close() }, t('discard'))))) : null)), document.body)
}

function interceptDocumentOpen(target, method, controller, result) {
  const descriptor = Object.getOwnPropertyDescriptor(target, method)
  const intercepted = async () => {
    void controller.open()
    return result
  }
  Object.defineProperty(target, method, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: intercepted,
    writable: true,
  })
  return () => {
    if (target[method] !== intercepted) return
    if (descriptor === undefined) Reflect.deleteProperty(target, method)
    else Object.defineProperty(target, method, descriptor)
  }
}

export function apply(ctx) {
  const controller = new DocumentController()
  ctx.effect(() => ctx.locale.register('settings.dshDocumentEditor', {
    zh: {
      title: '编辑配置文件', filename: 'settings.yaml', close: '关闭', loading: '正在读取配置文件', editorLabel: '配置文件内容',
      loadError: '无法读取或保存配置文件。', conflict: '配置文件已在其他位置发生变化，请重新加载后再编辑。', reload: '重新加载',
      unsaved: '有未保存的修改', saved: '所有修改均已保存', cancel: '关闭', save: '保存', saving: '正在保存',
      discardTitle: '放弃未保存的修改？', discardBody: '关闭后，本次未保存的修改将会丢失。', continueEditing: '继续编辑', discard: '放弃修改',
    },
    en: {
      title: 'Edit configuration file', filename: 'settings.yaml', close: 'Close', loading: 'Loading configuration file', editorLabel: 'Configuration file content',
      loadError: 'The configuration file could not be loaded or saved.', conflict: 'The configuration file changed elsewhere. Reload it before editing again.', reload: 'Reload',
      unsaved: 'Unsaved changes', saved: 'All changes saved', cancel: 'Close', save: 'Save', saving: 'Saving',
      discardTitle: 'Discard unsaved changes?', discardBody: 'Your unsaved changes will be lost when this editor closes.', continueEditing: 'Continue editing', discard: 'Discard changes',
    },
  }), 'dsh-settings-document-editor: locale')

  const connection = ctx.get('connection')
  if (typeof connection.api?.settings?.openDocument === 'function') {
    ctx.effect(() => interceptDocumentOpen(
      connection.api.settings,
      'openDocument',
      controller,
      { result: { ok: true, value: { opened: true } } },
    ), 'dsh-settings-document-editor: legacy open action')
  } else {
    ctx.inject(['remote.settings'], child => {
      child.effect(() => interceptDocumentOpen(
        child.remote.settings,
        'openSettingsDocument',
        controller,
        { ok: true, value: { opened: true } },
      ), 'dsh-settings-document-editor: open action')
    })
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-settings-document-editor',
    order: 80,
    locale: 'settings.dshDocumentEditor',
  }, props => h(Editor, { ...props, controller })))
}
