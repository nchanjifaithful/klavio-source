# Klavio

Keyboard shortcuts and a command palette for Chrome (Manifest V3). It gives you keys for the things you'd normally click through Chrome's menus for (QR code, copy URL, screenshot, pin/mute/duplicate tab and more), plus your own custom actions.

Chrome has no API for pressing its own menu items, so Klavio rebuilds each action with extension APIs and bundled code. QR codes come from a bundled library, and nothing is sent over the network except webhooks you set up yourself.

## Install (unpacked)

```sh
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Optional: bind more Chrome-level keys at `chrome://extensions/shortcuts`.

## Default keys

| Key | Action | Layer |
| --- | --- | --- |
| Alt+Shift+P | Command palette | Chrome (works on every page) |
| Alt+Shift+Q | QR code for this page | Chrome |
| Alt+Shift+C | Copy page URL | Chrome |
| Alt+Shift+S | Screenshot visible area | Chrome |
| Alt+Shift+M | Copy as Markdown link | in-page |
| Alt+Shift+R | Hard reload | in-page |
| Alt+Shift+= / - / 0 | Zoom in / out / reset | in-page |
| Alt+Shift+D / I / U / N / O / G / L | Duplicate / pin / mute / new window / close others / group / reading list | in-page |

You can remap any of these in **Settings → Shortcuts**.

## How it works

- **Layer 1: `chrome.commands`.** Every action has a manifest command, and only 4 get suggested keys (Chrome's limit). These keys work everywhere, including `chrome://` pages. There are also 10 `custom.slotN` commands that give custom actions global keys.
- **Layer 2: in-page keys.** A 1.8 KB content script listens for `keydown` in the capture phase and matches it against a keymap the service worker compiles ahead of time. Keys are stored as `KeyboardEvent.code`, so AZERTY and other layouts behave the same. Changes apply to open tabs right away, with no reload.
- **UI on demand.** The palette, QR panel, screenshot panel, prompts and toasts live in `overlay.js` (11 KB, closed Shadow DOM). It is injected only the first time it's needed, and the QR renderer (`qr.js`) is injected only for QR codes. On restricted pages Klavio falls back to the toolbar popup or a small popup window.
- **Stateless service worker.** All state lives in `chrome.storage`, so a cold start behaves the same as a warm one.
- **Minimal permissions.** Optional permissions (downloads, tab groups, bookmarks, reading list, sessions, page capture, browsing data, management, user scripts, clipboard read) are requested the first time an action needs them.

## Custom actions

Settings → **Custom** builds actions of 14 types: open URL, protocol/app link, extension page, toggle extension, message an extension, search selection, copy template, inject CSS, click/fill element, run JavaScript (needs "Allow User Scripts"), tab set, go to tab, webhook and macro. Template variables: `{url} {urlEncoded} {title} {domain} {origin} {path} {selection} {clipboard} {date} {time} {prompt:Label}`. Each action can be limited to URL patterns, and the most specific pattern wins. Packs can be exported and imported as plain JSON, and imports that contain JS, webhooks or extension toggles ask you to confirm first.

## Recording an action

Press **Alt+Shift+K**, or click **● Record on a page** in Settings → Custom, and use the page as you normally would. Klavio records:

- clicks
- text you type (password fields become a `{prompt:Password}` step, so the password is never stored)
- dropdown choices
- Enter and Escape

A recording keeps going when a step loads a new page. Press **Stop & save**, name the action, then press a shortcut (for example Alt+Shift+1).

On replay, Klavio first opens the recorded page if you're on another site. It then waits up to 6 s for each element to appear, waits for page loads after steps that navigated, and submits forms on Enter. Elements are found by a stable selector (id, `data-testid`, `name`, `aria-label`, `href`), with the element's visible text as a fallback.

Steps are stored one JSON object per line, so you can edit them in Settings, for example replacing typed text with `{selection}` or `{prompt:Query}`.

Limits: recording covers the page's main frame only, not iframes or Chrome's own UI.

## Development

```sh
npm run watch      # rebuild on change, then reload the extension in chrome://extensions
npm run typecheck
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end (Playwright, loads dist/ into Chromium)
npm run zip        # dist + klavio-<version>.zip
```

`src/actions/meta.ts` is the single registry. The build generates `manifest.json` (including commands) from it, so adding an action means adding one entry there plus its `run` function.

## Unsupported in v1

- **Cast:** Chrome has no API for it.
- **Chrome's native Translate bar:** replaced by opening the page in Google Translate.
- **Chrome's native dialogs** (Save as, QR, Cast) can't be triggered, so each one is rebuilt instead.
