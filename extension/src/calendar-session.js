import { resolveJoinLink } from './join-link.js'

// The extension reads the calendar by reusing the browser's existing Google
// session, hitting the same internal endpoints the Calendar web app uses. Both
// requests are pinned to account index u/0 so the identified email and the
// fetched events can never describe different accounts.
const BOOTSTRAP_URL = 'https://calendar.google.com/calendar/u/0/r/day'
const EVENTS_URL =
  'https://calendar.google.com/calendar/u/0/sync.fetcheventrange'
export const CALENDAR_OPEN_URL = 'https://calendar.google.com/calendar/u/0/r'

// The bootstrap page embeds the session account email and the web-client version
// the events endpoint expects. A missing email means no identifiable session.
const ACCOUNT_EMAIL_PATTERN = /id="xUserEmail">([^<]+)</
const CLIENT_VERSION_PATTERN = /calendar\.web_\d{8}\.\d{2}_p\d/
const SIGN_IN_HOST_PATTERN = /accounts\.google\.com/

// The events response is XSSI-guarded; strip the prefix before JSON.parse.
const XSSI_PREFIX_PATTERN = /^\)\]\}'\s*/

const DAY_MS = 86_400_000
// Event start/end are encoded inconsistently (nested [null,[ms],tz] for real
// meetings, flat [ms] for some entries), so we deep-scan for the epoch-ms value
// rather than hardcode a path. Real epoch-ms is far above this threshold.
const EPOCH_MS_THRESHOLD = 1e12

// Per-event positional indices in the fetcheventrange response. These are an
// implementation detail of a private endpoint and intentionally live only here.
const INDEX_ID = 0
const INDEX_TITLE = 5
const INDEX_ATTENDEES = 20
const INDEX_START = 35
const INDEX_END = 36
const INDEX_MEET_LINK = 45
const INDEX_CONFERENCE = 57
const INDEX_DESCRIPTION = 64
const INDEX_EVENT_TYPE = 82
// Within a self-attendee tuple.
const ATTENDEE_EMAIL = 0
const ATTENDEE_RESPONSE = 5
const ATTENDEE_IS_SELF = 9

const EVENT_TYPE_MEETING = 0
const RESPONSE_DECLINED = 1

// Opaque constants the events endpoint requires verbatim; keep as-is.
const REQUEST_SESSION_CONSTANT = 915076021

export function parseAccountEmail(html) {
  const match =
    typeof html === 'string' ? html.match(ACCOUNT_EMAIL_PATTERN) : null
  return match ? match[1] : null
}

export function parseClientVersion(html) {
  const match =
    typeof html === 'string' ? html.match(CLIENT_VERSION_PATTERN) : null
  return match ? match[0] : null
}

export function checkIsConnected(html) {
  return parseAccountEmail(html) !== null
}

export function parseEventRangeResponse(text) {
  if (typeof text !== 'string') {
    return []
  }

  let data
  try {
    data = JSON.parse(text.replace(XSSI_PREFIX_PATTERN, ''))
  } catch {
    return []
  }

  const nodes = data?.[0]?.[2]?.[1]?.[0]?.[1]
  return Array.isArray(nodes) ? nodes : []
}

function deepFindEpochMs(value) {
  if (typeof value === 'number') {
    return value > EPOCH_MS_THRESHOLD ? value : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindEpochMs(item)
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

// A node is a real timed meeting only when it has a string title, an epoch-ms
// start, and the default event type. This excludes all-day (no epoch-ms start),
// working-location (eventType 10 or an object title), and focus-time/OOO blocks
// (non-zero event types).
export function checkIsTimedMeeting(node) {
  if (!Array.isArray(node)) {
    return false
  }
  if (typeof node[INDEX_TITLE] !== 'string') {
    return false
  }
  if (node[INDEX_EVENT_TYPE] !== EVENT_TYPE_MEETING) {
    return false
  }
  return deepFindEpochMs(node[INDEX_START]) !== null
}

// The user's own response lives on the self-attendee tuple. The self tuple is
// marked by ATTENDEE_IS_SELF, and also carries the session email at index 0.
// Own / organizer / working-location events have no self attendee; a null
// response means "no RSVP to honor" and is treated as accepted downstream.
export function getSelfResponse(node, email) {
  const attendees = node?.[INDEX_ATTENDEES]
  if (!Array.isArray(attendees)) {
    return null
  }

  const self =
    attendees.find(
      (attendee) =>
        Array.isArray(attendee) && attendee[ATTENDEE_EMAIL] === email,
    ) ??
    attendees.find(
      (attendee) =>
        Array.isArray(attendee) && attendee[ATTENDEE_IS_SELF] === true,
    )

  if (!self) {
    return null
  }

  const response = self[ATTENDEE_RESPONSE]
  return typeof response === 'number' ? response : null
}

// Default ('acceptedTentative') hides only explicit declines; not-yet-responded
// and tentative are kept. 'all' keeps every response. A null response (own /
// organizer event) is never a decline, so it is always kept.
export function checkPassesFilter(selfResponse, meetingFilter) {
  if (meetingFilter === 'all') {
    return true
  }
  return selfResponse !== RESPONSE_DECLINED
}

// Collect every string nested under a value, so the text-scan fallback can find
// a link no matter where in the (variably-shaped) description/conference block
// it was pasted.
function collectStrings(value, accumulator) {
  if (typeof value === 'string') {
    accumulator.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, accumulator)
    }
  }
}

