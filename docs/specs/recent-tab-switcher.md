# Recent Tab Switcher

## Goal

Move through Chrome tabs by recent activation history instead of tab-strip position, with an Arc-inspired visual switcher that makes the current selection clear while the modifier key is held.

## Behavior

The switcher keeps a separate recent-tab history for each Chrome window. When the user starts switching in a focused window, the switcher shows only that window's recent tabs. Switching to another Chrome window changes the relevant history context to that window.

The active tab is always the first item in its window's history. The switcher shows a bounded list of up to six recent tabs total, including the active tab. New tabs enter the front of the history as soon as Chrome activates them.

Starting the switcher selects the second item, which is the most recently active previous tab. While the modifier key remains held, pressing `Tab` moves through the visible recent list and `Shift+Tab` moves in the opposite direction. Cycling wraps at the ends. The user can cycle back to the first item, which is already active.

Releasing the modifier key always commits the current selection. If the selected item is the already-active tab, releasing the modifier only hides the switcher. The design intentionally does not include an `Escape` cancel path.

## Shortcut Model

The feature should be exposed as a normal Chrome extension command so users can remap it through Chrome's extension shortcut settings. The feature should not require any specific keybinding to work.

Chrome's normal shortcut UI does not allow direct `Ctrl+Tab` assignment. The product should include an optional setup tip for advanced users who want to bind the command to `Ctrl+Tab` through Chrome's developer-private shortcut workaround. This is documented as optional setup, not as a runtime dependency, because keeping the command remappable lets users choose any shortcut they prefer.

The optional setup tip should tell users to copy the loaded Kool Kits extension ID from `chrome://extensions`, open `chrome://extensions/shortcuts`, open DevTools for that page, and run Chrome's private shortcut updater for the `recent-tab-switcher` command:

```js
chrome.developerPrivate.updateExtensionCommand({
  extensionId: "PASTE_KOOL_KITS_EXTENSION_ID",
  commandName: "recent-tab-switcher",
  keybinding: "Ctrl+Tab"
});
```

Reverse cycling uses the same private updater:

```js
chrome.developerPrivate.updateExtensionCommand({
  extensionId: "PASTE_KOOL_KITS_EXTENSION_ID",
  commandName: "recent-tab-switcher-previous",
  keybinding: "Ctrl+Shift+Tab"
});
```

This workaround is intentionally documented as unsupported Chrome internals because it may need to be repeated after reinstalling the extension, changing Chrome profiles, or other events that change the extension ID or shortcut state.

## Architecture

The Manifest V3 background service worker owns recent-tab state. It updates per-window histories from Chrome tab and window lifecycle events, deduplicates entries by tab ID, keeps the active tab first, and removes stale entries as Chrome state changes.

The switcher UI should be extension-owned rather than injected into the active page. This allows the switcher to appear consistently across ordinary websites, Chrome pages, discarded tabs, and pages where content-script injection is restricted. The switcher receives the focused window's recent list from the background worker, manages selection while the modifier key is held, and asks the background worker to activate the selected tab on release.

When a tab closes, its tab ID is removed from its window's history. When a window closes, that window's history is removed. Before rendering, the switcher should reconcile history with current Chrome tab state and drop entries that no longer exist. This prevents closed or stale tabs from appearing.

The background worker also owns screenshot thumbnail state. Thumbnail entries are tied to the same tab identity and recent-history lifetime as the switcher list, so removing or evicting a tab from history also removes its thumbnail. The switcher receives an optional thumbnail URL with each tab item and renders the existing preview fallback when no thumbnail is available.

Screenshot capture follows a hybrid refresh model. Each tab activation should refresh thumbnails for both sides of the switch: the tab being left and the tab becoming active. Chrome can only photograph the currently visible tab, so the background worker keeps the last successful visible capture per window and commits that image to the outgoing tab when a new tab activates. The incoming tab is captured immediately and again after a short paint delay. Activation-triggered delays must survive service worker suspension, so delayed incoming-tab captures use one-shot alarms rather than in-memory timers. Capture work should flow through one global scheduler that skips capture calls for tabs that are no longer active and spaces real captures so rapid tab cycling or multiple windows do not overwhelm Chrome's capture limits. When the switcher opens, it should refresh the currently visible source tab before creating the switcher popup, try that refresh without waiting behind rate-limit backoff or older activation captures, and preserve any still-pending activation capture for a different recent tab instead of dropping it. Cached thumbnails cover the remaining recent tabs. This keeps the current tab fresh when possible without making switcher open depend on recapturing every tab.

Capture results should only be saved after confirming they still belong to the requested active tab, unchanged active-tab generation, and unchanged navigation generation. This prevents rapid tab switches, tab closes, switch-away-and-back races, or same-tab navigation races from attaching one page's screenshot to another page's history entry.

