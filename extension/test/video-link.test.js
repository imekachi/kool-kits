import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveVideoLink } from '../src/video-link.js'

describe('resolveVideoLink', () => {
  it('prefers a video entry point from conferenceData', () => {
    const event = {
      hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc',
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-555-000' },
          { entryPointType: 'video', uri: 'https://zoom.us/j/123?pwd=x' },
        ],
      },
    }
    assert.equal(resolveVideoLink(event), 'https://zoom.us/j/123?pwd=x')
  })

  it('falls back to hangoutLink when no conference video entry point', () => {
    const event = { hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' }
    assert.equal(resolveVideoLink(event), 'https://meet.google.com/aaa-bbbb-ccc')
  })

  it('scans location and description for known providers', () => {
    assert.equal(
      resolveVideoLink({ location: 'Join https://acme.zoom.us/j/999 now' }),
      'https://acme.zoom.us/j/999',
    )
    assert.equal(
      resolveVideoLink({
        description: 'link: https://teams.microsoft.com/l/meetup-join/abc',
      }),
      'https://teams.microsoft.com/l/meetup-join/abc',
    )
    assert.equal(
      resolveVideoLink({ description: 'see https://meet.google.com/xyz-defg-hij' }),
      'https://meet.google.com/xyz-defg-hij',
    )
  })

  it('returns null when no video link is present', () => {
    assert.equal(resolveVideoLink({ location: 'Room 3B' }), null)
    assert.equal(resolveVideoLink({}), null)
    assert.equal(resolveVideoLink(undefined), null)
  })
})
