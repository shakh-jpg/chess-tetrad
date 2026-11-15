// Approximate diagram recognition from an image.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { BASE } from './base-data.js';

var Recog = (function () {
  var S = 48, T = 16, M = 3;
  var TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];
  var GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
  var PRIOR_H = { K: 1, Q: 0.97, R: 0.82, B: 0.9, N: 0.88, P: 0.7 };
  var templates = null;
  /* образцы фигур из печатных диаграмм (контурные фигурки): [фигура, пропорции, высота, тёмность, силуэт 16×16 в процентах] */

  function resample(mask, w, h, x0, y0, x1, y1) {
    var out = new Float32Array(T * T), bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    for (var ty = 0; ty < T; ty++) for (var tx = 0; tx < T; tx++) {
      var sx0 = x0 + Math.floor(tx * bw / T), sx1 = x0 + Math.max(Math.floor((tx + 1) * bw / T), Math.floor(tx * bw / T) + 1);
      var sy0 = y0 + Math.floor(ty * bh / T), sy1 = y0 + Math.max(Math.floor((ty + 1) * bh / T), Math.floor(ty * bh / T) + 1);
      var sum = 0, n = 0;
      for (var y = sy0; y < sy1; y++) for (var x = sx0; x < sx1; x++) { sum += mask[y * w + x]; n++; }
      out[ty * T + tx] = n ? sum / n : 0;
    }
    return out;
  }
  function bbox(mask, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function buildTemplates() {
    if (templates) return templates;
    templates = {};
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    TYPES.forEach(function (t) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '52px "Noto Sans Symbols 2","Segoe UI Symbol","DejaVu Sans","Arial Unicode MS",serif';
      ctx.fillText(GLYPH[t], 32, 34);
      var d = ctx.getImageData(0, 0, 64, 64).data, mask = new Uint8Array(64 * 64);
      for (var i = 0; i < 4096; i++) mask[i] = d[i * 4] < 128 ? 1 : 0;
      var bb = bbox(mask, 64, 64);
      templates[t] = bb ? { bits: resample(mask, 64, 64, bb.x0, bb.y0, bb.x1, bb.y1), aspect: bb.w / bb.h } : { bits: new Float32Array(T * T), aspect: 1 };
    });
    return templates;
  }

  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }

  // gray: Uint8 S*S. Возвращает {empty, color, bits, aspect, hr}
  function analyseSquare(gray) {
    var samples = [], cs = [[M, M], [S - M - 6, M], [M, S - M - 6], [S - M - 6, S - M - 6]];
    cs.forEach(function (c) { for (var y = 0; y < 6; y++) for (var x = 0; x < 6; x++) samples.push(gray[(c[1] + y) * S + c[0] + x]); });
    var bg = median(samples), ink = new Uint8Array(S * S), i, x, y;
    for (y = M; y < S - M; y++) for (x = M; x < S - M; x++) ink[y * S + x] = Math.abs(gray[y * S + x] - bg) > 42 ? 1 : 0;
    // рамка доски у краёв клеток: фигура никогда не доходит вплотную к левому/правому краю
    for (y = M; y < S - M; y++) for (x = M; x < S - M; x++) if (x < M + 3 || x >= S - M - 3 || y < M + 1 || y >= S - M - 2) ink[y * S + x] = 0;
    // штриховка клетки: тонкие диагональные линии (малая заполненность рамки). Убираем такие компоненты.
    var lab = new Uint8Array(S * S);
    for (i = 0; i < S * S; i++) if (ink[i] && !lab[i]) {
      var comp = [i], st = [i], bx0 = S, by0 = S, bx1 = 0, by1 = 0; lab[i] = 1;
      while (st.length) {
        var q = st.pop(), qx = q % S, qy = (q / S) | 0;
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          var nk = ny * S + nx; if (ink[nk] && !lab[nk]) { lab[nk] = 1; st.push(nk); comp.push(nk); }
        }
      }
      var n = comp.length, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0, ci;
      for (ci = 0; ci < n; ci++) { mx += comp[ci] % S; my += (comp[ci] / S) | 0; }
      mx /= n; my /= n;
      for (ci = 0; ci < n; ci++) { var ddx = comp[ci] % S - mx, ddy = ((comp[ci] / S) | 0) - my; sxx += ddx * ddx; syy += ddy * ddy; sxy += ddx * ddy; }
      var tr = sxx + syy, det = sxx * syy - sxy * sxy, lmax = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), lmin = tr - lmax;
      /* линия (штриховка): вытянутая тонкая компонента; кольцо контура фигуры вытянутым не бывает */
      var isLine = n >= 5 && lmin / (lmax || 1) < 0.04;
      if ((isLine && n < 400) || n < 4) comp.forEach(function (k) { ink[k] = 0; });
    }
    // внешний фон: заливка от границы внутренней области по клеткам без «чернил»
    var ext = new Uint8Array(S * S), stack = [];
    function push(px, py) {
      if (px < M || py < M || px >= S - M || py >= S - M) return;
      var k = py * S + px; if (ext[k] || ink[k]) return; ext[k] = 1; stack.push(k);
    }
    for (i = M; i < S - M; i++) { push(i, M); push(i, S - M - 1); push(M, i); push(S - M - 1, i); }
    while (stack.length) {
      var k = stack.pop(), px = k % S, py = (k / S) | 0;
      push(px + 1, py); push(px - 1, py); push(px, py + 1); push(px, py - 1);
    }
    var mask = new Uint8Array(S * S), cnt = 0, dark = 0;
    for (y = M; y < S - M; y++) for (x = M; x < S - M; x++) {
      var kk = y * S + x;
      if (!ext[kk]) { mask[kk] = 1; cnt++; if (gray[kk] < 110) dark++; }
    }
    var area = (S - 2 * M) * (S - 2 * M);
    if (cnt / area < 0.04) return { empty: true };
    var bb = bbox(mask, S, S);
    if (!bb || bb.h < S * 0.25 || bb.w < S * 0.2) return { empty: true };
    return {
      empty: false, color: dark / cnt > 0.5 ? 'b' : 'w',
      bits: resample(mask, S, S, bb.x0, bb.y0, bb.x1, bb.y1), aspect: bb.w / bb.h, hr: bb.h / S, dr: dark / cnt
    };
  }

  function iouBits(a, b) { var inter = 0, uni = 0; for (var i = 0; i < T * T; i++) { inter += Math.min(a[i], b[i]); uni += Math.max(a[i], b[i]); } return uni ? inter / uni : 0; }
  // Возвращает {p, conf}: p = 'wQ' | ... | null (пусто). Образцы пользователя (samples) сильнее встроенных эталонов.
  function scoreSample(sq, m, rel) {
    return iouBits(sq.bits, m.bits) - 0.3 * Math.abs(rel - m.rel) - 0.25 * Math.abs(sq.aspect - m.asp) - (m.dr === undefined ? 0 : 1.5 * Math.abs(sq.dr - m.dr)) - (m.p && m.p[0] !== sq.color ? 0.12 : 0);
  }
  function classify(sq, maxHr, samples) {
    var tp = buildTemplates(), best = {}, rel = sq.hr / maxHr;
    function put(label, s) { if (best[label] === undefined || s > best[label]) best[label] = s; }
    TYPES.forEach(function (t) {
      var tpl = tp[t], s = iouBits(sq.bits, tpl.bits) - 0.3 * Math.abs(rel - PRIOR_H[t]) - 0.25 * Math.abs(sq.aspect - tpl.aspect);
      put(sq.color + t, s);
    });
    BASE.forEach(function (m) { put(m.p, scoreSample(sq, m, rel) + 0.04); });
    (samples || []).forEach(function (m) { put(m.p || 'null', scoreSample(sq, m, rel) + 0.1); });
    var arr = Object.keys(best).map(function (k) { return { p: k, s: best[k] }; }).sort(function (p, q) { return q.s - p.s; });
    // ranked: all candidates (best first) — used by the scanned-book recognizer to apply chess rules
    return { p: arr[0].p === 'null' ? null : arr[0].p, conf: arr[0].s - arr[1].s, ranked: arr };
  }

  // src — canvas/img, rect = {x,y,w,h} в пикселях источника
  function recognize(src, rect, flipped, samples) {
    var work = document.createElement('canvas'); work.width = work.height = S * 8;
    var ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S * 8, S * 8);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, S * 8, S * 8);
    var data = ctx.getImageData(0, 0, S * 8, S * 8).data, W = S * 8;
    var out = [], an = [], maxHr = 0.01;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var gray = new Uint8Array(S * S);
      for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
        var o = ((r * S + y) * W + c * S + x) * 4;
        gray[y * S + x] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
      }
      var a = analyseSquare(gray), rank = flipped ? r + 1 : 8 - r, file = flipped ? 7 - c : c;
      a.sq = 'abcdefgh'[file] + rank; an.push(a);
      if (!a.empty && a.hr > maxHr) maxHr = a.hr;
    }
    an.forEach(function (a) {
      if (a.empty) out.push({ sq: a.sq, p: null, conf: 1 });
      else { var cl = classify(a, maxHr, samples); out.push({ sq: a.sq, p: cl.p, conf: cl.conf, dr: a.dr, f: { bits: Array.from(a.bits, function (v) { return +v.toFixed(2); }), asp: +a.aspect.toFixed(3), rel: +(a.hr / maxHr).toFixed(3), dr: +a.dr.toFixed(3) } }); }
    });
    // два короля одного цвета: тот, что темнее, чёрный (на диаграммах книг чёрные фигуры часто тоже контурные)
    var ks = out.filter(function (x) { return x.p && x.p[1] === 'K'; });
    if (ks.length === 2 && ks[0].p[0] === ks[1].p[0]) {
      var dk = ks[0].dr >= ks[1].dr ? ks[0] : ks[1], lt = dk === ks[0] ? ks[1] : ks[0];
      dk.p = 'bK'; lt.p = 'wK';
    }
    return out;
  }

  // _classify is used by the scanned-book recognizer (scan/recognize.js), which builds its own square analysis for hatched squares
  return { recognize: recognize, buildTemplates: buildTemplates, _an: analyseSquare, _classify: classify, _S: S, baseCount: BASE.length };
})();

export { Recog };
export default Recog;
