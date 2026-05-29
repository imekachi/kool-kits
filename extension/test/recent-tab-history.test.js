import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createRecentTabHistory } from '../src/recent-tab-history.js'

describe('recent tab history', () => {
  it('keeps the active tab first and deduplicates revisited tabs', () => {
    const history = createRecentTabHistory()

    history.recordActivation({ tabId: 1, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 10 })
    history.recordActivation({ tabId: 3, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 10 })

    assert.deepEqual(history.getWindowHistory(10), [2, 3, 1])
  })

  it('tracks each window independently', () => {
    const history = createRecentTabHistory()

    history.recordActivation({ tabId: 1, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 20 })
    history.recordActivation({ tabId: 3, windowId: 10 })

    assert.deepEqual(history.getWindowHistory(10), [3, 1])
    assert.deepEqual(history.getWindowHistory(20), [2])
  })

  it('keeps at most six tabs per window including the active tab', () => {
    const history = createRecentTabHistory()

    for (let tabId = 1; tabId <= 8; tabId += 1) {
      history.recordActivation({ tabId, windowId: 10 })
    }

    assert.deepEqual(history.getWindowHistory(10), [8, 7, 6, 5, 4, 3])
  })

  it('removes closed tabs and windows', () => {
    const history = createRecentTabHistory()

    history.recordActivation({ tabId: 1, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 10 })
    history.recordActivation({ tabId: 3, windowId: 20 })
    history.removeTab({ tabId: 2, windowId: 10 })
    history.removeWindow(20)

    assert.deepEqual(history.getWindowHistory(10), [1])
    assert.deepEqual(history.getWindowHistory(20), [])
  })

  it('drops stale tabs during reconciliation', () => {
    const history = createRecentTabHistory()

    history.recordActivation({ tabId: 1, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 10 })
    history.recordActivation({ tabId: 3, windowId: 10 })

    assert.deepEqual(
      history.reconcileWindow({ existingTabIds: [1, 3], windowId: 10 }),
      [3, 1],
    )
  })

  it('serializes and restores state', () => {
    const history = createRecentTabHistory()
    history.recordActivation({ tabId: 1, windowId: 10 })
    history.recordActivation({ tabId: 2, windowId: 10 })

    const restored = createRecentTabHistory(history.toJSON())

    assert.deepEqual(restored.getWindowHistory(10), [2, 1])
  })
})
