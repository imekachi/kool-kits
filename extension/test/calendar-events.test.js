import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkIsAllDayEvent,
  checkIsDeclinedEvent,
  normalizeEvents,
} from '../src/calendar-events.js'

describe('checkIsAllDayEvent', () => {
  it('detects date-only events as all-day', () => {
    assert.equal(checkIsAllDayEvent({ start: { date: '2026-05-29' } }), true)
  })

  it('treats timed events as not all-day', () => {
    assert.equal(
      checkIsAllDayEvent({ start: { dateTime: '2026-05-29T10:00:00Z' } }),
      false,
    )
  })
})

describe('checkIsDeclinedEvent', () => {
  it('detects when the self attendee declined', () => {
    const event = {
      attendees: [
        { email: 'other@x.com', responseStatus: 'accepted' },
        { self: true, responseStatus: 'declined' },
      ],
    }
    assert.equal(checkIsDeclinedEvent(event), true)
  })

  it('returns false when self accepted or no attendees', () => {
    assert.equal(
      checkIsDeclinedEvent({ attendees: [{ self: true, responseStatus: 'accepted' }] }),
      false,
    )
    assert.equal(checkIsDeclinedEvent({}), false)
  })
})

describe('normalizeEvents', () => {
  it('filters all-day and declined events and maps the rest', () => {
    const raw = [
      {
        id: 'a',
        summary: 'Standup',
        start: { dateTime: '2026-05-29T10:00:00Z' },
        end: { dateTime: '2026-05-29T10:15:00Z' },
        hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc',
      },
      { id: 'b', summary: 'Holiday', start: { date: '2026-05-29' }, end: { date: '2026-05-30' } },
      {
        id: 'c',
        summary: 'Declined sync',
        start: { dateTime: '2026-05-29T11:00:00Z' },
        end: { dateTime: '2026-05-29T11:30:00Z' },
        attendees: [{ self: true, responseStatus: 'declined' }],
      },
    ]
    const meetings = normalizeEvents(raw, 'primary')
    assert.equal(meetings.length, 1)
    assert.deepEqual(meetings[0], {
      id: 'a',
      calendarId: 'primary',
      title: 'Standup',
      start: Date.parse('2026-05-29T10:00:00Z'),
      end: Date.parse('2026-05-29T10:15:00Z'),
      videoUrl: 'https://meet.google.com/aaa-bbbb-ccc',
    })
  })

  it('falls back to a placeholder title when summary is missing', () => {
    const meetings = normalizeEvents(
      [
        {
          id: 'x',
          start: { dateTime: '2026-05-29T10:00:00Z' },
          end: { dateTime: '2026-05-29T10:15:00Z' },
        },
      ],
      'primary',
    )
    assert.equal(meetings[0].title, '(No title)')
  })
})
