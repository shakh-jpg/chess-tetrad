// Fallback engine (simple alpha-beta search up to depth 4) running in a module worker.
// Moved from the prototype's inline FALLBACK string; chess.js now comes from the bundle, not a CDN.
import { Chess } from '../core/chess.js';

var VAL = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
function evalPos(g) {
  var b = g.board(), s = 0, r, c, p, v, cd;
  for (r = 0; r < 8; r++) for (c = 0; c < 8; c++) {
    p = b[r][c]; if (!p) continue; v = VAL[p.type];
    cd = Math.abs(3.5 - c) + Math.abs(3.5 - r);
    if (p.type === 'n' || p.type === 'b') v += (7 - cd) * 4;
    else if (p.type === 'p') { var adv = p.color === 'w' ? (7 - r) : r; v += adv * 6 + (cd < 3 ? 8 : 0); }
    else if (p.type === 'q') v += (7 - cd) * 1;
    s += p.color === 'w' ? v : -v;
  }
  return g.turn() === 'w' ? s : -s;
}
var nodes = 0, deadline = 0, stopped = false;
function order(ms) { return ms.sort(function (a, b) { return sc(b) - sc(a); }); }
function sc(m) { var s = 0; if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece] / 10 + 1000; if (m.promotion) s += 800; return s; }
function q(g, alpha, beta, d) {
  nodes++; var st = evalPos(g); if (d <= 0) return st; if (st >= beta) return beta; if (st > alpha) alpha = st;
  var ms = g.moves({ verbose: true }).filter(function (m) { return m.captured; }); order(ms);
  for (var i = 0; i < ms.length; i++) { g.move(ms[i]); var v = -q(g, -beta, -alpha, d - 1); g.undo(); if (v >= beta) return beta; if (v > alpha) alpha = v; }
  return alpha;
}
function search(g, d, alpha, beta, ply, pv) {
  nodes++;
  if ((nodes & 255) === 0 && Date.now() > deadline) stopped = true; if (stopped) return 0;
  if (g.in_draw()) return 0;
  var ms = g.moves({ verbose: true });
  if (!ms.length) return g.in_check() ? -30000 + ply : 0;
  if (d <= 0) return q(g, alpha, beta, 3);
  order(ms); var best = -Infinity, line = [];
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i]; g.move(m); var sub = []; var v = -search(g, d - 1, -beta, -alpha, ply + 1, sub); g.undo();
    if (stopped) return 0;
    if (v > best) { best = v; line = [m.from + m.to + (m.promotion || '')].concat(sub); }
    if (v > alpha) alpha = v; if (alpha >= beta) break;
  }
  pv.length = 0; Array.prototype.push.apply(pv, line); return best;
}
self.onmessage = function (e) {
  var d = e.data;
  if (d.cmd === 'uci') { postMessage('uciok'); return; }
  if (d.cmd === 'go') {
    var g = new Chess(d.fen), turn = g.turn(); stopped = false; nodes = 0; deadline = Date.now() + (d.ms || 2500);
    var lastPv = [];
    for (var depth = 1; depth <= (d.depth || 4); depth++) {
      var pv = []; var v = search(g, depth, -40000, 40000, 0, pv); if (stopped) break; lastPv = pv;
      var mate = null, cp = v; if (Math.abs(v) > 29000) { mate = (v > 0 ? 1 : -1) * Math.ceil((30000 - Math.abs(v) + 1) / 2); cp = null; }
      postMessage({ info: true, depth: depth, multipv: 1, cp: cp, mate: mate, pv: lastPv, turn: turn });
    }
    postMessage({ done: true });
  }
};
