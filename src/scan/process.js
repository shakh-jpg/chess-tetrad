// Per-page processing of a scanned book (stage B): find the diagrams on the page, read the
// side-to-move marker and recognize the pieces. Each result keeps two small images:
//  - view: the diagram with its number/marker area, for the coach to compare (JPEG);
//  - board: the inner board at 48 px per square (PNG), so it can be recognized again with the
//    book's learned samples after the coach corrects a few boards (stage D).
import { findBoards, readMarker } from './boards.js';
import { recognizeBoard, grayToCanvas } from './recognize.js';
import { Samples } from '../recognition/samples.js';

/** Learned piece samples are kept per book (the file name without extension). */
export function profileName(file) { return String(file && file.name || 'Скан').replace(/\.[^.]+$/, '').slice(0, 80); }

function dataUrl(g, r, w, type, quality) {
  var cv = grayToCanvas(g, r), out = document.createElement('canvas');
  var scale = w / r.w; out.width = Math.round(r.w * scale); out.height = Math.round(r.h * scale);
  var ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, out.width, out.height);
  var url = out.toDataURL(type, quality);
  cv.width = cv.height = out.width = out.height = 0;
  return url;
}

/** View area: the board plus some room on the left (number, □/■ marker) and below. */
export function viewRect(g, b) {
  var o = b.outer, padL = Math.round(o.w * 0.2), padB = Math.round(o.w * 0.06);
  var x = Math.max(0, o.x - padL), y = Math.max(0, o.y - Math.round(o.w * 0.04));
  return { x: x, y: y, w: Math.min(g.width - x, o.x + o.w + 2 - x), h: Math.min(g.height - y, o.y + o.h + padB - y) };
}

export async function processScanPage(img, page, file) {
  var boards = findBoards(img);
  var samples = Samples.list(profileName(file));
  return boards.map(function (b, k) {
    var mk = readMarker(img, b);
    var rec = recognizeBoard(img, b, mk, samples.length ? samples : null);
    return {
      id: page + ':' + k, page: page, index: k,
      fen: rec.fen, side: rec.side, sideKnown: rec.sideKnown, task: rec.task,
      valid: rec.valid, problems: rec.problems, low: Object.keys(rec.low), conf: Math.round(rec.conf * 1000) / 1000,
      view: dataUrl(img, viewRect(img, b), 360, 'image/jpeg', 0.85),
      board: dataUrl(img, b.inner, 384, 'image/png'),
      status: 'new'
    };
  });
}

// Stage D replaces this with the review screen; set by ui/scan-review.js.
var resultsHandler = null;
export function setScanResultsHandler(fn) { resultsHandler = fn; }
export function onScanResults(state, file, modal) {
  return resultsHandler ? resultsHandler(state, file, modal) : null;
}
