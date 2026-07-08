import { createRecentTabHistory } from './recent-tab-history.js'
import {
  GOOGLE_CALENDAR_HOST_PATTERN,
  checkHasCalendarHostPermission,
  pickCalendarTabForConnect,
  requestCalendarHostPermission,
} from './calendar-connect.js'
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

const RECENT_TAB_SWITCHER_COMMAND = 'recent-tab-switcher'
const RECENT_TAB_SWITCHER_PREVIOUS_COMMAND = 'recent-tab-switcher-previous'
const SWITCHER_DOCUMENT_PATH = 'src/switcher.html'
const ACTION_BADGE_SUCCESS_TEXT = '✓'
const ACTION_BADGE_ERROR_TEXT = 'ERR'
const ACTION_BADGE_DURATION_MS = 1_500
const ACTION_BADGE_SUCCESS_BACKGROUND_COLOR = '#46d39a'
const ACTION_BADGE_ERROR_BACKGROUND_COLOR = '#e5484d'
const ACTION_BADGE_TEXT_COLOR = '#ffffff'
const RECENT_TAB_HISTORY_STORAGE_KEY = 'recentTabHistories'
const SWITCHER_CARD_WIDTH = 179
const SWITCHER_MAX_VISIBLE_TABS = 6
const SWITCHER_WINDOW_HEIGHT = 230
const SWITCHER_WINDOW_MIN_WIDTH = 520
const SWITCHER_WINDOW_MAX_WIDTH = 1160
const SWITCHER_SHELL_HORIZONTAL_PADDING = 34
const SWITCHER_WINDOW_HORIZONTAL_PADDING = 0

let temporaryBadgeRestoreTimeoutId
let recentTabHistoryPromise
let switcherOpeningPromise
let switcherSession

chrome.commands.onCommand.addListener((command) => {
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
      .map((tab) => getSwitcherTab({ tab })),
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
  recentTabHistory.reconcileWindow({
    existingTabIds: tabIds,
    windowId: sourceWindow.id,
  })
  await persistRecentTabHistory()
}

function getSwitcherTab({ tab }) {
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
  faviconUrl.searchParams.set('size', '48')
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

async function showTemporaryActionBadgeFeedback({ ok }) {
  if (temporaryBadgeRestoreTimeoutId) {
    clearTimeout(temporaryBadgeRestoreTimeoutId)
    temporaryBadgeRestoreTimeoutId = undefined
  }

  await chrome.action.setBadgeBackgroundColor({
    color: ok
      ? ACTION_BADGE_SUCCESS_BACKGROUND_COLOR
      : ACTION_BADGE_ERROR_BACKGROUND_COLOR,
  })
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: ACTION_BADGE_TEXT_COLOR })
  }
  await chrome.action.setBadgeText({
    text: ok ? ACTION_BADGE_SUCCESS_TEXT : ACTION_BADGE_ERROR_TEXT,
  })

  temporaryBadgeRestoreTimeoutId = setTimeout(() => {
    temporaryBadgeRestoreTimeoutId = undefined
    void refreshMeetingBadge()
  }, ACTION_BADGE_DURATION_MS)
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
    void (async () => {
      if (await checkHasCalendarHostPermission()) {
        await syncMeetings()
      }
    })()
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
  const hasCalendarHostPermission = await checkHasCalendarHostPermission()

  const skipDecision = checkShouldSkipMeetingSync({
    enabled: settings.enabled,
    allowReconnect,
    connectionStatus: previous.connectionStatus,
    hasCalendarHostPermission,
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
  if (!(await checkHasCalendarHostPermission())) {
    return undefined
  }

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
const CALENDAR_TAB_QUERY = GOOGLE_CALENDAR_HOST_PATTERN

// Connect requests Calendar host access first, then tries a background sync so
// an existing Google session promotes without opening Calendar. When sign-in is
// still needed, reuse an open Calendar tab (focus + reload) or open one in the
// foreground for login.
async function connectCalendar() {
  const { granted } = await requestCalendarHostPermission()
  if (!granted) {
    return {
      ok: false,
      ...buildConnectionStatusResponse(await getMeetingCache()),
    }
  }

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
      await showTemporaryActionBadgeFeedback({ ok: true })
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
