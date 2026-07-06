import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { ConnectionStatus } from '../src/meeting-connection.js'
import {
  CONNECTED_BOOTSTRAP_HTML,
  NOT_CONNECTED_BOOTSTRAP_HTML,
  SELF_EMAIL,
} from './fixtures/calendar-session.js'

const backgroundScriptUrl = new URL('../src/background.js', import.meta.url)
const originalChrome = globalThis.chrome
const originalCreateImageBitmap = globalThis.createImageBitmap
const originalFetch = globalThis.fetch
const originalOffscreenCanvas = globalThis.OffscreenCanvas

let importCounter = 0

afterEach(() => {
  globalThis.chrome = originalChrome
  globalThis.createImageBitmap = originalCreateImageBitmap
  globalThis.fetch = originalFetch
  globalThis.OffscreenCanvas = originalOffscreenCanvas
  mock.timers.reset()
})

describe('calendar connect toolbar badge feedback', () => {
  it('shows a success badge after connect via Calendar sign-in', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const calendarTab = {
      active: true,
      id: 99,
      lastAccessed: 2,
      url: 'https://calendar.google.com/calendar/u/0/r',
    }
    const harness = await createBackgroundHarness({
      calendarTab,
      fetchBootstrapSequence: [
        NOT_CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
      ],
      initialLocalStorage: {
        meetingSettings: {
          enabled: false,
          leadMinutes: 5,
          meetingFilter: 'acceptedTentative',
        },
        meetingReminderCache: {
          connectionStatus: ConnectionStatus.SESSION_UNAVAILABLE,
          lastSyncedAt: Date.now(),
          meetings: [],
        },
      },
    })

    harness.invokeRuntimeMessage({
      target: 'kool-kits-meeting-reminder',
      type: 'connect',
    })
    await flushAsyncWork()

    harness.invokeTabUpdated(
      calendarTab.id,
      { status: 'complete' },
      { url: calendarTab.url },
    )
    await flushAsyncWork()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      mock.timers.tick(500)
      await flushAsyncWork()
      if (harness.calls.setBadgeText.some((call) => call.text === '✓')) {
        break
      }
    }

    assert.ok(
      harness.calls.setBadgeText.some((call) => call.text === '✓'),
      'expected success badge',
    )
    assert.ok(
      harness.calls.setBadgeBackgroundColor.some(
        (call) => call.color === '#46d39a',
      ),
      'expected success badge background',
    )
    await drainTemporaryBadgeFeedback()
  })

  it('restores the meeting reminder badge after the connect badge clears', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })

    const now = Date.now()
    const calendarTab = {
      active: true,
      id: 99,
      lastAccessed: 2,
      url: 'https://calendar.google.com/calendar/u/0/r',
    }
    const harness = await createBackgroundHarness({
      calendarTab,
      fetchBootstrapSequence: [
        NOT_CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
        CONNECTED_BOOTSTRAP_HTML,
      ],
      initialLocalStorage: {
        meetingSettings: {
          enabled: false,
          leadMinutes: 5,
          meetingFilter: 'acceptedTentative',
        },
        meetingReminderCache: {
          connectedEmail: SELF_EMAIL,
          connectionStatus: ConnectionStatus.SESSION_UNAVAILABLE,
          lastSyncedAt: now,
          meetings: [
            {
              end: now + 120_000,
              id: '1',
              start: now + 60_000,
              title: 'Standup',
            },
          ],
        },
      },
    })

    harness.invokeRuntimeMessage({
      target: 'kool-kits-meeting-reminder',
      type: 'connect',
    })
    await flushAsyncWork()

    harness.invokeTabUpdated(
      calendarTab.id,
      { status: 'complete' },
      { url: calendarTab.url },
    )
    await flushAsyncWork()

    for (let attempt = 0; attempt < 40; attempt += 1) {
      mock.timers.tick(500)
      await flushAsyncWork()
      if (harness.calls.setBadgeText.some((call) => call.text === '✓')) {
        break
      }
    }

    const successBadgeIndex = harness.calls.setBadgeText.findIndex(
      (call) => call.text === '✓',
    )
    assert.notEqual(successBadgeIndex, -1)

    harness.localStorage.meetingSettings = {
      enabled: true,
      leadMinutes: 5,
      meetingFilter: 'acceptedTentative',
    }
    harness.localStorage.meetingReminderCache = {
      ...harness.localStorage.meetingReminderCache,
      connectedEmail: SELF_EMAIL,
      connectionStatus: ConnectionStatus.CONNECTED,
      meetings: [
        {
          end: now + 120_000,
          id: '1',
          start: now + 60_000,
          title: 'Standup',
        },
      ],
    }

    mock.timers.tick(1_500)
    await flushAsyncWork()

    assert.deepEqual(harness.calls.setBadgeText.at(-1), { text: '1m' })
    assert.deepEqual(harness.calls.setBadgeBackgroundColor.at(-1), {
      color: '#e5484d',
    })
    await drainTemporaryBadgeFeedback()
  })
})

