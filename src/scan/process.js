// Per-page processing of a scanned book (stage B): find the diagrams on the page, read the
// side-to-move marker and recognize the pieces. Each result keeps two small images:
//  - view: the diagram with its number/marker area, for the coach to compare (JPEG);
//  - board: the inner board at 48 px per square (PNG), so it can be recognized again with the
//    book's learned samples after the coach corrects a few boards (stage D).
import { findBoards, readMarker } from './boards.js';
import { recognizeBoard, recognizeSquares, grayToCanvas } from './recognize.js';
import { altsFrom } from './review.js';
import { readMoves, readPageMoves, tokenize, toMovetext, diagramNumber } from './moves.js';
import { ocrPage } from './ocr.js';
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

// The recognizer draws its reference pieces with the app's chess font once and keeps them; they
// must not be drawn before the font is loaded (a fallback font reads white pawns as rooks).
var fontReady = null;
export function recogFontReady() {
  if (!fontReady) {
    fontReady = typeof document !== 'undefined' && document.fonts && document.fonts.load
      ? document.fonts.load('52px "Noto Sans Symbols 2"', '♔♕♖♗♘♙♚♛♜♝♞♟').then(function () {}, function () {})
      : Promise.resolve();
  }
  return fontReady;
}

/**
 * Moves for a position from the page text (see scan/moves.js readMoves). Without a □/■ marker
 * the side to move is unknown: both are tried, and the side whose moves read better is returned.
 */
export function movesFor(fen, text, sideKnown) {
  var sides = sideKnown === false ? ['w', 'b'] : [fen.split(' ')[1]], best = null;
  sides.forEach(function (s) {
    var f = fen.replace(/ [wb] /, ' ' + s + ' '), run = readMoves(f, tokenize(text || ''));
    if (!best || run.sure > best.run.sure) best = { run: run, fen: f };
  });
  var r = best.run;
  return { fen: best.fen, side: best.fen.split(' ')[1], moves: r.moves.length ? toMovetext(best.fen, r.moves) : '', movesList: r.moves.map(function (m) { return { san: m.san, sure: m.sure }; }) };
}

/**
 * @param opts { ocr: boolean } read the page text (diagram numbers and moves) with OCR
 */
export async function processScanPage(img, page, file, opts) {
  var boards = findBoards(img);
  if (boards.length) await recogFontReady();
  var samples = Samples.list(profileName(file));
  var ocr = null;
  if (boards.length && opts && opts.ocr) ocr = await ocrPage(img, boards);
  var out = boards.map(function (b, k) {
    var mk = readMarker(img, b);
    var rec = recognizeBoard(img, b, mk, samples.length ? samples : null);
    var r = {
      id: page + ':' + k, page: page, index: k,
      fen: rec.fen, side: rec.side, sideKnown: rec.sideKnown, task: rec.task,
      valid: rec.valid, problems: rec.problems, low: Object.keys(rec.low), conf: Math.round(rec.conf * 1000) / 1000,
      alts: altsFrom(rec.raw),
      view: dataUrl(img, viewRect(img, b), 360, 'image/jpeg', 0.85),
      board: dataUrl(img, b.inner, 384, 'image/png'),
      status: 'new'
    };
    if (ocr) {
      var num = diagramNumber(ocr.words, b.outer);
      if (num) r.number = num;
      // the text of the moves is kept with the images (scan-store): moves are found again after the coach fixes the board
      r.text = ocr.moves || ocr.text;
    }
    return r;
  });
  if (ocr) {
    // all diagrams of the page at once: a stretch of moves belongs to one diagram only.
    // Without a □/■ marker the side to move comes from the moves (movesFor tries both).
    var fens = out.map(function (r) { return r.valid ? (r.sideKnown ? r.fen : movesFor(r.fen, r.text, false).fen) : null; });
    readPageMoves(fens, tokenize(out.length ? out[0].text : '')).forEach(function (run, k) {
      if (!fens[k] || !run.moves.length) return;
      out[k].fen = fens[k]; out[k].side = fens[k].split(' ')[1];
      out[k].moves = toMovetext(fens[k], run.moves);
      out[k].movesList = run.moves.map(function (m) { return { san: m.san, sure: m.sure }; });
    });
  }
  return out;
}

// --- learning from the coach's corrections (stage D): work on the stored board image

/** @param {string} url data URL of a stored board image @returns {Promise<{width:number,height:number,gray:Uint8ClampedArray}>} */
export function grayFromUrl(url) {
  return new Promise(function (res, rej) {
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      var d = ctx.getImageData(0, 0, cv.width, cv.height).data, g = new Uint8ClampedArray(cv.width * cv.height);
      for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
      var out = { width: cv.width, height: cv.height, gray: g };
      cv.width = cv.height = 0; res(out);
    };
    img.onerror = function () { rej(new Error('board image')); };
    img.src = url;
  });
}
function wholeBoard(g) { return { x: 0, y: 0, w: g.width, h: g.height }; }

/** Remembers the pieces of a corrected board as samples of the book. @returns {Promise<number>} samples added */
export async function learnBoard(profile, boardUrl, cells) {
  await recogFontReady();
  var g = await grayFromUrl(boardUrl);
  return Samples.learn(profile, null, cells, recognizeSquares(g, wholeBoard(g), null).squares);
}

/** Recognizes a stored board again with the book's samples; returns the fields to update. */
export async function recognizeAgain(result, boardUrl, profile) {
  await recogFontReady();
  var g = await grayFromUrl(boardUrl), samples = Samples.list(profile);
  var rec = recognizeBoard(g, { inner: wholeBoard(g) }, { side: result.side, task: result.task }, samples.length ? samples : null);
  return { fen: rec.fen, valid: rec.valid, problems: rec.problems, low: Object.keys(rec.low), conf: Math.round(rec.conf * 1000) / 1000, alts: altsFrom(rec.raw) };
}

// The review screen (ui/scan-review.js) is plugged in here by ui/app.js.
var resultsHandler = null;
export function setScanResultsHandler(fn) { resultsHandler = fn; }
export function onScanResults(state, file, modal) {
  return resultsHandler ? resultsHandler(state, file, modal) : null;
}
