import { readFileSync, writeFileSync } from 'node:fs'

function replaceExactlyOnce(target, before, after, description) {
  const source = readFileSync(target, 'utf8')
  const matches = source.split(before).length - 1

  if (matches !== 1) {
    throw new Error(
      `Expected exactly one ${description} in ${target}, found ${matches}. ` +
        'The upstream package may have changed; review this patch before building.',
    )
  }

  writeFileSync(target, source.replace(before, after))
}

replaceExactlyOnce(
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',
  'if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });',
  'if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, trustedHosts)) return new Response("forbidden", { status: 403 });',
  'privileged API trust check',
)

replaceExactlyOnce(
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js',
  'const target = resolve(path ?? home);',
  'const target = resolve(path ?? process.env.DSH_DEFAULT_WORKSPACE ?? home);',
  'directory picker default path',
)
