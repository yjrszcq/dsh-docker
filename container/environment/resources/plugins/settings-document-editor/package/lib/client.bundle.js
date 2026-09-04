window.__ModuleLoader__.load({ id: "@dsh-docker/settings-document-editor", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const css = Object.freeze({"actions":"dshSettingsDocumentEditor_actions","body":"dshSettingsDocumentEditor_body","close":"dshSettingsDocumentEditor_close","confirmActions":"dshSettingsDocumentEditor_confirmActions","confirmation":"dshSettingsDocumentEditor_confirmation","danger":"dshSettingsDocumentEditor_danger","dialog":"dshSettingsDocumentEditor_dialog","dirty":"dshSettingsDocumentEditor_dirty","editor":"dshSettingsDocumentEditor_editor","editorFrame":"dshSettingsDocumentEditor_editorFrame","error":"dshSettingsDocumentEditor_error","footer":"dshSettingsDocumentEditor_footer","header":"dshSettingsDocumentEditor_header","lineNumbers":"dshSettingsDocumentEditor_lineNumbers","loading":"dshSettingsDocumentEditor_loading","mask":"dshSettingsDocumentEditor_mask","overlay":"dshSettingsDocumentEditor_overlay","primary":"dshSettingsDocumentEditor_primary","saved":"dshSettingsDocumentEditor_saved"});
const styleId = "@dsh-docker/settings-document-editor/style.module.css";
if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-plugin-css]')].some(tag => tag.dataset.pluginCss === styleId)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = "@dsh-docker/settings-document-editor";
  tag.dataset.pluginCss = styleId;
  tag.textContent = ".dshSettingsDocumentEditor_overlay {\n  position: fixed;\n  inset: 0;\n  z-index: 1200;\n  display: grid;\n  place-items: center;\n  padding: 24px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshSettingsDocumentEditor_overlay,\n.dshSettingsDocumentEditor_overlay *,\n.dshSettingsDocumentEditor_overlay *::before,\n.dshSettingsDocumentEditor_overlay *::after {\n  corner-shape: round;\n}\n\n.dshSettingsDocumentEditor_mask {\n  position: absolute;\n  inset: 0;\n  background: rgb(0 0 0 / 48%);\n}\n\n.dshSettingsDocumentEditor_dialog {\n  position: relative;\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr) auto;\n  box-sizing: border-box;\n  width: min(820px, 100%);\n  height: min(680px, calc(100dvh - 48px));\n  min-height: 420px;\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 18px 50px rgb(0 0 0 / 32%);\n}\n\n.dshSettingsDocumentEditor_header,\n.dshSettingsDocumentEditor_footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 14px 18px;\n}\n\n.dshSettingsDocumentEditor_header { border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshSettingsDocumentEditor_footer { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshSettingsDocumentEditor_header h2 { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; }\n.dshSettingsDocumentEditor_header p { margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n\n.dshSettingsDocumentEditor_close {\n  flex: none;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  border: 0;\n  border-radius: 6px;\n  color: var(--dsw-alias-label-secondary);\n  background: transparent;\n  font: 18px/32px ui-sans-serif, system-ui, sans-serif;\n  cursor: pointer;\n}\n.dshSettingsDocumentEditor_close:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n.dshSettingsDocumentEditor_body { position: relative; min-height: 0; padding: 14px 18px; }\n.dshSettingsDocumentEditor_editorFrame {\n  display: grid;\n  grid-template-columns: auto minmax(0, 1fr);\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  min-height: 300px;\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n}\n.dshSettingsDocumentEditor_editorFrame:focus-within { border-color: var(--dsw-alias-border-l2); }\n\n.dshSettingsDocumentEditor_lineNumbers {\n  box-sizing: border-box;\n  min-width: 44px;\n  height: 100%;\n  margin: 0;\n  overflow: hidden;\n  padding: 12px 10px;\n  border-right: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, var(--dsw-alias-bg-module-platform));\n  font: 12px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  text-align: right;\n  user-select: none;\n}\n\n.dshSettingsDocumentEditor_editor {\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  resize: none;\n  padding: 12px 14px;\n  border: 0;\n  outline: none;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  font: 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  letter-spacing: 0;\n  tab-size: 2;\n}\n\n.dshSettingsDocumentEditor_loading {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 9px;\n  height: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n}\n.dshSettingsDocumentEditor_loading span {\n  width: 14px;\n  height: 14px;\n  border: 2px solid var(--dsw-alias-border-l2);\n  border-top-color: var(--dsw-alias-label-primary);\n  border-radius: 50%;\n  animation: document-editor-spin .8s linear infinite;\n}\n@keyframes document-editor-spin { to { transform: rotate(360deg); } }\n\n.dshSettingsDocumentEditor_error {\n  position: absolute;\n  right: 28px;\n  bottom: 24px;\n  left: 28px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 9px 11px;\n  border-left: 3px solid var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 4px 16px rgb(0 0 0 / 18%);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshSettingsDocumentEditor_actions,\n.dshSettingsDocumentEditor_confirmActions { display: flex; justify-content: flex-end; gap: 8px; }\n.dshSettingsDocumentEditor_footer button,\n.dshSettingsDocumentEditor_error button,\n.dshSettingsDocumentEditor_confirmation button {\n  min-height: 32px;\n  padding: 4px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 16px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshSettingsDocumentEditor_footer button:hover:not(:disabled),\n.dshSettingsDocumentEditor_error button:hover,\n.dshSettingsDocumentEditor_confirmation button:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dshSettingsDocumentEditor_footer button:disabled { cursor: not-allowed; opacity: .45; }\n.dshSettingsDocumentEditor_footer .dshSettingsDocumentEditor_primary {\n  border-color: transparent;\n  color: var(--dsw-alias-label-primary-foreground);\n  background: var(--dsw-alias-button-primary-fill);\n}\n.dshSettingsDocumentEditor_footer .dshSettingsDocumentEditor_primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n.dshSettingsDocumentEditor_saved, .dshSettingsDocumentEditor_dirty { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n.dshSettingsDocumentEditor_dirty { color: var(--dsw-alias-state-warn-label); }\n\n.dshSettingsDocumentEditor_confirmation {\n  position: absolute;\n  inset: 0;\n  z-index: 2;\n  display: grid;\n  place-items: center;\n  padding: 24px;\n  background: rgb(0 0 0 / 48%);\n}\n.dshSettingsDocumentEditor_confirmation > div {\n  box-sizing: border-box;\n  width: min(420px, 100%);\n  padding: 18px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 12px 30px rgb(0 0 0 / 28%);\n}\n.dshSettingsDocumentEditor_confirmation strong { font-size: 15px; line-height: 22px; }\n.dshSettingsDocumentEditor_confirmation p { margin: 6px 0 18px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n.dshSettingsDocumentEditor_confirmation .dshSettingsDocumentEditor_danger { color: var(--dsw-alias-state-error-primary); }\n\n@media (max-width: 640px) {\n  .dshSettingsDocumentEditor_overlay { padding: 0; }\n  .dshSettingsDocumentEditor_dialog { width: 100%; height: 100dvh; min-height: 0; border: 0; border-radius: 0; }\n  .dshSettingsDocumentEditor_header, .dshSettingsDocumentEditor_footer { padding: 12px 14px; }\n  .dshSettingsDocumentEditor_body { padding: 12px 14px; }\n  .dshSettingsDocumentEditor_editorFrame { min-height: 0; }\n  .dshSettingsDocumentEditor_footer { align-items: flex-start; flex-direction: column; }\n  .dshSettingsDocumentEditor_actions { width: 100%; }\n  .dshSettingsDocumentEditor_actions button { flex: 1; }\n  .dshSettingsDocumentEditor_error { right: 20px; bottom: 20px; left: 20px; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshSettingsDocumentEditor_loading span { animation: none; }\n}\n";
  document.head.appendChild(tag);
}
const React = require('react')
const { useCallback, useEffect, useRef, useState } = React
const { createPortal } = require('react-dom')

const API = '/_dsh_platform/plugin-api/v1/settings-document'
const h = React.createElement

const inject = ['slots', 'locale', 'connection', 'remote']

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

function apply(ctx) {
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
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
