export class AccessError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message)
    this.name = 'AccessError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function accessErrorBody(error) {
  if (error instanceof AccessError) return { error: error.message, code: error.code }
  return { error: 'access operation failed', code: 'ACCESS_INTERNAL_ERROR' }
}
