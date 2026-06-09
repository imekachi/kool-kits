import { checkCanCopyTabUrl } from './copyable-url.js'
import { createRecentTabHistory } from './recent-tab-history.js'
import { createRecentTabThumbnails } from './recent-tab-thumbnails.js'
import { prepareThumbnailImage } from './thumbnail-image.js'
import { pickCalendarTabForConnect } from './calendar-connect.js'
import {
  CALENDAR_OPEN_URL,
  fetchBootstrap,
  fetchTodaysEvents,
} from './calendar-session.js'
import {
  getNextReminderTransitionAt,
  getReminderView,
} from './meeting-reminder.js'
import {
  ConnectionStatus,
  buildMeetingCachePatchForBootstrapFailure,
  buildMeetingCachePatchForConnectedSync,
  buildMeetingCachePatchForConnectionOnlySync,
  buildMeetingCachePatchForEventsSyncFailure,
  buildMeetingCachePatchForSessionUnavailable,
  checkAllowsMeetingCacheCommit,
  checkAllowsSyncBadgeCommit,
  checkAllowsSyncCacheWrite,
  checkIsExtensionDisconnected,
  checkKeepsCachedMeetingsOnBadge,
  buildConnectionStatusResponse,
  checkShowsConnectedAccount,
  checkShouldClearReconnectPending,
  checkShouldFetchMeetingEvents,
  checkShouldRefreshLiveConnectionStatus,
  checkUsesCoalescedSyncForStatusRefresh,
  checkShouldSkipMeetingSync,
  resolveMeetingBadgeText,
  createCoalescedSyncRunner,
  createEmptyMeetingCache,
  normalizeMeetingCache,
} from './meeting-connection.js'
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
const THUMBNAIL_CAPTURE_ALARM_PREFIX = 'recent-tab-thumbnail:'
const THUMBNAIL_CAPTURE_OPTIONS = { format: 'jpeg', quality: 45 }
const THUMBNAIL_CAPTURE_MIN_INTERVAL_MS = 1000
const THUMBNAIL_CAPTURE_ALARM_PATTERN = /^recent-tab-thumbnail:(\d+):(\d+)$/
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
let recentTabThumbnailsPromise
let thumbnailCaptureQueuePromise = Promise.resolve()
let lastThumbnailCaptureAt = 0
const activeTabGenerationsByWindowId = new Map()
const lastVisibleCaptureByWindowId = new Map()
const previousActiveTabIdByWindowId = new Map()
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
    clearLastVisibleCaptureIfMatches({ tabId, windowId: tab.windowId })
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
  const previousTabId = previousActiveTabIdByWindowId.get(windowId)
  await flushOutgoingTabThumbnail({ previousTabId, windowId })
  previousActiveTabIdByWindowId.set(windowId, tabId)

  const recentTabHistory = await getRecentTabHistory()
  recentTabHistory.recordActivation({ tabId, windowId })
  bumpActiveTabGeneration(windowId)
  await persistRecentTabHistory()
  await reconcileWindowThumbnailsToHistory(windowId)

  void queueVisibleTabThumbnailCapture({
    allowDelay: false,
    tabId,
    windowId,
  })
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

function getThumbnailCaptureAlarmName({ tabId, windowId }) {
  return `${THUMBNAIL_CAPTURE_ALARM_PREFIX}${windowId}:${tabId}`
}

function scheduleVisibleTabThumbnailCapture({ tabId, windowId }) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return
  }

  const alarmName = getThumbnailCaptureAlarmName({ tabId, windowId })
  void chrome.alarms.clear(alarmName).then(() => {
    void chrome.alarms.create(alarmName, {
      when: Date.now() + THUMBNAIL_ACTIVATION_CAPTURE_DELAY_MS,
    })
  })
}

