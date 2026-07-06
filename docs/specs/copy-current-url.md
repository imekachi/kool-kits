# Copy Current URL

## Goal

Copy the active tab's current URL from a keyboard command and show lightweight toolbar feedback without requesting page access for this feature.

## Behavior

Pressing the configured copy-current-URL shortcut copies the active tab's current URL whenever Chrome exposes one to the extension. Chrome should expose the command through its extension shortcut settings so the user can remap it.

When Chrome delivers the configured command and exposes an active tab URL, the extension:

1. Handles the configured copy-current-URL command.
2. Reads the active tab's current URL from Chrome tab state.
3. Writes that URL to the clipboard.
4. Shows short toolbar badge feedback.

The copy action and its feedback do not depend on page injection. Chrome-internal pages, Chrome Web Store pages, extension pages, and ordinary websites should behave the same way when Chrome exposes their URL and delivers the command.

The extension shows short toolbar badge feedback instead of in-page UI or system notifications:

- Successful copy shows a check mark with a green badge background.
- Clipboard failure shows `ERR` with a red badge background.
- The badge clears after a short timeout.
  If a meeting reminder badge should be visible, the extension restores that badge after the copy badge clears instead of leaving the toolbar blank.

If Chrome does not expose a usable active tab URL, the command is silently ignored. If clipboard writing fails after the command is accepted, the extension should show the `ERR` toolbar badge.

## Architecture

The copy shortcut is handled by the extension's Manifest V3 background service worker. Keeping shortcut handling in the service worker makes the command independent of the active website's JavaScript runtime.

The service worker is responsible for:

- Receiving the copy-current-URL command.
- Finding the active tab in the focused Chrome window.
- Ignoring only tabs without a usable URL.
- Coordinating the clipboard write.
- Showing toolbar badge feedback after the clipboard write succeeds or fails.

Clipboard writing is delegated to an offscreen extension document. Manifest V3 service workers do not have DOM access, and clipboard writes are more reliable from an extension document context than from arbitrary web pages. The offscreen document receives the URL from the service worker, writes it to the clipboard, reports success or failure, and can then be closed or reused.

Toolbar badge feedback reuses the extension action badge API already used by meeting reminders. Copy feedback is temporary and must not permanently replace an active meeting badge. The same temporary badge helper also confirms a successful Calendar connect after sign-in. Copy-current-URL intentionally avoids in-page toasts and content-script injection so it does not need `activeTab` or broad host access for feedback. This keeps the permission surface tied to reading the tab URL and writing to the clipboard.

## Permissions And Chrome Shortcut Settings

The extension should request the permissions needed to:

- Register a keyboard command.
- Read the active tab's URL.
- Write to the clipboard through an extension-controlled context.

The manifest should suggest `Command+Shift+C` as the macOS shortcut for the copy-current-URL command. The command must remain visible in Chrome's extension shortcut settings so the user can remap it.

Chrome also uses `Command+Shift+C` for DevTools Inspect Element. The user has verified that a third-party extension can claim this shortcut and suppress Chrome's default behavior, but official Chrome documentation does not guarantee that extension commands always override Chrome or operating-system shortcuts. Because the exact shortcut matters, shortcut ownership is an explicit acceptance test rather than a reason to choose a different default.

## Acceptance Criteria

- A fresh install exposes the copy-current-URL command in Chrome extension shortcut settings.
- `Command+Shift+C` is suggested as the default macOS shortcut.
- Pressing the configured shortcut copies the exact current tab URL whenever Chrome exposes that URL to the extension.
- Normal and restricted pages use toolbar badge feedback only; no in-page notification or content-script injection is used for copy-current-URL feedback.
- Successful copies show a check-mark toolbar badge.
- Clipboard failures show `ERR` toolbar badge feedback.
- Copy toolbar badge feedback clears after a short timeout and restores any meeting reminder badge that should be visible.
- The command can be remapped through Chrome's extension shortcut settings.
- Pages without a usable tab URL are silently ignored with no clipboard write and no feedback UI.
- Shortcut behavior is tested with DevTools closed, open, focused, and undocked.

## Out Of Scope

- Designing or implementing the recent active tab switcher.
- Syncing settings across devices.
- In-page notification or toast feedback for copy-current-URL.
- Customizing badge text, color, or duration.
- System notification feedback for copy-current-URL.
- Supporting non-Chrome browsers.
