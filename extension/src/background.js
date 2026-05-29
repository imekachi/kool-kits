import { checkCanCopyTabUrl } from './copyable-url.js'
import { createRecentTabHistory } from './recent-tab-history.js'
import { createRecentTabThumbnails } from './recent-tab-thumbnails.js'
import { prepareThumbnailImage } from './thumbnail-image.js'
import { clearAuthToken, getAuthToken, revokeAuthToken } from './calendar-auth.js'
import { fetchTodaysEvents } from './calendar-events.js'
import { computeBadgeText, groupMeetings } from './meeting-reminder.js'
import { getMeetingSettings } from './meeting-settings.js'

const COPY_CURRENT_URL_COMMAND = 'copy-current-url'
const RECENT_TAB_SWITCHER_COMMAND = 'recent-tab-switcher'
const RECENT_TAB_SWITCHER_PREVIOUS_COMMAND = 'recent-tab-switcher-previous'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const SWITCHER_DOCUMENT_PATH = 'src/switcher.html'
const TOAST_SCRIPT_PATH = 'src/toast.js'
const RECENT_TAB_HISTORY_STORAGE_KEY = 'recentTabHistories'
const RECENT_TAB_THUMBNAILS_STORAGE_KEY = 'recentTabThumbnails'
const THUMBNAIL_ACTIVATION_CAPTURE_DELAY_MS = 250
const THUMBNAIL_CAPTURE_OPTIONS = { format: 'jpeg', quality: 45 }
const THUMBNAIL_CAPTURE_MIN_INTERVAL_MS = 1000
const SWITCHER_CARD_WIDTH = 179
const SWITCHER_MAX_VISIBLE_TABS = 6
const SWITCHER_WINDOW_HEIGHT = 230
const SWITCHER_WINDOW_MIN_WIDTH = 520
const SWITCHER_WINDOW_MAX_WIDTH = 1160
const SWITCHER_SHELL_HORIZONTAL_PADDING = 34
const SWITCHER_WINDOW_HORIZONTAL_PADDING = 0

let offscreenDocumentCreationPromise
let recentTabHistoryPromise
let switcherOpeningPromise
let switcherSession
const pendingThumbnailCapturesByWindowId = new Map()
let recentTabThumbnailsPromise
let thumbnailCaptureQueuePromise = Promise.resolve()
let lastThumbnailCaptureAt = 0
const activeTabGenerationsByWindowId = new Map()
const tabNavigationGenerations = new Map()

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
    bumpTabNavigationGeneration({ tabId, windowId: tab.windowId })
    void removeTabThumbnail({ tabId, windowId: tab.windowId })
  }
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
    void markSwitcherReady({
      layoutMetrics: message.layoutMetrics,
      visibleItemCount: message.visibleItemCount,
    }).then(sendResponse)
    return true
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

async function getRecentTabThumbnails() {
  if (!recentTabThumbnailsPromise) {
    recentTabThumbnailsPromise = chrome.storage.session
      .get(RECENT_TAB_THUMBNAILS_STORAGE_KEY)
      .then((storedValue) =>
        createRecentTabThumbnails(
          storedValue[RECENT_TAB_THUMBNAILS_STORAGE_KEY] ?? [],
        ),
      )
  }

  return recentTabThumbnailsPromise
}

async function persistRecentTabThumbnails() {
  const recentTabThumbnails = await getRecentTabThumbnails()
  for (let attempt = 0; attempt <= 6; attempt += 1) {
    try {
      await chrome.storage.session.set({
        [RECENT_TAB_THUMBNAILS_STORAGE_KEY]: recentTabThumbnails.toJSON(),
      })
      return
    } catch {
      if (!recentTabThumbnails.evictOldestThumbnail()) {
        return
      }
    }
  }
}

async function reconcileWindowThumbnailsToHistory(windowId) {
  const recentTabHistory = await getRecentTabHistory()
  const recentTabThumbnails = await getRecentTabThumbnails()
  const hadThumbnails = recentTabThumbnails.toJSON().length > 0
  recentTabThumbnails.reconcileWindow({
    existingTabIds: recentTabHistory.getWindowHistory(windowId),
    windowId,
  })
  if (hadThumbnails) {
    await persistRecentTabThumbnails()
  }
}

async function recordTabActivation({ tabId, windowId }) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.recordActivation({ tabId, windowId })
  bumpActiveTabGeneration(windowId)
  await persistRecentTabHistory()
  await reconcileWindowThumbnailsToHistory(windowId)
  scheduleVisibleTabThumbnailCapture({ tabId, windowId })
}

