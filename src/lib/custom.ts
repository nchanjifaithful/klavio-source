// Custom (user-built) actions: data model, type definitions for the builder UI, import validation.

export type CustomType =
  | 'url' | 'protocol' | 'extPage' | 'extToggle' | 'extMessage' | 'search' | 'copy'
  | 'css' | 'element' | 'js' | 'tabset' | 'gotoTab' | 'webhook' | 'macro' | 'recording';

export interface CustomAction {
  id: string; // "u_xxxxxxxx"
  source: 'user';
  type: CustomType;
  title: string;
  /** URL patterns; empty = all sites. */
  scope?: string[];
  cfg: Record<string, string>;
}

export type FieldKind = 'text' | 'textarea' | 'code' | 'select' | 'ext' | 'macro';
export interface Field { k: string; label: string; kind: FieldKind; options?: [string, string][]; ph?: string; hint?: string; tpl?: boolean }
export interface TypeDef { label: string; desc: string; fields: Field[]; perms?: string[]; danger?: string }

const TARGET: Field = { k: 'target', label: 'Open in', kind: 'select', options: [['newTab', 'New tab'], ['current', 'Current tab'], ['newWindow', 'New window'], ['incognito', 'Incognito window']] };

export const TYPES: Record<CustomType, TypeDef> = {
  url: { label: 'Open URL', desc: 'Open a URL template.', fields: [{ k: 'url', label: 'URL template', kind: 'text', ph: 'https://web.archive.org/web/{url}', tpl: true }, TARGET] },
  protocol: { label: 'Open app or protocol link', desc: 'Open a protocol link that can launch a desktop app.', fields: [{ k: 'url', label: 'Link', kind: 'text', ph: 'mailto:?body={url}', tpl: true }] },
  extPage: { label: 'Open extension page', desc: "Open another extension's options page or any of its pages.", perms: ['management'], fields: [{ k: 'ext', label: 'Extension', kind: 'ext' }, { k: 'path', label: 'Page path (empty = options page)', kind: 'text', ph: 'dashboard.html' }] },
  extToggle: { label: 'Toggle extension', desc: 'Enable or disable another extension.', perms: ['management'], danger: 'Changes another extension’s state.', fields: [{ k: 'ext', label: 'Extension', kind: 'ext' }, { k: 'mode', label: 'Action', kind: 'select', options: [['toggle', 'Toggle'], ['disable', 'Disable'], ['enable', 'Enable']] }, { k: 'revert', label: 'Revert after (minutes, empty = never)', kind: 'text', ph: '1' }] },
  extMessage: { label: 'Message an extension', desc: 'Send a JSON message to an extension that listens with onMessageExternal.', fields: [{ k: 'ext', label: 'Extension ID', kind: 'text', ph: 'abcdefghijklmnopabcdefghijklmnop' }, { k: 'payload', label: 'JSON payload', kind: 'code', ph: '{"cmd":"save","url":"{url}"}', tpl: true }] },
  search: { label: 'Search selection', desc: 'Search the selected text (or a prompt) with any engine. Use %s for the query.', fields: [{ k: 'url', label: 'Search URL', kind: 'text', ph: 'https://www.google.com/search?q=%s', tpl: true }, TARGET] },
  copy: { label: 'Copy template', desc: 'Copy text built from page variables.', fields: [{ k: 'text', label: 'Text template', kind: 'textarea', ph: '{title} — {url}', tpl: true }, { k: 'format', label: 'Format', kind: 'select', options: [['text', 'Plain text'], ['html', 'HTML (rich)']] }] },
  css: { label: 'Inject CSS', desc: 'Toggle a CSS snippet on the page.', fields: [{ k: 'css', label: 'CSS', kind: 'code', ph: 'header, aside { display: none !important; }' }] },
  element: { label: 'Click or fill element', desc: 'Click an element or type text into it, found by CSS selector.', fields: [{ k: 'selector', label: 'CSS selector', kind: 'text', ph: 'button.skip-intro' }, { k: 'mode', label: 'Do', kind: 'select', options: [['click', 'Click'], ['fill', 'Fill text']] }, { k: 'text', label: 'Text (for fill)', kind: 'textarea', tpl: true }] },
  js: { label: 'Run JavaScript', desc: 'Run your own JS snippet on the page (needs "Allow User Scripts").', perms: ['userScripts'], danger: 'Runs arbitrary code on the page.', fields: [{ k: 'code', label: 'JavaScript', kind: 'code', ph: 'window.scrollTo(0, document.body.scrollHeight)' }] },
  tabset: { label: 'Open tab set', desc: 'Open a saved group of URLs, optionally as a named tab group.', fields: [{ k: 'urls', label: 'URLs (one per line)', kind: 'textarea', ph: 'https://mail.google.com\nhttps://calendar.google.com' }, { k: 'group', label: 'Tab group name (optional)', kind: 'text' }] },
  gotoTab: { label: 'Go to tab', desc: 'Switch to the first tab matching a URL pattern, or open it.', fields: [{ k: 'pattern', label: 'URL pattern', kind: 'text', ph: '*://mail.google.com/*' }, { k: 'url', label: 'Open if none (optional)', kind: 'text', ph: 'https://mail.google.com', tpl: true }] },
  webhook: { label: 'Webhook', desc: 'POST page data to a URL you set.', danger: 'Sends page data to an external server.', fields: [{ k: 'url', label: 'Webhook URL', kind: 'text', ph: 'https://hooks.zapier.com/…' }, { k: 'method', label: 'Method', kind: 'select', options: [['POST', 'POST'], ['PUT', 'PUT']] }, { k: 'body', label: 'JSON body template', kind: 'code', ph: '{"url":"{url}","title":"{title}","selection":"{selection}"}', tpl: true }] },
  recording: { label: 'Recorded steps', desc: 'Clicks and typing recorded with “Record a new action on this page”. One step per line; edit text values freely (template variables work).', fields: [{ k: 'steps', label: 'Steps', kind: 'code', ph: '{"do":"click","sel":"#search","tag":"button","text":"Search"}', tpl: true }, { k: 'start', label: 'Start page', kind: 'select', options: [['auto', 'Open the recorded page if I’m on another site'], ['always', 'Always open the recorded page first'], ['never', 'Run on the current page']] }, { k: 'startUrl', label: 'Recorded page', kind: 'text' }] },
  macro: { label: 'Macro', desc: 'Run steps in order: one action id per line, or "wait 500" (ms).', fields: [{ k: 'steps', label: 'Steps', kind: 'macro', ph: 'tab.duplicate\ntab.toNewWindow\nwait 300\npage.zoomIn' }] },
};

