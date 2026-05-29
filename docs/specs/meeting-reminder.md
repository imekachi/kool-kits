# Meeting Reminder

## Goal

Surface the user's Google Calendar meetings for today directly in the Kool Kits toolbar action, so an imminent meeting is visible at a glance (a red badge) and one click reveals what is in progress, what is coming up next, and how to join.

## Connection

The extension reads the user's calendar by reusing the Google session they are already signed into in the browser. It calls the same internal endpoint the Google Calendar web app uses to load events, authenticated by the browser's existing Google cookies rather than by an OAuth token the extension holds. This was chosen over Chrome's identity flow (`chrome.identity.getAuthToken`) because that flow requires an OAuth client registered in Google Cloud against the extension ID, and the target organization blocks both new Google Cloud project creation and the personal "secret iCal address" egress path — leaving no usable way to provision an OAuth client for a personal-productivity extension. Reusing the browser session sidesteps OAuth entirely: there is no client ID to register, no consent screen, and no token to refresh or revoke.

There is therefore no "authorization" the extension owns and no token lifecycle. "Connected" simply means the browser currently has a live Google session whose account can be identified; "not connected" means there is no such session (the user is signed out, or the session cookie has expired). Both signed-out and expired sessions present identically and are treated as the single not-connected state.

The connected account is whichever Google account is the browser's primary session (account index `u/0`). The account's email is read from the same authenticated page load that the events come from, so the email and the session can never drift apart: they originate from one request. The events request and the account-identification request are pinned to the same account index so they always describe the same account. Reading a different account, account pickers, and non-Google providers are intentionally deferred.

Connecting is therefore not a credential prompt but an instruction: when not connected, the extension offers to open Google Calendar in a new tab so the user can sign in there. Once signed in, the session cookie is live and the next sync (on the periodic schedule, or when the popup reopens) detects the account and shows meetings. There is nothing to revoke; "disconnecting" is not offered because the extension holds no grant of its own — signing out of Google in the browser is what ends access.

Because the session can expire at any time, a previously connected extension can silently become not-connected. The extension detects this on its next sync (the identifying request no longer yields an account) and flips to the not-connected state, surfacing the same "open Google Calendar" action so the user can re-establish the session. The user must always be able to tell whether the extension is connected and as which account.

## Data Model And Sync

The service worker owns all calendar data and badge state so the badge stays trustworthy even while the popup is closed. This is the only architecture that keeps the reminder badge correct without depending on the user opening the popup.

When the feature is disabled (see Options), the service worker performs no calendar syncing and keeps the badge cleared.

While enabled, the service worker fetches today's events on a periodic schedule, normalizes them, and caches them in extension storage together with a last-synced timestamp, the connected account's email, and a sync state (connected, not connected, or error). Each sync first identifies the current session account (reading the email from an authenticated page load); if no account can be identified, the sync stops early in the not-connected state without disturbing cached meetings. When an account is identified, the worker fetches that account's events for today. It also refetches when the popup opens, so the user sees fresh data when they look.

A transient fetch failure (offline, server error) is not destructive: the last good set of cached meetings is retained and continues to drive both the badge and the popup, and only the sync state flips to error. This is essential to the badge's core promise — a single failed background fetch must not make an imminent meeting's badge disappear or blank the popup's cached list. Cached meetings are only cleared when the feature is disabled. A not-connected result (session expired or signed out) is distinct from a transient error and is surfaced as such, but it likewise preserves the last cached meetings so a brief session lapse does not blank the popup.

Calendar syncs are coalesced into a single in-flight operation. Multiple triggers (the periodic alarm, a popup-open refresh, and a settings change) can fire close together; without coalescing, a slow failing sync could overwrite the result of a newer successful one. Overlapping triggers therefore share one in-flight sync rather than racing on the cache.

Only events that represent real, time-bound commitments are kept: all-day events are excluded because they have no specific start to remind on, and non-meeting calendar entries (working-location, focus-time, and out-of-office blocks) are excluded because they are not meetings to join or be reminded of. Which response statuses are kept is user-configurable (see Options): the default keeps everything except meetings the user has explicitly declined, while the alternative keeps every event regardless of response. In both modes all-day events are still excluded. Events the user has not responded to (no RSVP yet) are treated like tentative and kept in the default mode — only an explicit decline removes a meeting in the default mode. Only the primary calendar is consulted. This is a deliberate, known limitation: meetings that live only on a shared, team, or other secondary calendar will not appear or drive the badge. A calendar picker was considered and deferred to keep the first version simple; adding one later means letting the user select calendars and fetching and merging events per selected calendar.

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