async function flushPendingActivationCapturesBeforePriority({
  tabId,
  windowId,
}) {
  const prefix = `${THUMBNAIL_CAPTURE_ALARM_PREFIX}${windowId}:`
  const alarms = await chrome.alarms.getAll()
  for (const alarm of alarms) {
    if (!alarm.name.startsWith(prefix)) {
      continue
    }

    const match = THUMBNAIL_CAPTURE_ALARM_PATTERN.exec(alarm.name)
    if (!match) {
      continue
    }

    const pendingTabId = Number(match[2])
    await chrome.alarms.clear(alarm.name)
    if (pendingTabId !== tabId) {
      void queueVisibleTabThumbnailCapture({
        priority: false,
        tabId: pendingTabId,
        windowId,
      })
    }
  }
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
    thumbnailCaptureQueuePromise = thumbnailCaptureQueuePromise
      .catch(() => undefined)
      .then(() =>
        flushPendingActivationCapturesBeforePriority({ tabId, windowId }),
      )
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

  if (!(await checkIsStillActiveTab({ tabId, windowId }))) {
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
    lastVisibleCaptureByWindowId.set(windowId, { tabId, thumbnailUrl })
    await persistRecentTabThumbnails()
  } catch {
    // Capture availability varies by page, tab state, and browser permissions.
  }
}

async function flushOutgoingTabThumbnail({ previousTabId, windowId }) {
  if (!Number.isInteger(previousTabId) || !Number.isInteger(windowId)) {
    return
  }

  const lastCapture = lastVisibleCaptureByWindowId.get(windowId)
  if (
    lastCapture?.tabId !== previousTabId ||
    !lastCapture.thumbnailUrl ||
    !(await checkIsTabStillInHistory({ tabId: previousTabId, windowId }))
  ) {
    return
  }

  const recentTabThumbnails = await getRecentTabThumbnails()
  recentTabThumbnails.setThumbnail({
    tabId: previousTabId,
    thumbnailUrl: lastCapture.thumbnailUrl,
    windowId,
  })
  await persistRecentTabThumbnails()
}

function clearLastVisibleCaptureIfMatches({ tabId, windowId }) {
  const lastCapture = lastVisibleCaptureByWindowId.get(windowId)
  if (lastCapture?.tabId === tabId) {
    lastVisibleCaptureByWindowId.delete(windowId)
  }
}

async function removeTabThumbnail({ tabId, windowId }) {
  clearLastVisibleCaptureIfMatches({ tabId, windowId })
  const recentTabThumbnails = await getRecentTabThumbnails()
  recentTabThumbnails.removeTab({ tabId, windowId })
  await persistRecentTabThumbnails()
}

async function removeWindowThumbnails(windowId) {
  lastVisibleCaptureByWindowId.delete(windowId)
  previousActiveTabIdByWindowId.delete(windowId)
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
    await refreshSourceWindowThumbnail(sourceWindow)

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
const MEETING_CALENDAR_CONNECT_PENDING_KEY = 'meetingCalendarConnectPending'
const MEETING_REMINDER_FETCH_ALARM = 'meeting-reminder-fetch'
const MEETING_REMINDER_TICK_ALARM = 'meeting-reminder-tick'
const MEETING_REMINDER_FETCH_PERIOD_MINUTES = 5
const MEETING_REMINDER_MIN_DISPLAY_DELAY_MS = 1_000
const MEETING_BADGE_BACKGROUND_COLOR = '#e5484d'
const MEETING_BADGE_TEXT_COLOR = '#ffffff'

let meetingSyncGeneration = 0
const requestMeetingSync = createCoalescedSyncRunner(runMeetingSync)

chrome.runtime.onInstalled.addListener(() => {
  void initializePreviousActiveTabs()
  void initializeMeetingReminder()
})

chrome.runtime.onStartup.addListener(() => {
  void initializePreviousActiveTabs()
  void initializeMeetingReminder()
})

async function initializePreviousActiveTabs() {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  })
  for (const window of windows) {
    if (!Number.isInteger(window.id)) {
      continue
    }

    const activeTab = (window.tabs ?? []).find(
      (tab) => tab.active && Number.isInteger(tab.id),
    )
    if (activeTab) {
      previousActiveTabIdByWindowId.set(window.id, activeTab.id)
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  const thumbnailCaptureMatch = THUMBNAIL_CAPTURE_ALARM_PATTERN.exec(alarm.name)
  if (thumbnailCaptureMatch) {
    const windowId = Number(thumbnailCaptureMatch[1])
    const tabId = Number(thumbnailCaptureMatch[2])
    void queueVisibleTabThumbnailCapture({ priority: false, tabId, windowId })
    return
  }

  if (alarm.name === MEETING_REMINDER_FETCH_ALARM) {
    void syncMeetings()
    return
  }

  if (alarm.name === MEETING_REMINDER_TICK_ALARM) {
    void refreshMeetingReminderDisplay()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.meetingSettings) {
    void syncMeetings()
  }
})

