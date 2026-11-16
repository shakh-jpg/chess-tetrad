// @ts-check
// Finds chess diagrams on a scanned page (grayscale pixels) and reads the side-to-move marker.
// Pure functions: no DOM, so they run in tests and could run in a worker.
//
// A diagram is a square frame: top and bottom edges are long dark horizontal runs with the same
// x-span, the distance between them is about the width, and the left/right edges are dark too.
// The inner board is found by stepping inside the frame (single or double line).

/**
 * @typedef {{ width: number, height: number, gray: Uint8ClampedArray | Uint8Array }} Gray
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ outer: Rect, inner: Rect, frame: number }} Board
 */

var DARK = 128;

/** @param {Gray} g @param {number} x @param {number} y */
function dark(g, x, y) { return g.gray[y * g.width + x] < DARK; }

/** Long horizontal dark runs: [{y, x0, x1}] @param {Gray} g @param {number} minLen */
export function horizontalRuns(g, minLen) {
  var out = [];
  for (var y = 0; y < g.height; y++) {
    var row = y * g.width, x = 0;
    while (x < g.width) {
      if (g.gray[row + x] >= DARK) { x++; continue; }
      var s = x;
      // allow 1-2 px gaps inside a printed line
      var gap = 0;
      while (x < g.width && (g.gray[row + x] < DARK || gap < 2)) { if (g.gray[row + x] < DARK) gap = 0; else gap++; x++; }
      var e = x - 1 - gap;
      if (e - s + 1 >= minLen) out.push({ y: y, x0: s, x1: e });
    }
  }
  return out;
}

/** Share of dark pixels on a vertical segment (x fixed, any of x-r..x+r dark counts). */
function columnDarkness(g, x, y0, y1, r) {
  var n = 0, d = 0;
  for (var y = y0; y <= y1; y++) {
    n++;
    for (var k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < g.width && dark(g, xx, y)) { d++; break; } }
  }
  return n ? d / n : 0;
}
/** Best column darkness within ±6 px of x (a side of a slightly rotated frame). */
function sideDarkness(g, x, y0, y1) {
  var best = 0;
  for (var k = -6; k <= 6; k++) { var xx = x + k; if (xx < 0 || xx >= g.width) continue; var d = columnDarkness(g, xx, y0, y1, 2); if (d > best) best = d; }
  return best;
}
/** Share of dark pixels in a row segment. */
function rowDarkness(g, y, x0, x1) {
  var d = 0; for (var x = x0; x <= x1; x++) if (dark(g, x, y)) d++;
  return d / Math.max(1, x1 - x0 + 1);
}

/**
 * @param {Gray} g
 * @param {{ minSide?: number, maxSide?: number }} [opts] sizes as a share of the page width
 * @returns {Board[]}
 */
export function findBoards(g, opts) {
  opts = opts || {};
  var minSide = Math.round(g.width * (opts.minSide || 0.18)), maxSide = Math.round(g.width * (opts.maxSide || 0.95));
  var runs = horizontalRuns(g, minSide);
  // group consecutive rows with the same span into one edge (thick lines)
  /** @type {{y0:number,y1:number,x0:number,x1:number}[]} */ var edges = [];
  runs.forEach(function (r) {
    var e = edges.filter(function (e) { return r.y - e.y1 <= 2 && Math.abs(r.x0 - e.x0) <= 4 && Math.abs(r.x1 - e.x1) <= 4; })[0];
    if (e) { e.y1 = r.y; e.x0 = Math.min(e.x0, r.x0); e.x1 = Math.max(e.x1, r.x1); } else edges.push({ y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 });
  });
  /** @type {Board[]} */ var boards = [];
  for (var i = 0; i < edges.length; i++) {
    var top = edges[i], w = top.x1 - top.x0 + 1;
    if (w < minSide || w > maxSide) continue;
    for (var j = i + 1; j < edges.length; j++) {
      var bot = edges[j], h = bot.y1 - top.y0 + 1;
      if (h > w * 1.12) break;
      if (h < w * 0.88) continue;
      // one end must match closely; the other may differ by up to 12% (a frame line can merge with
      // the hatching of a corner square and break) — the vertical edges are checked below anyway
      var tol = Math.max(4, w * 0.02), loose = Math.max(6, w * 0.12);
      var dl = Math.abs(bot.x0 - top.x0), dr = Math.abs(bot.x1 - top.x1);
      if (!((dl <= tol && dr <= loose) || (dr <= tol && dl <= loose))) continue;
      var x0 = Math.min(top.x0, bot.x0), x1 = Math.max(top.x1, bot.x1);
      // the sides: best column near each end (scans are often slightly rotated, the line drifts by a few px)
      if (sideDarkness(g, x0, top.y0, bot.y1) < 0.8 || sideDarkness(g, x1, top.y0, bot.y1) < 0.8) continue;
      var outer = { x: x0, y: top.y0, w: x1 - x0 + 1, h: bot.y1 - top.y0 + 1 };
      if (boards.some(function (b) { return overlap(b.outer, outer) > 0.5; })) continue;
      boards.push(refine(g, outer));
      break;
    }
  }
  return boards.sort(function (a, b) { return (a.outer.y - b.outer.y) || (a.outer.x - b.outer.x); });
}

