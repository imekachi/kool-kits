const MESSAGE_TARGET = 'kool-kits-meeting-reminder'

const meetingSection = document.getElementById('meeting-section')
const settingsButton = document.getElementById('settings-button')

settingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

void initializePopup()

async function initializePopup() {
  const state = await sendMessage({ type: 'get-popup-state' })
  render(state)
  void sendMessage({ type: 'refresh' }).then((freshState) => {
    if (freshState) {
      render(freshState)
    }
  })
}

function render(state) {
  meetingSection.replaceChildren()

  if (!state) {
    meetingSection.append(buildStatus('Unable to load meetings.'))
    return
  }

  if (!state.enabled) {
    meetingSection.style.display = 'none'
    return
  }

  meetingSection.style.display = ''

  if (state.syncState === 'not_connected') {
    meetingSection.append(
      buildStatus(
        'Connect Google Calendar to see your meetings and get reminders.',
        { actionLabel: 'Connect Google Calendar', action: 'connect' },
      ),
    )
    return
  }

  if (state.syncState === 'auth_error') {
    meetingSection.append(
      buildStatus('Calendar access expired.', {
        actionLabel: 'Reconnect',
        action: 'connect',
      }),
    )
    return
  }

  const hasMeetings = state.inProgress.length > 0 || state.upcoming.length > 0

  // A transient fetch error keeps cached meetings; only show the error banner when
  // there is nothing cached to display.
  if (state.syncState === 'error' && !hasMeetings) {
    meetingSection.append(buildStatus('Could not reach Google Calendar.'))
    return
  }

  if (!hasMeetings) {
    meetingSection.append(buildEmpty())
    return
  }

  if (state.inProgress.length > 0) {
    meetingSection.append(buildHeading('In progress'))
    for (const meeting of state.inProgress) {
      meetingSection.append(buildMeetingCard(meeting, true))
    }
  }

  if (state.upcoming.length > 0) {
    meetingSection.append(buildHeading('Upcoming'))
    for (const meeting of state.upcoming) {
      meetingSection.append(buildMeetingCard(meeting, false))
    }
  }
}

function buildHeading(text) {
  const heading = document.createElement('div')
  heading.className = 'group-heading'
  heading.textContent = text
  return heading
}

function buildMeetingCard(meeting, inProgress) {
  const card = document.createElement('div')
  card.className = 'meeting-card'
  card.dataset.inProgress = String(inProgress)

  const title = document.createElement('div')
  title.className = 'meeting-title'
  title.textContent = meeting.title
  card.append(title)

  const time = document.createElement('div')
  time.className = 'meeting-time'
  time.textContent = formatTimeRange(meeting.start, meeting.end)
  card.append(time)

  if (meeting.videoUrl) {
    const join = document.createElement('button')
    join.className = 'meeting-join'
    join.type = 'button'
    join.textContent = 'Join'
    join.addEventListener('click', () => {
      chrome.tabs.create({ url: meeting.videoUrl })
    })
    card.append(join)
  }

  return card
}

function buildEmpty() {
  const empty = document.createElement('div')
  empty.className = 'empty-state'
  empty.textContent = 'No meeting'
  return empty
}

function buildStatus(message, options) {
  const wrapper = document.createElement('div')
  wrapper.className = 'status-state'

  const text = document.createElement('div')
  text.textContent = message
  wrapper.append(text)

  if (options?.action === 'connect') {
    const button = document.createElement('button')
    button.className = 'connect-button'
    button.type = 'button'
    button.textContent = options.actionLabel
    button.addEventListener('click', async () => {
      button.disabled = true
      await sendMessage({ type: 'connect' })
      const state = await sendMessage({ type: 'get-popup-state' })
      render(state)
    })
    wrapper.append(button)
  }

  return wrapper
}

function formatTimeRange(start, end) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${formatter.format(start)} – ${formatter.format(end)}`
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
