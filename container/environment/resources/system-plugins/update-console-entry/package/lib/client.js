import React from 'react'
import css from './style.module.css'

export const inject = ['slots', 'locale']

export function UpdateConsoleEntry() {
  return React.createElement('section', { className: css.root },
    React.createElement('div', null,
      React.createElement('h2', null, '平台更新'),
      React.createElement('p', null, 'DSH Docker Update Console')),
    React.createElement('a', { className: css.action, href: '/_dsh_platform/ui/' }, '打开更新控制台'))
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('settings.dshPlatformUpdate', {
    zh: { nav: '平台更新' },
    en: { nav: 'Platform Update' },
  }), 'dsh-platform-update: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-platform-update',
    order: 90,
    label: () => ctx.locale.bind('settings.dshPlatformUpdate')('nav'),
    locale: 'settings.dshPlatformUpdate',
  }, UpdateConsoleEntry))
}
