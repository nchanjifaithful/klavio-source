# Manual test checklist

Automated tests: `npm test` (unit) and `npm run test:e2e` (Playwright). The items below need a real Chrome.

## Chrome-level shortcuts
- [ ] `chrome://extensions/shortcuts` lists every Klavio action plus Custom action slots 1–10.
- [ ] Alt+Shift+P, Q, C and S are bound by default. If one shows as unbound, another extension took it first.
- [ ] Bind a key to "Duplicate tab" there, then press it on `chrome://settings`. The tab duplicates.
- [ ] Settings → Shortcuts shows the new key in the "Chrome-level key" column after you return to the tab.

## Restricted pages (`chrome://settings`, New Tab, Chrome Web Store, PDF viewer)
- [ ] Alt+Shift+P opens the palette in the toolbar popup (or a popup window).
- [ ] Alt+Shift+Q shows the QR code in the popup.
- [ ] Alt+Shift+C copies the URL (offscreen fallback) and shows a ✓ badge.
- [ ] Pin, mute and duplicate work from the palette.
- [ ] Print shows "Not available on this page".
- [ ] Close others with more than 5 tabs asks for confirmation in a popup window.

## Normal pages
- [ ] Alt+Shift+Q shows a scannable QR within ~300 ms. Copy image and Download PNG both work.
- [ ] A very long URL (over 3,000 characters) shows the "too long" error and a "QR the origin only" button.
- [ ] Alt+Shift+S shows the screenshot preview with Copy and Download, and the image doesn't include the palette.
- [ ] In-page keys are ignored inside inputs unless the combo has Ctrl or Alt.
- [ ] Remapping a key in Settings applies to an already-open tab without a reload.
- [ ] "Disable on this site" in the popup turns in-page keys off for that site only.

## Permissions
- [ ] A fresh install asks only for the core permissions.
- [ ] The first "Save page as MHTML" asks for Downloads and Page capture, then saves the file.
- [ ] The first "Add tab to new group" asks for Tab groups.

## Custom actions
- [ ] Create one action of each type, give it a key, run it, export it, delete it and import it again.
- [ ] Assign a custom action to slot 1, bind the slot at `chrome://extensions/shortcuts`, and run it on `chrome://settings`. (Page-level types will report "Not available".)
- [ ] Run JavaScript shows the "Allow User Scripts" hint until that toggle is on.
- [ ] Importing a pack with JS or a webhook shows the code or URL and asks before saving.

## Network
- [ ] DevTools (service worker and pages): no requests other than user webhooks and pages you open.
