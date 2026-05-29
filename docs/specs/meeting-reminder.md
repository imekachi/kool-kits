# Meeting Reminder

## Goal

Surface the user's Google Calendar meetings for today directly in the Kool Kits toolbar action, so an imminent meeting is visible at a glance (a red badge) and one click reveals what is in progress, what is coming up next, and how to join.

## Connection And Authorization

The extension connects to a single Google account using Chrome's built-in identity flow (`chrome.identity.getAuthToken`) with a read-only Google Calendar scope. This was chosen over a generic web OAuth popup because the extension targets a single personal calendar: Chrome already knows the signed-in Google account, so connecting is a single click with no redirect handling and no manual token refresh. The trade-off is that the connected account is the one the user is signed into Chrome with, and the extension's OAuth client must be registered in Google Cloud against the extension ID. Supporting account pickers or non-Google providers is intentionally deferred; if that need arises, the connection layer would move to a generic web auth flow without changing the rest of the feature.

Connecting is initiated by the user (from the popup when not yet connected, or from the options page). Disconnecting revokes the grant so the next connection re-prompts for consent. Because the Manifest V3 service worker is ephemeral and loses any in-memory state when it is torn down, disconnect must re-read the live cached token from Chrome at the moment of disconnect rather than relying on a token held in a worker variable; otherwise a disconnect after the worker has been recycled would revoke nothing and the feature would silently reconnect on the next sync.

An unauthorized response from the Calendar API usually means a routine token expiry, not that the user revoked access. The extension therefore treats unauthorized as recoverable first: it clears the stale cached token and attempts a single silent re-acquire and retry. Only if that silent re-acquire fails does it enter the reconnect (auth error) state. A full revoke is reserved for explicit user disconnect, so a routine expiry never forces the user back through the consent screen. The user must always be able to tell whether the extension is connected.

## Data Model And Sync

The service worker owns all calendar data and badge state so the badge stays trustworthy even while the popup is closed. This is the only architecture that keeps the reminder badge correct without depending on the user opening the popup.

When the feature is disabled (see Options), the service worker performs no calendar syncing and keeps the badge cleared.

While enabled, the service worker fetches today's events from the Calendar API on a periodic schedule, normalizes them, and caches them in extension storage together with a last-synced timestamp and a sync state (connected, not connected, auth error, or error). It also refetches when the popup opens and immediately after a successful connect, so the user sees fresh data when they look.

A transient fetch failure (offline, server error) is not destructive: the last good set of cached meetings is retained and continues to drive both the badge and the popup, and only the sync state flips to error. This is essential to the badge's core promise — a single failed background fetch must not make an imminent meeting's badge disappear or blank the popup's cached list. Cached meetings are only cleared when the user disconnects or the feature is disabled.

Calendar syncs are coalesced into a single in-flight operation. Multiple triggers (the periodic alarm, a popup-open refresh, and a settings change) can fire close together; without coalescing, a slow failing sync could overwrite the result of a newer successful one. Overlapping triggers therefore share one in-flight sync rather than racing on the cache.

Only events that represent real, time-bound commitments are kept: all-day events are excluded because they have no specific start to remind on, and events the user has declined are excluded. Only the primary calendar is consulted. This is a deliberate, known limitation: meetings that live only on a shared, team, or other secondary calendar will not appear or drive the badge. A calendar picker was considered and deferred to keep the first version simple; adding one later means letting the user select calendars and fetching and merging events per selected calendar.

