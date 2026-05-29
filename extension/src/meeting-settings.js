const MEETING_SETTINGS_STORAGE_KEY = 'meetingSettings'
const MIN_LEAD_MINUTES = 1
const MAX_LEAD_MINUTES = 60

export const MEETING_SETTINGS_DEFAULTS = {
  enabled: true,
  leadMinutes: 5,
}

export function mergeMeetingSettings(stored) {
  return {
    enabled:
      typeof stored?.enabled === 'boolean'
        ? stored.enabled
        : MEETING_SETTINGS_DEFAULTS.enabled,
    leadMinutes: checkIsValidLeadMinutes(stored?.leadMinutes)
      ? stored.leadMinutes
      : MEETING_SETTINGS_DEFAULTS.leadMinutes,
  }
}

function checkIsValidLeadMinutes(value) {
  return (
    Number.isInteger(value) &&
    value >= MIN_LEAD_MINUTES &&
    value <= MAX_LEAD_MINUTES
  )
}

export async function getMeetingSettings() {
  const stored = await chrome.storage.local.get(MEETING_SETTINGS_STORAGE_KEY)
  return mergeMeetingSettings(stored[MEETING_SETTINGS_STORAGE_KEY])
}

export async function setMeetingSettings(partial) {
  const current = await getMeetingSettings()
  const next = mergeMeetingSettings({ ...current, ...partial })
  await chrome.storage.local.set({ [MEETING_SETTINGS_STORAGE_KEY]: next })
  return next
}
