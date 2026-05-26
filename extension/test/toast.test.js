import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const toastScriptPath = new URL('../src/toast.js', import.meta.url)

async function createToastHarness({ pageOwnedSameIdHost } = {}) {
  const source = await readFile(toastScriptPath, 'utf8')
  const listeners = []
  const appendedHosts = []
  const timers = []

  const documentElement = {
    append(host) {
      host.isConnected = true
      appendedHosts.push(host)
    },
  }

  const document = {
    documentElement,
    createElement(tagName) {
      return createElement(tagName)
    },
    getElementById(id) {
      if (pageOwnedSameIdHost?.id === id) {
        return pageOwnedSameIdHost
      }

      return appendedHosts.find((host) => host.id === id) ?? null
    },
  }

  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener)
          },
        },
      },
    },
    document,
    window: {
      setTimeout(callback, delay) {
        timers.push({ callback, delay })
        return timers.length
      },
    },
  })

  context.window.window = context.window

  function runToastScript() {
    new vm.Script(source, { filename: 'toast.js' }).runInContext(context)
  }

  function showToast(toast) {
    listeners.at(-1)({
      target: 'kool-kits-toast',
      type: 'show-toast',
      toast,
    })
  }

  return {
    appendedHosts,
    listeners,
    runToastScript,
    showToast,
  }
}

function createElement(tagName) {
  const element = {
    children: [],
    className: '',
    dataset: {},
    id: '',
    isConnected: false,
    shadowRoot: null,
    tagName,
    textContent: '',
    append(child) {
      this.children.push(child)
    },
    attachShadow() {
      const root = createShadowRoot()
      this.shadowRoot = root
      return root
    },
    remove() {
      this.isConnected = false
    },
  }

  element.classList = {
    add(className) {
      element.className = `${element.className} ${className}`.trim()
    },
  }

  return element
}

function createShadowRoot() {
  return {
    children: [],
    append(child) {
      this.children.push(child)
    },
    querySelector(selector) {
      if (selector !== '[data-kool-kits-toast]') {
        return null
      }

      return (
        this.children.find((child) =>
          Object.hasOwn(child.dataset ?? {}, 'koolKitsToast'),
        ) ?? null
      )
    },
  }
}

test('toast script can run repeatedly without reinstalling its listener', async () => {
  const harness = await createToastHarness()

  harness.runToastScript()
  harness.runToastScript()

  assert.equal(harness.listeners.length, 1)
})

test('toast rendering ignores a page-owned same-id host', async () => {
  const pageOwnedRoot = createShadowRoot()
  const pageOwnedSameIdHost = createElement('div')
  pageOwnedSameIdHost.id = 'kool-kits-toast-host'
  pageOwnedSameIdHost.isConnected = true
  pageOwnedSameIdHost.shadowRoot = pageOwnedRoot

  const harness = await createToastHarness({ pageOwnedSameIdHost })

  harness.runToastScript()
  harness.showToast({ text: 'Copied Current URL', tone: 'success' })

  const extensionHost = harness.appendedHosts.at(-1)
  const pageOwnedToast = pageOwnedRoot.querySelector('[data-kool-kits-toast]')
  const extensionToast = extensionHost.shadowRoot.querySelector(
    '[data-kool-kits-toast]',
  )

  assert.equal(pageOwnedToast, null)
  assert.equal(extensionHost.id, 'kool-kits-toast-host')
  assert.equal(extensionToast.textContent, 'Copied Current URL')
  assert.match(extensionToast.className, /\btoast--success\b/)
})

test('success toast uses cool green styling with a border', async () => {
  const harness = await createToastHarness()

  harness.runToastScript()
  harness.showToast({ text: 'Copied Current URL', tone: 'success' })

  const extensionHost = harness.appendedHosts.at(-1)
  const style = extensionHost.shadowRoot.children.find(
    (child) => child.tagName === 'style',
  )

  assert.match(
    style.textContent,
    /border:\s*1px solid rgba\(74, 222, 128, 0\.55\)/,
  )
  assert.match(style.textContent, /background:\s*rgba\(6, 78, 59, 0\.94\)/)
  assert.match(
    style.textContent,
    /box-shadow:\s*0 14px 40px rgba\(5, 46, 22, 0\.32\)/,
  )
})

test('toast sizes to its text with balanced horizontal padding', async () => {
  const harness = await createToastHarness()

  harness.runToastScript()
  harness.showToast({ text: 'Copied Current URL', tone: 'success' })

  const extensionHost = harness.appendedHosts.at(-1)
  const style = extensionHost.shadowRoot.children.find(
    (child) => child.tagName === 'style',
  )

  assert.doesNotMatch(style.textContent, /min-width:/)
  assert.match(style.textContent, /padding:\s*12px 14px/)
  assert.match(style.textContent, /width:\s*max-content/)
  assert.match(style.textContent, /white-space:\s*nowrap/)
})

test('toast animation moves vertically without horizontal slide', async () => {
  const harness = await createToastHarness()

  harness.runToastScript()
  harness.showToast({ text: 'Copied Current URL', tone: 'success' })

  const extensionHost = harness.appendedHosts.at(-1)
  const style = extensionHost.shadowRoot.children.find(
    (child) => child.tagName === 'style',
  )

  assert.doesNotMatch(style.textContent, /translate3d\(12px,/)
  assert.match(style.textContent, /translate3d\(0, -8px, 0\) scale\(0\.98\)/)
})
