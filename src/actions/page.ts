import { confirmIt, copyText, type Ctx, NOT_AVAILABLE, openPopupWindow, overlay, scriptable, toast } from '../background/ui';
import { getSettings } from '../lib/storage';

export type Run = (ctx: Ctx) => Promise<chrome.tabs.Tab | void | unknown>;

/** Show a popup view: the toolbar popup when possible, otherwise a small popup window. */
export async function showPopup(intent: Record<string, unknown>, w = 560, h = 520) {
  await chrome.storage.session.set({ intent });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.storage.session.remove('intent');
    await openPopupWindow(new URLSearchParams(intent as Record<string, string>).toString(), w, h);
  }
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
async function zoom(ctx: Ctx, dir: 1 | -1) {
  const z = await chrome.tabs.getZoom(ctx.tab.id!);
  const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001);
  if (next) await chrome.tabs.setZoom(ctx.tab.id!, next);
  return next ?? z;
}

const mdEscape = (s: string) => s.replace(/([[\]\\])/g, '\\$1');
const htmlEscape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const PAGE: Record<string, Run> = {
  async 'page.qr'(ctx) {
    const { opts } = await getSettings();
    const url = ctx.tab.url ?? '';
    if (scriptable(ctx.tab)) {
      let domain = '';
      try { domain = new URL(url).hostname; } catch { /* ignore */ }
      return overlay(ctx.tab.id!, 'qr', { url, size: opts.qrSize, ecl: opts.qrEcl, domain }, ['overlay', 'qr']);
    }
    await showPopup({ view: 'qr', tab: String(ctx.tab.id) });
  },

  async 'page.copyUrl'(ctx) {
    await copyText(ctx, ctx.tab.url ?? '', undefined, 'URL copied');
  },

  async 'page.copyTitleUrl'(ctx) {
    const { opts } = await getSettings();
    const url = ctx.tab.url ?? '';
    const title = ctx.tab.title || url;
    if (opts.linkFormat === 'html') {
      await copyText(ctx, `${title} ${url}`, `<a href="${htmlEscape(url)}">${htmlEscape(title)}</a>`, 'Link copied');
    } else if (opts.linkFormat === 'text') {
      await copyText(ctx, `${title} — ${url}`, undefined, 'Link copied');
    } else {
      await copyText(ctx, `[${mdEscape(title)}](${url.replace(/\)/g, '%29')})`, undefined, 'Markdown link copied');
    }
  },

  async 'page.screenshot'(ctx) {
    const { opts } = await getSettings();
    const format = opts.shotFormat;
    // captureVisibleTab grabs whatever tab is visible in the window; never capture a different tab.
    const [visible] = await chrome.tabs.query({ active: true, windowId: ctx.tab.windowId });
    if (visible?.id !== ctx.tab.id) throw new Error('Switch to this tab to take a screenshot');
    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(ctx.tab.windowId, { format, quality: opts.shotQuality });
    } catch {
      throw new Error('Chrome does not allow capturing this page');
    }
    if (scriptable(ctx.tab)) {
      try { return await overlay(ctx.tab.id!, 'shot', { dataUrl, format, title: ctx.tab.title ?? 'page' }); } catch { /* fall back */ }
    }
    await chrome.storage.session.set({ shot: { dataUrl, format, title: ctx.tab.title } });
    await showPopup({ view: 'shot' }, 760, 600);
  },

  async 'page.print'(ctx) {
    if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
    await chrome.scripting.executeScript({ target: { tabId: ctx.tab.id! }, func: () => setTimeout(() => print(), 0) });
  },

  async 'page.reloadHard'(ctx) { await chrome.tabs.reload(ctx.tab.id!, { bypassCache: true }); },
  async 'page.zoomIn'(ctx) { return zoom(ctx, 1); },
  async 'page.zoomOut'(ctx) { return zoom(ctx, -1); },
  async 'page.zoomReset'(ctx) { await chrome.tabs.setZoom(ctx.tab.id!, 0); },

  async 'page.viewSource'(ctx) {
    const url = ctx.tab.url ?? '';
    if (!/^(https?|file):/.test(url)) throw new Error(NOT_AVAILABLE);
    return chrome.tabs.create({ url: 'view-source:' + url, index: ctx.tab.index + 1, openerTabId: ctx.tab.id });
  },

  async 'page.translate'(ctx) {
    const url = ctx.tab.url ?? '';
    if (!/^https?:/.test(url)) throw new Error(NOT_AVAILABLE);
    const tl = chrome.i18n.getUILanguage().split('-')[0] || 'en';
    return chrome.tabs.create({ url: `https://translate.google.com/translate?sl=auto&tl=${tl}&u=${encodeURIComponent(url)}`, index: ctx.tab.index + 1, openerTabId: ctx.tab.id });
  },

  async 'page.save'(ctx) {
    if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
    const blob = await chrome.pageCapture.saveAsMHTML({ tabId: ctx.tab.id! });
    if (!blob) throw new Error('Could not capture this page');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const name = (ctx.tab.title || 'page').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100).trim() || 'page';
    await chrome.downloads.download({ url: 'data:multipart/related;base64,' + btoa(bin), filename: `${name}.mhtml`, saveAs: false });
    await toast(ctx, 'Saving page…');
  },
};

export { confirmIt };
