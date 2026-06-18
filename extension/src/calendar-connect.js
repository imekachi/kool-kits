export const GOOGLE_CALENDAR_URL_PREFIX = 'https://calendar.google.com/'
export const GOOGLE_CALENDAR_HOST_PATTERN = 'https://calendar.google.com/*'
export const GOOGLE_CALENDAR_HOST_ORIGINS = [GOOGLE_CALENDAR_HOST_PATTERN]

export async function checkHasCalendarHostPermission(
  permissions = chrome.permissions,
) {
  return permissions.contains({ origins: GOOGLE_CALENDAR_HOST_ORIGINS })
}

export async function requestCalendarHostPermission(
  permissions = chrome.permissions,
) {
  const granted = await permissions.request({
    origins: GOOGLE_CALENDAR_HOST_ORIGINS,
  })
  return { granted }
}

export function checkIsGoogleCalendarUrl(url) {
  return typeof url === 'string' && url.startsWith(GOOGLE_CALENDAR_URL_PREFIX)
}

// Prefer the focused Calendar tab; otherwise the most recently accessed one.
export function pickCalendarTabForConnect(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return null
  }

  const calendarTabs = tabs.filter((tab) => checkIsGoogleCalendarUrl(tab.url))
  if (calendarTabs.length === 0) {
    return null
  }

  const activeTab = calendarTabs.find((tab) => tab.active === true)
  if (activeTab) {
    return activeTab
  }

  return calendarTabs.reduce((best, tab) => {
    const bestAccessed = best.lastAccessed ?? 0
    const tabAccessed = tab.lastAccessed ?? 0
    return tabAccessed >= bestAccessed ? tab : best
  })
}