/** @param {Rect} a @param {Rect} b */
function overlap(a, b) {
  var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  var iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Steps inside the frame: skips the dark frame line(s) and a thin white gap of a double frame.
 * @param {Gray} g @param {Rect} o @returns {Board}
 */
export function refine(g, o) {
  var limit = Math.round(o.w * 0.06);
  /** @param {(k:number)=>number} darkness */
  function inset(darkness) {
    var k = 0;
    while (k < limit && darkness(k) > 0.6) k++;           // outer line
    var gapStart = k;
    while (k < limit && darkness(k) <= 0.6 && darkness(k) > -1 && k - gapStart < limit / 2) {
      // a second line close by (double frame)?
      var j = k; while (j < limit && darkness(j) <= 0.6) j++;
      if (j < limit && j - gapStart <= Math.max(3, o.w * 0.012)) { k = j; while (k < limit && darkness(k) > 0.6) k++; }
      break;
    }
    return k;
  }
  var mid0 = o.x + Math.round(o.w * 0.1), mid1 = o.x + o.w - 1 - Math.round(o.w * 0.1);
  var midY0 = o.y + Math.round(o.h * 0.1), midY1 = o.y + o.h - 1 - Math.round(o.h * 0.1);
  var t = inset(function (k) { return rowDarkness(g, o.y + k, mid0, mid1); });
  var b = inset(function (k) { return rowDarkness(g, o.y + o.h - 1 - k, mid0, mid1); });
  var l = inset(function (k) { return colDark(g, o.x + k, midY0, midY1); });
  var r = inset(function (k) { return colDark(g, o.x + o.w - 1 - k, midY0, midY1); });
  var inner = { x: o.x + l, y: o.y + t, w: o.w - l - r, h: o.h - t - b };
  return { outer: o, inner: inner, frame: Math.round((t + b + l + r) / 4) };
}
/** @param {Gray} g @param {number} x @param {number} y0 @param {number} y1 */
function colDark(g, x, y0, y1) { var d = 0; for (var y = y0; y <= y1; y++) if (dark(g, x, y)) d++; return d / Math.max(1, y1 - y0 + 1); }

/**
 * Side-to-move marker near the bottom-left corner of the board (left of the frame):
 * a filled square ■ = Black to move, an empty square □ = White; ink inside an empty square
 * (e.g. "?") marks a task. Returns null when there is no marker.
 * @param {Gray} g @param {Board} b
 * @returns {{ side: 'w'|'b', task: boolean, box: Rect } | null}
 */
export function readMarker(g, b) {
  var o = b.outer, s = o.w;
  var x0 = Math.max(0, o.x - Math.round(s * 0.16)), x1 = o.x - 2, y0 = o.y + Math.round(o.h * 0.7), y1 = Math.min(g.height - 1, o.y + o.h + Math.round(s * 0.02));
  if (x1 - x0 < 6) return null;
  // bounding boxes of dark connected blobs in the area (4-connectivity, small areas only)
  var w = x1 - x0 + 1, h = y1 - y0 + 1, seen = new Uint8Array(w * h), best = null;
  for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
    if (seen[yy * w + xx] || !dark(g, x0 + xx, y0 + yy)) continue;
    var stack = [yy * w + xx], bx0 = xx, by0 = yy, bx1 = xx, by1 = yy, n = 0; seen[yy * w + xx] = 1;
    while (stack.length) {
      var q = /** @type {number} */ (stack.pop()), qx = q % w, qy = (q / w) | 0; n++;
      if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = qx + d[0], ny = qy + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        var k = ny * w + nx; if (!seen[k] && dark(g, x0 + nx, y0 + ny)) { seen[k] = 1; stack.push(k); }
      });
    }
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bw < s * 0.03 || bh < s * 0.03 || bw > s * 0.14 || bh > s * 0.14 || Math.abs(bw - bh) > Math.max(bw, bh) * 0.25) continue;
    var cand = { x: x0 + bx0, y: y0 + by0, w: bw, h: bh, n: n };
    if (!best || cand.y > best.y) best = cand; // the lowest square-ish blob
  }
  if (!best) return null;
  var fill = best.n / (best.w * best.h);
  if (fill > 0.6) {
    // a filled square ■; a white sign inside it (e.g. a white "?") marks a task for Black
    var holes = 0, area = 0, mm = Math.round(best.w * 0.2);
    for (var hy = best.y + mm; hy < best.y + best.h - mm; hy++) for (var hx = best.x + mm; hx < best.x + best.w - mm; hx++) { area++; if (!dark(g, hx, hy)) holes++; }
    return { side: 'b', task: area > 0 && holes / area > 0.08, box: { x: best.x, y: best.y, w: best.w, h: best.h } };
  }
  // an outline: is there ink in the middle (a "?")?
  var ink = 0, tot = 0, m = Math.round(best.w * 0.25);
  for (var y = best.y + m; y < best.y + best.h - m; y++) for (var x = best.x + m; x < best.x + best.w - m; x++) { tot++; if (dark(g, x, y)) ink++; }
  return { side: 'w', task: tot > 0 && ink / tot > 0.06, box: { x: best.x, y: best.y, w: best.w, h: best.h } };
}
