const MAX_THUMBNAIL_WIDTH = 360
const MAX_THUMBNAIL_HEIGHT = 216
const MAX_THUMBNAIL_BYTES = 120_000
const THUMBNAIL_QUALITY = 0.45

export async function prepareThumbnailImage(
  capturedDataUrl,
  dependencies = {},
) {
  if (!checkIsCaptureDataUrl(capturedDataUrl)) {
    return ''
  }

  const fetchDataUrl = dependencies.fetch ?? fetch
  const createBitmap = dependencies.createImageBitmap ?? createImageBitmap
  const Canvas = dependencies.OffscreenCanvas ?? OffscreenCanvas

  try {
    const response = await fetchDataUrl(capturedDataUrl)
    const sourceBlob = await response.blob()
    const bitmap = await createBitmap(sourceBlob)
    const { height, width } = getThumbnailSize(bitmap)
    const canvas = new Canvas(width, height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0, width, height)

    const thumbnailBlob = await canvas.convertToBlob({
      quality: THUMBNAIL_QUALITY,
      type: 'image/jpeg',
    })
    if (thumbnailBlob.size > MAX_THUMBNAIL_BYTES) {
      return ''
    }

    return `data:image/jpeg;base64,${await blobToBase64(thumbnailBlob)}`
  } catch {
    return ''
  }
}

function getThumbnailSize(bitmap) {
  const scale = Math.min(
    1,
    MAX_THUMBNAIL_WIDTH / bitmap.width,
    MAX_THUMBNAIL_HEIGHT / bitmap.height,
  )

  return {
    height: Math.max(1, Math.round(bitmap.height * scale)),
    width: Math.max(1, Math.round(bitmap.width * scale)),
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function checkIsCaptureDataUrl(value) {
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
}
