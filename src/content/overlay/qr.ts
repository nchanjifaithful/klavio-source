// QR renderer, injected separately and only for the QR action (keeps the palette injection small).
import { toCanvas } from 'qrcode';

globalThis.__klv_qr = { toCanvas: (c, text, o) => toCanvas(c, text, o) as Promise<void> };
