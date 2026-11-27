// Offscreen document: clipboard fallback for pages where content scripts can't run (or lack focus).
import { execCopy } from '../lib/clipboard';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.op === 'copy') {
    reply(execCopy(document, msg.text ?? '', msg.html));
  } else if (msg.op === 'paste') {
    const ta = document.createElement('textarea');
    document.body.append(ta);
    ta.focus();
    document.execCommand('paste');
    reply(ta.value);
    ta.remove();
  }
});
