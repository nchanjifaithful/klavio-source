// Build: esbuild bundles each entry, copies public/, and generates manifest.json from the action registry
// (one chrome.commands entry per action, 4 suggested keys, 10 custom slots).
//   node build.mjs          production build into dist/
//   node build.mjs --watch  rebuild on change
//   node build.mjs --zip    build + dist/klavio-<version>.zip (needs PowerShell or zip)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = 'dist';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = { bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false, target: 'chrome120', legalComments: 'eof', logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' } };

const entries = [
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/content/keys.ts', out: 'keys', format: 'iife' },
  { in: 'src/content/overlay/index.ts', out: 'overlay', format: 'iife' },
  { in: 'src/content/overlay/qr.ts', out: 'qr', format: 'iife' },
  { in: 'src/content/recorder.ts', out: 'recorder', format: 'iife' },
  { in: 'src/offscreen/clipboard.ts', out: 'offscreen', format: 'iife' },
  { in: 'src/popup/index.ts', out: 'popup', format: 'esm' },
  { in: 'src/options/index.ts', out: 'options', format: 'esm' },
];

async function manifest() {
  const r = await esbuild.build({ entryPoints: ['src/actions/meta.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral' });
  const { ACTIONS, SLOT_IDS } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
  const commands = {};
  for (const a of ACTIONS) {
    if (a.unsupported) continue;
    commands[a.id] = a.manifestKey ? { suggested_key: { default: a.manifestKey }, description: a.title } : { description: a.title };
  }
  SLOT_IDS.forEach((id, i) => (commands[id] = { description: `Custom action slot ${i + 1}` }));
  const icons = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };
  const m = {
    manifest_version: 3,
    name: 'Klavio',
    version: pkg.version,
    description: 'Keyboard shortcuts and a command palette for Chrome: QR codes, copy URL, screenshots, tabs and your own custom actions.',
    minimum_chrome_version: '135',
    icons,
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html', default_title: 'Klavio', default_icon: icons },
    options_page: 'options.html',
    permissions: ['activeTab', 'scripting', 'storage', 'clipboardWrite', 'offscreen', 'tabs', 'alarms'],
    optional_permissions: ['downloads', 'sessions', 'bookmarks', 'tabGroups', 'readingList', 'pageCapture', 'browsingData', 'management', 'userScripts', 'clipboardRead'],
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['<all_urls>'], js: ['keys.js'], run_at: 'document_start', all_frames: false }],
    commands,
    incognito: 'spanning',
  };
  writeFileSync(`${out}/manifest.json`, JSON.stringify(m, null, 2));
}

const copyPublic = () => cpSync('public', out, { recursive: true });

if (watch) {
  for (const e of entries) {
    const ctx = await esbuild.context({ ...common, entryPoints: [e.in], outfile: `${out}/${e.out}.js`, format: e.format });
    await ctx.watch();
  }
  copyPublic();
  await manifest();
  console.log('watching… (reload the extension at chrome://extensions after changes)');
} else {
  await Promise.all(entries.map((e) => esbuild.build({ ...common, entryPoints: [e.in], outfile: `${out}/${e.out}.js`, format: e.format })));
  copyPublic();
  await manifest();
  if (zip) {
    const name = `klavio-${pkg.version}.zip`;
    try {
      execSync(process.platform === 'win32'
        ? `powershell -NoProfile -Command "Compress-Archive -Path '${out}/*' -DestinationPath '${name}' -Force"`
        : `cd ${out} && zip -qr ../${name} .`, { stdio: 'inherit' });
      console.log(`packed ${name}`);
    } catch { console.error('zip failed'); }
  }
}
