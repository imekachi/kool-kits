import {
  checkShowsAccountIdentity,
  checkShowsConnectedAccount,
} from './meeting-connection.js'
import { getMeetingSettings, setMeetingSettings } from './meeting-settings.js'

const MESSAGE_TARGET = 'kool-kits-meeting-reminder'
const MIN_LEAD_MINUTES = 1
const MAX_LEAD_MINUTES = 60

const meetingCard = document.getElementById('meeting-card')
const enabledToggle = document.getElementById('enabled-toggle')
const leadSelect = document.getElementById('lead-select')
const filterSelect = document.getElementById('filter-select')
const connectionRow = document.getElementById('connection-row')
const connectionStatus = document.getElementById('connection-status')
const connectionEmail = document.getElementById('connection-email')
const connectionButton = document.getElementById('connection-button')
const disconnectButton = document.getElementById('disconnect-button')

populateLeadOptions()
void initializeOptions()

enabledToggle.addEventListener('change', async () => {
  reflectEnabled(enabledToggle.checked)
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

disconnectButton.addEventListener('click', async () => {
  const confirmed = confirm(
    'Disconnect Kool Kits from this calendar?\n\nYour Google sign-in stays active. You can connect again later.',
  )
  if (!confirmed) {
    return
  }

  disconnectButton.disabled = true
  const previousLabel = disconnectButton.textContent
  disconnectButton.textContent = 'Disconnecting…'

  const state = await sendMessage({ type: 'disconnect-calendar' })
  renderConnectionFromState(state)

  disconnectButton.textContent = previousLabel
  disconnectButton.disabled = false
})

function populateLeadOptions() {
  for (
    let minutes = MIN_LEAD_MINUTES;
    minutes <= MAX_LEAD_MINUTES;
    minutes += 1
  ) {
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
  reflectEnabled(settings.enabled)

  renderChecking()

  // Seed from the synced cache first (a fast storage read) so a connected user
  // sees their account immediately, then confirm with the authoritative live
  // check. This avoids flashing "Not connected" during the bootstrap fetch.
  await seedConnectionFromCache()
  await refreshConnectionStatus()
}

// Disabling the feature stops calendar access, so its calendar controls no longer
// apply: dim and disable them while keeping the connection status (which is
// independent of the enabled flag) live.
function reflectEnabled(enabled) {
  meetingCard.dataset.enabled = String(enabled)
  leadSelect.disabled = !enabled
  filterSelect.disabled = !enabled
}

async function seedConnectionFromCache() {
  const state = await sendMessage({ type: 'get-popup-state' })
  renderConnectionFromState(state)
}

async function refreshConnectionStatus() {
  const status = await sendMessage({ type: 'get-connection-status' })
  renderConnectionFromState({
    connectionStatus: status?.connectionStatus,
    connectedEmail: status?.email,
    connected: status?.connected,
  })
}

function renderConnectionFromState(state) {
  if (
    checkShowsAccountIdentity(state?.connectionStatus, state?.connectedEmail)
  ) {
    renderKnownAccount(
      state.connectedEmail,
      checkShowsConnectedAccount(
        state?.connectionStatus,
        state?.connectedEmail,
      ) || state?.connected === true,
    )
    return
  }
  renderNotConnected()
}

function renderChecking() {
  connectionRow.dataset.connected = 'checking'
  connectionStatus.textContent = 'Checking connection…'
  connectionEmail.textContent = ''
  connectionEmail.hidden = true
  disconnectButton.hidden = true
  connectionButton.hidden = true
}

function renderKnownAccount(email, liveConnected) {
  connectionRow.dataset.connected = liveConnected ? 'true' : 'false'
  connectionStatus.textContent = liveConnected
    ? 'Connected as'
    : 'Calendar account'
  connectionEmail.textContent = email
  connectionEmail.title = email
  connectionEmail.hidden = false
  disconnectButton.hidden = false
  connectionButton.hidden = true
}

function renderNotConnected() {
  connectionRow.dataset.connected = 'false'
  connectionStatus.textContent = 'Not connected'
  connectionEmail.textContent = ''
  connectionEmail.hidden = true
  disconnectButton.hidden = true
  connectionButton.hidden = false
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
