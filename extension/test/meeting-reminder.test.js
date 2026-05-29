import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { computeBadgeText, groupMeetings } from '../src/meeting-reminder.js'

const MINUTE = 60_000

function meeting(overrides) {
  return {
    id: 'id',
    title: 'Meeting',
    start: 0,
    end: MINUTE,
    joinUrl: null,
    ...overrides,
  }
}

describe('groupMeetings', () => {
  const now = 100 * MINUTE

  it('drops meetings that already ended and sorts by start', () => {
    const meetings = [
      meeting({ id: 'ended', start: 90 * MINUTE, end: 95 * MINUTE }),
      meeting({ id: 'later', start: 110 * MINUTE, end: 120 * MINUTE }),
      meeting({ id: 'soon', start: 105 * MINUTE, end: 115 * MINUTE }),
    ]
    const { inProgress, upcoming } = groupMeetings(meetings, now)
    assert.deepEqual(inProgress, [])
    assert.deepEqual(
      upcoming.map((m) => m.id),
      ['soon', 'later'],
    )
  })

  it('classifies in-progress meetings separately from upcoming', () => {
    const meetings = [
      meeting({ id: 'live', start: 95 * MINUTE, end: 110 * MINUTE }),
      meeting({ id: 'next', start: 102 * MINUTE, end: 130 * MINUTE }),
    ]
    const { inProgress, upcoming } = groupMeetings(meetings, now)
    assert.deepEqual(
      inProgress.map((m) => m.id),
      ['live'],
    )
    assert.deepEqual(
      upcoming.map((m) => m.id),
      ['next'],
    )
  })
})

describe('computeBadgeText', () => {
  const now = 100 * MINUTE
  const lead = 5

  it('returns null when nothing is in progress or within the lead window', () => {
    const meetings = [meeting({ start: 110 * MINUTE, end: 120 * MINUTE })]
    assert.equal(computeBadgeText(meetings, now, lead), null)
  })

  it('counts down whole minutes within the lead window', () => {
    const meetings = [meeting({ start: now + 3 * MINUTE, end: now + 30 * MINUTE })]
    assert.equal(computeBadgeText(meetings, now, lead), '3')
  })

  it('rounds a partial minute up and never below 1', () => {
    const meetings = [meeting({ start: now + 30_000, end: now + 30 * MINUTE })]
    assert.equal(computeBadgeText(meetings, now, lead), '1')
  })

  it('shows now when in progress and nothing upcoming is within the window', () => {
    const meetings = [
      meeting({ start: now - 2 * MINUTE, end: now + 20 * MINUTE }),
      meeting({ start: now + 30 * MINUTE, end: now + 60 * MINUTE }),
    ]
    assert.equal(computeBadgeText(meetings, now, lead), 'now')
  })

  it('prefers the imminent upcoming start over an in-progress meeting', () => {
    const meetings = [
      meeting({ id: 'live', start: now - 2 * MINUTE, end: now + 20 * MINUTE }),
      meeting({ id: 'back2back', start: now + 2 * MINUTE, end: now + 40 * MINUTE }),
    ]
    assert.equal(computeBadgeText(meetings, now, lead), '2')
  })
})
