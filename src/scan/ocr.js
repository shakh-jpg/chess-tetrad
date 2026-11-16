// Text recognition of scanned pages (stage C): tesseract.js (Apache-2.0) with Russian + English
// data, all served by the app itself from ocr/ (no CDN, nothing leaves the device). Loaded only
// when a scanned book is read with moves; the service worker caches the files on first use, so
// it works offline afterwards. Runs in tesseract's own Web Worker.
import { grayToCanvas } from './recognize.js';
import { moveSpans } from './moves.js';

var workerP = null, movesP = null;

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

// Second pass over the stretches with moves: English, only the characters of moves, one line at a
// time. Figurines are not in Tesseract's alphabet: they come out as digits or vanish, and the
// rules restore them (scan/moves.js); the squares, though, read much better than in the first pass.
function movesReady() {
  if (!movesP) {
    movesP = (async function () {
      var T = await import('tesseract.js');
      var b = base();
      var w = await T.createWorker('eng', T.OEM.LSTM_ONLY, { workerPath: b + 'worker.min.js', corePath: b, langPath: b + 'lang', gzip: true, workerBlobURL: false });
      await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_LINE, tessedit_char_whitelist: 'abcdefgh12345678.!?:+-x=KQRBNO0 ', user_defined_dpi: '400' });
      return w;
    })();
    movesP.catch(function () { movesP = null; });
  }
  return movesP;
}

/** Stops the OCR workers (frees their memory). */
export async function ocrClose() {
  var ps = [workerP, movesP]; workerP = movesP = null;
  for (var i = 0; i < ps.length; i++) { if (ps[i]) { try { (await ps[i]).terminate(); } catch (e) { /* already gone */ } } }
}

/** Text of the move stretches of a page (second pass, scaled x2). */
async function ocrMoves(img, words) {
  var spans = moveSpans(words);
  if (!spans.length) return '';
  var w = await movesReady(), parts = [];
  for (var i = 0; i < spans.length; i++) {
    var s = spans[i], pad = 6, x = Math.max(0, s.x0 - pad), y = Math.max(0, s.y0 - pad);
    var r = { x: x, y: y, w: Math.min(img.width - x, s.x1 - s.x0 + 2 * pad), h: Math.min(img.height - y, s.y1 - s.y0 + 2 * pad) };
    var src = grayToCanvas(img, r), cv = document.createElement('canvas');
    cv.width = r.w * 2; cv.height = r.h * 2;
    var ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, cv.width, cv.height);
    var res = await w.recognize(cv);
    parts.push((res.data.text || '').trim());
    src.width = src.height = cv.width = cv.height = 0;
  }
  return parts.join(' ');
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
  var text = res.data.text || words.map(function (x) { return x.text; }).join(' ');
  return { words: words, text: text, moves: await ocrMoves(img, words) };
}
