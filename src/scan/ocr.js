// Text recognition of scanned pages (stage C): tesseract.js (Apache-2.0) with Russian + English
// data, all served by the app itself from ocr/ (no CDN, nothing leaves the device). Loaded only
// when a scanned book is read with moves; the service worker caches the files on first use, so
// it works offline afterwards. Runs in tesseract's own Web Worker.
import { grayToCanvas } from './recognize.js';

var workerP = null;

function base() { return new URL((import.meta.env && import.meta.env.BASE_URL || './') + 'ocr/', location.href).href; }

/** The OCR worker (created once). @param {(m: any) => void} [onLog] */
export function ocrReady(onLog) {
  if (!workerP) {
    workerP = (async function () {
      var T = await import('tesseract.js');
      var b = base();
      var w = await T.createWorker(['rus', 'eng'], T.OEM.LSTM_ONLY, {
        workerPath: b + 'worker.min.js', corePath: b, langPath: b + 'lang', gzip: true, workerBlobURL: false,
        logger: function (m) { if (onLog) onLog(m); }
      });
      // book pages have columns: let tesseract find the layout (its default reads one block)
      // pages are rendered at 200 dpi (ui/scan-dialog.js SCAN_DPI); telling it avoids a console message
      await w.setParameters({ tessedit_pageseg_mode: T.PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '200' });
      return w;
    })();
    workerP.catch(function () { workerP = null; });
  }
  return workerP;
}

/** Stops the OCR worker (frees its memory). */
export async function ocrClose() {
  if (!workerP) return;
  var p = workerP; workerP = null;
  try { (await p).terminate(); } catch (e) { /* already gone */ }
}

/**
 * Words of a page with the diagrams blanked out: [{ text, conf, x0, y0, x1, y1 }] in page pixels,
 * plus the page text in reading order.
 * @param {{ width: number, height: number, gray: Uint8ClampedArray }} img
 * @param {{ outer: { x: number, y: number, w: number, h: number } }[]} boards
 */
export async function ocrPage(img, boards) {
  var w = await ocrReady();
  var cv = grayToCanvas(img, { x: 0, y: 0, w: img.width, h: img.height }), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  boards.forEach(function (b) { var o = b.outer; ctx.fillRect(o.x - 4, o.y - 4, o.w + 8, o.h + 8); });
  var res = await w.recognize(cv, {}, { text: true, blocks: true });
  cv.width = cv.height = 0;
  var words = [];
  (res.data.blocks || []).forEach(function (bl) {
    (bl.paragraphs || []).forEach(function (pa) {
      (pa.lines || []).forEach(function (li) {
        (li.words || []).forEach(function (wd) { words.push({ text: wd.text, conf: wd.confidence, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 }); });
      });
    });
  });
  return { words: words, text: res.data.text || words.map(function (x) { return x.text; }).join(' ') };
}
