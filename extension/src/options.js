import { getMeetingSettings, setMeetingSettings } from './meeting-settings.js'

const MESSAGE_TARGET = 'kool-kits-meeting-reminder'
const MIN_LEAD_MINUTES = 1
const MAX_LEAD_MINUTES = 60

const enabledToggle = document.getElementById('enabled-toggle')
const leadSelect = document.getElementById('lead-select')
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

connectionButton.addEventListener('click', async () => {
  connectionButton.disabled = true
  const connected = connectionButton.dataset.connected === 'true'
  await sendMessage({ type: connected ? 'disconnect' : 'connect' })
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
  await refreshConnectionStatus()
}

async function refreshConnectionStatus() {
  const status = await sendMessage({ type: 'get-connection-status' })
  const connected = status?.connected === true
  connectionButton.dataset.connected = String(connected)
  connectionButton.textContent = connected ? 'Disconnect' : 'Connect'
  connectionStatus.textContent = connected
    ? 'Connected to Google Calendar'
    : 'Not connected'
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