A separate, frequent recompute step updates the toolbar badge from the cached events without making network calls, so the badge reflects the passage of time (counting down, flipping to in-progress, clearing when meetings end) between data fetches. Because this recompute runs on a roughly one-minute cadence (the platform's minimum alarm period), the displayed countdown and the flip to in-progress can lag real time by up to about a minute at minute boundaries; this is an accepted limitation. Likewise, a meeting that starts in the first minutes after midnight may not appear until the next periodic fetch picks up the new day, leaving a short blind window just after midnight.

## Badge Behavior

When the feature is disabled, there is never a badge. Otherwise the badge communicates urgency of the single most urgent meeting:

- When no meeting is within the configured lead window and none is in progress, there is no badge.
- When a meeting will start within the configured lead time, the badge shows the whole number of minutes until it starts, counting down, on a red background.
- When a meeting is in progress and nothing upcoming is within the lead window, the badge shows `now` on a red background.

When meetings are concurrent or back-to-back, the soonest upcoming start within the lead window wins the badge, because the action the user most needs to take is joining the meeting that is about to begin. An in-progress meeting only drives the badge when there is nothing imminent to start.

The badge text is deliberately short because Chrome only renders a few characters. The exact lead time is user-configurable (see Options).

## Popup

The popup is structured as a dedicated meeting section at the top and a separate footer beneath it, because the meeting section may grow long and the footer must remain a stable, predictable place for navigation.

The meeting section lists today's meetings that have not yet ended, split into two visually separated groups: meetings **in progress** and **upcoming** meetings. The section scrolls when there are many meetings. A meeting stays listed until its end time has passed, then it drops out. Each meeting shows its title and its start and end times in the user's locale format. A meeting shows a **Join** button only when a video call link can be resolved for it; meetings without a video link show no Join button. Activating Join opens the resolved video URL in a new browser tab, which works uniformly whether the link is Google Meet, Zoom, Microsoft Teams, or another provider.

The footer sits outside the meeting section and contains a Settings control that opens the extension's options page.

Both the popup and the options page use a dark theme by default, reusing the existing Kool Kits palette and typography already established by the recent tab switcher (a dark panel background, off-white text, and the yellow accent, with `color-scheme: dark` and the Inter font stack). The yellow accent marks primary actions such as Connect and the enabled toggle; the meeting urgency cues (badge and any in-progress emphasis) stay red so urgency reads distinctly from the brand accent. Keeping these surfaces on the same palette makes the new feature feel native to the extension rather than introducing a second visual language.

The popup renders one of several states:

- **Disabled:** when the feature is turned off in options, the popup omits the meeting section entirely and shows only the footer with the Settings control.
- **Not connected:** a primary action to connect Google Calendar, with a brief line explaining why access is needed. This is the no-authorization state; because connection uses Chrome's identity flow, it is a single button rather than a login form.
- **Loading:** shown only when there is no cached data yet, so a returning user with cached meetings never sees a spinner.
- **Authorization error:** a reconnect action, shown when the token is no longer valid and the silent re-acquire failed.
- **Empty:** when connected with no qualifying meetings remaining today, the section shows an empty state reading `No meeting`.
- **List:** the in-progress and upcoming groups described above. Whenever cached meetings exist they are shown, even if the most recent fetch failed transiently, so a popup opened while briefly offline keeps showing the last known meetings rather than collapsing to an error. A dedicated fetch-error message is shown only when the fetch failed and there are no cached meetings to fall back on.

## Video Link Resolution

A meeting's join link is resolved in priority order: first a video entry point from the event's structured conferencing data, then the Google Meet hangout link, then a scan of the event location and description for recognizable video-meeting URLs (Google Meet, Zoom, Microsoft Teams). The first match wins. If nothing matches, the meeting has no Join button. Structured conferencing data is preferred over text scanning because it is unambiguous and provider-supplied, while location and description scanning is a best-effort fallback for events that only paste a link in.

## Options

The options page opens in its own browser tab and contains a dedicated **Meeting Reminder** section so additional Kool Kits features can have their own sections later. The section contains:

- An **enable** switch that turns the whole feature on or off, rendered as a sliding toggle switch control (not a checkbox or radio). It is on by default. When off, the feature does no calendar syncing, clears the badge, and the popup omits the meeting section entirely (the footer and settings remain reachable). This lets the user keep the extension installed for other features without calendar access or a badge.
- A **lead time** control: a dropdown offering whole-minute values from 1 to 60, defaulting to 5. This determines how far before a meeting's start the badge begins counting down. A dropdown is used instead of a free-form number field to keep the value within a sensible range without validation.
- The **connection status** and a control to connect or disconnect the Google account. Connection status reflects whether a Google token can actually be obtained, independent of whether the feature is enabled — so a user who has connected but turned the feature off still sees themselves as connected rather than being misled into reconnecting.

Settings persist in extension storage and are read by both the service worker (for badge timing) and the popup.

## Architecture

The feature is built in vanilla JavaScript with ES modules and message passing, matching the existing extension code.

- The service worker gains alarm-driven event fetching, frequent badge recomputation, message handling for the popup (read cached state, request refresh), and wiring of the toolbar action to a popup.
- A calendar authorization module owns acquiring, clearing, and revoking the Google token.
- A calendar API module fetches and normalizes today's events into the internal meeting shape.
- A meeting-reminder module holds the pure selection and badge-state logic (which meeting is most urgent, in-progress versus upcoming grouping, badge text for a given moment) so it can be unit-tested without Chrome APIs.
- A video-link module holds the pure link-resolution logic.
- The popup and options page each have their own HTML, script, and styles.

Pure logic is deliberately separated from Chrome API calls so the time-sensitive and provider-parsing behavior can be tested deterministically.

Because the service worker is ephemeral, it holds no authoritative state in memory: the token is always read live from Chrome's identity cache when needed, all meeting data and sync state live in extension storage, and the periodic alarms (which persist across worker teardown) revive the worker to do their work. The worker also serializes its sync operation behind a single in-flight promise so overlapping triggers neither duplicate network fetches nor clobber a newer result with an older one.

## Permissions

The extension requests the additional capabilities needed to: use Chrome's identity flow for Google sign-in, schedule background alarms, and reach the Google Calendar API host. The toolbar action gains a default popup, and the manifest declares an options page and the OAuth client and scope.

## Testing

Following the existing test style, the pure modules are unit-tested:

- The meeting-reminder module: badge states across time (no badge, countdown, `now`), most-urgent selection for concurrent and back-to-back meetings, in-progress versus upcoming grouping, and boundary conditions at start and end times.
- The video-link module: resolution for each supported provider via structured data, hangout link, and text fallback, plus the no-link case.

## Acceptance Criteria

- The popup and options page render in the Kool Kits dark theme by default, consistent with the recent tab switcher's palette and typography.
- A connected user sees today's not-yet-ended meetings in the popup, grouped into in-progress and upcoming with clear visual separation.
- A meeting remains listed until its end time passes, then disappears.
- Each meeting shows start and end times in the user's locale; only meetings with a resolvable video link show a Join button, and Join opens that link in a new tab.
- The badge is absent until a meeting is within the configured lead time, then shows a red countdown, then `now` while a meeting is in progress with nothing imminent, then clears.
- For concurrent or back-to-back meetings, the badge reflects the soonest upcoming start within the lead window.
- The badge stays correct over time without the popup being opened.
- All-day events and declined events never appear and never drive the badge.
- A user who is not connected sees a single connect action; an invalid token shows a reconnect action; a connected user with nothing today sees `No meeting`.
- The options page has a Meeting Reminder section with an enable switch (on by default), a 1–60 minute lead-time dropdown (default 5), and a connect/disconnect control, and changes take effect for badge timing.
- Turning the feature off clears the badge, stops calendar syncing, and removes the meeting section from the popup while leaving the footer and settings reachable; turning it back on resumes syncing and the badge.

## Out Of Scope

- Desktop or system notifications beyond the toolbar badge.
- Multiple calendars, account pickers, and non-Google providers.
- Editing, creating, or responding to events.
- Syncing settings across devices.
- Supporting non-Chrome browsers.
