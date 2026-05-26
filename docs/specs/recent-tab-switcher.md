# Recent Tab Switcher

## Goal

Move through tabs by activation history instead of tab-strip position.

## Behavior

`Control+Tab` moves backward through tab activation history, and `Shift+Control+Tab` moves forward. Holding `Control` shows a horizontal switcher with thumbnails and tab titles. Pressing `Tab` while holding `Control` cycles through the switcher items, wrapping after the last item. Releasing `Control` activates the selected tab.

The switcher shows a bounded list of recent tabs. The list is ordered by recent activation rather than by the tab strip. The currently active tab anchors the interaction, and the first cycle should move to the most recent previously active tab.

## Design Constraints

- Activation history should be independent of tab-strip order.
- The switcher UI should make the selected tab visible while the modifier key is held.
- Final tab activation should happen when the modifier key is released.
- The implementation must account for Chrome pages, discarded tabs, windows, and tab groups.
- The shortcut model must be verified against Chrome extension command limitations before implementation.

## Acceptance Criteria

- Cycling order follows tab activation history.
- `Control+Tab` and `Shift+Control+Tab` move in opposite directions through that history.
- Cycling wraps after the last visible switcher item.
- The switcher shows the current selection while the modifier key is held.
- Releasing the modifier key activates the selected tab.

## Out Of Scope

- Implementing the switcher as part of the copy-current-URL milestone.
- Replacing Chrome's full tab management UI.
- Designing settings, sync, or user customization for the switcher.
- Supporting non-Chrome browsers.
