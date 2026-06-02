import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ConnectionStatus,
  ConnectionStatusRefreshMode,
  buildMeetingCachePatchForBootstrapFailure,
  buildMeetingCachePatchForConnectedSync,
  buildMeetingCachePatchForConnectionOnlySync,
  buildMeetingCachePatchForEventsSyncFailure,
  buildMeetingCachePatchForSessionUnavailable,
  checkAllowsMeetingCacheCommit,
  checkAllowsMeetingCacheReplacement,
  checkAllowsSyncCacheWrite,
  checkIsExtensionDisconnected,
  checkKeepsCachedMeetingsOnBadge,
  checkShouldClearReconnectPending,
  buildConnectionStatusResponse,
  checkShouldFetchMeetingEvents,
  checkShouldRefreshLiveConnectionStatus,
  checkShouldSkipMeetingSync,
  checkUsesCoalescedSyncForStatusRefresh,
  resolveConnectionStatusRefreshMode,
  checkHasCachedPopupMeetings,
  checkShowsConnectScreen,
  checkShowsPopupConnectScreen,
  checkAllowsSyncBadgeCommit,
  checkShowsAccountIdentity,
  checkShowsConnectedAccount,
  checkShowsFetchErrorScreen,
  resolveMeetingBadgeText,
  createCoalescedSyncRunner,
  createEmptyMeetingCache,
  normalizeMeetingCache,
  resolveLegacyConnectionStatus,
  resolveMeetingsForAccountChange,
} from '../src/meeting-connection.js'

describe('normalizeMeetingCache', () => {
  it('defaults to an empty disconnected cache', () => {
    assert.deepEqual(
      normalizeMeetingCache(undefined),
      createEmptyMeetingCache(),
    )
  })

  it('preserves a modern cache', () => {
    const cache = {
      connectionStatus: ConnectionStatus.CONNECTED,
      connectedEmail: 'me@example.com',
      meetings: [{ id: '1' }],
      lastSyncedAt: 1,
    }
    assert.equal(
      normalizeMeetingCache(cache).connectionStatus,
      ConnectionStatus.CONNECTED,
    )
    assert.equal(normalizeMeetingCache(cache).meetings.length, 1)
  })

  it('clears stale email and meetings from modern disconnected cache', () => {
    assert.deepEqual(
      normalizeMeetingCache({
        connectionStatus: ConnectionStatus.DISCONNECTED,
        connectedEmail: 'me@example.com',
        meetings: [{ id: '1' }],
        lastSyncedAt: 1,
      }),
      {
        connectionStatus: ConnectionStatus.DISCONNECTED,
        connectedEmail: undefined,
        meetings: [],
        lastSyncedAt: 1,
      },
    )
  })

  it('clears stale email and meetings from legacy user-disconnected cache', () => {
    assert.deepEqual(
      normalizeMeetingCache({
        syncState: 'connected',
        disconnectedByUser: true,
        connectedEmail: 'me@example.com',
        meetings: [{ id: '1' }],
        lastSyncedAt: 1,
      }),
      {
        connectionStatus: ConnectionStatus.DISCONNECTED,
        connectedEmail: undefined,
        meetings: [],
        lastSyncedAt: 1,
      },
    )
  })

  it('does not treat legacy disabled as user disconnect', () => {
    assert.equal(
      resolveLegacyConnectionStatus({
        syncState: 'disabled',
        connectedEmail: 'me@example.com',
        meetings: [],
      }),
      ConnectionStatus.CONNECTED,
    )
    assert.equal(
      resolveLegacyConnectionStatus({
        syncState: 'disabled',
        meetings: [],
      }),
      ConnectionStatus.SESSION_UNAVAILABLE,
    )
    assert.equal(
      normalizeMeetingCache({
        syncState: 'disabled',
        connectedEmail: 'me@example.com',
        meetings: [{ id: '1' }],
      }).connectionStatus,
      ConnectionStatus.CONNECTED,
    )
    assert.equal(
      normalizeMeetingCache({
        syncState: 'disabled',
        disconnectedByUser: true,
        connectedEmail: 'me@example.com',
        meetings: [],
      }).connectionStatus,
      ConnectionStatus.DISCONNECTED,
    )
  })

  it('maps legacy syncState and disconnectedByUser', () => {
    assert.equal(
      normalizeMeetingCache({
        syncState: 'connected',
        connectedEmail: 'me@example.com',
        meetings: [],
      }).connectionStatus,
      ConnectionStatus.CONNECTED,
    )
    assert.equal(
      normalizeMeetingCache({
        syncState: 'notConnected',
        disconnectedByUser: true,
        meetings: [],
      }).connectionStatus,
      ConnectionStatus.DISCONNECTED,
    )
    assert.equal(
      normalizeMeetingCache({
        syncState: 'notConnected',
        meetings: [],
      }).connectionStatus,
      ConnectionStatus.SESSION_UNAVAILABLE,
    )
  })
})

