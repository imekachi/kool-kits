// Sanitized synthetic fixtures for the calendar session parser.
//
// These mirror the positional structure and the response (RSVP) codes of real
// `sync.fetcheventrange` event nodes, but every email and title is fake. Real
// captures contain colleague emails and internal meeting titles and are never
// committed. Indices set here are exactly the ones the parser reads; unset
// positions are left null, matching how a sparse parser sees a real node.

export const SELF_EMAIL = 'me@example.com'
const COLLEAGUE_EMAIL = 'colleague@example.com'

const NODE_LENGTH = 83
const ATTENDEE_LENGTH = 15

function emptyNode() {
  return new Array(NODE_LENGTH).fill(null)
}

function attendee({ email, response, isSelf }) {
  const tuple = new Array(ATTENDEE_LENGTH).fill(null)
  tuple[0] = email
  tuple[5] = response
  tuple[9] = isSelf ? true : null
  return tuple
}

function selfAttendee(response) {
  return attendee({ email: SELF_EMAIL, response, isSelf: true })
}

// A timed meeting with a direct Google Meet link; self accepted (3).
function buildAcceptedMeet() {
  const node = emptyNode()
  node[0] = 'evt-accepted-meet'
  node[5] = 'Meeting A'
  node[20] = [
    attendee({ email: COLLEAGUE_EMAIL, response: 3 }),
    selfAttendee(3),
  ]
  node[35] = [null, [1778818500000], 'Asia/Bangkok']
  node[36] = [null, [1778822100000], 'Asia/Bangkok']
  node[45] = 'https://meet.google.com/aaa-bbbb-ccc'
  node[57] = [[[3, 'https://meet.google.com/aaa-bbbb-ccc', 'aaa-bbbb-ccc']]]
  node[82] = 0
  return node
}

// A timed meeting whose Join link is a Zoom video entry point (no [45]); self
// accepted (3). The phone (type 4) entry must be ignored.
function buildAcceptedZoom() {
  const node = emptyNode()
  node[0] = 'evt-accepted-zoom'
  node[5] = 'Meeting B'
  node[20] = [
    attendee({ email: COLLEAGUE_EMAIL, response: 3 }),
    selfAttendee(3),
  ]
  node[35] = [null, [1775012400000], 'Asia/Bangkok']
  node[36] = [null, [1775016000000], 'Asia/Bangkok']
  node[45] = null
  node[57] = [
    [
      [4, 'tel:+1-555-000-0000'],
      [3, 'https://example.zoom.us/j/123456789?pwd=abcdef'],
    ],
  ]
  node[82] = 0
  return node
}

// A timed meeting the user declined (1); flat epoch-ms start shape.
function buildDeclined() {
  const node = emptyNode()
  node[0] = 'evt-declined'
  node[5] = 'Meeting C'
  node[20] = [selfAttendee(1)]
  node[35] = [1776038400000]
  node[36] = [1777075200000]
  node[82] = 0
  return node
}

// A timed Meet meeting marked tentative (2).
function buildTentative() {
  const node = emptyNode()
  node[0] = 'evt-tentative'
  node[5] = 'Meeting D'
  node[20] = [selfAttendee(2)]
  node[35] = [null, [1780282800000], 'Asia/Bangkok']
  node[36] = [null, [1780286400000], 'Asia/Bangkok']
  node[45] = 'https://meet.google.com/cvk-asxw-qan'
  node[57] = [[[3, 'https://meet.google.com/cvk-asxw-qan', 'cvk-asxw-qan']]]
  node[82] = 0
  return node
}

// A timed meeting with no RSVP yet (0) and no Join link.
function buildNeedsAction() {
  const node = emptyNode()
  node[0] = 'evt-needs-action'
  node[5] = 'Meeting E'
  node[20] = [selfAttendee(0)]
  node[35] = [null, [1776103200000], 'America/Los_Angeles']
  node[36] = [null, [1776106800000], 'America/Los_Angeles']
  node[82] = 0
  return node
}

// A working-location block (eventType 10) with a short tuple and no attendees.
// Not a meeting; must be excluded.
function buildShortOwn() {
  const node = emptyNode()
  node[0] = 'evt-short-own'
  node[5] = 'Office'
  node[35] = [1698883200000]
  node[36] = [1698969600000]
  node[82] = 10
  return node
}

// A working-location alt-encoding whose title is an object. Not a meeting.
function buildWorkingLocationObjTitle() {
  const node = new Array(6).fill(null)
  node[0] = 'evt-wl-obj'
  node[5] = { 40: 1, 64: [[[4, 'Home']]] }
  return node
}

