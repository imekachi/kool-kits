const listElement = document.querySelector('[data-switcher-list]')
const commitModifierKeys = new Set(['Alt', 'Control', 'Meta'])

let selectedIndex = 0
let sourceWindowId
let switcherTabs = []

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') {
    return
  }

  event.preventDefault()
  moveSelection(event.shiftKey ? 'previous' : 'next')
})

document.addEventListener('keyup', (event) => {
  if (commitModifierKeys.has(event.key)) {
    void commitSelection()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.target !== 'kool-kits-recent-tab-switcher-ui' ||
    message.type !== 'advance-selection'
  ) {
    return undefined
  }

  moveSelection(message.direction)
  sendResponse({ ok: true })
  return undefined
})

void loadSwitcherState()

async function loadSwitcherState() {
  const response = await chrome.runtime.sendMessage({
    target: 'kool-kits-recent-tab-switcher',
    type: 'get-state',
  })

  sourceWindowId = response?.sourceWindowId
  switcherTabs = response?.tabs ?? []
  selectedIndex = switcherTabs.length > 1 ? 1 : 0

  if (switcherTabs.length <= 1) {
    window.close()
    return
  }

  render()

  await chrome.runtime.sendMessage({
    layoutMetrics: getLayoutMetrics(),
    target: 'kool-kits-recent-tab-switcher',
    type: 'ready',
    visibleItemCount: switcherTabs.length,
  })
}

function getLayoutMetrics() {
  const shell = document
    .querySelector('.switcher-shell')
    ?.getBoundingClientRect()
  if (!shell) {
    return undefined
  }

  return {
    contentHeight: Math.round(shell.height),
    contentWidth: Math.round(shell.width),
    frameHeight: Math.max(0, window.outerHeight - window.innerHeight),
  }
}

async function commitSelection() {
  const selectedTab = switcherTabs[selectedIndex]

  await chrome.runtime.sendMessage({
    sourceWindowId,
    tabId: selectedTab?.id,
    target: 'kool-kits-recent-tab-switcher',
    type: 'commit-selection',
  })
}

function moveSelection(direction) {
  if (switcherTabs.length === 0) {
    return
  }

  const delta = direction === 'previous' ? -1 : 1
  selectedIndex =
    (selectedIndex + delta + switcherTabs.length) % switcherTabs.length
  render()
}

function render() {
  listElement.replaceChildren(
    ...switcherTabs.map((tab, index) => createTabCard(tab, index)),
  )
}

function createTabCard(tab, index) {
  const card = document.createElement('article')
  card.ariaSelected = String(index === selectedIndex)
  card.className = 'switcher-card'
  card.dataset.selected = String(index === selectedIndex)
  card.role = 'option'

  const preview = document.createElement('div')
  preview.className = 'switcher-preview'

  const label = document.createElement('div')
  label.className = 'switcher-label'

  if (tab.favIconUrl) {
    const favicon = document.createElement('img')
    favicon.alt = ''
    favicon.className = 'switcher-favicon'
    favicon.src = tab.favIconUrl
    label.append(favicon)
  }

  const text = document.createElement('div')
  text.className = 'switcher-text'

  const title = document.createElement('div')
  title.className = 'switcher-title'
  title.textContent = tab.title
  text.append(title)

  label.append(text)
  card.append(preview, label)
  return card
}