describe('meeting sync guards', () => {
  it('blocks stale sync cache writes after disconnect generation bump', () => {
    assert.equal(checkAllowsSyncCacheWrite(1, 1), true)
    assert.equal(checkAllowsSyncCacheWrite(1, 2), false)
  })

  it('skips sync when disconnected unless reconnect is pending', () => {
    assert.deepEqual(
      checkShouldSkipMeetingSync({
        enabled: true,
        allowReconnect: false,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      { skip: true, reason: 'disconnected' },
    )
    assert.deepEqual(
      checkShouldSkipMeetingSync({
        enabled: true,
        allowReconnect: true,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      { skip: false },
    )
  })

  it('runs connection sync while feature disabled when reconnect pending', () => {
    assert.deepEqual(
      checkShouldSkipMeetingSync({
        enabled: false,
        allowReconnect: false,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      { skip: true, reason: 'disconnected' },
    )
    assert.deepEqual(
      checkShouldSkipMeetingSync({
        enabled: false,
        allowReconnect: false,
        connectionStatus: ConnectionStatus.CONNECTED,
      }),
      { skip: true, reason: 'disabled' },
    )
    assert.deepEqual(
      checkShouldSkipMeetingSync({
        enabled: false,
        allowReconnect: true,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      { skip: false },
    )
  })

  it('clears reconnect pending only after a connected sync', () => {
    assert.equal(
      checkShouldClearReconnectPending(ConnectionStatus.CONNECTED),
      true,
    )
    assert.equal(
      checkShouldClearReconnectPending(ConnectionStatus.SESSION_UNAVAILABLE),
      false,
    )
    assert.equal(
      checkShouldClearReconnectPending(ConnectionStatus.BOOTSTRAP_FAILED),
      false,
    )
    assert.equal(
      checkShouldClearReconnectPending(ConnectionStatus.EVENTS_SYNC_FAILED),
      false,
    )
  })

  it('blocks cache replacement while disconnected unless reconnect promotes', () => {
    assert.equal(
      checkAllowsMeetingCacheReplacement({
        allowReconnect: false,
        currentConnectionStatus: ConnectionStatus.DISCONNECTED,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsMeetingCacheReplacement({
        allowReconnect: true,
        currentConnectionStatus: ConnectionStatus.DISCONNECTED,
        nextConnectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsMeetingCacheReplacement({
        allowReconnect: true,
        currentConnectionStatus: ConnectionStatus.DISCONNECTED,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      true,
    )
    assert.equal(
      checkAllowsMeetingCacheReplacement({
        allowReconnect: false,
        currentConnectionStatus: ConnectionStatus.SESSION_UNAVAILABLE,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      true,
    )
  })

  it('skips event fetch while feature disabled', () => {
    assert.equal(checkShouldFetchMeetingEvents({ enabled: true }), true)
    assert.equal(checkShouldFetchMeetingEvents({ enabled: false }), false)
  })

  it('chooses full sync vs connection-only status refresh by enabled flag', () => {
    assert.equal(
      resolveConnectionStatusRefreshMode({ enabled: true }),
      ConnectionStatusRefreshMode.FULL_SYNC,
    )
    assert.equal(
      resolveConnectionStatusRefreshMode({ enabled: false }),
      ConnectionStatusRefreshMode.CONNECTION_ONLY,
    )
    assert.equal(
      checkUsesCoalescedSyncForStatusRefresh({ enabled: true }),
      true,
    )
    assert.equal(
      checkUsesCoalescedSyncForStatusRefresh({ enabled: false }),
      false,
    )
  })

  it('connection-only patch does not replace meetings with fetched events', () => {
    const current = {
      connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
      connectedEmail: 'me@example.com',
      meetings: [{ id: 'cached' }],
      lastSyncedAt: 1,
    }

    assert.deepEqual(
      buildMeetingCachePatchForConnectionOnlySync(
        current,
        { email: 'me@example.com' },
        2,
      ).meetings,
      [{ id: 'cached' }],
    )
    assert.deepEqual(
      buildMeetingCachePatchForConnectedSync(
        { email: 'me@example.com' },
        [{ id: 'fresh' }],
        2,
      ).meetings,
      [{ id: 'fresh' }],
    )
  })

  it('refreshes live connection status unless user disconnected', () => {
    assert.equal(
      checkShouldRefreshLiveConnectionStatus({
        connectionStatus: ConnectionStatus.DISCONNECTED,
        allowReconnect: false,
      }),
      false,
    )
    assert.equal(
      checkShouldRefreshLiveConnectionStatus({
        connectionStatus: ConnectionStatus.DISCONNECTED,
        allowReconnect: true,
      }),
      true,
    )
    assert.equal(
      checkShouldRefreshLiveConnectionStatus({
        connectionStatus: ConnectionStatus.CONNECTED,
        allowReconnect: false,
      }),
      true,
    )
    assert.equal(
      checkShouldRefreshLiveConnectionStatus({
        connectionStatus: ConnectionStatus.SESSION_UNAVAILABLE,
        allowReconnect: false,
      }),
      true,
    )
  })

  it('builds connection status API response from cache', () => {
    assert.deepEqual(
      buildConnectionStatusResponse({
        connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
        connectedEmail: 'me@example.com',
        meetings: [{ id: '1' }],
      }),
      {
        connected: false,
        email: 'me@example.com',
        connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
      },
    )
    assert.deepEqual(
      buildConnectionStatusResponse({
        connectionStatus: ConnectionStatus.CONNECTED,
        connectedEmail: 'me@example.com',
        meetings: [],
      }),
      {
        connected: true,
        email: 'me@example.com',
        connectionStatus: ConnectionStatus.CONNECTED,
      },
    )
    assert.deepEqual(
      buildConnectionStatusResponse({
        connectionStatus: ConnectionStatus.DISCONNECTED,
        connectedEmail: undefined,
        meetings: [],
      }),
      {
        connected: false,
        email: undefined,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      },
    )
  })

  it('blocks stale commit when generation changes after cache read', () => {
    assert.equal(
      checkAllowsMeetingCacheCommit({
        syncGeneration: 1,
        activeGeneration: 2,
        allowReconnect: true,
        currentConnectionStatus: ConnectionStatus.CONNECTED,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsMeetingCacheCommit({
        syncGeneration: 1,
        activeGeneration: 1,
        allowReconnect: false,
        currentConnectionStatus: ConnectionStatus.DISCONNECTED,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsMeetingCacheCommit({
        syncGeneration: 1,
        activeGeneration: 1,
        allowReconnect: true,
        currentConnectionStatus: ConnectionStatus.DISCONNECTED,
        nextConnectionStatus: ConnectionStatus.CONNECTED,
      }),
      true,
    )
  })

  it('clears meetings on account change and keeps them for same email', () => {
    const current = {
      connectedEmail: 'old@example.com',
      meetings: [{ id: '1' }],
    }

    assert.deepEqual(
      resolveMeetingsForAccountChange(current, 'new@example.com'),
      [],
    )
    assert.deepEqual(
      resolveMeetingsForAccountChange(current, 'old@example.com'),
      [{ id: '1' }],
    )
    assert.deepEqual(
      resolveMeetingsForAccountChange(
        { meetings: [{ id: '1' }] },
        'new@example.com',
      ),
      [],
    )
  })

  it('builds connection and event cache patches', () => {
    const current = {
      connectionStatus: ConnectionStatus.CONNECTED,
      connectedEmail: 'old@example.com',
      meetings: [{ id: '1' }],
      lastSyncedAt: 1,
    }

    assert.equal(
      buildMeetingCachePatchForBootstrapFailure(current, 2).connectionStatus,
      ConnectionStatus.BOOTSTRAP_FAILED,
    )
    assert.equal(
      buildMeetingCachePatchForSessionUnavailable(current, 2).connectionStatus,
      ConnectionStatus.SESSION_UNAVAILABLE,
    )
    assert.equal(
      buildMeetingCachePatchForSessionUnavailable(current, 2).connectedEmail,
      undefined,
    )
    assert.deepEqual(
      buildMeetingCachePatchForConnectedSync(
        { email: 'me@example.com' },
        [{ id: '2' }],
        3,
      ),
      {
        connectionStatus: ConnectionStatus.CONNECTED,
        connectedEmail: 'me@example.com',
        meetings: [{ id: '2' }],
        lastSyncedAt: 3,
      },
    )
    assert.deepEqual(
      buildMeetingCachePatchForConnectionOnlySync(
        current,
        { email: 'new@example.com' },
        3,
      ),
      {
        connectionStatus: ConnectionStatus.CONNECTED,
        connectedEmail: 'new@example.com',
        meetings: [],
        lastSyncedAt: 3,
      },
    )
    assert.deepEqual(
      buildMeetingCachePatchForEventsSyncFailure(
        current,
        { email: 'new@example.com' },
        4,
      ),
      {
        connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
        connectedEmail: 'new@example.com',
        meetings: [],
        lastSyncedAt: 4,
      },
    )
    assert.deepEqual(
      buildMeetingCachePatchForEventsSyncFailure(
        { ...current, connectedEmail: 'me@example.com' },
        { email: 'me@example.com' },
        4,
      ).meetings,
      [{ id: '1' }],
    )
  })

  it('reruns sync once after request during in-flight sync', async () => {
    const firstRun = createDeferred()
    const calls = []
    const syncMeetings = createCoalescedSyncRunner(async () => {
      calls.push('run')
      if (calls.length === 1) {
        await firstRun.promise
      }
    })

    const firstRequest = syncMeetings()
    const secondRequest = syncMeetings()
    assert.equal(calls.length, 1)

    firstRun.resolve()
    await firstRequest

    assert.equal(firstRequest, secondRequest)
    assert.equal(calls.length, 2)
  })
})

describe('connection UI helpers', () => {
  it('treats only DISCONNECTED as user-disconnected', () => {
    assert.equal(
      checkIsExtensionDisconnected(ConnectionStatus.DISCONNECTED),
      true,
    )
    assert.equal(
      checkIsExtensionDisconnected(ConnectionStatus.SESSION_UNAVAILABLE),
      false,
    )
  })

  it('shows account identity for linked failure states only', () => {
    assert.equal(
      checkShowsAccountIdentity(ConnectionStatus.CONNECTED, 'a@b.com'),
      true,
    )
    assert.equal(
      checkShowsAccountIdentity(ConnectionStatus.BOOTSTRAP_FAILED, 'a@b.com'),
      true,
    )
    assert.equal(
      checkShowsAccountIdentity(ConnectionStatus.EVENTS_SYNC_FAILED, 'a@b.com'),
      true,
    )
    assert.equal(
      checkShowsAccountIdentity(
        ConnectionStatus.SESSION_UNAVAILABLE,
        'a@b.com',
      ),
      false,
    )
    assert.equal(
      checkShowsAccountIdentity(ConnectionStatus.DISCONNECTED, 'a@b.com'),
      false,
    )
    assert.equal(
      checkShowsAccountIdentity(ConnectionStatus.CONNECTED, undefined),
      false,
    )
    assert.equal(
      checkShowsConnectedAccount(ConnectionStatus.BOOTSTRAP_FAILED, 'a@b.com'),
      false,
    )
  })

  it('blocks sync badge commit after disconnect generation bump', () => {
    assert.equal(
      checkAllowsSyncBadgeCommit({
        syncGeneration: 1,
        activeGeneration: 2,
        connectionStatus: ConnectionStatus.CONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsSyncBadgeCommit({
        syncGeneration: 1,
        activeGeneration: 1,
        connectionStatus: ConnectionStatus.DISCONNECTED,
      }),
      false,
    )
    assert.equal(
      checkAllowsSyncBadgeCommit({
        syncGeneration: 1,
        activeGeneration: 1,
        connectionStatus: ConnectionStatus.CONNECTED,
      }),
      true,
    )
  })

  it('resolves badge text only for enabled usable cache', () => {
    const meetings = [
      { id: '1', start: 1_000, end: 3_600_000, title: 'Standup' },
    ]

    assert.equal(
      resolveMeetingBadgeText({
        enabled: false,
        connectionStatus: ConnectionStatus.CONNECTED,
        meetings,
        now: 500,
        leadMinutes: 5,
      }),
      null,
    )
    assert.equal(
      resolveMeetingBadgeText({
        enabled: true,
        connectionStatus: ConnectionStatus.DISCONNECTED,
        meetings,
        now: 500,
        leadMinutes: 5,
      }),
      null,
    )
    assert.equal(
      resolveMeetingBadgeText({
        enabled: true,
        connectionStatus: ConnectionStatus.EVENTS_SYNC_FAILED,
        meetings,
        now: 500,
        leadMinutes: 5,
      }),
      '1',
    )
  })

  it('routes popup connect screen with session-unavailable cache fallback', () => {
    assert.equal(
      checkShowsPopupConnectScreen(ConnectionStatus.DISCONNECTED, true),
      true,
    )
    assert.equal(
      checkShowsPopupConnectScreen(ConnectionStatus.DISCONNECTED, false),
      true,
    )
    assert.equal(
      checkShowsPopupConnectScreen(ConnectionStatus.SESSION_UNAVAILABLE, false),
      true,
    )
    assert.equal(
      checkShowsPopupConnectScreen(ConnectionStatus.SESSION_UNAVAILABLE, true),
      false,
    )
    assert.equal(
      checkShowsPopupConnectScreen(ConnectionStatus.CONNECTED, false),
      false,
    )
    assert.equal(checkHasCachedPopupMeetings([{ id: '1' }], []), true)
    assert.equal(checkHasCachedPopupMeetings([], []), false)
  })

  it('routes connect and fetch-error screens', () => {
    assert.equal(checkShowsConnectScreen(ConnectionStatus.DISCONNECTED), true)
    assert.equal(
      checkShowsConnectScreen(ConnectionStatus.SESSION_UNAVAILABLE),
      true,
    )
    assert.equal(
      checkShowsFetchErrorScreen(ConnectionStatus.BOOTSTRAP_FAILED),
      true,
    )
    assert.equal(
      checkShowsFetchErrorScreen(ConnectionStatus.EVENTS_SYNC_FAILED),
      true,
    )
    assert.equal(
      checkShowsConnectedAccount(ConnectionStatus.CONNECTED, 'a@b.com'),
      true,
    )
  })

  it('keeps badge meetings for non-disconnected fetch failures', () => {
    assert.equal(
      checkKeepsCachedMeetingsOnBadge(ConnectionStatus.EVENTS_SYNC_FAILED),
      true,
    )
    assert.equal(
      checkKeepsCachedMeetingsOnBadge(ConnectionStatus.DISCONNECTED),
      false,
    )
  })
})

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}
