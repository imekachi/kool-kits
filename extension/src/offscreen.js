chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.target !== 'kool-kits-offscreen' ||
    message.type !== 'copy-text'
  ) {
    return false
  }

  void writeClipboardText(message.text)
    .then(() => {
      sendResponse({ ok: true })
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })

  return true
})

async function writeClipboardText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Clipboard text must be a non-empty string.')
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back to execCommand because offscreen clipboard focus can vary.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'

  document.body.append(textarea)

  let copied = false
  try {
    textarea.focus()
    textarea.select()
    copied = document.execCommand('copy')
  } finally {
    textarea.remove()
  }

  if (!copied) {
    throw new Error('Clipboard write failed.')
  }
}
