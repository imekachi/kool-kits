const MAX_RECENT_TABS = 6

export function createRecentTabHistory(initialHistories = []) {
  const historiesByWindowId = new Map(
    initialHistories.map(({ tabIds, windowId }) => [
      Number(windowId),
      normalizeTabIds(tabIds),
    ]),
  )

  function recordActivation({ tabId, windowId }) {
    if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
      return
    }

    const existing = historiesByWindowId.get(windowId) ?? []
    historiesByWindowId.set(
      windowId,
      [tabId, ...existing.filter((id) => id !== tabId)].slice(
        0,
        MAX_RECENT_TABS,
      ),
    )
  }

  function removeTab({ tabId, windowId }) {
    const next = (historiesByWindowId.get(windowId) ?? []).filter(
      (id) => id !== tabId,
    )

    if (next.length === 0) {
      historiesByWindowId.delete(windowId)
      return
    }

    historiesByWindowId.set(windowId, next)
  }

  function removeWindow(windowId) {
    historiesByWindowId.delete(windowId)
  }

  function reconcileWindow({ existingTabIds, windowId }) {
    const existingTabIdSet = new Set(existingTabIds)
    const next = (historiesByWindowId.get(windowId) ?? []).filter((tabId) =>
      existingTabIdSet.has(tabId),
    )

    if (next.length === 0) {
      historiesByWindowId.delete(windowId)
      return []
    }

    historiesByWindowId.set(windowId, next)
    return [...next]
  }

  function getWindowHistory(windowId) {
    return [...(historiesByWindowId.get(windowId) ?? [])]
  }

  function toJSON() {
    return [...historiesByWindowId.entries()].map(([windowId, tabIds]) => ({
      tabIds: [...tabIds],
      windowId,
    }))
  }

  return {
    getWindowHistory,
    reconcileWindow,
    recordActivation,
    removeTab,
    removeWindow,
    toJSON,
  }
}

function normalizeTabIds(tabIds = []) {
  return [...new Set(tabIds.filter(Number.isInteger))].slice(0, MAX_RECENT_TABS)
}
