// Engine: Stockfish 19 lite (single-threaded WASM, bundled under engine/) in a worker,
// with the simple built-in search as a fallback.
// Same protocol as the prototype's Engine: init() -> 'stockfish' | 'fallback' | 'none',
// analyse(fen, {lines, depth, ms}, cb), stop(). Stage 2 changes:
//  - Stockfish is served from the app itself (works offline, no CDN), not Stockfish 10 asm.js;
//  - the fallback worker is a bundled module (chess.js from the bundle, no CDN);
//  - info lines are parsed by uci.parseInfo (bound lines skipped);
//  - workers are created through injectable factories so the adapter can be unit-tested.
import { parseInfo } from './uci.js';

export var STOCKFISH_FILE = 'engine/stockfish-19-lite-single.js';
export var STOCKFISH_NAME = 'Stockfish 19 lite';

function defaultStockfishWorker() {
  return new Worker(new URL(STOCKFISH_FILE, document.baseURI).href);
}
function defaultFallbackWorker() {
  return new Worker(new URL('./fallback-worker.js', import.meta.url), { type: 'module' });
}

export function createEngine(opts) {
  opts = opts || {};
  var makeStockfish = opts.makeStockfish || defaultStockfishWorker;
  var makeFallback = opts.makeFallback || defaultFallbackWorker;
  var timeoutMs = opts.timeoutMs || 15000;
  var worker = null, kind = null, busy = false, pending = null, cur = null, initP = null;

  function startStockfish() {
    return new Promise(function (res, rej) {
      var w, t;
      try { w = makeStockfish(); } catch (e) { rej(e); return; }
      t = setTimeout(function () { try { w.terminate(); } catch (e) {} rej(new Error('timeout')); }, timeoutMs);
      w.onmessage = function (e) { if (String(e.data).indexOf('uciok') >= 0) { clearTimeout(t); res(w); } };
      w.onerror = function (err) { clearTimeout(t); try { w.terminate(); } catch (e) {} rej(err); };
      w.postMessage('uci');
    });
  }
  function startFallback() {
    return new Promise(function (res, rej) {
      var w, t;
      try { w = makeFallback(); } catch (e) { rej(e); return; }
      t = setTimeout(function () { try { w.terminate(); } catch (e) {} rej(new Error('timeout')); }, timeoutMs);
      w.onmessage = function (e) { if (e.data === 'uciok') { clearTimeout(t); res(w); } };
      w.onerror = function (err) { clearTimeout(t); try { w.terminate(); } catch (e) {} rej(err); };
      w.postMessage({ cmd: 'uci' });
    });
  }

  function init() {
    if (initP) return initP;
    initP = startStockfish().then(function (w) {
      worker = w; kind = 'stockfish'; wire(); return kind;
    }).catch(function () {
      return startFallback().then(function (w) { worker = w; kind = 'fallback'; wire(); return kind; });
    }).catch(function () { kind = 'none'; return kind; });
    return initP;
  }

  function wire() {
    worker.onmessage = function (e) {
      var d = e.data;
      if (kind === 'stockfish') {
        var line = String(d);
        if (line.indexOf('bestmove') === 0) { busy = false; if (pending) { var p = pending; pending = null; start(p); } return; }
        if (!cur) return;
        var info = parseInfo(line, cur.turn);
        if (info) cur.cb(info);
      } else {
        if (d.done) { busy = false; if (pending) { var p2 = pending; pending = null; start(p2); } return; }
        if (d.info && cur) cur.cb(d);
      }
    };
  }

  function start(req) {
    cur = req; busy = true;
    if (kind === 'stockfish') {
      worker.postMessage('setoption name MultiPV value ' + req.lines);
      worker.postMessage('position fen ' + req.fen);
      worker.postMessage('go depth ' + req.depth + ' movetime ' + req.ms);
    } else {
      worker.postMessage({ cmd: 'go', fen: req.fen, depth: Math.min(req.depth, 4), ms: req.ms });
    }
  }

  function analyse(fen, o, cb) {
    if (!worker) return;
    var req = { fen: fen, lines: (o && o.lines) || 3, depth: (o && o.depth) || 16, ms: (o && o.ms) || 5000,
      cb: cb, turn: fen.split(' ')[1] };
    if (busy) {
      pending = req; cur = null;
      if (kind === 'stockfish') worker.postMessage('stop');
      // the fallback search is short; wait for it to finish
    } else start(req);
  }
  function stop() {
    pending = null; cur = null;
    if (worker && busy && kind === 'stockfish') worker.postMessage('stop');
  }
  return { init: init, analyse: analyse, stop: stop, get kind() { return kind; } };
}

export var Engine = createEngine();
export default Engine;
