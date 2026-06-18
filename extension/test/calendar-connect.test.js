import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  GOOGLE_CALENDAR_HOST_ORIGINS,
  GOOGLE_CALENDAR_HOST_PATTERN,
  checkHasCalendarHostPermission,
  checkIsGoogleCalendarUrl,
  pickCalendarTabForConnect,
  requestCalendarHostPermission,
} from '../src/calendar-connect.js'

describe('calendar host permission helpers', () => {
  it('uses the calendar.google.com host pattern', () => {
    assert.equal(GOOGLE_CALENDAR_HOST_PATTERN, 'https://calendar.google.com/*')
    assert.deepEqual(GOOGLE_CALENDAR_HOST_ORIGINS, [
      'https://calendar.google.com/*',
    ])
  })

  it('checks whether calendar host permission is granted', async () => {
    const contains = async (details) => {
      assert.deepEqual(details, { origins: GOOGLE_CALENDAR_HOST_ORIGINS })
      return true
    }

    assert.equal(await checkHasCalendarHostPermission({ contains }), true)
  })

  it('requests calendar host permission and reports grant result', async () => {
    const request = async (details) => {
      assert.deepEqual(details, { origins: GOOGLE_CALENDAR_HOST_ORIGINS })
      return false
    }

    assert.deepEqual(await requestCalendarHostPermission({ request }), {
      granted: false,
    })
  })
})

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
