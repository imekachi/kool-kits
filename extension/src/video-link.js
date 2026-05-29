const VIDEO_URL_PATTERNS = [
  /https:\/\/[a-z0-9-]+\.zoom\.us\/[^\s"'<>]+/i,
  /https:\/\/zoom\.us\/[^\s"'<>]+/i,
  /https:\/\/meet\.google\.com\/[^\s"'<>]+/i,
  /https:\/\/teams\.microsoft\.com\/[^\s"'<>]+/i,
  /https:\/\/teams\.live\.com\/[^\s"'<>]+/i,
]

export function resolveVideoLink(event) {
  const conferenceUri = getConferenceVideoUri(event)
  if (conferenceUri) {
    return conferenceUri
  }

  if (event?.hangoutLink) {
    return event.hangoutLink
  }

  return scanTextForVideoLink(
    `${event?.location ?? ''}\n${event?.description ?? ''}`,
  )
}

function getConferenceVideoUri(event) {
  const entryPoints = event?.conferenceData?.entryPoints
  if (!Array.isArray(entryPoints)) {
    return null
  }

  const videoEntry = entryPoints.find(
    (entry) => entry?.entryPointType === 'video' && entry?.uri,
  )
  return videoEntry?.uri ?? null
}

function scanTextForVideoLink(text) {
  for (const pattern of VIDEO_URL_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      return match[0]
    }
  }

  return null
}
