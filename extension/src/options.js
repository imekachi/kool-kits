import { getMeetingSettings, setMeetingSettings } from './meeting-settings.js'

const MESSAGE_TARGET = 'kool-kits-meeting-reminder'
const MIN_LEAD_MINUTES = 1
const MAX_LEAD_MINUTES = 60

const enabledToggle = document.getElementById('enabled-toggle')
const leadSelect = document.getElementById('lead-select')
const filterSelect = document.getElementById('filter-select')
const connectionStatus = document.getElementById('connection-status')
const connectionButton = document.getElementById('connection-button')

populateLeadOptions()
void initializeOptions()

enabledToggle.addEventListener('change', async () => {
  await setMeetingSettings({ enabled: enabledToggle.checked })
})

leadSelect.addEventListener('change', async () => {
  await setMeetingSettings({ leadMinutes: Number(leadSelect.value) })
})

filterSelect.addEventListener('change', async () => {
  await setMeetingSettings({ meetingFilter: filterSelect.value })
})

connectionButton.addEventListener('click', async () => {
  connectionButton.disabled = true
  await sendMessage({ type: 'connect' })
  await refreshConnectionStatus()
  connectionButton.disabled = false
})

function populateLeadOptions() {
  for (let minutes = MIN_LEAD_MINUTES; minutes <= MAX_LEAD_MINUTES; minutes += 1) {
    const option = document.createElement('option')
    option.value = String(minutes)
    option.textContent = `${minutes} min`
    leadSelect.append(option)
  }
}

async function initializeOptions() {
  const settings = await getMeetingSettings()
  enabledToggle.checked = settings.enabled
  leadSelect.value = String(settings.leadMinutes)
  filterSelect.value = settings.meetingFilter
  // Seed from the synced cache first (a fast storage read) so a connected user
  // sees their account immediately, then confirm with the authoritative live
  // check. This avoids flashing "Not connected" during the bootstrap fetch.
  await seedConnectionFromCache()
  await refreshConnectionStatus()
}

async function seedConnectionFromCache() {
  const state = await sendMessage({ type: 'get-popup-state' })
  if (state?.connectedEmail) {
    renderConnected(state.connectedEmail)
  }
}

async function refreshConnectionStatus() {
  const status = await sendMessage({ type: 'get-connection-status' })
  if (status?.connected === true) {
    renderConnected(status.email)
  } else {
    renderNotConnected()
  }
}

function renderConnected(email) {
  connectionStatus.textContent = 'Connected as: ' + email
  connectionButton.style.display = 'none'
}

function renderNotConnected() {
  connectionStatus.textContent = 'Not connected'
  connectionButton.style.display = ''
  connectionButton.textContent = 'Open Google Calendar'
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
