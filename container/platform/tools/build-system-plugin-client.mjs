#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement)
  if (next === source) throw new Error(`client source is missing ${label}`)
  return next
}

function cssModule(source, namespace) {
  const names = [...new Set([...source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map(match => match[1]))].sort()
  const classes = Object.fromEntries(names.map(name => [name, `${namespace}_${name}`]))
  let css = source
  for (const name of names.sort((left, right) => right.length - left.length)) {
    css = css.replace(new RegExp(`\\.${name}(?=[^A-Za-z0-9_-]|$)`, 'g'), `.${classes[name]}`)
  }
  return { classes, css }
}

export async function buildSystemPluginClient({ sourcePath, stylePath, pluginId }) {
  let source = await readFile(sourcePath, 'utf8')
  const namespace = pluginId === '@dsh-docker/platform-management'
    ? 'dshPlatform'
    : `dsh${pluginId.split('/').at(-1).split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`
  const style = cssModule(await readFile(stylePath, 'utf8'), namespace)
  source = replaceOnce(
    source,
    /^import React, \{ useCallback, useEffect, useRef, useState \} from 'react'\n/m,
    "const React = require('react')\nconst { useCallback, useEffect, useRef, useState } = React\n",
    'the React import',
  )
  source = replaceOnce(source, /^import css from '.\/style\.module\.css'\n/m, '', 'the CSS Module import')
  source = replaceOnce(source, 'export const inject =', 'const inject =', 'the inject export')
  source = replaceOnce(source, 'export function apply(ctx)', 'function apply(ctx)', 'the apply export')

  const styleId = `${pluginId}/style.module.css`
  return [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    `const css = Object.freeze(${JSON.stringify(style.classes)});`,
    `const styleId = ${JSON.stringify(styleId)};`,
    'if (typeof document !== \'undefined\' && ![...document.querySelectorAll(\'style[data-plugin-css]\')].some(tag => tag.dataset.pluginCss === styleId)) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = styleId;',
    `  tag.textContent = ${JSON.stringify(style.css)};`,
    '  document.head.appendChild(tag);',
    '}',
    source.trim(),
    'exports.inject = inject;',
    'exports.apply = apply;',
    'return module.exports; } });',
    '',
  ].join('\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 6) {
    console.error('usage: build-system-plugin-client.mjs <plugin-id> <source.js> <style.css> <output.js>')
    process.exit(64)
  }
  const [, , pluginId, sourcePath, stylePath, outputPath] = process.argv
  await writeFile(outputPath, await buildSystemPluginClient({ sourcePath, stylePath, pluginId }))
}
