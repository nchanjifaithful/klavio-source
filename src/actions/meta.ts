// Action metadata shared by every context (service worker, popup, options, overlay).
// Implementations live in ./tab.ts, ./page.ts, ./open.ts, ./data.ts and are joined in ./registry.ts.

export type Category = 'General' | 'Page' | 'Tab' | 'Open' | 'Data' | 'Custom';

export interface ActionMeta {
  id: string;
  title: string;
  category: Category;
  keywords?: string;
  /** Suggested chrome.commands key (max 4 in the manifest). */
  manifestKey?: string;
  /** Default in-page combo, stored as KeyboardEvent.code values, e.g. "Alt+Shift+KeyQ". */
  key?: string;
  /** Optional permissions requested on first use. */
  perms?: string[];
  /** Set when Chrome offers no API to rebuild the action. */
  unsupported?: string;
}

export const ACTIONS: ActionMeta[] = [
  { id: 'palette.open', title: 'Open command palette', category: 'General', keywords: 'commands search find run', manifestKey: 'Alt+Shift+P', key: 'Alt+Shift+KeyP' },
  { id: 'page.qr', title: 'Create QR code for this page', category: 'Page', keywords: 'qr code share phone scan', manifestKey: 'Alt+Shift+Q', key: 'Alt+Shift+KeyQ' },
  { id: 'page.copyUrl', title: 'Copy page URL', category: 'Page', keywords: 'link address clipboard', manifestKey: 'Alt+Shift+C', key: 'Alt+Shift+KeyC' },
  { id: 'page.screenshot', title: 'Screenshot visible area', category: 'Page', keywords: 'capture image snap picture', manifestKey: 'Alt+Shift+S', key: 'Alt+Shift+KeyS' },
  { id: 'page.copyTitleUrl', title: 'Copy as Markdown link', category: 'Page', keywords: 'title url markdown link clipboard', key: 'Alt+Shift+KeyM' },
  { id: 'page.print', title: 'Print', category: 'Page', keywords: 'printer pdf' },
  { id: 'page.reloadHard', title: 'Hard reload (bypass cache)', category: 'Page', keywords: 'refresh reload cache', key: 'Alt+Shift+KeyR' },
  { id: 'page.zoomIn', title: 'Zoom in', category: 'Page', keywords: 'bigger larger magnify', key: 'Alt+Shift+Equal' },
  { id: 'page.zoomOut', title: 'Zoom out', category: 'Page', keywords: 'smaller', key: 'Alt+Shift+Minus' },
  { id: 'page.zoomReset', title: 'Reset zoom', category: 'Page', keywords: 'zoom 100 actual size', key: 'Alt+Shift+Digit0' },
  { id: 'page.viewSource', title: 'View page source', category: 'Page', keywords: 'html code source' },
  { id: 'page.translate', title: 'Translate page (Google Translate)', category: 'Page', keywords: 'language translate' },
  { id: 'page.save', title: 'Save page as MHTML', category: 'Page', keywords: 'download archive offline save', perms: ['pageCapture', 'downloads'] },
  { id: 'page.cast', title: 'Cast', category: 'Page', keywords: 'chromecast tv', unsupported: 'Chrome has no API for Cast' },
  { id: 'tab.duplicate', title: 'Duplicate tab', category: 'Tab', keywords: 'copy clone', key: 'Alt+Shift+KeyD' },
  { id: 'tab.pin', title: 'Pin / unpin tab', category: 'Tab', keywords: 'pin', key: 'Alt+Shift+KeyI' },
  { id: 'tab.mute', title: 'Mute / unmute tab', category: 'Tab', keywords: 'sound audio silence', key: 'Alt+Shift+KeyU' },
  { id: 'tab.toNewWindow', title: 'Move tab to new window', category: 'Tab', keywords: 'detach pop out', key: 'Alt+Shift+KeyN' },
  { id: 'tab.closeOthers', title: 'Close other tabs', category: 'Tab', keywords: 'close others', key: 'Alt+Shift+KeyO' },
  { id: 'tab.closeRight', title: 'Close tabs to the right', category: 'Tab', keywords: 'close right' },
  { id: 'tab.group', title: 'Add tab to new group', category: 'Tab', keywords: 'group', key: 'Alt+Shift+KeyG', perms: ['tabGroups'] },
  { id: 'tab.discard', title: 'Free memory (discard background tabs)', category: 'Tab', keywords: 'discard sleep memory suspend' },
  { id: 'tab.reopenClosed', title: 'Reopen closed tab', category: 'Tab', keywords: 'restore undo closed', perms: ['sessions'] },
  { id: 'tab.bookmark', title: 'Bookmark page', category: 'Tab', keywords: 'bookmark favorite star', perms: ['bookmarks'] },
  { id: 'tab.readingList', title: 'Add to reading list', category: 'Tab', keywords: 'read later', key: 'Alt+Shift+KeyL', perms: ['readingList'] },
  { id: 'open.settings', title: 'Open Chrome settings', category: 'Open', keywords: 'preferences options' },
  { id: 'open.history', title: 'Open history', category: 'Open', keywords: 'history' },
  { id: 'open.downloads', title: 'Open downloads', category: 'Open', keywords: 'downloads files' },
  { id: 'open.extensions', title: 'Open extensions', category: 'Open', keywords: 'extensions addons plugins' },
  { id: 'open.passwords', title: 'Open password manager', category: 'Open', keywords: 'passwords credentials' },
  { id: 'open.shortcuts', title: 'Open Chrome extension shortcuts', category: 'Open', keywords: 'keyboard shortcuts commands bind' },
  { id: 'open.klavio', title: 'Open Klavio settings', category: 'Open', keywords: 'klavio options preferences keymap' },
  { id: 'data.clearCache', title: 'Clear cache (last hour)', category: 'Data', keywords: 'cache clear browsing data', perms: ['browsingData'] },
];

export const META: Record<string, ActionMeta> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

export const SLOT_COUNT = 10;
export const SLOT_IDS = Array.from({ length: SLOT_COUNT }, (_, i) => `custom.slot${i + 1}`);
