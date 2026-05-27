# Recent Tab Switcher Shortcuts

The recent tab switcher is exposed as normal Chrome extension commands. You can assign any shortcut Chrome accepts from `chrome://extensions/shortcuts`.

## Standard Setup

1. Open `chrome://extensions/shortcuts`.
2. Find Kool Kits.
3. Assign shortcuts to **Show recent tab switcher** and **Move recent tab switcher selection backward**.
4. Use the first shortcut to open and advance the switcher.
5. Use the second shortcut to move backward while the switcher is open.

## Optional Ctrl+Tab Setup

Chrome's shortcut settings UI does not normally accept `Ctrl+Tab` or `Ctrl+Shift+Tab`, but advanced users can force those bindings from DevTools on the shortcuts page.

1. Open `chrome://extensions` and copy the Kool Kits extension ID.
2. Open `chrome://extensions/shortcuts`.
3. Open DevTools for the shortcuts page.
4. Run this snippet after replacing `PASTE_KOOL_KITS_EXTENSION_ID`:

   ```javascript
   const extensionId = 'PASTE_KOOL_KITS_EXTENSION_ID'

   chrome.developerPrivate.getExtensionInfo(extensionId, ({ commands }) => {
     for (const { commandName, keybinding } of [
       { commandName: 'recent-tab-switcher', keybinding: 'Ctrl+Tab' },
       {
         commandName: 'recent-tab-switcher-previous',
         keybinding: 'Ctrl+Shift+Tab',
       },
     ]) {
       const command = commands.find(({ name }) => name === commandName)
       if (!command) {
         throw new Error(`${commandName} command not found`)
       }

       chrome.developerPrivate.updateExtensionCommand({
         commandName: command.name,
         extensionId,
         keybinding,
       })
     }
   })
   ```

5. Confirm that the shortcut rows now show `Ctrl+Tab` and `Ctrl+Shift+Tab`.

This workaround uses a private Chrome API from the shortcuts page. It may change between Chrome versions. If it stops working, assign normal supported shortcuts instead.