// Recover promptly from a session the user just established: when a Google
// Calendar tab finishes loading, re-detect the account so signing in there shows
// meetings without waiting for the next periodic alarm.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === 'complete' &&
    typeof tab?.url === 'string' &&
    tab.url.startsWith('https://calendar.google.com/')
  ) {
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

  if (
    message.type === 'disconnect-calendar' ||
    message.type === 'reset-calendar-state'
  ) {
    void disconnectMeetingCalendar().then(sendResponse)
    return true
  }

  if (message.type === 'refresh') {
    void syncMeetings()
      .then(() => getMeetingPopupState())
      .then(sendResponse)
    return true
  }

  return undefined
})

async function initializeMeetingReminder() {
  await chrome.alarms.create(MEETING_REMINDER_FETCH_ALARM, {
    periodInMinutes: MEETING_REMINDER_FETCH_PERIOD_MINUTES,
  })
  await syncMeetings()
}

async function getMeetingCache() {
  const stored = await chrome.storage.local.get(MEETING_REMINDER_CACHE_KEY)
  return normalizeMeetingCache(stored[MEETING_REMINDER_CACHE_KEY])
}

async function setMeetingCache(cache) {
  await chrome.storage.local.set({ [MEETING_REMINDER_CACHE_KEY]: cache })
}

// Coalesce overlapping triggers (alarm, popup refresh, settings change) into one
// in-flight sync, then rerun once if another trigger arrives while it is active.
function syncMeetings() {
  return requestMeetingSync()
}

async function getCalendarConnectPending() {
  const stored = await chrome.storage.local.get(
    MEETING_CALENDAR_CONNECT_PENDING_KEY,
  )
  return stored[MEETING_CALENDAR_CONNECT_PENDING_KEY] === true
}

async function setCalendarConnectPending(pending) {
  if (pending) {
    await chrome.storage.local.set({
      [MEETING_CALENDAR_CONNECT_PENDING_KEY]: true,
    })
    return
  }

  await chrome.storage.local.remove(MEETING_CALENDAR_CONNECT_PENDING_KEY)
}

async function runMeetingSync() {
  const syncContext = await createMeetingSyncContext()
  if (!syncContext) {
    return
  }

  const bootstrap = await detectMeetingCalendarConnection(syncContext)
  if (!bootstrap) {
    return
  }

  if (
    !checkShouldFetchMeetingEvents({ enabled: syncContext.settings.enabled })
  ) {
    await storeMeetingConnectionOnly(syncContext, bootstrap)
    return
  }

  await fetchAndStoreMeetingEvents(syncContext, bootstrap)
}

async function createMeetingSyncContext() {
  const syncGeneration = meetingSyncGeneration
  const settings = await getMeetingSettings()
  const previous = await getMeetingCache()
  const allowReconnect = await getCalendarConnectPending()

  const skipDecision = checkShouldSkipMeetingSync({
    enabled: settings.enabled,
    allowReconnect,
    connectionStatus: previous.connectionStatus,
  })
  if (skipDecision.skip) {
    await clearMeetingBadge()
    return undefined
  }

  return {
    syncGeneration,
    settings,
    allowReconnect,
  }
}

