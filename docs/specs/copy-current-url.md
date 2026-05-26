# Copy Current URL

## Goal

Copy the active tab's current URL from a keyboard command and show lightweight page feedback when Chrome allows it.

## Behavior

Pressing the configured copy-current-URL shortcut copies the active tab's current URL whenever Chrome exposes one to the extension. Chrome should expose the command through its extension shortcut settings so the user can remap it.

When Chrome delivers the configured command and exposes an active tab URL, the extension:

1. Handles the configured copy-current-URL command.
2. Reads the active tab's current URL from Chrome tab state.
3. Writes that URL to the clipboard.
4. Attempts to show an in-page toast with the exact label `Copied Current URL`.

The copy action does not depend on page injection. Chrome-internal pages, Chrome Web Store pages, extension pages, and other pages that block content-script injection should still be copied when Chrome exposes their URL and delivers the command.

When the toast can be rendered, it appears at the top-right of the viewport, uses a cool green treatment with a visible green border for success, sizes to the confirmation text with balanced horizontal padding, animates in and out with vertical motion only, and auto-hides after a short delay. The normal path should not use system notifications or toolbar badge feedback.

If Chrome does not expose a usable active tab URL, the command is silently ignored. If the URL is copied but feedback UI cannot be rendered, the copy still succeeds silently. If clipboard writing fails after the command is accepted, the extension should show a short in-page failure toast when possible; if feedback UI cannot be rendered, the failure remains silent.

## Architecture

The copy shortcut is handled by the extension's Manifest V3 background service worker. Keeping shortcut handling in the service worker makes the command independent of the active website's JavaScript runtime.

The service worker is responsible for:

- Receiving the copy-current-URL command.
- Finding the active tab in the focused Chrome window.
- Ignoring only tabs without a usable URL.
- Coordinating the clipboard write.
- Asking the active tab to render feedback after the clipboard write succeeds or fails, when Chrome allows injection.

Clipboard writing is delegated to an offscreen extension document. Manifest V3 service workers do not have DOM access, and clipboard writes are more reliable from an extension document context than from arbitrary web pages. The offscreen document receives the URL from the service worker, writes it to the clipboard, reports success or failure, and can then be closed or reused.

Toast rendering is delegated to a content script injected into the active tab. The extension requests broad site access so this toast can render across ordinary websites and any other injectable pages. The content script owns only the page overlay behavior; it does not decide which URL to copy, and failure to inject it does not block copying.

## Permissions And Chrome Shortcut Settings

The extension should request the permissions needed to:

- Register a keyboard command.
- Read the active tab's URL.
- Write to the clipboard through an extension-controlled context.
- Inject toast feedback into ordinary websites.

The manifest should suggest `Command+Shift+C` as the macOS shortcut for the copy-current-URL command. The command must remain visible in Chrome's extension shortcut settings so the user can remap it.

Chrome also uses `Command+Shift+C` for DevTools Inspect Element. The user has verified that a third-party extension can claim this shortcut and suppress Chrome's default behavior, but official Chrome documentation does not guarantee that extension commands always override Chrome or operating-system shortcuts. Because the exact shortcut matters, shortcut ownership is an explicit acceptance test rather than a reason to choose a different default.

## Acceptance Criteria

- A fresh install exposes the copy-current-URL command in Chrome extension shortcut settings.
- `Command+Shift+C` is suggested as the default macOS shortcut.
- Pressing the configured shortcut copies the exact current tab URL whenever Chrome exposes that URL to the extension.
- Injectable pages show a green, bordered toast with the exact text `Copied Current URL` at the top-right of the page.
- The toast animates in and out and disappears automatically when it can be rendered.
- The command can be remapped through Chrome's extension shortcut settings.
- Non-injectable pages still copy when Chrome exposes the URL, with no toast and no fallback UI.
- Pages without a usable tab URL are silently ignored with no clipboard write and no fallback UI.
- Shortcut behavior is tested with DevTools closed, open, focused, and undocked.

## Out Of Scope

- Designing or implementing the recent active tab switcher.
- Syncing settings across devices.
- Customizing toast text, position, or duration.
- Adding toolbar badge, popup, or system notification feedback.
- Supporting non-Chrome browsers.
