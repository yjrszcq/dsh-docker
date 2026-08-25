export class ProxyConfigurationError extends Error {
  constructor(message, {
    code = 'INVALID_CONFIG',
    statusCode = 400,
    stage = 'validate',
    retryable = false,
  } = {}) {
    super(message)
    this.name = 'ProxyConfigurationError'
    this.code = code
    this.statusCode = statusCode
    this.stage = stage
    this.retryable = retryable
  }
}

export function proxyErrorBody(error) {
  return Object.freeze({
    error: Object.freeze({
      code: error?.code ?? 'PROXY_MANAGER_UNAVAILABLE',
      message: error?.message ?? 'proxy manager is unavailable',
      stage: error?.stage ?? 'unknown',
      retryable: error?.retryable === true,
    }),
  })
}