function createMeetingSyncWriters(syncContext) {
  const { syncGeneration, settings, allowReconnect } = syncContext

  async function applyMeetingCacheReplacement(cache) {
    const current = await getMeetingCache()
    if (
      !checkAllowsMeetingCacheCommit({
        syncGeneration,
        activeGeneration: meetingSyncGeneration,
        allowReconnect,
        currentConnectionStatus: current.connectionStatus,
        nextConnectionStatus: cache.connectionStatus,
      })
    ) {
      return false
    }

    if (
      !checkAllowsMeetingCacheCommit({
        syncGeneration,
        activeGeneration: meetingSyncGeneration,
        allowReconnect,
        currentConnectionStatus: (await getMeetingCache()).connectionStatus,
        nextConnectionStatus: cache.connectionStatus,
      })
    ) {
      return false
    }

    await setMeetingCache(cache)
    return true
  }

  async function finishSync() {
    if (!checkAllowsSyncCacheWrite(syncGeneration, meetingSyncGeneration)) {
      return
    }

    if (settings.enabled) {
      await refreshMeetingBadgeFromSync(syncGeneration)
      await scheduleNextReminderDisplayRefresh()
      return
    }

    await clearMeetingBadgeFromSync(syncGeneration)
    await chrome.alarms.clear(MEETING_REMINDER_TICK_ALARM)
  }

  return { applyMeetingCacheReplacement, finishSync }
}

async function detectMeetingCalendarConnection(syncContext) {
  const { applyMeetingCacheReplacement, finishSync } =
    createMeetingSyncWriters(syncContext)
  const lastSyncedAt = Date.now()

  let bootstrap
  try {
    bootstrap = await fetchBootstrap()
  } catch {
    const current = await getMeetingCache()
    const applied = await applyMeetingCacheReplacement(
      buildMeetingCachePatchForBootstrapFailure(current, lastSyncedAt),
    )
    if (applied) {
      await finishSync()
    }
    return undefined
  }

  if (!bootstrap.connected) {
    const current = await getMeetingCache()
    const applied = await applyMeetingCacheReplacement(
      buildMeetingCachePatchForSessionUnavailable(current, lastSyncedAt),
    )
    if (applied) {
      await finishSync()
    }
    return undefined
  }

  return bootstrap
}

async function storeMeetingConnectionOnly(syncContext, bootstrap) {
  const { applyMeetingCacheReplacement, finishSync } =
    createMeetingSyncWriters(syncContext)
  const current = await getMeetingCache()
  const applied = await applyMeetingCacheReplacement(
    buildMeetingCachePatchForConnectionOnlySync(current, bootstrap, Date.now()),
  )
  if (applied) {
    if (checkShouldClearReconnectPending(ConnectionStatus.CONNECTED)) {
      await setCalendarConnectPending(false)
    }
    await finishSync()
  }
}

async function fetchAndStoreMeetingEvents(syncContext, bootstrap) {
  const { settings } = syncContext
  const { applyMeetingCacheReplacement, finishSync } =
    createMeetingSyncWriters(syncContext)
  const lastSyncedAt = Date.now()

  try {
    const meetings = await fetchTodaysEvents({
      email: bootstrap.email,
      version: bootstrap.version,
      meetingFilter: settings.meetingFilter,
    })
    const applied = await applyMeetingCacheReplacement(
      buildMeetingCachePatchForConnectedSync(bootstrap, meetings, lastSyncedAt),
    )
    if (applied) {
      if (checkShouldClearReconnectPending(ConnectionStatus.CONNECTED)) {
        await setCalendarConnectPending(false)
      }
      await finishSync()
    }
  } catch {
    const current = await getMeetingCache()
    const applied = await applyMeetingCacheReplacement(
      buildMeetingCachePatchForEventsSyncFailure(
        current,
        bootstrap,
        lastSyncedAt,
      ),
    )
    if (applied) {
      await finishSync()
    }
  }
}

async function refreshMeetingReminderDisplay() {
  await refreshMeetingBadge()
  await scheduleNextReminderDisplayRefresh()
}

