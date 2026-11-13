import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';

// Fake UCI worker: records commands; tests push engine output via emit().
function fakeStockfish(opts) {
  opts = opts || {};
  const w = {
    sent: [], terminated: false, onmessage: null, onerror: null,
    postMessage(cmd) {
      w.sent.push(cmd);
      if (cmd === 'uci' && !opts.silent) setTimeout(() => w.emit('uciok'), 0);
      if (cmd === 'uci' && opts.crash) setTimeout(() => w.onerror && w.onerror(new Error('wasm failed')), 0);
    },
    emit(line) { w.onmessage && w.onmessage({ data: line }); },
    terminate() { w.terminated = true; }
  };
  return w;
}
function fakeFallback() {
  const w = {
    sent: [], onmessage: null, onerror: null,
    postMessage(m) { w.sent.push(m); if (m.cmd === 'uci') setTimeout(() => w.onmessage({ data: 'uciok' }), 0); },
    emit(d) { w.onmessage({ data: d }); },
    terminate() {}
  };
  return w;
}
const FEN_B = '4k3/8/8/8/3q4/8/8/4K3 b - - 0 1';

describe('engine adapter', () => {
  it('starts Stockfish and sends MultiPV, position and go', async () => {
    const sf = fakeStockfish();
    const e = createEngine({ makeStockfish: () => sf, makeFallback: () => { throw new Error('no'); } });
    expect(await e.init()).toBe('stockfish');
    e.analyse(FEN_B, { lines: 3, depth: 16, ms: 6000 }, () => {});
    expect(sf.sent).toEqual(['uci', 'setoption name MultiPV value 3', 'position fen ' + FEN_B, 'go depth 16 movetime 6000']);
  });

  it('delivers parsed info with the side to move, skipping bound lines', async () => {
    const sf = fakeStockfish();
    const e = createEngine({ makeStockfish: () => sf });
    await e.init();
    const got = [];
    e.analyse(FEN_B, {}, (i) => got.push(i));
    sf.emit('info depth 12 seldepth 21 multipv 1 score cp 925 lowerbound nodes 1 pv d4e3');
    sf.emit('info depth 12 seldepth 21 multipv 1 score cp 900 nodes 1 pv d4e3 e1d1');
    expect(got).toEqual([{ info: true, depth: 12, multipv: 1, cp: 900, mate: null, pv: ['d4e3', 'e1d1'], turn: 'b' }]);
  });

  it('a new request while busy stops the old search and starts after bestmove', async () => {
    const sf = fakeStockfish();
    const e = createEngine({ makeStockfish: () => sf });
    await e.init();
    const a = [], b = [];
    e.analyse(FEN_B, {}, (i) => a.push(i));
    e.analyse('4k3/8/8/8/8/8/8/4K2R w K - 0 1', {}, (i) => b.push(i));
    expect(sf.sent[sf.sent.length - 1]).toBe('stop');
    sf.emit('info depth 5 multipv 1 score cp 1 pv d4e3'); // late line of the old search: dropped
    expect(a.length + b.length).toBe(0);
    sf.emit('bestmove d4e3');
    expect(sf.sent.slice(-2)).toEqual(['position fen 4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'go depth 16 movetime 5000']);
    sf.emit('info depth 5 multipv 1 score cp 500 pv h1h8');
    expect(b[0]).toMatchObject({ cp: 500, turn: 'w' });
  });

  it('stop() drops results and sends stop', async () => {
    const sf = fakeStockfish();
    const e = createEngine({ makeStockfish: () => sf });
    await e.init();
    const got = [];
    e.analyse(FEN_B, {}, (i) => got.push(i));
    e.stop();
    expect(sf.sent[sf.sent.length - 1]).toBe('stop');
    sf.emit('info depth 5 multipv 1 score cp 1 pv d4e3');
    expect(got).toEqual([]);
  });

  it('falls back to the built-in engine when Stockfish fails to load', async () => {
    const sf = fakeStockfish({ silent: true, crash: true });
    const fb = fakeFallback();
    const e = createEngine({ makeStockfish: () => sf, makeFallback: () => fb });
    expect(await e.init()).toBe('fallback');
    expect(sf.terminated).toBe(true);
    const got = [];
    e.analyse(FEN_B, { depth: 16, ms: 1000 }, (i) => got.push(i));
    expect(fb.sent[1]).toEqual({ cmd: 'go', fen: FEN_B, depth: 4, ms: 1000 });
    fb.emit({ info: true, depth: 1, multipv: 1, cp: 800, mate: null, pv: ['d4e3'], turn: 'b' });
    expect(got.length).toBe(1);
  });

  it('reports none when no engine can start (timeout)', async () => {
    const e = createEngine({
      makeStockfish: () => fakeStockfish({ silent: true }),
      makeFallback: () => { throw new Error('no workers'); },
      timeoutMs: 20
    });
    expect(await e.init()).toBe('none');
    expect(e.kind).toBe('none');
  });
});
