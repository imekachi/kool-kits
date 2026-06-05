const VIDEO_URL_PATTERNS = [
  /https:\/\/[a-z0-9-]+\.zoom\.us\/[^\s"'<>]+/i,
  /https:\/\/zoom\.us\/[^\s"'<>]+/i,
  /https:\/\/meet\.google\.com\/[^\s"'<>]+/i,
  /https:\/\/teams\.microsoft\.com\/[^\s"'<>]+/i,
  /https:\/\/teams\.live\.com\/[^\s"'<>]+/i,
]

export function resolveJoinLink({ meetLink, entryPoints, text } = {}) {
  if (meetLink) {
    return meetLink
  }

  if (Array.isArray(entryPoints)) {
    const videoEntry = entryPoints.find(
      (entry) => entry?.[0] === 3 && typeof entry?.[1] === 'string',
    )
    if (videoEntry) {
      return videoEntry[1]
    }
  }

  if (text) {
    for (const pattern of VIDEO_URL_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        return match[0]
      }
    }
  }

  return null
}
