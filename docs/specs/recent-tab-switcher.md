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
  extensionId: 'PASTE_KOOL_KITS_EXTENSION_ID',
  commandName: 'recent-tab-switcher',
  keybinding: 'Ctrl+Tab',
})
```

Reverse cycling uses the same private updater:

```js
chrome.developerPrivate.updateExtensionCommand({
  extensionId: 'PASTE_KOOL_KITS_EXTENSION_ID',
  commandName: 'recent-tab-switcher-previous',
  keybinding: 'Ctrl+Shift+Tab',
})
```

This workaround is intentionally documented as unsupported Chrome internals because it may need to be repeated after reinstalling the extension, changing Chrome profiles, or other events that change the extension ID or shortcut state.

## Architecture

The Manifest V3 background service worker owns recent-tab state. It updates per-window histories from Chrome tab and window lifecycle events, deduplicates entries by tab ID, keeps the active tab first, and removes stale entries as Chrome state changes.

The switcher UI should be extension-owned rather than injected into the active page. This allows the switcher to appear consistently across ordinary websites, Chrome pages, discarded tabs, and pages where content-script injection is restricted. The switcher receives the focused window's recent list from the background worker, manages selection while the modifier key is held, and asks the background worker to activate the selected tab on release.

When a tab closes, its tab ID is removed from its window's history. When a window closes, that window's history is removed. Before rendering, the switcher should reconcile history with current Chrome tab state and drop entries that no longer exist. This prevents closed or stale tabs from appearing.

The switcher does not capture page screenshots. Tab previews use a stable black preview area with the site favicon centered inside it. The extension requests the `favicon` permission so it can resolve icons through Chrome's favicon API when a tab does not already expose `favIconUrl`. It does not request broad host access for `captureVisibleTab`.

## UI And Visual Style

The switcher should feel like a lightweight browser overlay: centered, dark, rounded, and horizontal. It should show up to six tab cards. Each card contains a stable preview area with a centered favicon plus a truncated title beneath. The selected card must be visually obvious.

The switcher window should size to the rendered tab cards instead of always reserving room for the maximum list. The browser window should hug the rendered panel so there is no separate outer gutter between the window edge and the UI; internal panel and card spacing provide the visual breathing room. The window background should match the panel background, and the panel should avoid a separate border so the popup reads as one compact surface.

The visual language should build from the Kool Kits logo palette:

- Deep navy: `#1d1b3a`
- Warm off-white: `#fffaf0`
- Yellow accent: `#ffd23f`

The selected state should use the yellow accent or a compatible derived tone rather than assuming the browser's theme color. The UI may expand the palette with darker and lighter tones when needed, while staying aligned with the logo.

Each card's preview area stays black for recent tabs. The current active tab, always shown first, uses the same overall contrast as black with a subtle connected-green tint (the same semantic green as the online dot) and a faint green inset ring, but only while another card carries the keyboard selection. When the active tab itself is selected, the green active preview styling yields to the yellow selection state. When a favicon is available, it is centered in that area at a size proportional to the preview box. When Chrome does not expose a favicon or the favicon image fails to load, the preview shows Chrome's default favicon globe rather than a broken image. Title metadata should still be shown when Chrome exposes it.

Grouped tabs remain in the same recent-history order as ordinary tabs. If group metadata is available, the UI may show a subtle group cue, but tab groups should not change ordering or selection behavior.

## Error Handling

The primary action is selecting a tab. Missing favicons or titles must not block selection. Missing metadata should degrade to the best available tab label.

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
- Each card shows a black preview area with a centered favicon when one is available, or Chrome's default favicon globe when the favicon is missing or cannot load.
- The current active tab preview is subtly highlighted so it stays distinguishable from other recent tabs.
- Chrome pages, discarded tabs, tab groups, and tabs with missing favicons are handled without blocking switching.
- The extension command remains remappable, with optional documentation for users who want to bind it to `Ctrl+Tab`.

## Rationale

Per-window history avoids surprising focus jumps across Chrome windows and matches the expectation that each window has its own recent-tab context. Including the active tab as the first item makes reverse cycling intuitive and lets the user return to the current tab before release.

An extension-owned switcher is preferred over an in-page overlay because the switcher must appear regardless of the current page's injection permissions. Centered favicons inside a stable preview area give enough visual recognition without requiring broad host permissions for page screenshots. Falling back to Chrome's default favicon globe keeps tabs with missing or unreachable favicon resources visually consistent with Chrome and avoids exposing browser broken-image chrome inside the switcher.

Keeping `Ctrl+Tab` as an optional setup tip preserves the desired workflow for advanced users while keeping the extension command valid and remappable for normal Chrome installs.

Sizing the popup from the rendered content reduces empty space when only a few recent tabs are available while keeping the full-list presentation compact. Removing the outer gutter and using the panel color as the window background avoids a visible nested-container effect. Basing the final resize on the UI's rendered layout keeps the window aligned with what the user actually sees.

## Out Of Scope

- Replacing Chrome's full tab management UI.
- Designing settings, sync, or user customization for the switcher.
- Supporting non-Chrome browsers.
