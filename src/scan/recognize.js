// Turns a found board (scan/boards.js) into a position: pieces via the existing diagram
// recognizer (recognition/recog.js: hatch removal, per-book learned samples), side to move from
// the □/■ marker, castling rights from the king/rook placement, and a legality check.
import { Recog } from '../recognition/recog.js';
import { mapToFen } from '../board/position.js';
import { Chess } from '../core/chess.js';

/** Copies a rectangle of grayscale pixels to a canvas (the recognizer works on canvases). */
export function grayToCanvas(g, r) {
  var cv = document.createElement('canvas'); cv.width = r.w; cv.height = r.h;
  var ctx = cv.getContext('2d'), id = ctx.createImageData(r.w, r.h), d = id.data;
  for (var y = 0; y < r.h; y++) {
    var row = (r.y + y) * g.width + r.x;
    for (var x = 0; x < r.w; x++) { var v = g.gray[row + x], k = (y * r.w + x) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

export function castlingFrom(cells) {
  var cs = '';
  if (cells.e1 === 'wK') { if (cells.h1 === 'wR') cs += 'K'; if (cells.a1 === 'wR') cs += 'Q'; }
  if (cells.e8 === 'bK') { if (cells.h8 === 'bR') cs += 'k'; if (cells.a8 === 'bR') cs += 'q'; }
  return cs || '-';
}

// Checks what a position needs to be playable: one king each, no pawns on the first/last rank,
// the side not to move is not in check, chess.js accepts it.
export function positionProblems(cells, side) {
  var problems = [], wk = 0, bk = 0;
  Object.keys(cells).forEach(function (sq) {
    var p = cells[sq];
    if (p === 'wK') wk++; if (p === 'bK') bk++;
    if (p[1] === 'P' && (sq[1] === '1' || sq[1] === '8')) problems.push('пешка на ' + sq);
  });
  if (wk !== 1) problems.push(wk ? 'два белых короля' : 'нет белого короля');
  if (bk !== 1) problems.push(bk ? 'два чёрных короля' : 'нет чёрного короля');
  if (!problems.length) {
    var fen = mapToFen(cells, side, castlingFrom(cells));
    if (!new Chess().load(fen)) problems.push('позиция не проходит проверку');
    else {
      var other = new Chess(fen.replace(/ [wb] /, side === 'w' ? ' b ' : ' w '));
      if (other.in_check()) problems.push('король стороны, которая не ходит, под шахом');
    }
  }
  return problems;
}

// ---------- squares ----------
// Book diagrams draw dark squares as diagonal hatching. At scan resolution the hatch lines merge
// into a mesh that the generic recognizer takes for a piece. On a hatched square we therefore look
// at the local ink density instead: hatching is "half dark" everywhere, a white piece is a region
// that is clearly white (its interior), a black piece a region that is solid black.
var S = Recog._S, M = 3, WIN = 2; // 48-px squares, 3-px margin, 5x5 density window

/** Integral-image density of dark pixels in a (2*WIN+1)^2 window, clipped to the square. */
function densityMap(gray) {
  var I = new Int32Array((S + 1) * (S + 1));
  for (var y = 0; y < S; y++) { var run = 0; for (var x = 0; x < S; x++) { run += gray[y * S + x] < 128 ? 1 : 0; I[(y + 1) * (S + 1) + x + 1] = I[y * (S + 1) + x + 1] + run; } }
  var D = new Float32Array(S * S);
  for (var yy = 0; yy < S; yy++) for (var xx = 0; xx < S; xx++) {
    var x0 = Math.max(0, xx - WIN), y0 = Math.max(0, yy - WIN), x1 = Math.min(S, xx + WIN + 1), y1 = Math.min(S, yy + WIN + 1);
    var sum = I[y1 * (S + 1) + x1] - I[y0 * (S + 1) + x1] - I[y1 * (S + 1) + x0] + I[y0 * (S + 1) + x0];
    D[yy * S + xx] = sum / ((x1 - x0) * (y1 - y0));
  }
  return D;
}

/** Share of dark pixels in the outer ring of a square (where pieces rarely reach). */
export function ringDensity(gray) {
  var d = 0, n = 0;
  for (var y = M; y < S - M; y++) for (var x = M; x < S - M; x++) {
    if (x > M + 4 && x < S - M - 5 && y > M + 4 && y < S - M - 5) continue;
    n++; if (gray[y * S + x] < 128) d++;
  }
  return n ? d / n : 0;
}

/** Copy of a square with a white ring of width w: on hatched boards a slightly misaligned grid lets
 * the neighbours' hatching into the edges of a plain square and inflates the piece height. */
export function wipeRing(gray, w) {
  var out = new Uint8Array(gray);
  for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) if (x < w || y < w || x >= S - w || y >= S - w) out[y * S + x] = 255;
  return out;
}

/** Share of dark pixels in the middle of the square (where the body of a piece is). */
export function coreDarkness(gray) {
  var d = 0, n = 0, x0 = Math.round(S * 0.36), x1 = Math.round(S * 0.64), y0 = Math.round(S * 0.4), y1 = Math.round(S * 0.72);
  for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { n++; if (gray[y * S + x] < 128) d++; }
  return n ? d / n : 0;
}

/** Analysis of a hatched square in the format of Recog._an: {empty, color, bits, aspect, hr, dr}. */
export function analyseHatched(gray) {
  var D = densityMap(gray), mask = new Uint8Array(S * S), white = 0, solid = 0;
  for (var y = M + 1; y < S - M - 1; y++) for (var x = M + 1; x < S - M - 1; x++) {
    var k = y * S + x, d = D[k];
    if (d < 0.08) { mask[k] = 1; white++; } else if (d > 0.88) { mask[k] = 1; solid++; }
  }
  // the white interior lacks the piece outline (and the density window shrinks solid areas):
  // grow the silhouette by 2 px so its shape is closer to the whole piece
  var synth = new Uint8Array(S * S).fill(255), R = 0;
  for (var yy = M; yy < S - M; yy++) for (var xx = M; xx < S - M; xx++) {
    var on = false;
    for (var dy = -R; dy <= R && !on; dy++) for (var dx = -R; dx <= R; dx++) {
      var ny = yy + dy, nx = xx + dx;
      if (ny >= 0 && nx >= 0 && ny < S && nx < S && mask[ny * S + nx]) { on = true; break; }
    }
    if (on) synth[yy * S + xx] = 0;
  }
  var a = Recog._an(synth);
  if (a.empty) return a;
  // a white piece shows a clearly white interior; a black piece is solid with at most thin white details
  a.color = white / Math.max(1, white + solid) > 0.3 ? 'w' : 'b';
  a.dr = a.color === 'b' ? 0.85 : 0.2;
  a.hatched = true;
  return a;
}

/** Cuts the board into 8x8 squares of S x S gray pixels (via a canvas, as the old recognizer did). */
function boardSquares(g, r) {
  var src = grayToCanvas(g, r), work = document.createElement('canvas');
  work.width = work.height = S * 8;
  var ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S * 8, S * 8);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, r.w, r.h, 0, 0, S * 8, S * 8);
  var data = ctx.getImageData(0, 0, S * 8, S * 8).data, W = S * 8, out = [];
  for (var row = 0; row < 8; row++) for (var col = 0; col < 8; col++) {
    var gray = new Uint8Array(S * S);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var o = ((row * S + y) * W + col * S + x) * 4;
      gray[y * S + x] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
    }
    out.push({ row: row, col: col, gray: gray });
  }
  src.width = src.height = work.width = work.height = 0;
  return out;
}

