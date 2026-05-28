import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

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

describe('background command orchestration', () => {
  it('copies Chrome-owned pages without toast when injection fails', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 1, url: 'chrome://extensions/' },
      executeScriptError: new Error('cannot inject'),
    })

    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.tabsQuery.length, 1)
    assert.equal(harness.calls.executeScript.length, 1)
    assert.equal(harness.calls.getContexts.length, 1)
    assert.equal(harness.calls.createDocument.length, 1)
    assert.deepEqual(harness.calls.runtimeSendMessage, [
      {
        target: 'kool-kits-offscreen',
        type: 'copy-text',
        text: 'chrome://extensions/',
      },
    ])
    assert.deepEqual(harness.calls.tabsSendMessage, [])
  })

  it('copies the active tab URL and shows a success toast', async () => {
    const tabUrl = 'https://example.com/current?tab=1'
    const harness = await createBackgroundHarness({
      activeTab: { id: 42, url: tabUrl },
      copyResponse: { ok: true },
    })

    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.deepEqual(harness.calls.executeScript, [
      {
        target: { tabId: 42 },
        files: ['src/toast.js'],
      },
    ])
    assert.deepEqual(harness.calls.getContexts, [
      {
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: ['chrome-extension://kool-kits/src/offscreen.html'],
      },
    ])
    assert.deepEqual(harness.calls.createDocument, [
      {
        url: 'src/offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Copy the active tab URL to the clipboard.',
      },
    ])
    assert.deepEqual(harness.calls.runtimeSendMessage, [
      {
        target: 'kool-kits-offscreen',
        type: 'copy-text',
        text: tabUrl,
      },
    ])
    assert.deepEqual(harness.calls.tabsSendMessage, [
      {
        tabId: 42,
        message: {
          target: 'kool-kits-toast',
          type: 'show-toast',
          toast: {
            tone: 'success',
            text: 'Copied Current URL',
          },
        },
      },
    ])
    assert.deepEqual(harness.events, [
      'tabs.query',
      'runtime.getContexts',
      'offscreen.createDocument',
      'runtime.sendMessage',
      'scripting.executeScript',
      'tabs.sendMessage',
    ])
  })

  it('uses an existing offscreen document while copying the active tab URL', async () => {
    const tabUrl = 'https://example.com/current?tab=1'
    const harness = await createBackgroundHarness({
      activeTab: { id: 42, url: tabUrl },
      copyResponse: { ok: true },
      existingContexts: [
        {
          contextType: 'OFFSCREEN_DOCUMENT',
          documentUrl: 'chrome-extension://kool-kits/src/offscreen.html',
        },
      ],
    })

    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.deepEqual(harness.calls.getContexts, [
      {
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: ['chrome-extension://kool-kits/src/offscreen.html'],
      },
    ])
    assert.deepEqual(harness.calls.createDocument, [])
    assert.deepEqual(harness.calls.runtimeSendMessage, [
      {
        target: 'kool-kits-offscreen',
        type: 'copy-text',
        text: tabUrl,
      },
    ])
    assert.deepEqual(harness.calls.tabsSendMessage, [
      {
        tabId: 42,
        message: {
          target: 'kool-kits-toast',
          type: 'show-toast',
          toast: {
            tone: 'success',
            text: 'Copied Current URL',
          },
        },
      },
    ])
  })

  it('copies without feedback when toast injection fails', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 42, url: 'https://example.com/current' },
      executeScriptError: new Error('cannot inject'),
    })

    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.executeScript.length, 1)
    assert.equal(harness.calls.getContexts.length, 1)
    assert.equal(harness.calls.createDocument.length, 1)
    assert.deepEqual(harness.calls.runtimeSendMessage, [
      {
        target: 'kool-kits-offscreen',
        type: 'copy-text',
        text: 'https://example.com/current',
      },
    ])
    assert.deepEqual(harness.calls.tabsSendMessage, [])
  })

  it('shows an error toast when clipboard copy fails', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 42, url: 'https://example.com/current' },
      copyResponse: { ok: false },
    })

    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.executeScript.length, 1)
    assert.equal(harness.calls.runtimeSendMessage.length, 1)
    assert.deepEqual(harness.calls.tabsSendMessage, [
      {
        tabId: 42,
        message: {
          target: 'kool-kits-toast',
          type: 'show-toast',
          toast: {
            tone: 'error',
            text: 'Could not copy URL',
          },
        },
      },
    ])
  })

  it('shares one offscreen document creation across concurrent first-run commands', async () => {
    const createDocument = createDeferred()
    const harness = await createBackgroundHarness({
      activeTab: { id: 42, url: 'https://example.com/current' },
      createDocumentResult: createDocument.promise,
      copyResponse: { ok: true },
    })

    harness.invokeCopyCurrentUrlCommand()
    harness.invokeCopyCurrentUrlCommand()
    await flushAsyncWork()

    assert.equal(harness.calls.getContexts.length, 2)
    assert.equal(harness.calls.createDocument.length, 1)
    assert.deepEqual(harness.calls.runtimeSendMessage, [])

    createDocument.resolve()
    await flushAsyncWork()

    assert.equal(harness.calls.createDocument.length, 1)
    assert.equal(harness.calls.runtimeSendMessage.length, 2)
    assert.equal(harness.calls.tabsSendMessage.length, 2)
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

  it('opens immediately while the current-tab refresh is still in flight', async () => {
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

    assert.equal(harness.calls.windowsCreate.length, 1)

    const state = harness.invokeRuntimeMessage({
      target: 'kool-kits-recent-tab-switcher',
      type: 'get-state',
    })
    await flushAsyncWork()

    assert.deepEqual(harness.calls.tabsCaptureVisibleTab, [
      {
        options: { format: 'jpeg', quality: 45 },
        windowId: 10,
      },
    ])
    assert.deepEqual(
      state.response.tabs.map(({ id, thumbnailUrl }) => ({ id, thumbnailUrl })),
      [
        { id: 1, thumbnailUrl: 'data:image/jpeg;base64,oldCurrent' },
        { id: 2, thumbnailUrl: 'data:image/jpeg;base64,prevTab' },
      ],
    )

    capture.resolve('data:image/jpeg;base64,cmF3')
    await flushAsyncWork()
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
    const harness = await createBackgroundHarness({
      activeTab: { id: 3, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
      initialRecentHistories: [{ tabIds: [2, 1], windowId: 10 }],
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
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

  it('coalesces rapid activation captures per window', async () => {
    const harness = await createBackgroundHarness({
      activeTab: { id: 3, windowId: 10 },
      captureVisibleTabResult: 'data:image/jpeg;base64,cmF3',
    })

    mock.timers.enable({ apis: ['setTimeout'] })
    harness.invokeTabActivated({ tabId: 1, windowId: 10 })
    harness.invokeTabActivated({ tabId: 2, windowId: 10 })
    harness.invokeTabActivated({ tabId: 3, windowId: 10 })
    await flushAsyncWork()
    mock.timers.tick(250)
    await flushAsyncWork()

    assert.equal(harness.calls.tabsCaptureVisibleTab.length, 1)
    assert.deepEqual(harness.sessionStorage.recentTabThumbnails, [
      {
        thumbnails: [{ tabId: 3, thumbnailUrl: 'data:image/jpeg;base64,AQID' }],
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
  captureVisibleTabError,
  captureVisibleTabResult = 'data:image/jpeg;base64,cmF3',
  copyResponse = { ok: true },
  createDocumentResult = Promise.resolve(),
  executeScriptError,
  existingContexts = [],
  getWindowResult,
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
  const windowsRemovedListeners = []
  const runtimeMessageListeners = []
  const calls = {
    createDocument: [],
    executeScript: [],
    getContexts: [],
    runtimeSendMessage: [],
    storageGet: [],
    storageSet: [],
    tabsCaptureVisibleTab: [],
    tabsQuery: [],
    tabsSendMessage: [],
    tabsUpdate: [],
    windowsCreate: [],
    windowsGet: [],
    windowsGetLastFocused: [],
    windowsRemove: [],
    windowsUpdate: [],
  }
  const events = []
  const sessionStorage = {}
  if (initialRecentHistories) {
    sessionStorage.recentTabHistories = initialRecentHistories
  }
  if (initialRecentThumbnails) {
    sessionStorage.recentTabThumbnails = initialRecentThumbnails
  }

  globalThis.fetch = () =>
    Promise.resolve({
      blob: () => Promise.resolve(new Blob(['raw'])),
    })
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
    commands: {
      onCommand: {
        addListener(listener) {
          commandListeners.push(listener)
        },
      },
    },
    offscreen: {
      createDocument(options) {
        events.push('offscreen.createDocument')
        calls.createDocument.push(options)
        return createDocumentResult
      },
    },
    runtime: {
      getContexts(options) {
        events.push('runtime.getContexts')
        calls.getContexts.push(options)
        return Promise.resolve(existingContexts)
      },
      getURL(path) {
        return `chrome-extension://kool-kits/${path}`
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
        return Promise.resolve(copyResponse)
      },
    },
    scripting: {
      executeScript(options) {
        events.push('scripting.executeScript')
        calls.executeScript.push(options)

        if (executeScriptError) {
          return Promise.reject(executeScriptError)
        }

        return Promise.resolve()
      },
    },
    storage: {
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
      captureVisibleTab(windowId, options) {
        events.push('tabs.captureVisibleTab')
        calls.tabsCaptureVisibleTab.push({ options, windowId })
        if (captureVisibleTabError) {
          return Promise.reject(captureVisibleTabError)
        }
        return Promise.resolve(captureVisibleTabResult)
      },
      query(options) {
        events.push('tabs.query')
        calls.tabsQuery.push(options)
        return Promise.resolve(activeTab ? [activeTab] : [])
      },
      sendMessage(tabId, message) {
        events.push('tabs.sendMessage')
        calls.tabsSendMessage.push({ tabId, message })
        return Promise.resolve()
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
    sessionStorage,
    invokeCopyCurrentUrlCommand() {
      commandListeners.at(-1)('copy-current-url')
    },
    invokeRecentTabSwitcherCommand() {
      commandListeners.at(-1)('recent-tab-switcher')
    },
    invokeRecentTabSwitcherPreviousCommand() {
      commandListeners.at(-1)('recent-tab-switcher-previous')
    },
    invokeTabActivated(activeInfo) {
      for (const listener of tabsActivatedListeners) {
        listener(activeInfo)
      }
    },
    invokeTabRemoved(tabId, removeInfo) {
      for (const listener of tabsRemovedListeners) {
        listener(tabId, removeInfo)
      }
    },
    invokeWindowRemoved(windowId) {
      for (const listener of windowsRemovedListeners) {
        listener(windowId)
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

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}
