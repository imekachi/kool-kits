const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export function getLocalDayBounds(now) {
  const date = new Date(now)
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime()
  return { start, end: start + DAY_MS }
}

export function checkMeetingOccursOnLocalDay(meeting, now) {
  const { start: dayStart, end: dayEnd } = getLocalDayBounds(now)
  return meeting.start < dayEnd && meeting.end > dayStart
}

export function getVisibleMeetings(meetings, now) {
  return (Array.isArray(meetings) ? meetings : [])
    .filter(
      (meeting) =>
        meeting.end > now && checkMeetingOccursOnLocalDay(meeting, now),
    )
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

/** Popup: all in-progress (always simultaneous at `now`) + next start slot only. */
export function selectPopupMeetings(meetings, now) {
  const { inProgress, upcoming } = groupMeetings(meetings, now)
  if (upcoming.length === 0) {
    return { inProgress, upcoming }
  }

  const nextStart = upcoming[0].start
  return {
    inProgress,
    upcoming: upcoming.filter((meeting) => meeting.start === nextStart),
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