// Periodic chrome.alarms cannot repeat below one minute; schedule the next moment
// badge or popup grouping can change (start, end, lead window, minute rollover).
async function scheduleNextReminderDisplayRefresh() {
  await chrome.alarms.clear(MEETING_REMINDER_TICK_ALARM)

  const settings = await getMeetingSettings()
  if (!settings.enabled) {
    return
  }

  const cache = await getMeetingCache()
  if (
    !checkKeepsCachedMeetingsOnBadge(cache.connectionStatus) ||
    !Array.isArray(cache.meetings) ||
    cache.meetings.length === 0
  ) {
    return
  }

  const now = Date.now()
  const nextAt = getNextReminderTransitionAt(
    cache.meetings,
    now,
    settings.leadMinutes,
  )
  if (nextAt == null) {
    return
  }

  await chrome.alarms.create(MEETING_REMINDER_TICK_ALARM, {
    when: Math.max(now + MEETING_REMINDER_MIN_DISPLAY_DELAY_MS, nextAt),
  })
}

async function refreshMeetingBadge() {
  const settings = await getMeetingSettings()
  const cache = await getMeetingCache()
  const badgeText = resolveMeetingBadgeText({
    enabled: settings.enabled,
    connectionStatus: cache.connectionStatus,
    meetings: cache.meetings,
    now: Date.now(),
    leadMinutes: settings.leadMinutes,
  })
  await applyMeetingBadgeText(badgeText)
}

async function refreshMeetingBadgeFromSync(syncGeneration) {
  const settings = await getMeetingSettings()
  const cache = await getMeetingCache()
  const badgeText = resolveMeetingBadgeText({
    enabled: settings.enabled,
    connectionStatus: cache.connectionStatus,
    meetings: cache.meetings,
    now: Date.now(),
    leadMinutes: settings.leadMinutes,
  })
  await applyMeetingBadgeTextFromSync(syncGeneration, badgeText)
}

async function clearMeetingBadgeFromSync(syncGeneration) {
  await applyMeetingBadgeTextFromSync(syncGeneration, null)
}

async function applyMeetingBadgeTextFromSync(syncGeneration, badgeText) {
  const cache = await getMeetingCache()
  if (
    !checkAllowsSyncBadgeCommit({
      syncGeneration,
      activeGeneration: meetingSyncGeneration,
      connectionStatus: cache.connectionStatus,
    })
  ) {
    return
  }

  await applyMeetingBadgeText(badgeText, syncGeneration)
}

async function applyMeetingBadgeText(badgeText, syncGeneration) {
  if (badgeText == null) {
    await clearMeetingBadge()
    return
  }

  if (syncGeneration !== undefined) {
    const cache = await getMeetingCache()
    if (
      !checkAllowsSyncBadgeCommit({
        syncGeneration,
        activeGeneration: meetingSyncGeneration,
        connectionStatus: cache.connectionStatus,
      })
    ) {
      return
    }
  }

  await chrome.action.setBadgeBackgroundColor({
    color: MEETING_BADGE_BACKGROUND_COLOR,
  })
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: MEETING_BADGE_TEXT_COLOR })
  }

  if (syncGeneration !== undefined) {
    const cache = await getMeetingCache()
    if (
      !checkAllowsSyncBadgeCommit({
        syncGeneration,
        activeGeneration: meetingSyncGeneration,
        connectionStatus: cache.connectionStatus,
      })
    ) {
      return
    }
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
  // Group whenever we have cached meetings (any non-disabled state), so a popup
  // opened during a transient error or brief session lapse keeps showing the
  // last known list rather than collapsing.
  const view = Array.isArray(cache.meetings)
    ? getReminderView(cache.meetings, now, settings.leadMinutes)
    : { inProgress: [], upcoming: [] }

  return {
    enabled: settings.enabled,
    connectionStatus: cache.connectionStatus,
    connectedEmail: cache.connectedEmail,
    inProgress: view.inProgress,
    upcoming: view.upcoming,
  }
}

async function createConnectionStatusRefreshContext() {
  const allowReconnect = await getCalendarConnectPending()
  const previous = await getMeetingCache()

  if (
    !checkShouldRefreshLiveConnectionStatus({
      connectionStatus: previous.connectionStatus,
      allowReconnect,
    })
  ) {
    return undefined
  }

  return {
    syncGeneration: meetingSyncGeneration,
    settings: await getMeetingSettings(),
    allowReconnect,
  }
}