/** Per-square recognition of a board: [{sq, p, conf, f}] like Recog.recognize. */
export function recognizeSquares(g, r, samples) {
  var squares = boardSquares(g, r), an = [], maxHr = 0.01;
  // hatch density of this board: median ring density of the dark squares
  var ringsDark = squares.filter(function (s) { return (s.row + s.col) % 2 === 1; }).map(function (s) { return ringDensity(s.gray); }).sort();
  var hatchLevel = ringsDark[ringsDark.length >> 1] || 0;
  var hatchedBoard = hatchLevel > 0.12 && hatchLevel < 0.8;
  squares.forEach(function (s) {
    var darkSq = (s.row + s.col) % 2 === 1;
    var a = hatchedBoard && darkSq ? analyseHatched(s.gray) : Recog._an(s.gray);
    // Colour on plain squares: book pieces have thick outlines, so "more than half of the
    // silhouette is dark" calls white pieces black. The core of the piece decides instead:
    // filled for a black piece, mostly white for a white one.
    if (!a.empty && !a.hatched) { var cd = coreDarkness(s.gray); a.color = cd > 0.6 ? 'b' : 'w'; a.core = cd; }
    a.sq = 'abcdefgh'[s.col] + (8 - s.row);
    an.push(a);
    if (!a.empty && a.hr > maxHr) maxHr = a.hr;
  });
  var out = an.map(function (a) {
    if (a.empty) return { sq: a.sq, p: null, conf: 1 };
    var cl = Recog._classify(a, maxHr, samples || null);
    // the colour comes from the square analysis (fill vs. outline), the type from the shape match
    var scores = {};
    (cl.ranked || []).forEach(function (c) { if (c.p && c.p !== 'null') { var t = c.p[1]; if (scores[t] === undefined || c.s > scores[t]) scores[t] = c.s; } });
    var p = cl.p ? a.color + cl.p[1] : null;
    if (!p && (cl.ranked || []).length) { var firstPiece = cl.ranked.filter(function (c) { return c.p && c.p !== 'null'; })[0]; if (firstPiece) p = null; }
    return { sq: a.sq, p: p, conf: cl.conf, dr: a.dr, scores: scores, f: { bits: Array.from(a.bits, function (v) { return +v.toFixed(2); }), asp: +a.aspect.toFixed(3), rel: +(a.hr / maxHr).toFixed(3), dr: +a.dr.toFixed(3) } };
  });
  applyChessRules(out);
  return { squares: out, hatched: hatchedBoard, hatchLevel: hatchLevel };
}

