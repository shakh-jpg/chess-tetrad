import { describe, it, expect } from 'vitest';
import { parseInfo, scoreText, whiteShare } from '../src/engine/uci.js';

// Real lines captured from Stockfish 19 lite (node_modules/stockfish).
const START_D16 = 'info depth 16 seldepth 26 multipv 1 score cp 28 nodes 352089 nps 360377 hashfull 129 tbhits 0 time 977 pv e2e4 e7e5 g1f3';
const BLACK_UP_QUEEN = 'info depth 12 seldepth 21 multipv 1 score cp 925 nodes 148760 nps 469274 hashfull 26 tbhits 0 time 317 pv d4e3 e1d1 e3f2';

describe('UCI info parsing', () => {
  it('parses depth, multipv, cp and pv', () => {
    expect(parseInfo(START_D16, 'w')).toEqual({
      info: true, depth: 16, multipv: 1, cp: 28, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'], turn: 'w'
    });
  });

  it('parses mate scores', () => {
    const l = parseInfo('info depth 9 seldepth 4 multipv 2 score mate -2 nodes 10 nps 1 time 1 pv h7h6 d8e8', 'b');
    expect(l).toMatchObject({ multipv: 2, cp: null, mate: -2, pv: ['h7h6', 'd8e8'] });
  });

  it('defaults multipv to 1 when absent', () => {
    expect(parseInfo('info depth 3 score cp 10 nodes 5 pv e2e4', 'w').multipv).toBe(1);
  });

  it('skips aspiration-window bound lines (they made scores jump)', () => {
    expect(parseInfo('info depth 20 seldepth 30 multipv 1 score cp 140 lowerbound nodes 1 nps 1 time 1 pv e2e4', 'w')).toBe(null);
    expect(parseInfo('info depth 20 seldepth 30 multipv 1 score cp -40 upperbound nodes 1 nps 1 time 1 pv e2e4', 'w')).toBe(null);
  });

  it('ignores non-info and pv-less lines', () => {
    expect(parseInfo('bestmove e2e4 ponder e7e5', 'w')).toBe(null);
    expect(parseInfo('info string NNUE evaluation using nn-xxx.nnue', 'w')).toBe(null);
    expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1', 'w')).toBe(null);
  });
});

describe('score from White\'s point of view', () => {
  it('start position: small plus for White (Stockfish 19 scale)', () => {
    const l = parseInfo(START_D16, 'w');
    expect(scoreText(l)).toBe('+0.28');
    expect(whiteShare(l)).toBeGreaterThan(50);
    expect(whiteShare(l)).toBeLessThan(55);
  });

  it('black to move and better: engine says +9.25 for the side to move, shown as minus', () => {
    const l = parseInfo(BLACK_UP_QUEEN, 'b');
    expect(scoreText(l)).toBe('−9.25');
    expect(whiteShare(l)).toBeLessThan(10);
  });

  it('mates are shown with # and the right sign', () => {
    expect(scoreText({ mate: 3, cp: null, turn: 'w' })).toBe('+#3');
    expect(scoreText({ mate: 3, cp: null, turn: 'b' })).toBe('−#3');
    expect(scoreText({ mate: -1, cp: null, turn: 'b' })).toBe('+#1');
    expect(whiteShare({ mate: -1, cp: null, turn: 'b' })).toBe(100);
  });

  it('equal is shown without sign', () => {
    expect(scoreText({ cp: 0, mate: null, turn: 'w' })).toBe('0.00');
    expect(whiteShare({ cp: 0, mate: null, turn: 'b' })).toBe(50);
  });
});
