import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkIsGoogleCalendarUrl,
  pickCalendarTabForConnect,
} from '../src/calendar-connect.js'

describe('checkIsGoogleCalendarUrl', () => {
  it('matches calendar.google.com URLs', () => {
    assert.equal(
      checkIsGoogleCalendarUrl('https://calendar.google.com/calendar/u/0/r'),
      true,
    )
    assert.equal(checkIsGoogleCalendarUrl('https://example.com/'), false)
    assert.equal(checkIsGoogleCalendarUrl(null), false)
  })
})

describe('pickCalendarTabForConnect', () => {
  it('returns null when no calendar tabs exist', () => {
    assert.equal(pickCalendarTabForConnect([]), null)
    assert.equal(
      pickCalendarTabForConnect([{ id: 1, url: 'https://example.com/' }]),
      null,
    )
  })

  it('prefers the active calendar tab', () => {
    const picked = pickCalendarTabForConnect([
      { id: 1, url: 'https://calendar.google.com/a', lastAccessed: 99 },
      {
        id: 2,
        url: 'https://calendar.google.com/b',
        active: true,
        lastAccessed: 1,
      },
    ])
    assert.equal(picked.id, 2)
  })

  it('falls back to the most recently accessed calendar tab', () => {
    const picked = pickCalendarTabForConnect([
      { id: 1, url: 'https://calendar.google.com/a', lastAccessed: 10 },
      { id: 2, url: 'https://calendar.google.com/b', lastAccessed: 50 },
    ])
    assert.equal(picked.id, 2)
  })
})
