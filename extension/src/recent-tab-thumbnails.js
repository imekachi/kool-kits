export function createRecentTabThumbnails(initialWindows = []) {
  const thumbnailsByWindowId = new Map()

  for (const { thumbnails, windowId } of initialWindows) {
    const normalizedWindowId = Number(windowId)
    if (!Number.isInteger(normalizedWindowId)) {
      continue
    }

    const thumbnailsByTabId = normalizeThumbnails(thumbnails)
    if (thumbnailsByTabId.size > 0) {
      thumbnailsByWindowId.set(normalizedWindowId, thumbnailsByTabId)
    }
  }

  function setThumbnail({ tabId, thumbnailUrl, windowId }) {
    if (
      !Number.isInteger(tabId) ||
      !Number.isInteger(windowId) ||
      !checkIsThumbnailUrl(thumbnailUrl)
    ) {
      return
    }

    const windowThumbnails = thumbnailsByWindowId.get(windowId) ?? new Map()
    windowThumbnails.delete(tabId)
    windowThumbnails.set(tabId, thumbnailUrl)
    thumbnailsByWindowId.set(windowId, windowThumbnails)
  }

  function getThumbnail({ tabId, windowId }) {
    return thumbnailsByWindowId.get(windowId)?.get(tabId) ?? ''
  }

  function removeTab({ tabId, windowId }) {
    const windowThumbnails = thumbnailsByWindowId.get(windowId)
    if (!windowThumbnails) {
      return
    }

    windowThumbnails.delete(tabId)
    if (windowThumbnails.size === 0) {
      thumbnailsByWindowId.delete(windowId)
    }
  }

  function removeWindow(windowId) {
    thumbnailsByWindowId.delete(windowId)
  }

  function reconcileWindow({ existingTabIds, windowId }) {
    const windowThumbnails = thumbnailsByWindowId.get(windowId)
    if (!windowThumbnails) {
      return
    }

    const existingTabIdSet = new Set(existingTabIds)
    for (const tabId of windowThumbnails.keys()) {
      if (!existingTabIdSet.has(tabId)) {
        windowThumbnails.delete(tabId)
      }
    }

    if (windowThumbnails.size === 0) {
      thumbnailsByWindowId.delete(windowId)
    }
  }

  function evictOldestThumbnail() {
    for (const [windowId, windowThumbnails] of thumbnailsByWindowId.entries()) {
      const oldestTabId = windowThumbnails.keys().next().value
      if (Number.isInteger(oldestTabId)) {
        windowThumbnails.delete(oldestTabId)
        if (windowThumbnails.size === 0) {
          thumbnailsByWindowId.delete(windowId)
        }
        return true
      }
    }

    return false
  }

  function toJSON() {
    return [...thumbnailsByWindowId.entries()].map(
      ([windowId, thumbnailsByTabId]) => ({
        thumbnails: [...thumbnailsByTabId.entries()].map(
          ([tabId, thumbnailUrl]) => ({ tabId, thumbnailUrl }),
        ),
        windowId,
      }),
    )
  }

  return {
    evictOldestThumbnail,
    getThumbnail,
    reconcileWindow,
    removeTab,
    removeWindow,
    setThumbnail,
    toJSON,
  }
}

function normalizeThumbnails(thumbnails = []) {
  const thumbnailsByTabId = new Map()

  for (const { tabId, thumbnailUrl } of thumbnails) {
    if (Number.isInteger(tabId) && checkIsThumbnailUrl(thumbnailUrl)) {
      thumbnailsByTabId.set(tabId, thumbnailUrl)
    }
  }

  return thumbnailsByTabId
}

function checkIsThumbnailUrl(thumbnailUrl) {
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(
    thumbnailUrl,
  )
}