async function refreshLiveConnectionStatusConnectionOnly(syncContext) {
  const bootstrap = await detectMeetingCalendarConnection(syncContext)
  if (!bootstrap) {
    return
  }

  await storeMeetingConnectionOnly(syncContext, bootstrap)
}

async function getConnectionStatus() {
  const cache = await getMeetingCache()
  const syncContext = await createConnectionStatusRefreshContext()
  if (!syncContext) {
    return buildConnectionStatusResponse(cache)
  }

  if (
    checkUsesCoalescedSyncForStatusRefresh({
      enabled: syncContext.settings.enabled,
    })
  ) {
    await syncMeetings()
  } else {
    await refreshLiveConnectionStatusConnectionOnly(syncContext)
  }

  return buildConnectionStatusResponse(await getMeetingCache())
}

const CALENDAR_CONNECT_POLL_MS = 500
const CALENDAR_CONNECT_TIMEOUT_MS = 20_000
const CALENDAR_TAB_QUERY = 'https://calendar.google.com/*'

// Connect tries a background sync first so an existing Google session promotes
// without opening Calendar. When sign-in is still needed, reuse an open Calendar
// tab (focus + reload) or open one in the foreground for login.
async function connectCalendar() {
  await setCalendarConnectPending(true)

  try {
    await syncMeetings()
    let cache = await getMeetingCache()

    if (
      checkShowsConnectedAccount(cache.connectionStatus, cache.connectedEmail)
    ) {
      await setCalendarConnectPending(false)
      return { ok: true, ...buildConnectionStatusResponse(cache) }
    }

    await openCalendarTabForSignIn()
    await waitForCalendarConnectResult()
    await syncMeetings()

    cache = await getMeetingCache()
    const response = { ok: true, ...buildConnectionStatusResponse(cache) }

    if (
      checkShowsConnectedAccount(cache.connectionStatus, cache.connectedEmail)
    ) {
      await setCalendarConnectPending(false)
      await showCalendarConnectedToast()
    }

    return response
  } catch {
    await setCalendarConnectPending(false)
    return {
      ok: false,
      ...buildConnectionStatusResponse(await getMeetingCache()),
    }
  }
}

async function queryCalendarTabs() {
  return chrome.tabs.query({ url: CALENDAR_TAB_QUERY })
}

async function openCalendarTabForSignIn() {
  const existingTab = pickCalendarTabForConnect(await queryCalendarTabs())

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, {
      url: CALENDAR_OPEN_URL,
      active: true,
    })
    return
  }

  await chrome.tabs.create({ url: CALENDAR_OPEN_URL, active: true })
}

async function waitForCalendarConnectResult() {
  const deadline = Date.now() + CALENDAR_CONNECT_TIMEOUT_MS

  while (Date.now() < deadline) {
    const cache = await getMeetingCache()
    if (
      checkShowsConnectedAccount(cache.connectionStatus, cache.connectedEmail)
    ) {
      return true
    }

    await new Promise((resolve) => {
      setTimeout(resolve, CALENDAR_CONNECT_POLL_MS)
    })
  }

  return false
}

async function showCalendarConnectedToast() {
  const calendarTab = pickCalendarTabForConnect(await queryCalendarTabs())
  if (!calendarTab?.id) {
    return
  }

  const canRenderToast = await ensureToastScript(calendarTab.id)
  if (!canRenderToast) {
    return
  }

  await sendToastMessage(calendarTab.id, {
    tone: 'success',
    text: 'Calendar connected. You can close this tab.',
  })
}

// Clears cached meetings and connection state and stops syncing until the user
// reconnects. Does not sign the user out of Google.
async function disconnectMeetingCalendar() {
  meetingSyncGeneration += 1
  await setCalendarConnectPending(false)
  await setMeetingCache({
    ...createEmptyMeetingCache(),
    lastSyncedAt: Date.now(),
  })
  await clearMeetingBadge()
  await chrome.alarms.clear(MEETING_REMINDER_TICK_ALARM)
  const state = await getMeetingPopupState()
  return { ok: true, ...state }
}
