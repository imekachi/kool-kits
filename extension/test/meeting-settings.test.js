import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MEETING_SETTINGS_DEFAULTS,
  mergeMeetingSettings,
} from '../src/meeting-settings.js'

describe('mergeMeetingSettings', () => {
  it('returns defaults for undefined or empty input', () => {
    assert.deepEqual(mergeMeetingSettings(undefined), MEETING_SETTINGS_DEFAULTS)
    assert.deepEqual(mergeMeetingSettings({}), MEETING_SETTINGS_DEFAULTS)
  })

  it('keeps a valid enabled flag and lead time', () => {
    assert.deepEqual(mergeMeetingSettings({ enabled: false, leadMinutes: 30 }), {
      enabled: false,
      leadMinutes: 30,
      meetingFilter: 'acceptedTentative',
    })
  })

  it('rejects out-of-range or non-integer lead times', () => {
    assert.equal(mergeMeetingSettings({ leadMinutes: 0 }).leadMinutes, 5)
    assert.equal(mergeMeetingSettings({ leadMinutes: 61 }).leadMinutes, 5)
    assert.equal(mergeMeetingSettings({ leadMinutes: 5.5 }).leadMinutes, 5)
  })

  it('rejects a non-boolean enabled flag', () => {
    assert.equal(mergeMeetingSettings({ enabled: 'yes' }).enabled, true)
  })

  it('meetingFilter defaults to acceptedTentative', () => {
    assert.equal(
      mergeMeetingSettings({}).meetingFilter,
      'acceptedTentative',
    )
  })

  it('keeps a valid meetingFilter of all', () => {
    assert.equal(
      mergeMeetingSettings({ meetingFilter: 'all' }).meetingFilter,
      'all',
    )
  })

  it('rejects an unknown meetingFilter string, falling back to acceptedTentative', () => {
    assert.equal(
      mergeMeetingSettings({ meetingFilter: 'bogus' }).meetingFilter,
      'acceptedTentative',
    )
  })
})
