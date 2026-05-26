import { checkCanCopyTabUrl } from './copyable-url.js'

const COPY_CURRENT_URL_COMMAND = 'copy-current-url'
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html'
const TOAST_SCRIPT_PATH = 'src/toast.js'

let offscreenDocumentCreationPromise

chrome.commands.onCommand.addListener((command) => {
  if (command === COPY_CURRENT_URL_COMMAND) {
    void copyCurrentUrl()
  }
})

async function copyCurrentUrl() {
  const tab = await getActiveTab()

  if (!tab?.url || !checkCanCopyTabUrl(tab.url)) {
    return
  }

  const copyResult = await copyTextToClipboard(tab.url)
  if (!tab.id) {
    return
  }

  const canRenderToast = await ensureToastScript(tab.id)
  if (!canRenderToast) {
    return
  }

  await sendToastMessage(tab.id, {
    tone: copyResult.ok ? 'success' : 'error',
    text: copyResult.ok ? 'Copied Current URL' : 'Could not copy URL',
  })
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })

  return tab
}

async function ensureToastScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [TOAST_SCRIPT_PATH],
    })
    return true
  } catch {
    return false
  }
}

async function copyTextToClipboard(text) {
  try {
    await ensureOffscreenDocument()
    const response = await chrome.runtime.sendMessage({
      target: 'kool-kits-offscreen',
      type: 'copy-text',
      text,
    })

    return response?.ok ? { ok: true } : { ok: false }
  } catch {
    return { ok: false }
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  })

  if (existingContexts.length > 0) {
    return
  }

  offscreenDocumentCreationPromise ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['CLIPBOARD'],
      justification: 'Copy the active tab URL to the clipboard.',
    })
    .finally(() => {
      offscreenDocumentCreationPromise = undefined
    })

  await offscreenDocumentCreationPromise
}

async function sendToastMessage(tabId, toast) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      target: 'kool-kits-toast',
      type: 'show-toast',
      toast,
    })
  } catch {
    // The spec intentionally avoids fallback feedback channels.
  }
}