The meeting section lists today's meetings that have not yet ended, split into two visually separated groups: meetings **in progress** and **upcoming** meetings. The section scrolls when there are many meetings. A meeting stays listed until its end time has passed, then it drops out. Each meeting shows its title and its start and end times in the user's locale format. A meeting shows a **Join** button only when a join link can be resolved for it; meetings without one show no Join button. Activating Join opens the resolved URL in a new browser tab, which works uniformly whether the link is Google Meet, Zoom, Microsoft Teams, or another provider.

The footer sits outside the meeting section and contains a Settings control that opens the extension's options page.

Both the popup and the options page use a dark theme by default, reusing the existing Kool Kits palette and typography already established by the recent tab switcher (a dark panel background, off-white text, and the yellow accent, with `color-scheme: dark` and the Inter font stack). The yellow accent marks primary actions such as Connect and the enabled toggle; the meeting urgency cues (badge and any in-progress emphasis) stay red so urgency reads distinctly from the brand accent. Keeping these surfaces on the same palette makes the new feature feel native to the extension rather than introducing a second visual language.

The popup renders one of several states:

- **Disabled:** when the feature is turned off in options, the popup omits the meeting section entirely and shows only the footer with the Settings control.
- **Not connected:** a primary action that opens Google Calendar in a new tab so the user can sign in, with a brief line explaining that the extension reads meetings from the signed-in Google session. This single state covers both never-connected and an expired or signed-out session, since they are indistinguishable and resolved the same way. It is an instruction to sign in elsewhere, not a login form or a consent button.
- **Loading:** shown only when there is no cached data yet, so a returning user with cached meetings never sees a spinner.
- **Empty:** when connected with no qualifying meetings remaining today, the section shows an empty state reading `No meeting`.
- **List:** the in-progress and upcoming groups described above. Whenever cached meetings exist they are shown, even if the most recent fetch failed transiently, so a popup opened while briefly offline keeps showing the last known meetings rather than collapsing to an error. A dedicated fetch-error message is shown only when the fetch failed and there are no cached meetings to fall back on.

## Join Link Resolution

A meeting's join link (the "video call" link, named for the user-facing Join action — not video content) is resolved in priority order: first a direct provider link when present, then a video entry point from the event's structured conferencing data, then a scan of the event description and location for recognizable meeting URLs (Google Meet, Zoom, Microsoft Teams). The first match wins. If nothing matches, the meeting has no Join button. Structured conferencing data is preferred over text scanning because it is unambiguous and provider-supplied, while description and location scanning is a best-effort fallback for events that only paste a link in. Non-video entry points (such as dial-in phone numbers) are never used for the Join action.

## Options

The options page opens in its own browser tab and contains a dedicated **Meeting Reminder** section so additional Kool Kits features can have their own sections later. The section contains:

- An **enable** switch that turns the whole feature on or off, rendered as a sliding toggle switch control (not a checkbox or radio). It is on by default. When off, the feature does no calendar syncing, clears the badge, and the popup omits the meeting section entirely (the footer and settings remain reachable). This lets the user keep the extension installed for other features without calendar access or a badge.
- A **lead time** control: a dropdown offering whole-minute values from 1 to 60, defaulting to 5. This determines how far before a meeting's start the badge begins counting down. A dropdown is used instead of a free-form number field to keep the value within a sensible range without validation.
- A **which meetings** control selecting whether the feature considers all meetings except those the user has explicitly declined (the default), or all events regardless of response (still excluding all-day). Not-yet-responded invites are treated like tentative and kept in the default mode; only an explicit decline hides a meeting there. This setting governs both the popup list and the badge, so a user who declines noise invites is not nagged by them while still seeing meetings they have not gotten around to answering.
- The **connection status**, including the email of the connected Google account when connected, so the user can confirm which calendar is being read. When not connected, the status offers the same open-Google-Calendar action as the popup. Connection status reflects whether a live Google session account can be identified, independent of whether the feature is enabled — so a user who has connected but turned the feature off still sees their connected account rather than being misled into thinking they must reconnect. There is no disconnect control, because the extension holds no grant to revoke; ending access means signing out of Google in the browser.

Settings persist in extension storage and are read by both the service worker (for badge timing) and the popup.

## Architecture

