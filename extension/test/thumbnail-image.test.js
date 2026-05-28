import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { prepareThumbnailImage } from '../src/thumbnail-image.js'

describe('thumbnail image preparation', () => {
  it('downscales a captured data URL into a compact JPEG data URL', async () => {
    const drawCalls = []
    const prepared = await prepareThumbnailImage('data:image/jpeg;base64,raw', {
      OffscreenCanvas: createOffscreenCanvas({ drawCalls, size: 3 }),
      createImageBitmap: () => Promise.resolve({ height: 900, width: 1600 }),
      fetch: () =>
        Promise.resolve({
          blob: () => Promise.resolve(new Blob(['raw'])),
        }),
    })

    assert.equal(prepared, 'data:image/jpeg;base64,AQID')
    assert.deepEqual(drawCalls, [{ height: 203, width: 360 }])
  })

  it('rejects non-capture values', async () => {
    const prepared = await prepareThumbnailImage(
      'https://example.com/image.jpg',
    )

    assert.equal(prepared, '')
  })

  it('rejects prepared images that exceed the storage budget', async () => {
    const prepared = await prepareThumbnailImage('data:image/jpeg;base64,raw', {
      OffscreenCanvas: createOffscreenCanvas({ size: 200_000 }),
      createImageBitmap: () => Promise.resolve({ height: 900, width: 1600 }),
      fetch: () =>
        Promise.resolve({
          blob: () => Promise.resolve(new Blob(['raw'])),
        }),
    })

    assert.equal(prepared, '')
  })
})

function createOffscreenCanvas({ drawCalls = [], size }) {
  return class FakeOffscreenCanvas {
    constructor(width, height) {
      this.height = height
      this.width = width
    }

    getContext(contextType) {
      assert.equal(contextType, '2d')
      return {
        drawImage: (_bitmap, _x, _y, width, height) => {
          drawCalls.push({ height, width })
        },
      }
    }

    convertToBlob(options) {
      assert.deepEqual(options, { quality: 0.45, type: 'image/jpeg' })
      return Promise.resolve(
        new Blob(
          [Uint8Array.from({ length: size }, (_value, index) => index + 1)],
          {
            type: 'image/jpeg',
          },
        ),
      )
    }
  }
}