async function removeClosedTab({ tabId, windowId }) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.removeTab({ tabId, windowId })
  await persistRecentTabHistory()
  await removeTabThumbnail({ tabId, windowId })
}

async function removeClosedWindow(windowId) {
  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.removeWindow(windowId)
  await persistRecentTabHistory()
  await removeWindowThumbnails(windowId)
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

function scheduleVisibleTabThumbnailCapture({ tabId, windowId }) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return
  }

  const pending = pendingThumbnailCapturesByWindowId.get(windowId)
  if (pending) {
    clearTimeout(pending.timeoutId)
  }

  const timeoutId = setTimeout(() => {
    pendingThumbnailCapturesByWindowId.delete(windowId)
    void queueVisibleTabThumbnailCapture({ priority: false, tabId, windowId })
  }, THUMBNAIL_ACTIVATION_CAPTURE_DELAY_MS)

  pendingThumbnailCapturesByWindowId.set(windowId, { tabId, timeoutId })
}

function clearPendingThumbnailCapture(windowId) {
  const pending = pendingThumbnailCapturesByWindowId.get(windowId)
  if (!pending) {
    return
  }

  clearTimeout(pending.timeoutId)
  pendingThumbnailCapturesByWindowId.delete(windowId)
}

function queueVisibleTabThumbnailCapture({
  allowDelay = true,
  priority,
  tabId,
  windowId,
}) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return thumbnailCaptureQueuePromise
  }

  if (priority) {
    clearPendingThumbnailCapture(windowId)
  }

  thumbnailCaptureQueuePromise = thumbnailCaptureQueuePromise
    .catch(() => undefined)
    .then(() => waitForNextThumbnailCaptureSlot({ allowDelay }))
    .then(() => captureVisibleTabThumbnail({ tabId, windowId }))
    .catch(() => undefined)
  return thumbnailCaptureQueuePromise
}

async function waitForNextThumbnailCaptureSlot({ allowDelay }) {
  const now = Date.now()
  const nextAllowedAt =
    lastThumbnailCaptureAt + THUMBNAIL_CAPTURE_MIN_INTERVAL_MS
  if (nextAllowedAt > now) {
    if (!allowDelay) {
      throw new Error('thumbnail capture skipped by rate limit')
    }
    await new Promise((resolve) => {
      setTimeout(resolve, nextAllowedAt - now)
    })
  }
  lastThumbnailCaptureAt = Date.now()
}

async function captureVisibleTabThumbnail({ tabId, windowId }) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return
  }

  const activeTabGeneration = getActiveTabGeneration(windowId)
  const navigationGeneration = getTabNavigationGeneration({ tabId, windowId })
  try {
    const capturedDataUrl = await chrome.tabs.captureVisibleTab(
      windowId,
      THUMBNAIL_CAPTURE_OPTIONS,
    )
    if (!(await checkIsStillActiveTab({ tabId, windowId }))) {
      return
    }

    const thumbnailUrl = await prepareThumbnailImage(capturedDataUrl)
    if (
      !thumbnailUrl ||
      !(await checkIsStillActiveTab({ tabId, windowId })) ||
      activeTabGeneration !== getActiveTabGeneration(windowId) ||
      !(await checkIsTabStillInHistory({ tabId, windowId })) ||
      navigationGeneration !== getTabNavigationGeneration({ tabId, windowId })
    ) {
      return
    }

    const recentTabThumbnails = await getRecentTabThumbnails()
    recentTabThumbnails.setThumbnail({ tabId, thumbnailUrl, windowId })
    await persistRecentTabThumbnails()
  } catch {
    // Capture availability varies by page, tab state, and browser permissions.
  }
}

async function removeTabThumbnail({ tabId, windowId }) {
  const recentTabThumbnails = await getRecentTabThumbnails()
  recentTabThumbnails.removeTab({ tabId, windowId })
  await persistRecentTabThumbnails()
}

async function removeWindowThumbnails(windowId) {
  const recentTabThumbnails = await getRecentTabThumbnails()
  recentTabThumbnails.removeWindow(windowId)
  await persistRecentTabThumbnails()
}

async function checkIsStillActiveTab({ tabId, windowId }) {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId })
  return activeTab?.id === tabId
}

async function checkIsTabStillInHistory({ tabId, windowId }) {
  const recentTabHistory = await getRecentTabHistory()
  return recentTabHistory.getWindowHistory(windowId).includes(tabId)
}

function getActiveTabGeneration(windowId) {
  return activeTabGenerationsByWindowId.get(windowId) ?? 0
}

