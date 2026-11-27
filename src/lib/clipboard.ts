// Clipboard helpers usable in any document (content script, offscreen document, extension pages).

/** Synchronous copy through a copy-event listener: works without page focus when the extension has clipboardWrite. */
export function execCopy(doc: Document, text: string, html?: string): boolean {
  let ok = false;
  const h = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', text);
    if (html) e.clipboardData?.setData('text/html', html);
    e.preventDefault();
    e.stopImmediatePropagation();
    ok = true;
  };
  doc.addEventListener('copy', h, true);
  try { doc.execCommand('copy'); } catch { /* ignore */ } finally { doc.removeEventListener('copy', h, true); }
  return ok;
}

export async function writeText(doc: Document, text: string, html?: string): Promise<boolean> {
  try {
    if (html) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    return execCopy(doc, text, html);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream' });
}

export async function writeImage(blob: Blob): Promise<boolean> {
  try {
    const png = blob.type === 'image/png' ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

/** The async clipboard only accepts PNG images. */
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}
