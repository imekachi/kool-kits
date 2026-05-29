import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const switcherScriptPath = new URL('../src/switcher.js', import.meta.url)

describe('switcher UI rendering', () => {
  it('keeps the preview fallback empty when no thumbnail exists', async () => {
    const harness = await createSwitcherHarness({
      tabs: [
        { favIconUrl: '', id: 1, title: 'Active', windowId: 10 },
        { favIconUrl: '', id: 2, title: 'Previous', windowId: 10 },
      ],
    })

    harness.runSwitcherScript()
    await flushAsyncWork()

    const firstCard = harness.listElement.children[0]
    const preview = firstCard.children[0]

    assert.equal(preview.className, 'switcher-preview')
    assert.deepEqual(preview.children, [])
  })

  it('renders thumbnail image inside the existing preview area', async () => {
    const harness = await createSwitcherHarness({
      tabs: [
        {
          favIconUrl: '',
          id: 1,
          thumbnailUrl: 'data:image/jpeg;base64,active',
          title: 'Active',
          windowId: 10,
        },
        { favIconUrl: '', id: 2, title: 'Previous', windowId: 10 },
      ],
    })

    harness.runSwitcherScript()
    await flushAsyncWork()

    const firstCard = harness.listElement.children[0]
    const preview = firstCard.children[0]
    const image = preview.children[0]

    assert.equal(image.tagName, 'img')
    assert.equal(image.alt, '')
    assert.equal(image.className, 'switcher-thumbnail')
    assert.equal(image.src, 'data:image/jpeg;base64,active')
  })
})

async function createSwitcherHarness({ tabs }) {
  const source = await readFile(switcherScriptPath, 'utf8')
  const listeners = {
    keydown: [],
    keyup: [],
    runtimeMessage: [],
  }
  const listElement = createElement('div')
  const sentMessages = []
  let closed = false

  const document = {
    addEventListener(type, listener) {
      listeners[type].push(listener)
    },
    createElement(tagName) {
      return createElement(tagName)
    },
    querySelector(selector) {
      if (selector === '[data-switcher-list]') {
        return listElement
      }
      return null
    },
  }

  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.runtimeMessage.push(listener)
          },
        },
        sendMessage(message) {
          sentMessages.push(message)
          if (message.type === 'get-state') {
            return Promise.resolve({ sourceWindowId: 10, tabs })
          }
          return Promise.resolve({ ok: true })
        },
      },
    },
    document,
    window: {
      close() {
        closed = true
      },
    },
  })

  function runSwitcherScript() {
    new vm.Script(source, { filename: 'switcher.js' }).runInContext(context)
  }

  return {
    get closed() {
      return closed
    },
    listElement,
    runSwitcherScript,
    sentMessages,
  }
}

function createElement(tagName) {
  return {
    alt: undefined,
    ariaSelected: undefined,
    children: [],
    className: '',
    dataset: {},
    role: undefined,
    src: '',
    tagName,
    textContent: '',
    append(...children) {
      this.children.push(...children)
    },
    replaceChildren(...children) {
      this.children = children
    },
  }
}

async function flushAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}
