import { computeBadgeText } from './meeting-reminder.js'

export const ConnectionStatus = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTED: 'CONNECTED',
  SESSION_UNAVAILABLE: 'SESSION_UNAVAILABLE',
  BOOTSTRAP_FAILED: 'BOOTSTRAP_FAILED',
  EVENTS_SYNC_FAILED: 'EVENTS_SYNC_FAILED',
}

const LEGACY_SYNC_STATE_MAP = {
  notConnected: ConnectionStatus.SESSION_UNAVAILABLE,
  connected: ConnectionStatus.CONNECTED,
  error: ConnectionStatus.BOOTSTRAP_FAILED,
}

export function resolveLegacyConnectionStatus(stored) {
  if (!stored || typeof stored !== 'object') {
    return ConnectionStatus.DISCONNECTED
  }

  if (stored.disconnectedByUser === true) {
    return ConnectionStatus.DISCONNECTED
  }

  if (stored.syncState === 'disabled') {
    return stored.connectedEmail
      ? ConnectionStatus.CONNECTED
      : ConnectionStatus.SESSION_UNAVAILABLE
  }

  return (
    LEGACY_SYNC_STATE_MAP[stored.syncState] ?? ConnectionStatus.DISCONNECTED
  )
}

export function checkAllowsSyncCacheWrite(syncGeneration, activeGeneration) {
  return syncGeneration === activeGeneration
}

export function checkAllowsMeetingCacheReplacement({
  allowReconnect,
  currentConnectionStatus,
  nextConnectionStatus,
}) {
  if (!checkIsExtensionDisconnected(currentConnectionStatus)) {
    return true
  }

  return allowReconnect && !checkIsExtensionDisconnected(nextConnectionStatus)
}

export function checkAllowsMeetingCacheCommit({
  syncGeneration,
  activeGeneration,
  allowReconnect,
  currentConnectionStatus,
  nextConnectionStatus,
}) {
  if (!checkAllowsSyncCacheWrite(syncGeneration, activeGeneration)) {
    return false
  }

  return checkAllowsMeetingCacheReplacement({
    allowReconnect,
    currentConnectionStatus,
    nextConnectionStatus,
  })
}

export const ConnectionStatusRefreshMode = {
  FULL_SYNC: 'full-sync',
  CONNECTION_ONLY: 'connection-only',
}

export function checkShouldFetchMeetingEvents({ enabled }) {
  return enabled === true
}

export function resolveConnectionStatusRefreshMode({ enabled }) {
  return checkShouldFetchMeetingEvents({ enabled })
    ? ConnectionStatusRefreshMode.FULL_SYNC
    : ConnectionStatusRefreshMode.CONNECTION_ONLY
}

export function checkUsesCoalescedSyncForStatusRefresh({ enabled }) {
  return (
    resolveConnectionStatusRefreshMode({ enabled }) ===
    ConnectionStatusRefreshMode.FULL_SYNC
  )
}

export function checkShouldRefreshLiveConnectionStatus({
  connectionStatus,
  allowReconnect,
}) {
  if (checkIsExtensionDisconnected(connectionStatus) && !allowReconnect) {
    return false
  }

  return true
}

export function buildConnectionStatusResponse(cache) {
  const showsAccountIdentity = checkShowsAccountIdentity(
    cache.connectionStatus,
    cache.connectedEmail,
  )

  return {
    connected: checkShowsConnectedAccount(
      cache.connectionStatus,
      cache.connectedEmail,
    ),
    email: showsAccountIdentity ? cache.connectedEmail : undefined,
    connectionStatus: cache.connectionStatus,
  }
}

export function resolveMeetingsForAccountChange(current, nextEmail) {
  const meetings = Array.isArray(current.meetings) ? current.meetings : []
  if (!nextEmail) {
    return meetings
  }

  const previousEmail = current.connectedEmail
  if (!previousEmail || previousEmail !== nextEmail) {
    return []
  }

  return meetings
}

export function buildMeetingCachePatchForBootstrapFailure(
  current,
  lastSyncedAt,
) {
  return {
    ...current,
    connectionStatus: ConnectionStatus.BOOTSTRAP_FAILED,
    lastSyncedAt,
  }
}

export function buildMeetingCachePatchForSessionUnavailable(
  current,
  lastSyncedAt,
) {
  return {
    ...current,
    connectionStatus: ConnectionStatus.SESSION_UNAVAILABLE,
    connectedEmail: undefined,
    lastSyncedAt,
  }
}

export function buildMeetingCachePatchForConnectedSync(
  bootstrap,
  meetings,
  lastSyncedAt,
) {
  return {
    connectionStatus: ConnectionStatus.CONNECTED,
    connectedEmail: bootstrap.email,
    meetings,
    lastSyncedAt,
  }
}

export function buildMeetingCachePatchForConnectionOnlySync(
  current,
  bootstrap,
  lastSyncedAt,
) {
  return {
    ...current,
    connectionStatus: ConnectionStatus.CONNECTED,
    connectedEmail: bootstrap.email,
    meetings: resolveMeetingsForAccountChange(current, bootstrap.email),
    lastSyncedAt,
  }
}

export function buildMeetingCachePatchForEventsSyncFailure(
  current,
  bootstrap,
  lastSyncedAt,
) {
  return {
    ...current,
    connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
    connectedEmail: bootstrap.email,
    meetings: resolveMeetingsForAccountChange(current, bootstrap.email),
    lastSyncedAt,
  }
}

