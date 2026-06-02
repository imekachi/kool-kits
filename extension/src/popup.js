import {
  checkHasCachedPopupMeetings,
  checkShowsAccountIdentity,
  checkShowsConnectedAccount,
  checkShowsFetchErrorScreen,
  checkShowsPopupConnectScreen,
} from './meeting-connection.js'
import { getMeetingSettings } from './meeting-settings.js'

const MESSAGE_TARGET = 'kool-kits-meeting-reminder'
const MINUTE_MS = 60_000
const RERENDER_INTERVAL_MS = 30_000

const head = document.getElementById('pp-head')
const meetingSection = document.getElementById('meeting-section')
const settingsButton = document.getElementById('settings-button')

// Keep the latest known state and lead time so the 30s tick can recompute
// countdowns from cache without another round trip to the service worker.
let latestState
let leadMinutes = 5
let rerenderTimer
let connectInFlight = false

settingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

async function initializePopup() {
  settingsButton.replaceChildren(
    icon(ICONS.gear),
    document.createTextNode('Settings'),
  )

  const settings = await getMeetingSettings().catch(() => undefined)
  if (settings) {
    leadMinutes = settings.leadMinutes
  }

  const state = await sendMessage({ type: 'get-popup-state' })
  render(state)

  void sendMessage({ type: 'refresh' }).then((freshState) => {
    if (freshState) {
      render(freshState)
    }
  })
}

function render(state) {
  latestState = state
  renderHeader(state)
  renderBody(state)
  scheduleRerender(state)
}

// The list and countdowns only need to advance while there are meetings to show;
// avoid an idle timer in the empty/disconnected states.
function scheduleRerender(state) {
  clearInterval(rerenderTimer)
  const live =
    state?.enabled &&
    ((state.inProgress?.length ?? 0) > 0 || (state.upcoming?.length ?? 0) > 0)
  if (live) {
    rerenderTimer = setInterval(() => {
      renderBody(latestState)
    }, RERENDER_INTERVAL_MS)
  }
}

function renderHeader(state) {
  if (!state || !state.enabled) {
    head.hidden = true
    head.replaceChildren()
    return
  }

  const showsAccountIdentity = checkShowsAccountIdentity(
    state.connectionStatus,
    state.connectedEmail,
  )
  const liveConnected = checkShowsConnectedAccount(
    state.connectionStatus,
    state.connectedEmail,
  )

  const brand = document.createElement('div')
  brand.className = 'pp-brand'
  brand.append(logoImage(19), spanWith('pp-brand-name', 'Kool Kits'))

  const acct = document.createElement('div')
  acct.className = 'pp-acct'
  acct.dataset.connected = String(liveConnected)
  const dot = document.createElement('span')
  dot.className = 'dot'
  const email = spanWith(
    'pp-acct-email',
    showsAccountIdentity ? state.connectedEmail : 'Not connected',
  )
  if (showsAccountIdentity) {
    acct.title = state.connectedEmail
  }
  acct.append(dot, email)

  head.replaceChildren(brand, acct)
  head.hidden = false
}

function renderBody(state) {
  meetingSection.replaceChildren()

  if (!state) {
    meetingSection.append(
      buildState(
        ICONS.alert,
        'Unable to load meetings',
        'Try reopening the popup.',
      ),
    )
    return
  }

  if (!state.enabled) {
    meetingSection.style.display = 'none'
    return
  }
  meetingSection.style.display = ''

  const inProgress = state.inProgress ?? []
  const upcoming = state.upcoming ?? []
  const hasMeetings = checkHasCachedPopupMeetings(inProgress, upcoming)

  if (checkShowsPopupConnectScreen(state.connectionStatus, hasMeetings)) {
    meetingSection.append(buildNotConnected())
    return
  }

  // A transient fetch error keeps cached meetings; only surface the error banner
  // when there is nothing cached to fall back on.
  if (checkShowsFetchErrorScreen(state.connectionStatus) && !hasMeetings) {
    meetingSection.append(
      buildState(
        ICONS.alert,
        "Couldn't reach Google Calendar",
        'Showing nothing until the next sync succeeds.',
      ),
    )
    return
  }

  if (!hasMeetings) {
    meetingSection.append(
      buildState(ICONS.calendar, 'No more meetings today', "You're all clear."),
    )
    return
  }

  const now = Date.now()

  if (inProgress.length > 0) {
    const group = buildGroup('Now', true)
    for (const meeting of inProgress) {
      group.append(buildNowCard(meeting, now))
    }
    meetingSection.append(group)
  }

  if (upcoming.length > 0) {
    const group = buildGroup('Up next', false)
    const leadMs = leadMinutes * MINUTE_MS
    for (const meeting of upcoming) {
      group.append(buildUpRow(meeting, now, leadMs))
    }
    meetingSection.append(group)
  }
}

function buildGroup(label, urgent) {
  const group = document.createElement('div')
  group.className = 'mr-group'
  const heading = document.createElement('div')
  heading.className = 'group-heading'
  if (urgent) {
    const dot = document.createElement('span')
    dot.className = 'dot'
    heading.append(dot)
  }
  heading.append(document.createTextNode(label))
  group.append(heading)
  return group
}