// A plain timed meeting with no Join link anywhere; no RSVP (0).
function buildNoLink() {
  const node = emptyNode()
  node[0] = 'evt-no-link'
  node[5] = 'Meeting Z'
  node[20] = [selfAttendee(0)]
  node[35] = [null, [1776103200000], 'America/Los_Angeles']
  node[36] = [null, [1776106800000], 'America/Los_Angeles']
  node[82] = 0
  return node
}

// A timed meeting whose only Join link is a Zoom URL pasted into the event
// description (no [45], no structured [57] video entry point). The description
// at index 64 is a nested HTML-ish structure.
function buildDescriptionZoom() {
  const node = emptyNode()
  node[0] = 'evt-description-zoom'
  node[5] = 'Meeting F'
  node[20] = [selfAttendee(3)]
  node[35] = [null, [1776189600000], 'America/Los_Angeles']
  node[36] = [null, [1776193200000], 'America/Los_Angeles']
  node[64] = [
    null,
    'Agenda below. Join: https://example.zoom.us/j/98765?pwd=zzz now',
  ]
  node[82] = 0
  return node
}

export const DESCRIPTION_ZOOM_NODE = buildDescriptionZoom()

// Recurring meeting returned as `_R…` shorthand on a single-day fetch. Start/end
// carry the series anchor (May 18 10:00–11:00 Bangkok), not today's instance.
function buildRecurrenceShorthand() {
  const node = emptyNode()
  node[0] = 'evt-series_R20260518T030000'
  node[5] = 'Weekly Standup'
  node[20] = [selfAttendee(0)]
  node[35] = [null, [1779073200000], 'Asia/Bangkok']
  node[36] = [null, [1779076800000], 'Asia/Bangkok']
  node[45] = 'https://meet.google.com/series-standup'
  node[82] = 0
  return node
}

// Expanded instance for the same series on a specific day.
function buildRecurrenceInstance() {
  const node = emptyNode()
  node[0] = 'evt-series_20260608T030000Z'
  node[5] = 'Weekly Standup'
  node[20] = [selfAttendee(0)]
  node[35] = [null, [1780889400000], 'Asia/Bangkok']
  node[36] = [null, [1780891200000], 'Asia/Bangkok']
  node[45] = 'https://meet.google.com/series-standup'
  node[82] = 0
  return node
}

// Bare series master with stale anchor times.
function buildRecurrenceMaster() {
  const node = emptyNode()
  node[0] = 'evt-series'
  node[5] = 'Weekly Standup'
  node[20] = [selfAttendee(0)]
  node[35] = [null, [1760673600000], 'Asia/Bangkok']
  node[36] = [null, [1760675400000], 'Asia/Bangkok']
  node[45] = 'https://meet.google.com/series-standup'
  node[82] = 0
  return node
}

export const RECURRENCE_SHORTHAND_NODE = buildRecurrenceShorthand()
export const RECURRENCE_INSTANCE_NODE = buildRecurrenceInstance()
export const RECURRENCE_MASTER_NODE = buildRecurrenceMaster()

export const EVENT_NODES = {
  acceptedMeet: buildAcceptedMeet(),
  acceptedZoom: buildAcceptedZoom(),
  declined: buildDeclined(),
  tentative: buildTentative(),
  needsAction: buildNeedsAction(),
  shortOwn: buildShortOwn(),
  workingLocationObjTitle: buildWorkingLocationObjTitle(),
  noLink: buildNoLink(),
}

export const ALL_EVENT_NODES = Object.values(EVENT_NODES)

// Wrap event nodes in the XSSI-prefixed envelope, with the events array at the
// path parseEventRangeResponse walks: data[0][2][1][0][1].
export function wrapEventRangeResponse(nodes) {
  const eventsHolder = [null, nodes]
  const collection = [eventsHolder]
  const calendarBlock = [null, collection]
  const root = [null, null, calendarBlock]
  return `)]}'\n\n${JSON.stringify([root])}`
}

export const CONNECTED_BOOTSTRAP_HTML = `<!doctype html><html><head>
<script>var x = "calendar.web_20260513.08_p0";</script></head>
<body><div id="xUserEmail">${SELF_EMAIL}</div></body></html>`

export const NOT_CONNECTED_BOOTSTRAP_HTML = `<!doctype html><html><head></head>
<body><a href="https://accounts.google.com/signin">Sign in</a></body></html>`
