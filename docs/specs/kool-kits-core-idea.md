# Kool Kits Core Idea

## Scope

Kool Kits is a Chrome Manifest V3 extension for small browser workflow upgrades. Chrome remains the base browser; Kool Kits adds focused behaviors that make repeated browsing actions faster, clearer, or more pleasant.

Arc and other browsers can inspire features, but Kool Kits is not limited to Arc parity or shortcut cloning.

## Feature Specs

- [Copy Current URL](copy-current-url.md) defines the first shipped workflow: a keyboard command that copies the active tab URL and shows lightweight feedback when possible.
- [Recent Tab Switcher](recent-tab-switcher.md) defines a future workflow for cycling through recently active tabs with a visible switcher while holding the modifier key.
- [Meeting Reminder](meeting-reminder.md) defines a workflow that surfaces today's Google Calendar meetings in the toolbar action, with a red urgency badge and a popup to see and join in-progress and upcoming meetings.

## Product Principles

- Prefer small workflow improvements over broad browser replacement features.
- Keep each feature independently understandable, testable, and releasable.
- Treat Arc and other browsers as inspiration, not as strict compatibility targets.
- Let the configured Chrome extension command or browser API own the action when page scripts would be less reliable.
- Use best-effort UI feedback when it improves confidence, but do not let feedback failures block the primary action.
