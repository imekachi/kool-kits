import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkIsConnected,
  checkIsTimedMeeting,
  checkPassesFilter,
  getSelfResponse,
  normalizeEvents,
  parseAccountEmail,
  parseClientVersion,
  parseEventRangeResponse,
  selectMeetings,
} from '../src/calendar-session.js'
import {
  ALL_EVENT_NODES,
  CONNECTED_BOOTSTRAP_HTML,
  DESCRIPTION_ZOOM_NODE,
  EVENT_NODES,
  NOT_CONNECTED_BOOTSTRAP_HTML,
  SELF_EMAIL,
  wrapEventRangeResponse,
} from './fixtures/calendar-session.js'

describe('bootstrap parsing', () => {
  it('extracts the session account email', () => {
    assert.equal(parseAccountEmail(CONNECTED_BOOTSTRAP_HTML), SELF_EMAIL)
  })

  it('extracts the web-client version', () => {
    assert.equal(
      parseClientVersion(CONNECTED_BOOTSTRAP_HTML),
      'calendar.web_20260513.08_p0',
    )
  })

  it('reports connected only when an account email is present', () => {
    assert.equal(checkIsConnected(CONNECTED_BOOTSTRAP_HTML), true)
    assert.equal(checkIsConnected(NOT_CONNECTED_BOOTSTRAP_HTML), false)
    assert.equal(checkIsConnected(undefined), false)
  })

  it('returns null for missing email or version', () => {
    assert.equal(parseAccountEmail(NOT_CONNECTED_BOOTSTRAP_HTML), null)
    assert.equal(parseClientVersion(NOT_CONNECTED_BOOTSTRAP_HTML), null)
  })
})

describe('parseEventRangeResponse', () => {
  it('strips the XSSI prefix and walks to the events array', () => {
    const text = wrapEventRangeResponse(ALL_EVENT_NODES)
    const nodes = parseEventRangeResponse(text)
    assert.equal(nodes.length, ALL_EVENT_NODES.length)
  })

  it('returns an empty array for malformed input', () => {
    assert.deepEqual(parseEventRangeResponse('not json'), [])
    assert.deepEqual(parseEventRangeResponse(undefined), [])
    assert.deepEqual(parseEventRangeResponse(")]}'\n\n{}"), [])
  })
})

describe('checkIsTimedMeeting', () => {
  it('keeps real timed meetings', () => {
    assert.equal(checkIsTimedMeeting(EVENT_NODES.acceptedMeet), true)
    assert.equal(checkIsTimedMeeting(EVENT_NODES.declined), true)
    assert.equal(checkIsTimedMeeting(EVENT_NODES.noLink), true)
  })

  it('excludes working-location (eventType 10) entries', () => {
    assert.equal(checkIsTimedMeeting(EVENT_NODES.shortOwn), false)
  })

  it('excludes object-titled working-location entries', () => {
    assert.equal(checkIsTimedMeeting(EVENT_NODES.workingLocationObjTitle), false)
  })
})

describe('getSelfResponse', () => {
  it('reads the self-attendee response code', () => {
    assert.equal(getSelfResponse(EVENT_NODES.acceptedMeet, SELF_EMAIL), 3)
    assert.equal(getSelfResponse(EVENT_NODES.declined, SELF_EMAIL), 1)
    assert.equal(getSelfResponse(EVENT_NODES.tentative, SELF_EMAIL), 2)
    assert.equal(getSelfResponse(EVENT_NODES.needsAction, SELF_EMAIL), 0)
  })

  it('returns null when there is no self attendee', () => {
    assert.equal(getSelfResponse(EVENT_NODES.shortOwn, SELF_EMAIL), null)
  })
})

describe('checkPassesFilter', () => {
  it('default hides only explicit declines', () => {
    assert.equal(checkPassesFilter(1, 'acceptedTentative'), false)
    assert.equal(checkPassesFilter(0, 'acceptedTentative'), true)
    assert.equal(checkPassesFilter(2, 'acceptedTentative'), true)
    assert.equal(checkPassesFilter(3, 'acceptedTentative'), true)
    assert.equal(checkPassesFilter(null, 'acceptedTentative'), true)
  })

  it('all keeps every response', () => {
    assert.equal(checkPassesFilter(1, 'all'), true)
    assert.equal(checkPassesFilter(null, 'all'), true)
  })
})

describe('normalizeEvents', () => {
  it('maps timed meetings to the internal shape with deep-scanned times', () => {
    const meetings = normalizeEvents(ALL_EVENT_NODES, SELF_EMAIL)
    // 6 timed meetings; the two working-location entries are excluded.
    assert.equal(meetings.length, 6)

    const meet = meetings.find((meeting) => meeting.id === 'evt-accepted-meet')
    assert.equal(meet.title, 'Meeting A')
    assert.equal(meet.start, 1778818500000)
    assert.equal(meet.end, 1778822100000)
    assert.equal(meet.joinUrl, 'https://meet.google.com/aaa-bbbb-ccc')

    // Flat epoch-ms shape (declined) is deep-scanned correctly.
    const declined = meetings.find((meeting) => meeting.id === 'evt-declined')
    assert.equal(declined.start, 1776038400000)
    assert.equal(declined.end, 1777075200000)
  })

  it('resolves the Zoom video entry point when no direct Meet link', () => {
    const meetings = normalizeEvents([EVENT_NODES.acceptedZoom], SELF_EMAIL)
    assert.equal(
      meetings[0].joinUrl,
      'https://example.zoom.us/j/123456789?pwd=abcdef',
    )
  })

  it('scans the event description for a pasted link when unstructured', () => {
    const meetings = normalizeEvents([DESCRIPTION_ZOOM_NODE], SELF_EMAIL)
    assert.equal(meetings[0].joinUrl, 'https://example.zoom.us/j/98765?pwd=zzz')
  })

  it('leaves joinUrl null when no link is present', () => {
    const meetings = normalizeEvents([EVENT_NODES.noLink], SELF_EMAIL)
    assert.equal(meetings[0].joinUrl, null)
  })
})

describe('selectMeetings', () => {
  it('default filter excludes declined and drops selfResponse', () => {
    const meetings = selectMeetings(
      ALL_EVENT_NODES,
      SELF_EMAIL,
      'acceptedTentative',
    )
    assert.equal(meetings.length, 5)
    assert.ok(!meetings.some((meeting) => meeting.id === 'evt-declined'))
    assert.ok(!('selfResponse' in meetings[0]))
  })

  it('all filter keeps declined meetings', () => {
    const meetings = selectMeetings(ALL_EVENT_NODES, SELF_EMAIL, 'all')
    assert.equal(meetings.length, 6)
    assert.ok(meetings.some((meeting) => meeting.id === 'evt-declined'))
  })
})