export function checkShouldSkipMeetingSync({
  enabled,
  allowReconnect,
  connectionStatus,
}) {
  if (checkIsExtensionDisconnected(connectionStatus) && !allowReconnect) {
    return { skip: true, reason: 'disconnected' }
  }

  if (!enabled && !allowReconnect) {
    return { skip: true, reason: 'disabled' }
  }

  return { skip: false }
}

export function checkShouldClearReconnectPending(connectionStatus) {
  return connectionStatus === ConnectionStatus.CONNECTED
}

export function createCoalescedSyncRunner(runSync) {
  let syncPromise
  let rerunRequested = false

  async function runQueuedSyncs() {
    do {
      rerunRequested = false
      await runSync()
    } while (rerunRequested)
  }

  return function requestSync() {
    if (syncPromise) {
      rerunRequested = true
      return syncPromise
    }

    syncPromise = runQueuedSyncs().finally(() => {
      syncPromise = undefined
    })
    return syncPromise
  }
}

export function createEmptyMeetingCache() {
  return {
    connectionStatus: ConnectionStatus.DISCONNECTED,
    connectedEmail: undefined,
    meetings: [],
    lastSyncedAt: 0,
  }
}

export function normalizeMeetingCache(stored) {
  if (!stored || typeof stored !== 'object') {
    return createEmptyMeetingCache()
  }

  if (Object.values(ConnectionStatus).includes(stored.connectionStatus)) {
    return normalizeDisconnectedMeetingData({
      ...createEmptyMeetingCache(),
      ...stored,
      meetings: Array.isArray(stored.meetings) ? stored.meetings : [],
    })
  }

  let connectionStatus = resolveLegacyConnectionStatus(stored)
  if (!connectionStatus) {
    connectionStatus = ConnectionStatus.DISCONNECTED
  }

  const { syncState, disconnectedByUser, ...rest } = stored
  return normalizeDisconnectedMeetingData({
    ...createEmptyMeetingCache(),
    ...rest,
    connectionStatus,
    meetings: Array.isArray(rest.meetings) ? rest.meetings : [],
  })
}

function normalizeDisconnectedMeetingData(cache) {
  if (!checkIsExtensionDisconnected(cache.connectionStatus)) {
    return cache
  }

  return {
    ...cache,
    connectedEmail: undefined,
    meetings: [],
  }
}

export function checkIsExtensionDisconnected(connectionStatus) {
  return connectionStatus === ConnectionStatus.DISCONNECTED
}

export function checkShowsConnectScreen(connectionStatus) {
  return (
    connectionStatus === ConnectionStatus.DISCONNECTED ||
    connectionStatus === ConnectionStatus.SESSION_UNAVAILABLE
  )
}

export function checkHasCachedPopupMeetings(inProgress, upcoming) {
  const inProgressCount = Array.isArray(inProgress) ? inProgress.length : 0
  const upcomingCount = Array.isArray(upcoming) ? upcoming.length : 0
  return inProgressCount > 0 || upcomingCount > 0
}

export function checkShowsPopupConnectScreen(
  connectionStatus,
  hasCachedMeetings,
) {
  if (checkIsExtensionDisconnected(connectionStatus)) {
    return true
  }

  if (connectionStatus === ConnectionStatus.SESSION_UNAVAILABLE) {
    return !hasCachedMeetings
  }

  return false
}

export function checkShowsFetchErrorScreen(connectionStatus) {
  return (
    connectionStatus === ConnectionStatus.BOOTSTRAP_FAILED ||
    connectionStatus === ConnectionStatus.EVENTS_SYNC_FAILED
  )
}

export function checkShowsConnectedAccount(connectionStatus, email) {
  return connectionStatus === ConnectionStatus.CONNECTED && Boolean(email)
}

export function checkShowsAccountIdentity(connectionStatus, email) {
  if (!email) {
    return false
  }

  return (
    connectionStatus === ConnectionStatus.CONNECTED ||
    connectionStatus === ConnectionStatus.BOOTSTRAP_FAILED ||
    connectionStatus === ConnectionStatus.EVENTS_SYNC_FAILED
  )
}

export function checkAllowsSyncBadgeCommit({
  syncGeneration,
  activeGeneration,
  connectionStatus,
}) {
  if (!checkAllowsSyncCacheWrite(syncGeneration, activeGeneration)) {
    return false
  }

  return !checkIsExtensionDisconnected(connectionStatus)
}

export function resolveMeetingBadgeText({
  enabled,
  connectionStatus,
  meetings,
  now,
  leadMinutes,
}) {
  if (!enabled) {
    return null
  }

  if (!checkKeepsCachedMeetingsOnBadge(connectionStatus)) {
    return null
  }

  if (!Array.isArray(meetings) || meetings.length === 0) {
    return null
  }

  return computeBadgeText(meetings, now, leadMinutes) || null
}

export function checkKeepsCachedMeetingsOnBadge(connectionStatus) {
  return (
    connectionStatus === ConnectionStatus.CONNECTED ||
    connectionStatus === ConnectionStatus.SESSION_UNAVAILABLE ||
    connectionStatus === ConnectionStatus.BOOTSTRAP_FAILED ||
    connectionStatus === ConnectionStatus.EVENTS_SYNC_FAILED
  )
}
