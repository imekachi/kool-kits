import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkCanCopyTabUrl } from '../src/copyable-url.js'

describe('checkCanCopyTabUrl', () => {
  it('allows ordinary http and https pages', () => {
    assert.equal(checkCanCopyTabUrl('https://example.com/path?q=1'), true)
    assert.equal(checkCanCopyTabUrl('http://localhost:3000/'), true)
  })

  it('allows Chrome-owned and extension URLs when Chrome exposes them', () => {
    assert.equal(checkCanCopyTabUrl('chrome://extensions/'), true)
    assert.equal(
      checkCanCopyTabUrl('devtools://devtools/bundled/inspector.html'),
      true,
    )
    assert.equal(
      checkCanCopyTabUrl('chrome-extension://abc123/options.html'),
      true,
    )
  })

  it('allows Chrome Web Store pages even though toast injection may fail', () => {
    assert.equal(
      checkCanCopyTabUrl('https://chrome.google.com/webstore/detail/example'),
      true,
    )
    assert.equal(
      checkCanCopyTabUrl('https://chromewebstore.google.com/detail/example'),
      true,
    )
  })

  it('rejects empty or malformed URLs', () => {
    assert.equal(checkCanCopyTabUrl(''), false)
    assert.equal(checkCanCopyTabUrl(undefined), false)
    assert.equal(checkCanCopyTabUrl('not a url'), false)
  })
})