function resolveNodeJoinLink(node) {
  const meetLink =
    typeof node[INDEX_MEET_LINK] === 'string' ? node[INDEX_MEET_LINK] : null
  const conference = node[INDEX_CONFERENCE]
  const entryPoints = Array.isArray(conference) ? conference[0] : null

  // Fallback scan source: the title, the conference block, and the event
  // description, where users often paste a bare Zoom/Teams/Meet link.
  const textParts = []
  if (typeof node[INDEX_TITLE] === 'string') {
    textParts.push(node[INDEX_TITLE])
  }
  collectStrings(conference, textParts)
  collectStrings(node[INDEX_DESCRIPTION], textParts)

  return resolveJoinLink({ meetLink, entryPoints, text: textParts.join('\n') })
}

function normalizeNode(node, email) {
  return {
    id: node[INDEX_ID] ?? null,
    title: node[INDEX_TITLE] || '(No title)',
    start: deepFindEpochMs(node[INDEX_START]),
    end: deepFindEpochMs(node[INDEX_END]),
    joinUrl: resolveNodeJoinLink(node),
    selfResponse: getSelfResponse(node, email),
  }
}

// Parse-defensively: drop any node missing a usable start/end rather than
// throwing, so one malformed node can never break the whole sync.
export function normalizeEvents(nodes, email) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter((node) => checkIsTimedMeeting(node))
    .map((node) => normalizeNode(node, email))
    .filter(
      (meeting) =>
        typeof meeting.start === 'number' && typeof meeting.end === 'number',
    )
}

// Normalize, apply the response filter, and drop the internal selfResponse from
// the cached meeting shape (the popup and badge only need title/time/link).
export function selectMeetings(nodes, email, meetingFilter) {
  return normalizeEvents(nodes, email)
    .filter((meeting) => checkPassesFilter(meeting.selfResponse, meetingFilter))
    .map(({ selfResponse, ...meeting }) => meeting)
}

// Identify the current u/0 session account and the client version the events
// endpoint expects, from one authenticated page load. Throws on a network
// failure (a transient error, distinct from a not-connected session).
export async function fetchBootstrap() {
  const response = await fetch(BOOTSTRAP_URL, { credentials: 'include' })

  if (response.redirected && SIGN_IN_HOST_PATTERN.test(response.url)) {
    return { connected: false, email: null, version: null }
  }

  const html = await response.text()
  const email = parseAccountEmail(html)
  if (!email) {
    return { connected: false, email: null, version: null }
  }

  return { connected: true, email, version: parseClientVersion(html) }
}

function buildEventRangeBody({ email, version, startDay, endDay }) {
  const request = JSON.stringify([
    [
      [email],
      [null, null, startDay, endDay],
      [
        null,
        3,
        version,
        null,
        null,
        null,
        null,
        REQUEST_SESSION_CONSTANT,
        null,
        'WEB',
        'prod-04-us.web',
        1,
        null,
        null,
        null,
        0,
        null,
        '2026a',
        1,
        1,
        null,
        1,
        1,
        null,
        0,
        0,
      ],
      [null, 1, 1, 1, 1, null, 0],
    ],
  ])
  return `f.req=${encodeURIComponent(request)}&cwuik=10&hl=en`
}

function getLocalDayIndex(now = Date.now()) {
  const date = new Date(now)
  const localMidnight = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime()
  return Math.floor(localMidnight / DAY_MS)
}

export async function fetchTodaysEvents({ email, version, meetingFilter }) {
  const today = getLocalDayIndex()
  const response = await fetch(EVENTS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-is-xhr-request': '1',
    },
    body: buildEventRangeBody({
      email,
      version,
      startDay: today,
      endDay: today + 1,
    }),
  })

  if (!response.ok) {
    throw new Error(`calendar events fetch failed: ${response.status}`)
  }

  const nodes = parseEventRangeResponse(await response.text())
  return selectMeetings(nodes, email, meetingFilter)
}
