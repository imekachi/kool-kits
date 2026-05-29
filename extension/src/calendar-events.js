import { resolveVideoLink } from './video-link.js'

const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export function checkIsAllDayEvent(event) {
  return Boolean(event?.start?.date) && !event?.start?.dateTime
}

export function checkIsDeclinedEvent(event) {
  const attendees = event?.attendees
  if (!Array.isArray(attendees)) {
    return false
  }

  const selfAttendee = attendees.find((attendee) => attendee?.self)
  return selfAttendee?.responseStatus === 'declined'
}

export function normalizeEvents(events, calendarId) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => !checkIsAllDayEvent(event))
    .filter((event) => !checkIsDeclinedEvent(event))
    .map((event) => normalizeEvent(event, calendarId))
}

function normalizeEvent(event, calendarId) {
  return {
    id: event.id,
    calendarId,
    title: event.summary || '(No title)',
    start: Date.parse(event.start.dateTime),
    end: Date.parse(event.end.dateTime),
    videoUrl: resolveVideoLink(event),
  }
}

export async function fetchTodaysEvents(token) {
  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const url = new URL(CALENDAR_EVENTS_ENDPOINT)
  url.searchParams.set('timeMin', now.toISOString())
  url.searchParams.set('timeMax', endOfDay.toISOString())
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '50')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (response.status === 401) {
    const error = new Error('calendar unauthorized')
    error.code = 'unauthorized'
    throw error
  }

  if (!response.ok) {
    throw new Error(`calendar fetch failed: ${response.status}`)
  }

  const body = await response.json()
  return normalizeEvents(body.items, 'primary')
}