describe('background recent tab switcher orchestration', () => {
  it('records tab activations so the most recent activation is first', async () => {
    const harness = await createBackgroundHarness({})

    harness.invokeTabActivated({ tabId: 1, windowId: 10 })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    harness.invokeTabActivated({ tabId: 3, windowId: 10 })
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabHistories, [
      { tabIds: [3, 2, 1], windowId: 10 },
    ])
  })

  it('removes closed tabs from the recent tab history', async () => {
    const harness = await createBackgroundHarness({})

    harness.invokeTabActivated({ tabId: 1, windowId: 10 })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    harness.invokeTabActivated({ tabId: 3, windowId: 10 })
    await flushAsyncWork()

    harness.invokeTabRemoved(2, { windowId: 10, isWindowClosing: false })
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabHistories, [
      { tabIds: [3, 1], windowId: 10 },
    ])
  })

  it('does not open the switcher when only the active tab is known', async () => {
    const harness = await createBackgroundHarness({
      lastFocusedWindow: {
        id: 10,
        type: 'normal',
        tabs: [
          {
            id: 1,
            active: true,
            title: 'Only Tab',
            url: 'https://example.com',
            favIconUrl: '',
            windowId: 10,
          },
        ],
        width: 1200,
        height: 800,
        left: 0,
        top: 0,
      },
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 0)
  })

  it('opens one switcher popup when a previous tab exists', async () => {
    const harness = await createBackgroundHarness({
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: {
        id: 10,
        type: 'normal',
        tabs: [
          {
            id: 1,
            active: true,
            title: 'Active',
            url: 'https://active.example/',
            favIconUrl: '',
            windowId: 10,
          },
          {
            id: 2,
            active: false,
            title: 'Previous',
            url: 'https://previous.example/',
            favIconUrl: '',
            windowId: 10,
          },
        ],
        width: 1200,
        height: 800,
        left: 100,
        top: 50,
      },
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)
    assert.equal(harness.calls.windowsCreate[0].type, 'popup')
    assert.equal(harness.calls.windowsCreate[0].focused, true)
    assert.equal(
      harness.calls.windowsCreate[0].url,
      'chrome-extension://kool-kits/src/switcher.html',
    )
  })

  it('forwards advance-selection next when the next command repeats while the switcher is open', async () => {
    const harness = await createBackgroundHarness({
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'ready',
    })
    await flushAsyncWork()

    const messagesBefore = harness.calls.runtimeSendMessage.length
    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)
    assert.deepEqual(harness.calls.runtimeSendMessage.slice(messagesBefore), [
      {
        direction: 'next',
        target: 'kool-kits-recent-tab-switcher-ui',
        type: 'advance-selection',
      },
    ])
  })

  it('forwards advance-selection previous when the previous command repeats while the switcher is open', async () => {
    const harness = await createBackgroundHarness({
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'ready',
    })
    await flushAsyncWork()

    const messagesBefore = harness.calls.runtimeSendMessage.length
    harness.invokeRecentTabSwitcherPreviousCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)
    assert.deepEqual(harness.calls.runtimeSendMessage.slice(messagesBefore), [
      {
        direction: 'previous',
        target: 'kool-kits-recent-tab-switcher-ui',
        type: 'advance-selection',
      },
    ])
  })

  it('activates the selected tab, focuses the source window, and closes the switcher on commit', async () => {
    const harness = await createBackgroundHarness({
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'ready',
    })
    await flushAsyncWork()

    harness.invokeRuntimeMessage({
      sourceWindowId: 10,
      tabId: 2,
      target: 'kool-kits-recent-tab-switcher',
      type: 'commit-selection',
    })
    await flushAsyncWork()

    assert.deepEqual(harness.calls.tabsUpdate, [
      { tabId: 2, updateProperties: { active: true } },
    ])
    assert.deepEqual(harness.calls.windowsUpdate, [
      { windowId: 10, updateInfo: { focused: true } },
    ])
    assert.deepEqual(harness.calls.windowsRemove, [9001])
  })

  it('fails silently and still closes the switcher when commit targets are gone', async () => {
    const harness = await createBackgroundHarness({
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
      tabsUpdateError: new Error('tab missing'),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'ready',
    })
    await flushAsyncWork()

    harness.invokeWindowRemoved(9001)
    await flushAsyncWork()

    harness.invokeRuntimeMessage(
      {
        sourceWindowId: 10,
        tabId: 2,
        target: 'kool-kits-recent-tab-switcher',
        type: 'commit-selection',
      },
      { tab: { windowId: 10 } },
    )
    await flushAsyncWork()

    assert.equal(harness.calls.windowsRemove.length, 0)
  })

  it('does not close any window when commit-selection arrives without an active switcher session', async () => {
    const harness = await createBackgroundHarness({})

    harness.invokeRuntimeMessage(
      {
        target: 'kool-kits-recent-tab-switcher',
        type: 'commit-selection',
      },
      { tab: { windowId: 7777 } },
    )
    await flushAsyncWork()

    assert.equal(harness.calls.windowsRemove.length, 0)
    assert.equal(harness.calls.tabsUpdate.length, 0)
    assert.equal(harness.calls.windowsUpdate.length, 0)
  })

  it('captures a thumbnail when a tab becomes active', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
    await flushAsyncWork()

    assert.deepEqual(harness.calls.tabsCaptureVisibleTab, [
      {
        options: { format: 'jpeg', quality: 45 },
        windowId: 10,
      },
    ])
    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,AQID' }],
        windowId: 10,
      },
    ])
  })

  it('flushes pending activation alarms for other tabs when opening the switcher', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 1, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
      initialRecentHistories: [{ tabIds: [1, 2], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    harness.invokeTabActivated({ tabId: 1, windowId: 10 })
    await flushAsyncWork()
    assert.ok(harness.hasScheduledAlarm('recent-tab-thumbnail:10:2'))

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)
    assert.ok(!harness.hasScheduledAlarm('recent-tab-thumbnail:10:2'))
    assert.ok(harness.calls.tabsCaptureVisibleTab.length >= 1)
  })

  it('refreshes the current tab before opening the switcher', async () => {
    const capture = createDeferred()
    const harness = await createBackgroundHarness({
      activeTab: { id: 1, windowId: 10 },
      captureVisibleTabResult: capture.promise,
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      initialRecentThumbnails: [
        {
          thumbnails: [
            { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,oldCurrent' },
            { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,prevTab' },
          ],
          windowId: 10,
        },
      ],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 0)
    assert.deepEqual(harness.calls.tabsCaptureVisibleTab, [
      {
        options: { format: 'jpeg', quality: 45 },
        windowId: 10,
      },
    ])

    capture.resolve('data:image/jpeg;base64,cmF3')
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)

    const state = harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'get-state',
    })
    await flushAsyncWork()

    assert.deepEqual(
      state.response.tabs.map(({ id, thumbnailUrl }) => ({ id, thumbnailUrl })),
      [
        { id: 1, thumbnailUrl: 'data:image/jpeg;base64,AQID' },
        { id: 2, thumbnailUrl: 'data:image/jpeg;base64,prevTab' },
      ],
    )
    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [
          { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,prevTab' },
          { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,AQID' },
        ],
        windowId: 10,
      },
    ])
  })

  it('opens the switcher without thumbnails when capture fails', async () => {
    const harness = await createBackgroundHarness({
      captureVisibleTabError: new Error('capture unavailable'),
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      lastFocusedWindow: openableSwitcherWindow(),
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    const state = harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'get-state',
    })
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 1)
    assert.deepEqual(
      state.response.tabs.map(({ id, thumbnailUrl }) => ({ id, thumbnailUrl })),
      [
        { id: 1, thumbnailUrl: undefined },
        { id: 2, thumbnailUrl: undefined },
      ],
    )
  })

  it('does not save a capture when the active tab changed before capture finished', async () => {
    const capture = createDeferred()
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: capture.promise,
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
    })

    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    harness.setActiveTab({ id: 3, windowId: 10 })
    capture.resolve('data:image/jpeg;base64,cmF3')
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, undefined)
  })

  it('does not save a capture after a switch-away-and-back race', async () => {
    const capture = createDeferred()
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: capture.promise,
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
    await flushAsyncWork()

    harness.invokeTabActivated({ tabId: 3, windowId: 10 })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    capture.resolve('data:image/jpeg;base64,cmF3')
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, undefined)
  })

  it('commits the outgoing tab thumbnail when switching away after it was captured', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
    })

    harness.invokeTabActivated({ tabId: 1, windowId: 10 })
    await flushAsyncWork()
    harness.invokeThumbnailCaptureAlarm('recent-tab-thumbnail:10:1')
    await flushAsyncWork()

    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,AQID' }],
        windowId: 10,
      },
    ])
  })

  it('captures a thumbnail when the scheduled activation alarm fires', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
    })

    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    harness.invokeThumbnailCaptureAlarm('recent-tab-thumbnail:10:2')
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,AQID' }],
        windowId: 10,
      },
    ])
  })

  it('removes thumbnails when bounded recent history evicts old tabs', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 7, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
      initialRecentHistories: [{ tabIds: [6, 5, 4, 3, 2, 1], windowId: 10 }],
      initialRecentThumbnails: [
        {
          thumbnails: [1, 2, 3, 4, 5, 6].map((tabId) => ({
            tabId,
            thumbnailUrl: `data:image/jpeg;base64,${tabId}`,
          })),
          windowId: 10,
        },
      ],
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 7, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
    await flushAsyncWork()

    assert.deepEqual(
      harness.sessionStorage.recentTabThumbnails[0].thumbnails.map(
        ({ tabId }) => tabId,
      ),
      [2, 3, 4, 5, 6, 7],
    )
  })

  it('invalidates a thumbnail when its tab starts navigating', async () => {
    const harness = await createBackgroundHarness({
      initialRecentThumbnails: [
        {
          thumbnails: [
            { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,oldPage' },
          ],
          windowId: 10,
        },
      ],
    })

    harness.invokeTabUpdated(2, { status: 'loading' }, { id: 2, windowId: 10 })
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [])
  })

  it('does not save a capture if the same tab navigates while capture is in flight', async () => {
    const capture = createDeferred()
    const harness = await createBackgroundHarness({
      activeTab: { id: 2, windowId: 10 },
      captureVisibleTabResult: capture.promise,
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
    await flushAsyncWork()

    harness.invokeTabUpdated(2, { status: 'loading' }, { id: 2, windowId: 10 })
    capture.resolve('data:image/jpeg;base64,cmF3')
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [])
  })

  it('keeps a thumbnail when a tab update does not represent navigation', async () => {
    const harness = await createBackgroundHarness({
      initialRecentThumbnails: [
        {
          thumbnails: [
            { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,currentPage' },
          ],
          windowId: 10,
        },
      ],
    })

    harness.invokeTabUpdated(2, { title: 'Renamed' }, { id: 2, windowId: 10 })
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [
          { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,currentPage' },
        ],
        windowId: 10,
      },
    ])
  })

  it('removes thumbnails when tabs and windows close', async () => {
    const harness = await createBackgroundHarness({
      initialRecentThumbnails: [
        {
          thumbnails: [
            { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' },
            { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,two' },
          ],
          windowId: 10,
        },
        {
          thumbnails: [
            { tabId: 3, thumbnailUrl: 'data:image/jpeg;base64,three' },
          ],
          windowId: 20,
        },
      ],
    })

    harness.invokeTabRemoved(2, { isWindowClosing: false, windowId: 10 })
    harness.invokeWindowRemoved(20)
    await flushAsyncWork()

    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' }],
        windowId: 10,
      },
    ])
  })

  it('removes thumbnails for tabs dropped during source-window reconciliation', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 1, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
      initialRecentThumbnails: [
        {
          thumbnails: [
            { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' },
            { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,two' },
          ],
          windowId: 10,
        },
      ],
      lastFocusedWindow: {
        ...openableSwitcherWindow(),
        tabs: [openableSwitcherWindow().tabs[0]],
      },
    })

    harness.invokeRecentTabSwitcherCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.windowsCreate.length, 0)
    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' }],
        windowId: 10,
      },
    ])
  })
})

