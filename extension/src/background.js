import { checkCanCopyTabUrl } from './copyable-url.js'
import { createRecentTabHistory } from './recent-tab-history.js'

const COPY_CURRENT_URL_COMMAND = 'copy-current-url'
const RECENT_TAB_SWITCHER_COMMAND = 'recent-tab-switcher'
const RECENT_TAB_SWITCHER_PREVIOUS_COMMAND = 'recent-tab-switcher-previous'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const SWITCHER_DOCUMENT_PATH = 'src/switcher.html'
const TOAST_SCRIPT_PATH = 'src/toast.js'
const RECENT_TAB_HISTORY_STORAGE_KEY = 'recentTabHistories'

let offscreenDocumentCreationPromise
let recentTabHistoryPromise
let switcherOpeningPromise
let switcherSession

chrome.commands.onCommand.addListener((command) => {
  if (command === COPY_CURRENT_URL_COMMAND) {
    void copyCurrentUrl()
    return
  }

  if (command === RECENT_TAB_SWITCHER_COMMAND) {
    void showOrAdvanceRecentTabSwitcher('next')
    return
  }

  if (command === RECENT_TAB_SWITCHER_PREVIOUS_COMMAND) {
    void showOrAdvanceRecentTabSwitcher('previous')
  }
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  void recordTabActivation(activeInfo)
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void removeClosedTab({ tabId, windowId: removeInfo.windowId })
})

chrome.windows.onRemoved.addListener((windowId) => {
  if (switcherSession?.switcherWindowId === windowId) {
    switcherSession = undefined
  }

  void removeClosedWindow(windowId)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'kool-kits-recent-tab-switcher') {
    return undefined
  }

  if (message.type === 'get-state') {
    void getSwitcherState().then(sendResponse)
    return true
  }

  if (message.type === 'ready') {
    markSwitcherReady()
    sendResponse({ ok: true })
    return undefined
  }

  if (message.type === 'commit-selection') {
    void commitSwitcherSelection({
      sourceWindowId: message.sourceWindowId,
      switcherWindowId: switcherSession?.switcherWindowId,
      tabId: message.tabId,
    }).then(sendResponse)
    return true
  }

  return undefined
})

async function getRecentTabHistory() {
  if (!recentTabHistoryPromise) {
    recentTabHistoryPromise = chrome.storage.session
      .get(RECENT_TAB_HISTORY_STORAGE_KEY)
      .then((storedValue) =>
        createRecentTabHistory(
          storedValue[RECENT_TAB_HISTORY_STORAGE_KEY] ?? [],
        ),
      )
  }

  return recentTabHistoryPromise
}

async function persistRecentTabHistory() {
  const recentTabHistory = await getRecentTabHistory()
  await chrome.storage.session.set({
    [RECENT_TAB_HISTORY_STORAGE_KEY]: recentTabHistory.toJSON(),
  })
}

async function recordTabActivation({ tabId, windowId }) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.recordActivation({ tabId, windowId })
  await persistRecentTabHistory()
}

async function removeClosedTab({ tabId, windowId }) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.removeTab({ tabId, windowId })
  await persistRecentTabHistory()
}

async function removeClosedWindow(windowId) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.removeWindow(windowId)
  await persistRecentTabHistory()
}

async function showOrAdvanceRecentTabSwitcher(direction) {
  if (switcherOpeningPromise) {
    return
  }

  if (switcherSession?.switcherWindowId) {
    if (!switcherSession.ready) {
      return
    }

    const delivered = await sendAdvanceSelection(direction)
    if (delivered) {
      return
    }

    switcherSession = undefined
  }

  switcherOpeningPromise = openRecentTabSwitcher().finally(() => {
    switcherOpeningPromise = undefined
  })
  await switcherOpeningPromise
}

async function openRecentTabSwitcher() {
  try {
    const sourceWindow = await chrome.windows.getLastFocused({
      populate: true,
      windowTypes: ['normal'],
    })

    if (!sourceWindow?.id || sourceWindow.type !== 'normal') {
      return
    }

    await reconcileSourceWindow(sourceWindow)

    const recentTabHistory = await getRecentTabHistory()
    const historyTabIds = recentTabHistory.getWindowHistory(sourceWindow.id)
    if (historyTabIds.length <= 1) {
      return
    }

    const sourceBounds = getSwitcherBounds(sourceWindow)
    switcherSession = {
      ready: false,
      sourceWindowId: sourceWindow.id,
      switcherTabId: undefined,
      switcherWindowId: undefined,
    }

    const switcherWindow = await chrome.windows.create({
      focused: true,
      height: sourceBounds.height,
      left: sourceBounds.left,
      top: sourceBounds.top,
      type: 'popup',
      url: chrome.runtime.getURL(SWITCHER_DOCUMENT_PATH),
      width: sourceBounds.width,
    })

    switcherSession.switcherTabId = switcherWindow.tabs?.[0]?.id
    switcherSession.switcherWindowId = switcherWindow.id
  } catch {
    switcherSession = undefined
  }
}

