// A scanned book as a sequence of page images: one interface for PDF (pdf.js) and DjVu (worker).
// renderPage(i, dpi) -> { width, height, gray: Uint8ClampedArray } — one page at a time.
import { openPdf } from '../pdf-import/files.js';

export function isDjvuName(name) { return /\.(djvu|djv)$/i.test(name || ''); }
export function isPdfName(name) { return /\.pdf$/i.test(name || ''); }

// Stable id of a file for "continue where we stopped" (the File object itself cannot be stored).
export function fileFingerprint(file) {
  return [file.name, file.size, file.lastModified || 0].join('|');
}

function grayFromCanvas(cv) {
  var ctx = cv.getContext('2d', { willReadFrequently: true });
  var d = ctx.getImageData(0, 0, cv.width, cv.height).data, n = cv.width * cv.height, g = new Uint8ClampedArray(n);
  for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  return g;
}

async function openPdfSource(file) {
  var doc = await openPdf(await file.arrayBuffer());
  return {
    kind: 'pdf', pages: doc.numPages,
    renderPage: async function (i, dpi) {
      var page = await doc.getPage(i + 1), vp = page.getViewport({ scale: dpi / 72 });
      var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
      var out = { width: cv.width, height: cv.height, gray: grayFromCanvas(cv) };
      cv.width = cv.height = 0; page.cleanup();
      return out;
    },
    close: function () { try { doc.destroy(); } catch (e) {} }
  };
}

async function openDjvuSource(file) {
  var worker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
  var seq = 0, waiting = new Map();
  worker.onmessage = function (e) {
    var w = waiting.get(e.data.id); if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.res(e.data.result); else w.rej(new Error(e.data.error));
  };
  worker.onerror = function (e) { waiting.forEach(function (w) { w.rej(new Error(e.message || 'Ошибка обработчика DjVu')); }); waiting.clear(); };
  function call(msg, transfer) {
    return new Promise(function (res, rej) { msg.id = ++seq; waiting.set(msg.id, { res: res, rej: rej }); worker.postMessage(msg, transfer || []); });
  }
  var bytes = await file.arrayBuffer();
  var info = await call({ cmd: 'open-djvu', bytes: bytes }, [bytes]);
  return {
    kind: 'djvu', pages: info.pages,
    renderPage: function (i, dpi) { return call({ cmd: 'render', page: i, dpi: dpi }); },
    close: function () { worker.terminate(); }
  };
}

export function openScanSource(file) {
  if (isDjvuName(file.name)) return openDjvuSource(file);
  if (isPdfName(file.name) || file.type === 'application/pdf') return openPdfSource(file);
  return Promise.reject(new Error('Распознавание сканов работает с PDF и DjVu.'));
}
