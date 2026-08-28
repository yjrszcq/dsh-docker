export async function consumeInternalCapability(access, { token, audience, method, target }) {
  try {
    const result = await access.request('POST', '/v1/capabilities/consume', {
      token, audience, method, target,
    })
    return result.authorized === true
  } catch (error) {
    if (error?.statusCode === 401) return false
    if (!Number.isInteger(error?.statusCode) || error.statusCode >= 500) error.statusCode = 503
    throw error
  }
}
