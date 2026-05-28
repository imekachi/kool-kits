import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createRecentTabThumbnails } from '../src/recent-tab-thumbnails.js'

describe('recent tab thumbnails', () => {
  it('stores thumbnails per tab and window', () => {
    const thumbnails = createRecentTabThumbnails()

    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: 'data:image/jpeg;base64,one',
      windowId: 10,
    })
    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: 'data:image/jpeg;base64,two',
      windowId: 20,
    })

    assert.equal(
      thumbnails.getThumbnail({ tabId: 1, windowId: 10 }),
      'data:image/jpeg;base64,one',
    )
    assert.equal(
      thumbnails.getThumbnail({ tabId: 1, windowId: 20 }),
      'data:image/jpeg;base64,two',
    )
  })

  it('ignores invalid thumbnail entries', () => {
    const thumbnails = createRecentTabThumbnails()

    thumbnails.setThumbnail({
      tabId: 1.5,
      thumbnailUrl: 'data:image/jpeg;base64,invalid-tab',
      windowId: 10,
    })
    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: '',
      windowId: 10,
    })
    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: 'https://example.com/not-a-capture.jpg',
      windowId: 10,
    })
    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: 'data:image/jpeg;base64,invalid-window',
      windowId: Number.NaN,
    })

    assert.deepEqual(thumbnails.toJSON(), [])
  })

  it('removes thumbnails for closed tabs and windows', () => {
    const thumbnails = createRecentTabThumbnails([
      {
        thumbnails: [
          { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' },
          { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,two' },
        ],
        windowId: 10,
      },
      {
        thumbnails: [
          { tabId: 3, thumbnailUrl: 'data:image/jpeg;base64,three' },
        ],
        windowId: 20,
      },
    ])

    thumbnails.removeTab({ tabId: 2, windowId: 10 })
    thumbnails.removeWindow(20)

    assert.deepEqual(thumbnails.toJSON(), [
      {
        thumbnails: [{ tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' }],
        windowId: 10,
      },
    ])
  })

  it('drops thumbnails not present after window reconciliation', () => {
    const thumbnails = createRecentTabThumbnails([
      {
        thumbnails: [
          { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' },
          { tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,two' },
          { tabId: 3, thumbnailUrl: 'data:image/jpeg;base64,three' },
        ],
        windowId: 10,
      },
    ])

    thumbnails.reconcileWindow({ existingTabIds: [1, 3], windowId: 10 })

    assert.deepEqual(thumbnails.toJSON(), [
      {
        thumbnails: [
          { tabId: 1, thumbnailUrl: 'data:image/jpeg;base64,one' },
          { tabId: 3, thumbnailUrl: 'data:image/jpeg;base64,three' },
        ],
        windowId: 10,
      },
    ])
  })

  it('serializes and restores thumbnail state', () => {
    const thumbnails = createRecentTabThumbnails()
    thumbnails.setThumbnail({
      tabId: 7,
      thumbnailUrl: 'data:image/jpeg;base64,seven',
      windowId: 70,
    })

    const restored = createRecentTabThumbnails(thumbnails.toJSON())

    assert.equal(
      restored.getThumbnail({ tabId: 7, windowId: 70 }),
      'data:image/jpeg;base64,seven',
    )
  })

  it('evicts the oldest thumbnail when storage budget needs room', () => {
    const thumbnails = createRecentTabThumbnails()
    thumbnails.setThumbnail({
      tabId: 1,
      thumbnailUrl: 'data:image/jpeg;base64,one',
      windowId: 10,
    })
    thumbnails.setThumbnail({
      tabId: 2,
      thumbnailUrl: 'data:image/jpeg;base64,two',
      windowId: 10,
    })

    assert.equal(thumbnails.evictOldestThumbnail(), true)
    assert.deepEqual(thumbnails.toJSON(), [
      {
        thumbnails: [{ tabId: 2, thumbnailUrl: 'data:image/jpeg;base64,two' }],
        windowId: 10,
      },
    ])
  })
})
