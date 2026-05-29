const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export async function getAuthToken({ interactive }) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive })
    const token = typeof result === 'string' ? result : result?.token
    return token ?? null
  } catch {
    return null
  }
}

export async function clearAuthToken(token) {
  if (!token) {
    return
  }

  try {
    await chrome.identity.removeCachedAuthToken({ token })
  } catch {
    // Token may already be gone; clearing is best-effort.
  }
}

export async function revokeAuthToken(token) {
  await clearAuthToken(token)
  if (!token) {
    return
  }

  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    })
  } catch {
    // Network failure on revoke is non-fatal; the cached token is already cleared.
  }
}