// Next best type for a square, excluding some types. @returns {string|null}
function nextBest(sq, exclude) {
  var best = null, bs = -Infinity;
  Object.keys(sq.scores || {}).forEach(function (t) { if (exclude.indexOf(t) < 0 && sq.scores[t] > bs) { bs = sq.scores[t]; best = t; } });
  return best;
}
// how far below the best match "king" may be for a piece to be turned into the missing king
// (measured on real books: misread kings were within 0.23, pawns of king-less diagrams 0.35+)
export var KING_GAP = -0.25;
// Chess rules as a prior: exactly one king per side (the most king-like piece of that colour),
// no pawns on the first or last rank. Changed squares are marked low-confidence.
export function applyChessRules(out) {
  ['w', 'b'].forEach(function (c) {
    var mine = out.filter(function (x) { return x.p && x.p[0] === c; });
    // a pawn is almost never a misread king: prefer pieces when choosing the missing king
    // relative: how far "king" is from the best match of that square (plain and hatched squares
    // have different score levels, absolute scores are not comparable)
    var kingScore = function (x) {
      var sc = x.scores || {}, best = -Infinity;
      Object.keys(sc).forEach(function (t) { if (sc[t] > best) best = sc[t]; });
      return (sc.K !== undefined ? sc.K - best : -Infinity) - (x.p[1] === 'P' ? 0.25 : 0);
    };
    var kings = mine.filter(function (x) { return x.p[1] === 'K'; });
    if (kings.length === 1) return;
    var pool = kings.length ? kings : mine;
    if (!pool.length) return;
    var king = pool.slice().sort(function (a, b) { return kingScore(b) - kingScore(a); })[0];
    // no king read: promote a piece only when "king" is a close second for it. Book illustrations
    // without kings exist (pawn structures); then the position stays "no king" and goes to review.
    if (!kings.length && kingScore(king) < KING_GAP) return;
    if (king.p[1] !== 'K') { king.from = king.p; king.p = c + 'K'; king.conf = 0; king.fixed = true; }
    kings.forEach(function (x) { if (x !== king) { var t = nextBest(x, ['K']); x.p = t ? c + t : null; x.conf = 0; x.fixed = true; } });
  });
  out.forEach(function (x) {
    if (x.p && x.p[1] === 'P' && (x.sq[1] === '1' || x.sq[1] === '8')) { var t = nextBest(x, ['P', 'K']); x.p = t ? x.p[0] + t : null; x.conf = 0; x.fixed = true; }
  });
  return out;
}

/**
 * @param g grayscale page, @param board from findBoards, @param marker from readMarker (or null),
 * @param samples learned piece samples of this book (or null)
 */
export function recognizeBoard(g, board, marker, samples) {
  var r = board.inner;
  var rs = recognizeSquares(g, r, samples), res = rs.squares;
  var cells = {}, low = {}, lowCount = 0, confSum = 0, nPieces = 0;
  res.forEach(function (c) {
    if (c.p) { cells[c.sq] = c.p; nPieces++; confSum += Math.max(0, Math.min(1, c.conf)); }
    if (c.p && c.conf < 0.1) { low[c.sq] = 1; lowCount++; }
  });
  var side = marker ? marker.side : 'w';
  var problems = positionProblems(cells, side);
  return {
    fen: mapToFen(cells, side, castlingFrom(cells)), cells: cells, low: low, lowCount: lowCount,
    side: side, sideKnown: !!marker, task: !!(marker && marker.task),
    problems: problems, valid: !problems.length, pieces: nPieces, conf: nPieces ? confSum / nPieces : 0,
    raw: res // per-square features, used to learn samples after the coach corrects the board
  };
}