async function getSwitcherState() {
  if (!switcherSession?.sourceWindowId) {
    return { sourceWindowId: undefined, tabs: [] }
  }

  let sourceWindow
  try {
    sourceWindow = await chrome.windows.get(switcherSession.sourceWindowId, {
      populate: true,
    })
  } catch {
    return { sourceWindowId: undefined, tabs: [] }
  }

  await reconcileSourceWindow(sourceWindow)

  const recentTabHistory = await getRecentTabHistory()
  const historyTabIds = recentTabHistory.getWindowHistory(sourceWindow.id)
  const tabsById = new Map(
    (sourceWindow.tabs ?? []).map((tab) => [tab.id, tab]),
  )

  return {
    sourceWindowId: sourceWindow.id,
    tabs: historyTabIds
      .map((tabId) => tabsById.get(tabId))
      .filter(Boolean)
      .map(getSwitcherTab),
  }
}

async function commitSwitcherSelection({
  sourceWindowId,
  switcherWindowId,
  tabId,
}) {
  switcherSession = undefined

  if (Number.isInteger(tabId) && Number.isInteger(sourceWindowId)) {
    try {
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(sourceWindowId, { focused: true })
    } catch {
      // The selected tab or source window may have closed before release.
    }
  }

  if (Number.isInteger(switcherWindowId)) {
    try {
      await chrome.windows.remove(switcherWindowId)
    } catch {
      // The switcher may already be closed by the browser.
    }
  }
}

async function sendAdvanceSelection(direction) {
  try {
    const response = await chrome.runtime.sendMessage({
      direction,
      target: 'kool-kits-recent-tab-switcher-ui',
      type: 'advance-selection',
    })
    return response?.ok === true
  } catch {
    return false
  }
}

function markSwitcherReady() {
  if (switcherSession) {
    switcherSession.ready = true
  }
}

async function reconcileSourceWindow(sourceWindow) {
  const recentTabHistory = await getRecentTabHistory()
  const activeTab = (sourceWindow.tabs ?? []).find(
    (tab) => tab.active && Number.isInteger(tab.id),
  )
  if (activeTab) {
    recentTabHistory.recordActivation({
      tabId: activeTab.id,
      windowId: sourceWindow.id,
    })
  }

  const tabIds = (sourceWindow.tabs ?? [])
    .map((tab) => tab.id)
    .filter(Number.isInteger)
  recentTabHistory.reconcileWindow({
    existingTabIds: tabIds,
    windowId: sourceWindow.id,
  })
  await persistRecentTabHistory()
}

function getSwitcherTab(tab) {
  return {
    favIconUrl: tab.favIconUrl || getDefaultFaviconUrl(tab.url),
    id: tab.id,
    title: tab.title || tab.url || 'Untitled Tab',
    windowId: tab.windowId,
  }
}

function getDefaultFaviconUrl(pageUrl) {
  if (!pageUrl) {
    return ''
  }

  const faviconUrl = new URL(chrome.runtime.getURL('_favicon/'))
  faviconUrl.searchParams.set('pageUrl', pageUrl)
  faviconUrl.searchParams.set('size', '32')
  return faviconUrl.toString()
}

function getSwitcherBounds(sourceWindow) {
  const width = Math.min(1160, Math.max(520, sourceWindow.width ?? 1160))
  const height = 230
  const left = Math.round(
    (sourceWindow.left ?? 0) + ((sourceWindow.width ?? width) - width) / 2,
  )
  const top = Math.round(
    (sourceWindow.top ?? 0) + ((sourceWindow.height ?? height) - height) / 3,
  )

  return { height, left, top, width }
}

async function copyCurrentUrl() {
  const tab = await getActiveTab()

  if (!tab?.url || !checkCanCopyTabUrl(tab.url)) {
    return
  }

  const copyResult = await copyTextToClipboard(tab.url)
  if (!tab.id) {
    return
  }

  const canRenderToast = await ensureToastScript(tab.id)
  if (!canRenderToast) {
    return
  }

  await sendToastMessage(tab.id, {
    tone: copyResult.ok ? 'success' : 'error',
    text: copyResult.ok ? 'Copied Current URL' : 'Could not copy URL',
  })
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })

  return tab
}

async function ensureToastScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [TOAST_SCRIPT_PATH],
    })
    return true
  } catch {
    return false
  }
}

async function copyTextToClipboard(text) {
  try {
    await ensureOffscreenDocument()
    const response = await chrome.runtime.sendMessage({
      target: 'kool-kits-offscreen',
      type: 'copy-text',
      text,
    })

    return response?.ok ? { ok: true } : { ok: false }
  } catch {
    return { ok: false }
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  })

  if (existingContexts.length > 0) {
    return
  }

  offscreenDocumentCreationPromise ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['CLIPBOARD'],
      justification: 'Copy the active tab URL to the clipboard.',
    })
    .finally(() => {
      offscreenDocumentCreationPromise = undefined
    })

  await offscreenDocumentCreationPromise
}

async function sendToastMessage(tabId, toast) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      target: 'kool-kits-toast',
      type: 'show-toast',
      toast,
    })
  } catch {
    // The spec intentionally avoids fallback feedback channels.
  }
}
