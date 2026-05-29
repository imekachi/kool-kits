import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveJoinLink } from '../src/join-link.js'

describe('resolveJoinLink', () => {
  it('returns meetLink when present, even if entryPoints and text also have links', () => {
    assert.equal(
      resolveJoinLink({
        meetLink: 'https://meet.google.com/aaa-bbbb-ccc',
        entryPoints: [[3, 'https://earnin.zoom.us/j/123?pwd=x']],
        text: 'https://teams.microsoft.com/l/meetup-join/abc',
      }),
      'https://meet.google.com/aaa-bbbb-ccc',
    )
  })

  it('returns the type-3 video entryPoint uri when no meetLink, ignoring type 4 and 5', () => {
    assert.equal(
      resolveJoinLink({
        entryPoints: [
          [4, 'tel:+1-555'],
          [3, 'https://earnin.zoom.us/j/123?pwd=x'],
          [5, 'https://some-addon.com/join'],
        ],
      }),
      'https://earnin.zoom.us/j/123?pwd=x',
    )

    assert.equal(
      resolveJoinLink({
        entryPoints: [
          [4, 'tel:+1-555'],
          [5, 'https://some-addon.com/join'],
        ],
        text: 'https://meet.google.com/xyz-defg-hij',
      }),
      'https://meet.google.com/xyz-defg-hij',
    )
  })

  it('falls back to scanning text for known provider URLs when no meetLink and no video entryPoint', () => {
    assert.equal(
      resolveJoinLink({ text: 'Join https://acme.zoom.us/j/999 now' }),
      'https://acme.zoom.us/j/999',
    )
    assert.equal(
      resolveJoinLink({ text: 'link: https://teams.microsoft.com/l/meetup-join/abc' }),
      'https://teams.microsoft.com/l/meetup-join/abc',
    )
    assert.equal(
      resolveJoinLink({ text: 'see https://meet.google.com/xyz-defg-hij' }),
      'https://meet.google.com/xyz-defg-hij',
    )
    assert.equal(
      resolveJoinLink({ text: 'see https://teams.live.com/meet/9876543' }),
      'https://teams.live.com/meet/9876543',
    )
  })

  it('returns null when nothing resolves', () => {
    assert.equal(resolveJoinLink({}), null)
    assert.equal(resolveJoinLink({ text: 'Room 3B, no links here' }), null)
    assert.equal(resolveJoinLink({ entryPoints: [[4, 'tel:+1-555']] }), null)
    assert.equal(resolveJoinLink(undefined), null)
  })
})