function bumpActiveTabGeneration(windowId) {
  activeTabGenerationsByWindowId.set(
    windowId,
    getActiveTabGeneration(windowId) + 1,
  )
}

function getTabNavigationGeneration({ tabId, windowId }) {
  return tabNavigationGenerations.get(getTabKey({ tabId, windowId })) ?? 0
}

function bumpTabNavigationGeneration({ tabId, windowId }) {
  const tabKey = getTabKey({ tabId, windowId })
  tabNavigationGenerations.set(
    tabKey,
    (tabNavigationGenerations.get(tabKey) ?? 0) + 1,
  )
}

function getTabKey({ tabId, windowId }) {
  return `${windowId}:${tabId}`
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

    void refreshSourceWindowThumbnail(sourceWindow)

    const recentTabHistory = await getRecentTabHistory()
    const historyTabIds = recentTabHistory.getWindowHistory(sourceWindow.id)
    if (historyTabIds.length <= 1) {
      return
    }

    const sourceBounds = getSwitcherBounds(sourceWindow, historyTabIds.length)
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

async function refreshSourceWindowThumbnail(sourceWindow) {
  const activeTab = (sourceWindow.tabs ?? []).find(
    (tab) => tab.active && Number.isInteger(tab.id),
  )

  clearPendingThumbnailCapture(sourceWindow.id)
  await queueVisibleTabThumbnailCapture({
    allowDelay: false,
    priority: true,
    tabId: activeTab?.id,
    windowId: sourceWindow.id,
  })
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
  const recentTabThumbnails = await getRecentTabThumbnails()

  return {
    sourceWindowId: sourceWindow.id,
    tabs: historyTabIds
      .map((tabId) => tabsById.get(tabId))
      .filter(Boolean)
      .map((tab) =>
        getSwitcherTab({
          tab,
          thumbnailUrl: recentTabThumbnails.getThumbnail({
            tabId: tab.id,
            windowId: sourceWindow.id,
          }),
        }),
      ),
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

async function markSwitcherReady({ layoutMetrics, visibleItemCount }) {
  if (!switcherSession) {
    return { ok: false }
  }

  switcherSession.ready = true
  await resizeSwitcherToVisibleItems({ layoutMetrics, visibleItemCount })
  return { ok: true }
}

async function resizeSwitcherToVisibleItems({
  layoutMetrics,
  visibleItemCount,
}) {
  if (
    !Number.isInteger(visibleItemCount) ||
    !Number.isInteger(switcherSession?.sourceWindowId) ||
    !Number.isInteger(switcherSession?.switcherWindowId)
  ) {
    return
  }

  try {
    const sourceWindow = await chrome.windows.get(
      switcherSession.sourceWindowId,
    )
    const bounds = getSwitcherBounds(
      sourceWindow,
      visibleItemCount,
      layoutMetrics,
    )
    await chrome.windows.update(switcherSession.switcherWindowId, {
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
    })
  } catch {
    // The source or switcher window may have closed while the UI was loading.
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
  const remainingTabIds = recentTabHistory.reconcileWindow({
    existingTabIds: tabIds,
    windowId: sourceWindow.id,
  })
  await persistRecentTabHistory()

  const recentTabThumbnails = await getRecentTabThumbnails()
  recentTabThumbnails.reconcileWindow({
    existingTabIds: remainingTabIds,
    windowId: sourceWindow.id,
  })
  await persistRecentTabThumbnails()
}

function getSwitcherTab({ tab, thumbnailUrl }) {
  return {
    favIconUrl: tab.favIconUrl || getDefaultFaviconUrl(tab.url),
    id: tab.id,
    thumbnailUrl: thumbnailUrl || undefined,
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

function getSwitcherBounds(sourceWindow, visibleItemCount, layoutMetrics) {
  const sourceBoundedWidth = Math.min(
    SWITCHER_WINDOW_MAX_WIDTH,
    Math.max(
      SWITCHER_WINDOW_MIN_WIDTH,
      sourceWindow.width ?? SWITCHER_WINDOW_MAX_WIDTH,
    ),
  )
  const width = Math.min(
    getDesiredSwitcherWidth({ layoutMetrics, visibleItemCount }),
    sourceBoundedWidth,
  )
  const height = getDesiredSwitcherHeight({ layoutMetrics, width })
  const left = Math.round(
    (sourceWindow.left ?? 0) + ((sourceWindow.width ?? width) - width) / 2,
  )
  const top = Math.round(
    (sourceWindow.top ?? 0) + ((sourceWindow.height ?? height) - height) / 3,
  )

  return { height, left, top, width }
}

function getDesiredSwitcherHeight({ layoutMetrics, width }) {
  if (
    !layoutMetrics ||
    !Number.isFinite(layoutMetrics.contentHeight) ||
    !Number.isFinite(layoutMetrics.contentWidth) ||
    !Number.isFinite(layoutMetrics.frameHeight)
  ) {
    return SWITCHER_WINDOW_HEIGHT
  }

  const horizontalPadding = Math.max(
    0,
    (width - layoutMetrics.contentWidth) / 2,
  )
  return Math.round(
    layoutMetrics.contentHeight +
      horizontalPadding * 2 +
      layoutMetrics.frameHeight,
  )
}

function getDesiredSwitcherWidth({ layoutMetrics, visibleItemCount }) {
  if (Number.isFinite(layoutMetrics?.contentWidth)) {
    return layoutMetrics.contentWidth + SWITCHER_WINDOW_HORIZONTAL_PADDING
  }

  const itemCount = Math.max(
    1,
    Math.min(visibleItemCount, SWITCHER_MAX_VISIBLE_TABS),
  )
  return (
    SWITCHER_CARD_WIDTH * itemCount +
    SWITCHER_SHELL_HORIZONTAL_PADDING +
    SWITCHER_WINDOW_HORIZONTAL_PADDING
  )
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

const MEETING_REMINDER_MESSAGE_TARGET = 'kool-kits-meeting-reminder'
const MEETING_REMINDER_CACHE_KEY = 'meetingReminderCache'
const MEETING_REMINDER_FETCH_ALARM = 'meeting-reminder-fetch'
const MEETING_REMINDER_TICK_ALARM = 'meeting-reminder-tick'
const MEETING_REMINDER_FETCH_PERIOD_MINUTES = 5
const MEETING_REMINDER_TICK_PERIOD_MINUTES = 1
const MEETING_BADGE_BACKGROUND_COLOR = '#e5484d'
const MEETING_BADGE_TEXT_COLOR = '#ffffff'

let meetingSyncPromise

chrome.runtime.onInstalled.addListener(() => {
  void initializeMeetingReminder()
})

chrome.runtime.onStartup.addListener(() => {
  void initializeMeetingReminder()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MEETING_REMINDER_FETCH_ALARM) {
    void syncMeetings()
    return
  }

  if (alarm.name === MEETING_REMINDER_TICK_ALARM) {
    void refreshMeetingBadge()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.meetingSettings) {
    void syncMeetings()
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== MEETING_REMINDER_MESSAGE_TARGET) {
    return undefined
  }

  if (message.type === 'get-popup-state') {
    void getMeetingPopupState().then(sendResponse)
    return true
  }

  if (message.type === 'get-connection-status') {
    void getConnectionStatus().then(sendResponse)
    return true
  }

  if (message.type === 'connect') {
    void connectCalendar().then(sendResponse)
    return true
  }

  if (message.type === 'disconnect') {
    void disconnectCalendar().then(sendResponse)
    return true
  }

  if (message.type === 'refresh') {
    void syncMeetings().then(() => getMeetingPopupState()).then(sendResponse)
    return true
  }

  return undefined
})

async function initializeMeetingReminder() {
  await chrome.alarms.create(MEETING_REMINDER_FETCH_ALARM, {
    periodInMinutes: MEETING_REMINDER_FETCH_PERIOD_MINUTES,
  })
  await chrome.alarms.create(MEETING_REMINDER_TICK_ALARM, {
    periodInMinutes: MEETING_REMINDER_TICK_PERIOD_MINUTES,
  })
  await syncMeetings()
}

async function getMeetingCache() {
  const stored = await chrome.storage.local.get(MEETING_REMINDER_CACHE_KEY)
  return (
    stored[MEETING_REMINDER_CACHE_KEY] ?? {
      syncState: 'not_connected',
      meetings: [],
      lastSyncedAt: 0,
    }
  )
}

async function setMeetingCache(cache) {
  await chrome.storage.local.set({ [MEETING_REMINDER_CACHE_KEY]: cache })
}

// Coalesce overlapping triggers (alarm, popup refresh, settings change) into one
// in-flight sync so a slow failing sync cannot clobber a newer successful one.
function syncMeetings() {
  meetingSyncPromise ??= runMeetingSync().finally(() => {
    meetingSyncPromise = undefined
  })
  return meetingSyncPromise
}

async function runMeetingSync() {
  const settings = await getMeetingSettings()

  if (!settings.enabled) {
    await setMeetingCache({
      syncState: 'disabled',
      meetings: [],
      lastSyncedAt: Date.now(),
    })
    await clearMeetingBadge()
    return
  }

  const token = await getAuthToken({ interactive: false })
  if (!token) {
    const previous = await getMeetingCache()
    await setMeetingCache({ ...previous, syncState: 'not_connected' })
    await clearMeetingBadge()
    return
  }

  try {
    const meetings = await fetchEventsWithReauth(token)
    await setMeetingCache({
      syncState: 'ok',
      meetings,
      lastSyncedAt: Date.now(),
    })
    await refreshMeetingBadge()
  } catch (error) {
    if (error?.code === 'unauthorized') {
      const previous = await getMeetingCache()
      await setMeetingCache({ ...previous, syncState: 'auth_error' })
      await clearMeetingBadge()
      return
    }

    // Transient failure (offline, server error): keep the last good meetings so
    // the badge keeps counting down from cache and the popup keeps its list.
    const previous = await getMeetingCache()
    await setMeetingCache({ ...previous, syncState: 'error' })
    await refreshMeetingBadge()
  }
}

// An unauthorized response usually means a stale cached token, not revoked access.
// Clear it, silently re-acquire once, and retry. Only a failed re-acquire is a
// real auth error (it re-throws the unauthorized error).
async function fetchEventsWithReauth(token) {
  try {
    return await fetchTodaysEvents(token)
  } catch (error) {
    if (error?.code !== 'unauthorized') {
      throw error
    }

    await clearAuthToken(token)
    const freshToken = await getAuthToken({ interactive: false })
    if (!freshToken) {
      throw error
    }

    return await fetchTodaysEvents(freshToken)
  }
}

async function refreshMeetingBadge() {
  const settings = await getMeetingSettings()
  const cache = await getMeetingCache()

  // Render from cached meetings whenever we have a usable set. A transient fetch
  // error keeps the last good meetings, so the badge must NOT blank on 'error'.
  // Only disabled / not_connected / auth_error states clear the badge.
  const checkHasUsableCache =
    settings.enabled &&
    (cache.syncState === 'ok' || cache.syncState === 'error') &&
    Array.isArray(cache.meetings) &&
    cache.meetings.length > 0
  if (!checkHasUsableCache) {
    await clearMeetingBadge()
    return
  }

  const badgeText = computeBadgeText(cache.meetings, Date.now(), settings.leadMinutes)
  if (!badgeText) {
    await clearMeetingBadge()
    return
  }

  await chrome.action.setBadgeBackgroundColor({
    color: MEETING_BADGE_BACKGROUND_COLOR,
  })
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: MEETING_BADGE_TEXT_COLOR })
  }
  await chrome.action.setBadgeText({ text: badgeText })
}

async function clearMeetingBadge() {
  await chrome.action.setBadgeText({ text: '' })
}

async function getMeetingPopupState() {
  const settings = await getMeetingSettings()
  const cache = await getMeetingCache()
  const now = Date.now()
  // Group whenever we have cached meetings, including the transient 'error' state,
  // so a popup opened while briefly offline keeps showing the last known list.
  const checkHasCachedMeetings =
    (cache.syncState === 'ok' || cache.syncState === 'error') &&
    Array.isArray(cache.meetings)
  const groups = checkHasCachedMeetings
    ? groupMeetings(cache.meetings, now)
    : { inProgress: [], upcoming: [] }

  return {
    enabled: settings.enabled,
    syncState: cache.syncState,
    inProgress: groups.inProgress,
    upcoming: groups.upcoming,
  }
}

async function getConnectionStatus() {
  // Connection reflects real token presence, independent of the enabled flag,
  // so a connected-but-disabled user is not told to reconnect.
  const token = await getAuthToken({ interactive: false })
  return { connected: Boolean(token) }
}

async function connectCalendar() {
  const token = await getAuthToken({ interactive: true })
  if (!token) {
    return { ok: false }
  }

  await syncMeetings()
  return { ok: true }
}

async function disconnectCalendar() {
  // The service worker is ephemeral, so never trust an in-memory token. Read the
  // live cached token now and revoke that, otherwise disconnect would no-op after
  // a worker restart and the feature would silently reconnect on the next sync.
  const token = await getAuthToken({ interactive: false })
  await revokeAuthToken(token)
  await setMeetingCache({
    syncState: 'not_connected',
    meetings: [],
    lastSyncedAt: Date.now(),
  })
  await clearMeetingBadge()
  return { ok: true }
}
