import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

const originalChrome = globalThis.chrome
const originalDocument = globalThis.document
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
)

afterEach(() => {
  globalThis.chrome = originalChrome
  globalThis.document = originalDocument

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    delete globalThis.navigator
  }
})

describe('offscreen clipboard handler', () => {
  it('removes the fallback textarea when copy throws', async () => {
    let listener
    let didRemoveTextarea = false

    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback
          },
        },
      },
    }

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })

    globalThis.document = {
      body: {
        append() {},
      },
      createElement() {
        return {
          set value(_value) {},
          setAttribute() {},
          style: {},
          focus() {},
          select() {},
          remove() {
            didRemoveTextarea = true
          },
        }
      },
      execCommand() {
        throw new Error('copy exploded')
      },
    }

    await import(`../src/offscreen.js?test=${Date.now()}`)

    const response = await new Promise((resolve) => {
      const didKeepChannelOpen = listener(
        {
          target: 'kool-kits-offscreen',
          type: 'copy-text',
          text: 'https://example.com/',
        },
        undefined,
        resolve,
      )

      assert.equal(didKeepChannelOpen, true)
    })

    assert.equal(didRemoveTextarea, true)
    assert.deepEqual(response, { ok: false, error: 'copy exploded' })
  })
})