export const DANGEROUS: CustomType[] = ['js', 'webhook', 'extToggle'];

export const newId = () => 'u_' + Math.random().toString(36).slice(2, 10);

export function blank(type: CustomType = 'url'): CustomAction {
  const cfg: Record<string, string> = {};
  for (const f of TYPES[type].fields) cfg[f.k] = f.kind === 'select' ? f.options![0][0] : '';
  return { id: newId(), source: 'user', type, title: TYPES[type].label, scope: [], cfg };
}

/** Validate + normalise an imported pack. Throws on malformed input. */
export function parsePack(json: string): CustomAction[] {
  const data = JSON.parse(json);
  const list = Array.isArray(data) ? data : data?.actions;
  if (!Array.isArray(list)) throw new Error('Expected {"actions": [...]}');
  return list.map((a: any) => {
    if (!a || typeof a !== 'object' || !(a.type in TYPES)) throw new Error(`Unknown action type: ${a?.type}`);
    const cfg: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.cfg ?? {})) cfg[k] = String(v);
    return {
      id: typeof a.id === 'string' && /^u_[\w]+$/.test(a.id) ? a.id : newId(),
      source: 'user', type: a.type,
      title: String(a.title || TYPES[a.type as CustomType].label).slice(0, 120),
      scope: Array.isArray(a.scope) ? a.scope.map(String).filter(Boolean) : [],
      cfg,
    };
  });
}

/** What a dangerous action will do, for the import confirmation. */
export function describeDanger(a: CustomAction): string | null {
  if (a.type === 'js') return `Run JavaScript:\n${a.cfg.code}`;
  if (a.type === 'webhook') return `Send data to ${a.cfg.url}`;
  if (a.type === 'extToggle') return `Toggle extension ${a.cfg.ext}`;
  return null;
}

export function macroSteps(s = ''): { id?: string; wait?: number }[] {
  return s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const w = /^wait\s+(\d+)/i.exec(l);
    return w ? { wait: Math.min(+w[1], 60000) } : { id: l };
  });
}
