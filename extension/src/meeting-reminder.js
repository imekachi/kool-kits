const MINUTE_MS = 60_000

export function getVisibleMeetings(meetings, now) {
  return (Array.isArray(meetings) ? meetings : [])
    .filter((meeting) => meeting.end > now)
    .slice()
    .sort((a, b) => a.start - b.start)
}

export function groupMeetings(meetings, now) {
  const visible = getVisibleMeetings(meetings, now)
  return {
    inProgress: visible.filter(
      (meeting) => meeting.start <= now && now < meeting.end,
    ),
    upcoming: visible.filter((meeting) => meeting.start > now),
  }
}

export function computeBadgeText(meetings, now, leadMinutes) {
  const { inProgress, upcoming } = groupMeetings(meetings, now)
  const leadMs = leadMinutes * MINUTE_MS
  const nextUpcoming = upcoming[0]

  if (nextUpcoming && nextUpcoming.start - now <= leadMs) {
    const minutesUntilStart = Math.max(
      1,
      Math.ceil((nextUpcoming.start - now) / MINUTE_MS),
    )
    return String(minutesUntilStart)
  }

  if (inProgress.length > 0) {
    return 'now'
  }

  return null
}
