import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const switcherScriptPath = new URL('../src/switcher.js', import.meta.url)

describe('switcher UI rendering', () => {
  it('shows the default favicon when no favicon exists', async () => {
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

    assert.equal(
      preview.className,
      'switcher-preview switcher-preview-active-tab',
    )
    assertDefaultFavicon(preview.children[0])
    assert.equal(
      harness.listElement.children[1].children[0].className,
      'switcher-preview',
    )
    assertDefaultFavicon(
      harness.listElement.children[1].children[0].children[0],
    )
  })

  it('renders the favicon centered in the preview area', async () => {
    const harness = await createSwitcherHarness({
      tabs: [
        {
          favIconUrl: 'https://active.example/favicon.ico',
          id: 1,
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
    const favicon = preview.children[0]
    const label = firstCard.children[1]

    assert.equal(favicon.tagName, 'img')
    assert.equal(favicon.alt, '')
    assert.equal(favicon.className, 'switcher-favicon')
    assert.equal(favicon.src, 'https://active.example/favicon.ico')
    assert.equal(label.className, 'switcher-label')
    assert.equal(label.children.length, 1)
    assert.equal(label.children[0].className, 'switcher-text')
  })

  it('replaces a failed favicon image with the default favicon', async () => {
    const harness = await createSwitcherHarness({
      tabs: [
        {
          favIconUrl: 'https://active.example/missing.ico',
          id: 1,
          title: 'Active',
          windowId: 10,
        },
        { favIconUrl: '', id: 2, title: 'Previous', windowId: 10 },
      ],
    })

    harness.runSwitcherScript()
    await flushAsyncWork()

    const preview = harness.listElement.children[0].children[0]
    const favicon = preview.children[0]

    favicon.onerror()

    assertDefaultFavicon(preview.children[0])
  })

  it('drops the active-tab preview highlight when that card is selected', async () => {
    const harness = await createSwitcherHarness({
      tabs: [
        { favIconUrl: '', id: 1, title: 'Active', windowId: 10 },
        { favIconUrl: '', id: 2, title: 'Previous', windowId: 10 },
      ],
    })

    harness.runSwitcherScript()
    await flushAsyncWork()

    harness.invokeKeydown({ key: 'Tab', shiftKey: false, preventDefault() {} })
    await flushAsyncWork()

    const activePreview = harness.listElement.children[0].children[0]
    assert.equal(activePreview.className, 'switcher-preview')
    assert.equal(harness.listElement.children[0].dataset.selected, 'true')
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
    invokeKeydown(event) {
      for (const listener of listeners.keydown) {
        listener(event)
      }
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
    ariaHidden: undefined,
    children: [],
    className: '',
    dataset: {},
    onerror: undefined,
    parentNode: undefined,
    role: undefined,
    src: '',
    tagName,
    textContent: '',
    append(...children) {
      for (const child of children) {
        child.parentNode = this
      }
      this.children.push(...children)
    },
    replaceWith(replacement) {
      if (!this.parentNode) {
        return
      }
      const index = this.parentNode.children.indexOf(this)
      if (index === -1) {
        return
      }
      replacement.parentNode = this.parentNode
      this.parentNode.children.splice(index, 1, replacement)
      this.parentNode = undefined
    },
    replaceChildren(...children) {
      for (const child of children) {
        child.parentNode = this
      }
      this.children = children
    },
  }
}

function assertDefaultFavicon(favicon) {
  assert.equal(favicon.tagName, 'div')
  assert.equal(favicon.ariaHidden, 'true')
  assert.equal(favicon.className, 'switcher-favicon switcher-default-favicon')
}

async function flushAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}