The feature is built in vanilla JavaScript with ES modules and message passing, matching the existing extension code.

- The service worker gains alarm-driven event fetching, frequent badge recomputation, message handling for the popup (read cached state, request refresh), and wiring of the toolbar action to a popup.
- A calendar session module owns reading the current session account from the authenticated Google Calendar page (identifying the account email and the web-client version the events endpoint expects) and fetching today's events from the web app's internal events endpoint using the browser's existing cookies. It also parses the endpoint's positional-array response into the internal meeting shape and reports the not-connected condition when no account can be identified.
- A meeting-reminder module holds the pure selection and badge-state logic (which meeting is most urgent, in-progress versus upcoming grouping, badge text for a given moment) so it can be unit-tested without Chrome APIs.
- A join-link module holds the pure link-resolution logic.
- The popup and options page each have their own HTML, script, and styles.

Pure logic is deliberately separated from Chrome API and network calls so the time-sensitive, response-parsing, and provider-parsing behavior can be tested deterministically. In particular, the response parser and the account/version extraction are pure functions over captured response text, so they can be tested against fixtures without a live session.

Because the service worker is ephemeral, it holds no authoritative state in memory: there is no token to hold, all meeting data, the connected email, and sync state live in extension storage, and the periodic alarms (which persist across worker teardown) revive the worker to do their work. The worker serializes its sync operation behind a single in-flight promise so overlapping triggers neither duplicate network fetches nor clobber a newer result with an older one. To recover promptly from a session that was just established, the worker also watches for the user landing on or finishing a load of the Google Calendar site and triggers a sync then, so signing in to Calendar re-detects the account without waiting for the next periodic alarm.

## Permissions

The extension requests the additional capabilities needed to: schedule background alarms, reach the Google Calendar web host (to read events using the existing browser session) and observe navigation to that host (to re-detect a freshly established session). No OAuth client, scope, or identity permission is declared, because the feature does not use Chrome's identity flow. The toolbar action gains a default popup and the manifest declares an options page.

## Testing

Following the existing test style, the pure modules are unit-tested:

- The meeting-reminder module: badge states across time (no badge, countdown, `now`), most-urgent selection for concurrent and back-to-back meetings, in-progress versus upcoming grouping, and boundary conditions at start and end times.
- The join-link module: resolution for each supported provider via structured data, direct link, and text fallback, plus the no-link case.
- The calendar session module's pure parts, against captured response fixtures: normalizing the positional-array response into meetings (title, start, end, video link), excluding all-day and declined events, extracting the account email and web-client version from a captured page, and detecting the not-connected condition (no identifiable account).

## Acceptance Criteria

- The popup and options page render in the Kool Kits dark theme by default, consistent with the recent tab switcher's palette and typography.
- A connected user sees today's not-yet-ended meetings in the popup, grouped into in-progress and upcoming with clear visual separation.
- A meeting remains listed until its end time passes, then disappears.
- Each meeting shows start and end times in the user's locale; only meetings with a resolvable video link show a Join button, and Join opens that link in a new tab.
- The badge is absent until a meeting is within the configured lead time, then shows a red countdown, then `now` while a meeting is in progress with nothing imminent, then clears.
- For concurrent or back-to-back meetings, the badge reflects the soonest upcoming start within the lead window.
- The badge stays correct over time without the popup being opened.
- All-day events never appear and never drive the badge. By default, only explicitly declined events are also excluded (not-yet-responded and tentative are kept); switching the "which meetings" setting to all events includes declined ones too (all-day still excluded).
- A user who is not connected (never signed in, or session expired/signed out) sees a single action that opens Google Calendar so they can sign in; once signed in, the extension re-detects the session and shows meetings without further interaction. A connected user with nothing today sees `No meeting`.
- The options page has a Meeting Reminder section with an enable switch (on by default), a 1–60 minute lead-time dropdown (default 5), a "which meetings" control (accepted/tentative by default, or all events), and a connection status that shows the connected account's email (or an open-Google-Calendar action when not connected), and changes take effect for the popup list and badge timing.
- Turning the feature off clears the badge, stops calendar syncing, and removes the meeting section from the popup while leaving the footer and settings reachable; turning it back on resumes syncing and the badge.

## Out Of Scope

- Desktop or system notifications beyond the toolbar badge.
- Multiple calendars, account pickers, and non-Google providers.
- Editing, creating, or responding to events.
- Syncing settings across devices.
- Supporting non-Chrome browsers.
