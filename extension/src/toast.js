;(function installKoolKitsToast() {
  if (window.__koolKitsToastInstalled) {
    return
  }

  window.__koolKitsToastInstalled = true

  const TOAST_HOST_ID = 'kool-kits-toast-host'
  const AUTO_HIDE_MS = 6000
  const EXIT_ANIMATION_MS = 180
  const TOAST_HOST_SENTINEL = Symbol('koolKitsToastHost')

  let toastHost
  let toastRoot

  chrome.runtime.onMessage.addListener((message) => {
    if (
      message?.target !== 'kool-kits-toast' ||
      message.type !== 'show-toast'
    ) {
      return
    }

    showToast(message.toast)
  })

  function showToast(toast) {
    const root = getToastRoot()
    const existingToast = root.querySelector('[data-kool-kits-toast]')

    existingToast?.remove()

    const toastElement = document.createElement('div')
    toastElement.dataset.koolKitsToast = ''
    toastElement.className = `toast toast--${toast.tone === 'error' ? 'error' : 'success'}`
    toastElement.textContent = toast.text

    root.append(toastElement)

    window.setTimeout(() => {
      toastElement.classList.add('toast--leaving')
      window.setTimeout(() => {
        toastElement.remove()
      }, EXIT_ANIMATION_MS)
    }, AUTO_HIDE_MS)
  }

  function getToastRoot() {
    if (
      toastHost?.isConnected &&
      toastHost.shadowRoot &&
      toastHost[TOAST_HOST_SENTINEL]
    ) {
      return toastRoot
    }

    toastHost = document.createElement('div')
    toastHost.id = TOAST_HOST_ID
    toastHost[TOAST_HOST_SENTINEL] = true

    toastRoot = toastHost.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = `
    :host {
      all: initial;
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 2147483647;
      pointer-events: none;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
    }

    .toast {
      width: max-content;
      border-radius: 12px;
      border: 1px solid rgba(74, 222, 128, 0.55);
      padding: 12px 14px;
      color: #ffffff;
      background: rgba(6, 78, 59, 0.94);
      box-shadow: 0 14px 40px rgba(5, 46, 22, 0.32);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: 0.01em;
      white-space: nowrap;
      animation: kool-kits-toast-enter 180ms ease-out;
      backdrop-filter: blur(12px);
    }

    .toast--error {
      border-color: rgba(252, 165, 165, 0.6);
      background: rgba(160, 42, 42, 0.94);
      box-shadow: 0 14px 40px rgba(69, 10, 10, 0.3);
    }

    .toast--leaving {
      animation: kool-kits-toast-exit 180ms ease-in forwards;
    }

    @keyframes kool-kits-toast-enter {
      from {
        opacity: 0;
        transform: translate3d(0, -8px, 0) scale(0.98);
      }

      to {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }
    }

    @keyframes kool-kits-toast-exit {
      from {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }

      to {
        opacity: 0;
        transform: translate3d(0, -8px, 0) scale(0.98);
      }
    }
  `

    toastRoot.append(style)
    document.documentElement.append(toastHost)

    return toastRoot
  }
})()
