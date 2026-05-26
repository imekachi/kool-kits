import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

const backgroundScriptUrl = new URL('../src/background.js', import.meta.url)
const originalChrome = globalThis.chrome

let importCounter = 0

afterEach(() => {
  globalThis.chrome = originalChrome
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

async function createBackgroundHarness({
  activeTab,
  copyResponse = { ok: true },
  createDocumentResult = Promise.resolve(),
  executeScriptError,
  existingContexts = [],
} = {}) {
  const commandListeners = []
  const calls = {
    createDocument: [],
    executeScript: [],
    getContexts: [],
    runtimeSendMessage: [],
    tabsQuery: [],
    tabsSendMessage: [],
  }
  const events = []

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
      sendMessage(message) {
        events.push('runtime.sendMessage')
        calls.runtimeSendMessage.push(message)
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
    tabs: {
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
    },
  }

  await import(`${backgroundScriptUrl.href}?test=${++importCounter}`)

  return {
    calls,
    events,
    invokeCopyCurrentUrlCommand() {
      commandListeners.at(-1)('copy-current-url')
    },
  }
}

async function flushAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
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