function openableSwitcherWindow() {
  return {
    id: 10,
    type: 'normal',
    tabs: [
      {
        id: 1,
        active: true,
        title: 'Active',
        url: 'https://active.example/',
        favIconUrl: '',
        windowId: 10,
      },
      {
        id: 2,
        active: false,
        title: 'Previous',
        url: 'https://previous.example/',
        favIconUrl: '',
        windowId: 10,
      },
    ],
    width: 1200,
    height: 800,
    left: 0,
    top: 0,
  }
}

async function createBackgroundHarness({
  activeTab,
  advanceSelectionResponse = { ok: true },
  calendarHostPermissionGranted = true,
  calendarTab,
  captureVisibleTabError,
  captureVisibleTabResult = 'data:image/jpeg;base64,cmF3',
  fetchBootstrapSequence,
  getWindowResult,
  initialLocalStorage,
  initialRecentHistories,
  initialRecentThumbnails,
  lastFocusedWindow,
  storageSetError,
  tabsUpdateError,
  windowsCreateResult,
  windowsRemoveError,
  windowsUpdateError,
} = {}) {
  const commandListeners = []
  const tabsActivatedListeners = []
  const tabsRemovedListeners = []
  const tabsUpdatedListeners = []
  const windowsRemovedListeners = []
  const runtimeMessageListeners = []
  const calls = {
    runtimeSendMessage: [],
    setBadgeBackgroundColor: [],
    setBadgeText: [],
    setBadgeTextColor: [],
    storageGet: [],
    storageSet: [],
    tabsCaptureVisibleTab: [],
    tabsCreate: [],
    tabsQuery: [],
    tabsUpdate: [],
    windowsCreate: [],
    windowsGet: [],
    windowsGetLastFocused: [],
    windowsRemove: [],
    windowsUpdate: [],
  }
  const events = []
  const alarmListeners = []
  const scheduledAlarms = new Map()
  const sessionStorage = {}
  const localStorage = { ...initialLocalStorage }
  if (initialRecentHistories) {
    sessionStorage.recentTabHistories = initialRecentHistories
  }
  if (initialRecentThumbnails) {
    sessionStorage.recentTabThumbnails = initialRecentThumbnails
  }
  const currentActiveTab = activeTab
    ? {
        favIconUrl: activeTab.favIconUrl ?? '',
        id: activeTab.id,
        title: activeTab.title ?? 'Active',
        url: activeTab.url ?? 'https://example.com/',
        windowId: activeTab.windowId,
      }
    : undefined
  let bootstrapFetchCount = 0

  globalThis.fetch = (url, options) => {
    if (typeof url === 'string' && url.includes('/sync.fetcheventrange')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(")]}'\n\n{}"),
      })
    }

    if (
      typeof url === 'string' &&
      url.startsWith('https://calendar.google.com/calendar')
    ) {
      const sequence = fetchBootstrapSequence ?? [NOT_CONNECTED_BOOTSTRAP_HTML]
      const html =
        sequence[Math.min(bootstrapFetchCount, sequence.length - 1)] ??
        sequence.at(-1)
      bootstrapFetchCount += 1
      return Promise.resolve({
        ok: true,
        redirected: false,
        text: () => Promise.resolve(html),
        url,
      })
    }

    return Promise.resolve({
      blob: () => Promise.resolve(new Blob(['raw'])),
    })
  }
  globalThis.createImageBitmap = () =>
    Promise.resolve({ height: 900, width: 1600 })
  globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
    constructor(width, height) {
      this.height = height
      this.width = width
    }

    getContext() {
      return { drawImage() {} }
    }

    convertToBlob() {
      return Promise.resolve(
        new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' }),
      )
    }
  }

  globalThis.chrome = {
    action: {
      setBadgeBackgroundColor(details) {
        calls.setBadgeBackgroundColor.push(details)
        return Promise.resolve()
      },
      setBadgeText(details) {
        calls.setBadgeText.push(details)
        return Promise.resolve()
      },
      setBadgeTextColor(details) {
        calls.setBadgeTextColor.push(details)
        return Promise.resolve()
      },
    },
    alarms: {
      clear(name) {
        scheduledAlarms.delete(name)
        return Promise.resolve()
      },
      create(name, info) {
        scheduledAlarms.set(name, info)
        const delay = Math.max(0, (info.when ?? Date.now()) - Date.now())
        setTimeout(() => {
          if (!scheduledAlarms.has(name)) {
            return
          }
          scheduledAlarms.delete(name)
          for (const listener of alarmListeners) {
            listener({ name })
          }
        }, delay)
        return Promise.resolve()
      },
      getAll() {
        return Promise.resolve(
          [...scheduledAlarms.entries()].map(([name, info]) => ({
            name,
            ...info,
          })),
        )
      },
      onAlarm: {
        addListener(listener) {
          alarmListeners.push(listener)
        },
      },
    },
    commands: {
      onCommand: {
        addListener(listener) {
          commandListeners.push(listener)
        },
      },
    },
    permissions: {
      contains() {
        return Promise.resolve(calendarHostPermissionGranted)
      },
      request() {
        return Promise.resolve(calendarHostPermissionGranted)
      },
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://kool-kits/${path}`
      },
      onInstalled: {
        addListener() {},
      },
      onStartup: {
        addListener() {},
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageListeners.push(listener)
        },
      },
      sendMessage(message) {
        events.push('runtime.sendMessage')
        calls.runtimeSendMessage.push(message)
        if (message?.target === 'kool-kits-recent-tab-switcher-ui') {
          return Promise.resolve(advanceSelectionResponse)
        }
        return Promise.resolve()
      },
    },
    storage: {
      local: {
        get(keys) {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: localStorage[keys] })
          }
          const result = {}
          for (const key of keys) {
            if (Object.hasOwn(localStorage, key)) {
              result[key] = localStorage[key]
            }
          }
          return Promise.resolve(result)
        },
        remove(keys) {
          for (const key of keys) {
            delete localStorage[key]
          }
          return Promise.resolve()
        },
        set(values) {
          Object.assign(localStorage, values)
          return Promise.resolve()
        },
      },
      onChanged: {
        addListener() {},
      },
      session: {
        get(key) {
          events.push('storage.session.get')
          calls.storageGet.push(key)
          return Promise.resolve({ [key]: sessionStorage[key] })
        },
        set(values) {
          events.push('storage.session.set')
          calls.storageSet.push(values)
          if (storageSetError && Object.hasOwn(values, 'recentTabThumbnails')) {
            const error = storageSetError
            error.values = values
            storageSetError = undefined
            return Promise.reject(error)
          }
          Object.assign(sessionStorage, values)
          return Promise.resolve()
        },
      },
    },
    tabs: {
      create(options) {
        events.push('tabs.create')
        calls.tabsCreate.push(options)
        return Promise.resolve({
          active: options.active,
          id: calendarTab?.id ?? 100,
          url: options.url,
        })
      },
      onActivated: {
        addListener(listener) {
          tabsActivatedListeners.push(listener)
        },
      },
      onRemoved: {
        addListener(listener) {
          tabsRemovedListeners.push(listener)
        },
      },
      onUpdated: {
        addListener(listener) {
          tabsUpdatedListeners.push(listener)
        },
      },
      captureVisibleTab(windowId, options) {
        events.push('tabs.captureVisibleTab')
        calls.tabsCaptureVisibleTab.push({ options, windowId })
        if (captureVisibleTabError) {
          return Promise.reject(captureVisibleTabError)
        }
        const result =
          typeof captureVisibleTabResult === 'function'
            ? captureVisibleTabResult({ options, windowId })
            : captureVisibleTabResult
        return Promise.resolve(result)
      },
      query(options) {
        events.push('tabs.query')
        calls.tabsQuery.push(options)
        if (options?.url === 'https://calendar.google.com/*') {
          return Promise.resolve(calendarTab ? [calendarTab] : [])
        }
        return Promise.resolve(currentActiveTab ? [currentActiveTab] : [])
      },
      update(tabId, updateProperties) {
        events.push('tabs.update')
        calls.tabsUpdate.push({ tabId, updateProperties })
        if (tabsUpdateError) {
          return Promise.reject(tabsUpdateError)
        }
        return Promise.resolve()
      },
    },
    windows: {
      getAll() {
        return Promise.resolve([])
      },
      onRemoved: {
        addListener(listener) {
          windowsRemovedListeners.push(listener)
        },
      },
      create(options) {
        events.push('windows.create')
        calls.windowsCreate.push(options)
        return Promise.resolve(
          windowsCreateResult ?? { id: 9001, tabs: [{ id: 9000 }] },
        )
      },
      get(windowId, options) {
        events.push('windows.get')
        calls.windowsGet.push({ windowId, options })
        if (getWindowResult instanceof Error) {
          return Promise.reject(getWindowResult)
        }
        return Promise.resolve(getWindowResult ?? lastFocusedWindow)
      },
      getLastFocused(options) {
        events.push('windows.getLastFocused')
        calls.windowsGetLastFocused.push(options)
        return Promise.resolve(lastFocusedWindow)
      },
      remove(windowId) {
        events.push('windows.remove')
        calls.windowsRemove.push(windowId)
        if (windowsRemoveError) {
          return Promise.reject(windowsRemoveError)
        }
        return Promise.resolve()
      },
      update(windowId, updateInfo) {
        events.push('windows.update')
        calls.windowsUpdate.push({ windowId, updateInfo })
        if (windowsUpdateError) {
          return Promise.reject(windowsUpdateError)
        }
        return Promise.resolve()
      },
    },
  }

  await import(`${backgroundScriptUrl.href}?test=${++importCounter}`)

  return {
    calls,
    events,
    localStorage,
    sessionStorage,
    hasScheduledAlarm(alarmName) {
      return scheduledAlarms.has(alarmName)
    },
    setActiveTab(activeInfo) {
      if (!currentActiveTab) {
        return
      }
      currentActiveTab.id = activeInfo.tabId
      currentActiveTab.windowId = activeInfo.windowId
    },
    invokeRecentTabSwitcherCommand() {
      commandListeners.at(-1)('recent-tab-switcher')
    },
    invokeRecentTabSwitcherPreviousCommand() {
      commandListeners.at(-1)('recent-tab-switcher-previous')
    },
    invokeTabActivated(activeInfo) {
      if (currentActiveTab) {
        currentActiveTab.id = activeInfo.tabId
        currentActiveTab.windowId = activeInfo.windowId
      }
      for (const listener of tabsActivatedListeners) {
        listener(activeInfo)
      }
    },
    invokeTabRemoved(tabId, removeInfo) {
      for (const listener of tabsRemovedListeners) {
        listener(tabId, removeInfo)
      }
    },
    invokeTabUpdated(tabId, changeInfo, tab) {
      for (const listener of tabsUpdatedListeners) {
        listener(tabId, changeInfo, tab)
      }
    },
    invokeWindowRemoved(windowId) {
      for (const listener of windowsRemovedListeners) {
        listener(windowId)
      }
    },
    invokeThumbnailCaptureAlarm(alarmName) {
      for (const listener of alarmListeners) {
        listener({ name: alarmName })
      }
    },
    invokeRuntimeMessage(message, sender = {}) {
      let response
      const sendResponse = (value) => {
        response = value
      }
      for (const listener of runtimeMessageListeners) {
        listener(message, sender, sendResponse)
      }
      return {
        get response() {
          return response
        },
      }
    },
  }
}

async function flushAsyncWork() {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve()
  }
}

async function drainTemporaryBadgeFeedback() {
  mock.timers.tick(2_000)
  await flushAsyncWork()
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}