function buildNowCard(meeting, now) {
  const card = document.createElement('div')
  card.className = 'now-card'

  const headRow = document.createElement('div')
  headRow.className = 'now-head'
  headRow.append(meetingTitle(meeting.title))
  const pill = document.createElement('span')
  pill.className = 'pill pill-urgent'
  pill.textContent = formatEndsIn(meeting.end, now)
  headRow.append(pill)
  card.append(headRow)

  const progress = document.createElement('div')
  progress.className = 'now-progress'
  const fill = document.createElement('span')
  fill.style.width = `${elapsedPercent(meeting, now)}%`
  progress.append(fill)
  card.append(progress)

  const footRow = document.createElement('div')
  footRow.className = 'now-foot'
  const time = document.createElement('span')
  time.className = 'mtime'
  time.textContent = formatTimeRange(meeting.start, meeting.end)
  footRow.append(time)
  if (meeting.joinUrl) {
    footRow.append(joinButton(meeting.joinUrl, 'Join meeting', 'join'))
  }
  card.append(footRow)

  return card
}

function buildUpRow(meeting, now, leadMs) {
  const row = document.createElement('div')
  row.className = 'up-row'

  const when = document.createElement('div')
  when.className = 'up-when'
  when.dataset.soon = String(meeting.start - now <= leadMs)
  const countdown = spanWith('countdown', formatCountdown(meeting.start, now))
  const at = spanWith('at', formatTime(meeting.start))
  when.append(countdown, at)
  row.append(when)

  const body = document.createElement('div')
  body.className = 'up-body'
  body.append(meetingTitle(meeting.title))
  const until = document.createElement('div')
  until.className = 'mtime'
  until.textContent = `until ${formatTime(meeting.end)}`
  body.append(until)
  row.append(body)

  if (meeting.joinUrl) {
    row.append(joinButton(meeting.joinUrl, 'Join', 'join-sm'))
  }

  return row
}

function buildNotConnected() {
  const state = buildState(
    ICONS.plug,
    'Connect your calendar',
    "Kool Kits reads meetings from the Google account you're signed into in this browser.",
  )
  const button = document.createElement('button')
  button.className = 'connect-button'
  button.type = 'button'
  button.textContent = connectInFlight ? 'Connecting…' : 'Open Google Calendar'
  button.disabled = connectInFlight
  button.addEventListener('click', () => {
    if (connectInFlight || button.disabled) {
      return
    }

    connectInFlight = true
    button.disabled = true
    button.textContent = 'Connecting…'

    void sendMessage({ type: 'connect' })
      .then(() => sendMessage({ type: 'refresh' }))
      .then((freshState) => {
        if (freshState) {
          render(freshState)
        }
      })
      .finally(() => {
        connectInFlight = false
      })
  })
  state.append(button)
  return state
}

function buildState(iconMarkup, title, text) {
  const wrapper = document.createElement('div')
  wrapper.className = 'mr-state'

  const iconBox = document.createElement('div')
  iconBox.className = 'mr-state-icon'
  iconBox.append(icon(iconMarkup))
  wrapper.append(iconBox)

  wrapper.append(spanWith('mr-state-title', title, 'div'))
  if (text) {
    wrapper.append(spanWith('mr-state-text', text, 'div'))
  }
  return wrapper
}

function joinButton(url, label, className) {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', () => {
    chrome.tabs.create({ url })
  })
  return button
}

function logoImage(size) {
  const img = document.createElement('img')
  img.src = chrome.runtime.getURL('icons/icon48.png')
  img.width = size
  img.height = size
  img.alt = ''
  return img
}

function meetingTitle(title) {
  const node = document.createElement('div')
  node.className = 'mtitle'
  node.textContent = title
  node.title = title
  return node
}

function spanWith(className, text, tag = 'span') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/* ---------- time + countdown formatting ---------- */

function formatTime(ts) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(ts)
}

function formatTimeRange(start, end) {
  return `${formatTime(start)} – ${formatTime(end)}`
}

function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatCountdown(start, now) {
  const minutes = Math.max(0, Math.ceil((start - now) / MINUTE_MS))
  return minutes < 1 ? 'now' : formatDuration(minutes)
}

function formatEndsIn(end, now) {
  const minutes = Math.max(0, Math.ceil((end - now) / MINUTE_MS))
  return minutes < 1 ? 'ending' : `ends in ${formatDuration(minutes)}`
}

function elapsedPercent(meeting, now) {
  const span = meeting.end - meeting.start
  if (span <= 0) {
    return 0
  }
  const ratio = (now - meeting.start) / span
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

/* ---------- icons (inline SVG, no extra requests) ---------- */

function icon(markup, size) {
  const span = document.createElement('span')
  span.innerHTML = markup
  const svg = span.firstElementChild
  if (svg && size) {
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
  }
  return svg ?? span
}

const ICONS = {
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffd23f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffd23f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5M9 8V2M15 8V2M5 8h14v3a7 7 0 0 1-14 0z"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="#ff9b9e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET,
      ...message,
    })
  } catch {
    return undefined
  }
}

// Start only after every const above (notably ICONS) is initialized.
void initializePopup()
