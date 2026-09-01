export class AccessError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message)
    this.name = 'AccessError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export function accessErrorBody(error) {
  if (error instanceof AccessError) return {
    error: error.message,
    code: error.code,
    ...(Number.isInteger(error.details.retryAfterSeconds)
      ? { retryAfterSeconds: error.details.retryAfterSeconds } : {}),
  }
  return { error: 'access operation failed', code: 'ACCESS_INTERNAL_ERROR' }
}