Navigation invalidates a tab's previous thumbnail because an old page image should not represent a new page. A later successful capture can refill the thumbnail while the same tab remains in recent history.

## UI And Visual Style

The switcher should feel like a lightweight browser overlay: centered, dark, rounded, and horizontal. It should show up to six tab cards. Each card contains a stable preview area plus favicon and truncated title. The selected card must be visually obvious.

The switcher window should size to the rendered tab cards instead of always reserving room for the maximum list. The browser window should hug the rendered panel so there is no separate outer gutter between the window edge and the UI; internal panel and card spacing provide the visual breathing room. The window background should match the panel background, and the panel should avoid a separate border so the popup reads as one compact surface.

The visual language should build from the Kool Kits logo palette:

- Deep navy: `#1d1b3a`
- Warm off-white: `#fffaf0`
- Yellow accent: `#ffd23f`

The selected state should use the yellow accent or a compatible derived tone rather than assuming the browser's theme color. The UI may expand the palette with darker and lighter tones when needed, while staying aligned with the logo.

Screenshot previews are required for launch. The extension should capture and cache a compact preview when a tab is visible, keep that preview only while the tab remains part of recent history, then render that image in the card's thumbnail area when available. If a screenshot is unavailable, stale, too large to store safely, or cannot be captured for a given tab, the card renders a black preview fallback in the same thumbnail area. Favicon, title, and domain metadata should still be shown when Chrome exposes them.

Grouped tabs remain in the same recent-history order as ordinary tabs. If group metadata is available, the UI may show a subtle group cue, but tab groups should not change ordering or selection behavior.

## Error Handling

The primary action is selecting a tab. Preview capture or rendering failures must not block selection. Missing screenshots use the black fallback, and missing metadata should degrade to the best available tab label.

Thumbnail storage should be session-scoped rather than persisted across browser or extension restarts. Stored previews should be downscaled or otherwise bounded before session storage so they do not retain full-page screenshots or exceed extension storage limits. If storage quota or capture rate limits are reached, the switcher should prefer dropping thumbnails over blocking tab selection.

If the selected tab no longer exists when the modifier key is released, the switcher should hide without activating a stale tab. If the recent list has only the active tab, the command should do nothing visible or close immediately.

## Acceptance Criteria

- Recent-tab history is tracked independently per Chrome window.
- The active tab is always first in its window's history.
- The visible switcher list contains up to six tabs total, including the active tab.
- Closed tabs are removed from history and never appear in the switcher.
- Closed windows have their histories removed.
- Starting the switcher selects the most recently active previous tab when one exists.
- `Tab` and `Shift+Tab` move in opposite directions through the visible recent list.
- Cycling wraps after the first or last visible item.
- Releasing the modifier key activates the selected tab, unless it is already active.
- The switcher appears as extension-owned UI instead of relying on page injection.
- Screenshot previews are captured and shown for eligible tabs before launch.
- Tabs without screenshots show a black preview fallback.
- The current visible tab is refreshed when the switcher opens.
- Recently activated tabs keep thumbnails while their history entries remain alive.
- Thumbnails are removed when bounded recent-history eviction removes their tab entries.
- Navigating a tab invalidates its previous thumbnail until a fresh capture succeeds.
- Removing a tab or window from recent history removes its thumbnail.
- Rapid tab switching, capture rate limits, storage quota limits, and capture/tab races fall back to missing thumbnails rather than stale or incorrect images.
- Chrome pages, discarded tabs, tab groups, and pages with unavailable previews are handled without blocking switching.
- The extension command remains remappable, with optional documentation for users who want to bind it to `Ctrl+Tab`.

## Rationale

Per-window history avoids surprising focus jumps across Chrome windows and matches the expectation that each window has its own recent-tab context. Including the active tab as the first item makes reverse cycling intuitive and lets the user return to the current tab before release.

An extension-owned switcher is preferred over an in-page overlay because the switcher must appear regardless of the current page's injection permissions. Screenshot previews are part of the launch experience because the switcher needs visual recognition, while the black fallback keeps switching reliable on pages where Chrome cannot provide a usable thumbnail. Tying thumbnails to recent-history lifetime keeps the behavior predictable, and bounding stored previews reduces privacy and quota risk from retaining full-resolution page images.

Keeping `Ctrl+Tab` as an optional setup tip preserves the desired workflow for advanced users while keeping the extension command valid and remappable for normal Chrome installs.

Sizing the popup from the rendered content reduces empty space when only a few recent tabs are available while keeping the full-list presentation compact. Removing the outer gutter and using the panel color as the window background avoids a visible nested-container effect. Basing the final resize on the UI's rendered layout keeps the window aligned with what the user actually sees.

## Out Of Scope

- Implementing the switcher as part of the copy-current-URL milestone.
- Replacing Chrome's full tab management UI.
- Designing settings, sync, or user customization for the switcher.
- Supporting non-Chrome browsers.
