import { describe, it, expect } from 'vitest';
import { Chess } from '../src/core/chess.js';

describe('chess rules (vendored chess.js)', () => {
  it('starts from the standard position with 20 legal moves', () => {
    const g = new Chess();
    expect(g.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(g.moves().length).toBe(20);
  });

  it('castles both sides and updates castling rights', () => {
    const g = new Chess('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    expect(g.moves()).toContain('O-O');
    expect(g.moves()).toContain('O-O-O');
    expect(g.move('O-O')).toBeTruthy();
    expect(g.fen().split(' ')[2]).toBe('kq');
    expect(g.move('O-O-O')).toBeTruthy();
    expect(g.fen()).toBe('2kr3r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 w - - 2 2');
  });

  it('forbids castling through check', () => {
    const g = new Chess('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
    expect(g.moves()).not.toContain('O-O');
  });

  it('captures en passant', () => {
    const g = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
    const m = g.move('exd6');
    expect(m).toBeTruthy();
    expect(m.flags).toContain('e');
    expect(g.get('d5')).toBe(null);
  });

  it('promotes to any piece; under-promotion included', () => {
    const g = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promos = g.moves().filter((m) => m.startsWith('a8'));
    expect(promos.sort()).toEqual(['a8=B', 'a8=N', 'a8=Q+', 'a8=R+'].sort());
    g.move('a8=N');
    expect(g.get('a8')).toEqual({ type: 'n', color: 'w' });
  });

  it('detects checkmate', () => {
    const g = new Chess();
    ['f3', 'e5', 'g4', 'Qh4#'].forEach((m) => g.move(m));
    expect(g.in_checkmate()).toBe(true);
    expect(g.game_over()).toBe(true);
  });

  it('detects stalemate', () => {
    const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(g.in_stalemate()).toBe(true);
    expect(g.in_checkmate()).toBe(false);
    expect(g.in_draw()).toBe(true);
  });

  it('rejects an illegal move and an invalid FEN', () => {
    const g = new Chess();
    expect(g.move('e5')).toBe(null);
    expect(new Chess().load('not a fen')).toBe(false);
  });

  it('accepts sloppy long-algebraic input (used by the parser)', () => {
    const g = new Chess();
    expect(g.move('e2e4', { sloppy: true }).san).toBe('e4');
  });
});
