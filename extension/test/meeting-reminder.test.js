import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkMeetingOccursOnLocalDay,
  computeBadgeText,
  getLocalDayBounds,
  getNextReminderTransitionAt,
  getReminderView,
  getVisibleMeetings,
  groupMeetings,
  selectPopupMeetings,
} from '../src/meeting-reminder.js'

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

describe('getVisibleMeetings', () => {
  it('excludes meetings that start on a future local day', () => {
    const now = new Date(2026, 5, 2, 17, 6, 0).getTime()
    const { end: dayEnd } = getLocalDayBounds(now)
    const tomorrowMorning = meeting({
      id: 'tomorrow',
      start: dayEnd + (11 * 60 + 30) * MINUTE,
      end: dayEnd + 12 * 60 * MINUTE,
    })
    const visible = getVisibleMeetings(
      [
        tomorrowMorning,
        meeting({
          id: 'ended',
          start: now - 120 * MINUTE,
          end: now - 60 * MINUTE,
        }),
      ],
      now,
    )
    assert.deepEqual(visible, [])
  })

  it('keeps not-yet-ended meetings still on the local day', () => {
    const now = new Date(2026, 5, 2, 17, 6, 0).getTime()
    const laterToday = meeting({
      id: 'later',
      start: now + 30 * MINUTE,
      end: now + 90 * MINUTE,
    })
    const visible = getVisibleMeetings([laterToday], now)
    assert.deepEqual(
      visible.map((m) => m.id),
      ['later'],
    )
    assert.equal(checkMeetingOccursOnLocalDay(laterToday, now), true)
  })
})

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

describe('selectPopupMeetings', () => {
  const now = 100 * MINUTE

  it('keeps every in-progress meeting and only the next start slot', () => {
    const meetings = [
      meeting({ id: 'live', start: 95 * MINUTE, end: 110 * MINUTE }),
      meeting({ id: 'later', start: 120 * MINUTE, end: 130 * MINUTE }),
      meeting({ id: 'soon', start: 110 * MINUTE, end: 115 * MINUTE }),
    ]
    const { inProgress, upcoming } = selectPopupMeetings(meetings, now)
    assert.deepEqual(
      inProgress.map((m) => m.id),
      ['live'],
    )
    assert.deepEqual(
      upcoming.map((m) => m.id),
      ['soon'],
    )
  })

  it('does not surface tomorrow when today has no remaining meetings', () => {
    const now = new Date(2026, 5, 2, 17, 6, 0).getTime()
    const { end: dayEnd } = getLocalDayBounds(now)
    const { inProgress, upcoming } = selectPopupMeetings(
      [
        meeting({
          id: 'tomorrow',
          start: dayEnd + (11 * 60 + 30) * MINUTE,
          end: dayEnd + 12 * 60 * MINUTE,
        }),
      ],
      now,
    )
    assert.deepEqual(inProgress, [])
    assert.deepEqual(upcoming, [])
  })

  it('includes every meeting that shares the next start time', () => {
    const sameStart = 110 * MINUTE
    const meetings = [
      meeting({ id: 'a', start: sameStart, end: sameStart + 30 * MINUTE }),
      meeting({ id: 'b', start: sameStart, end: sameStart + 45 * MINUTE }),
      meeting({ id: 'later', start: 130 * MINUTE, end: 140 * MINUTE }),
    ]
    const { upcoming } = selectPopupMeetings(meetings, now)
    assert.deepEqual(
      upcoming.map((m) => m.id),
      ['a', 'b'],
    )
  })
})

describe('getReminderView', () => {
  const now = 100 * MINUTE
  const lead = 5

  it('returns popup groups and badge text for the same moment', () => {
    const meetings = [
      meeting({ id: 'live', start: now - 2 * MINUTE, end: now + 20 * MINUTE }),
      meeting({
        id: 'soon',
        start: now + 3 * MINUTE,
        end: now + 40 * MINUTE,
      }),
    ]
    const view = getReminderView(meetings, now, lead)
    assert.equal(view.badgeText, '3m')
    assert.deepEqual(
      view.inProgress.map((m) => m.id),
      ['live'],
    )
    assert.deepEqual(
      view.upcoming.map((m) => m.id),
      ['soon'],
    )
  })
})

describe('getNextReminderTransitionAt', () => {
  const now = new Date(2026, 5, 2, 10, 0, 0).getTime()
  const lead = 5

  it('returns the soonest meeting end while in progress', () => {
    const end = now + 8 * MINUTE
    const meetings = [
      meeting({ start: now - 2 * MINUTE, end, id: 'live' }),
      meeting({
        start: now + 30 * MINUTE,
        end: now + 60 * MINUTE,
        id: 'later',
      }),
    ]
    assert.equal(getNextReminderTransitionAt(meetings, now, lead), end)
  })

  it('returns the meeting start when it is the next transition', () => {
    const start = now + 4 * MINUTE
    const at = start - 30_000
    const meetings = [meeting({ start, end: start + 30 * MINUTE })]
    assert.equal(getNextReminderTransitionAt(meetings, at, lead), start)
  })

  it('returns the lead-window edge before the countdown appears', () => {
    const start = now + 8 * MINUTE
    const meetings = [meeting({ start, end: start + 30 * MINUTE })]
    assert.equal(
      getNextReminderTransitionAt(meetings, now, lead),
      start - lead * MINUTE,
    )
  })

  it('returns the next minute boundary for an imminent countdown badge', () => {
    const start = now + 2 * MINUTE + 15_000
    const meetings = [meeting({ start, end: start + 30 * MINUTE })]
    assert.equal(
      getNextReminderTransitionAt(meetings, now, lead),
      start - 2 * MINUTE,
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
    const meetings = [
      meeting({ start: now + 3 * MINUTE, end: now + 30 * MINUTE }),
    ]
    assert.equal(computeBadgeText(meetings, now, lead), '3m')
  })

  it('rounds a partial minute up and never below 1', () => {
    const meetings = [meeting({ start: now + 30_000, end: now + 30 * MINUTE })]
    assert.equal(computeBadgeText(meetings, now, lead), '1m')
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
      meeting({
        id: 'back2back',
        start: now + 2 * MINUTE,
        end: now + 40 * MINUTE,
      }),
    ]
    assert.equal(computeBadgeText(meetings, now, lead), '2m')
  })
})
