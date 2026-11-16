// Stage B of scan import on SYNTHETIC pages (drawn in the test; no book pages):
// board frames, hatched dark squares, the □/■ marker, and results -> library items.
import { describe, it, expect } from 'vitest';
import { findBoards, readMarker, horizontalRuns } from '../src/scan/boards.js';
import { scanItemsFrom, mergeScanItems, scanBookName, scanTitle } from '../src/scan/to-items.js';
import { castlingFrom, positionProblems } from '../src/scan/recognize.js';

// --- a tiny raster for synthetic pages
function page(w, h) { return { width: w, height: h, gray: new Uint8ClampedArray(w * h).fill(255) }; }
function rect(g, x, y, w, h, v = 0) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g.gray[yy * g.width + xx] = v; }
function frame(g, x, y, s, t) { rect(g, x, y, s, t); rect(g, x, y + s - t, s, t); rect(g, x, y, t, s); rect(g, x + s - t, y, t, s); }
function hatch(g, x, y, s) { for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) if ((xx + yy) % 4 === 0) g.gray[(y + yy) * g.width + x + xx] = 0; }
// a diagram: frame + 8x8 board with hatched dark squares
function diagram(g, x, y, s, t = 3) {
  frame(g, x, y, s, t);
  const sq = (s - 2 * t) / 8;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) hatch(g, Math.round(x + t + c * sq), Math.round(y + t + r * sq), Math.floor(sq));
  return { x: x + t, y: y + t, w: s - 2 * t };
}

describe('board detection on a synthetic page', () => {
  const g = page(1000, 1400);
  const b1 = diagram(g, 120, 100, 300);
  const b2 = diagram(g, 600, 100, 300);
  const b3 = diagram(g, 300, 800, 380);
  // text-like noise: short dark runs and a long rule line that is not a board
  rect(g, 50, 60, 900, 2);
  for (let i = 0; i < 40; i++) rect(g, 100 + i * 20, 600, 12, 14);

  it('finds every frame, sorted top-down / left-right, and steps inside the frame', () => {
    const boards = findBoards(g);
    expect(boards.length).toBe(3);
    expect(boards.map((b) => [b.outer.x, b.outer.y])).toEqual([[120, 100], [600, 100], [300, 800]]);
    for (const [b, exp] of [[boards[0], b1], [boards[1], b2], [boards[2], b3]]) {
      expect(Math.abs(b.inner.x - exp.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.inner.y - exp.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.inner.w - exp.w)).toBeLessThanOrEqual(2);
    }
  });
  it('ignores a long rule that has no square frame under it', () => {
    expect(horizontalRuns(g, 180).some((r) => r.y === 60)).toBe(true);
    expect(findBoards(g).every((b) => b.outer.y !== 60)).toBe(true);
  });
  it('finds a frame of a slightly rotated scan (the sides drift by a few pixels)', () => {
    const h = page(800, 700);
    // top and bottom lines, sides drifting by 3 px from top to bottom (about 0.6°)
    rect(h, 100, 100, 300, 3); rect(h, 103, 397, 300, 3);
    for (let y = 100; y < 400; y++) { const dx = Math.round((y - 100) / 100); rect(h, 100 + dx, y, 2, 1); rect(h, 398 + dx, y, 2, 1); }
    expect(findBoards(h).length).toBe(1);
  });
  it('accepts a frame whose top line is broken near a corner', () => {
    const h = page(800, 600);
    diagram(h, 100, 100, 300);
    rect(h, 384, 100, 6, 3, 255); // gap in the top line near the right corner (~5% of the width, as in a real book)
    expect(findBoards(h).length).toBe(1);
  });
});

describe('side-to-move marker', () => {
  function withMarker(kind) {
    const g = page(800, 600);
    diagram(g, 200, 100, 300);
    const s = 22, x = 200 - 40, y = 100 + 300 - s - 2;
    if (kind === 'filled') rect(g, x, y, s, s);
    if (kind === 'filled?') { rect(g, x, y, s, s); rect(g, x + 8, y + 5, 6, 10, 255); }
    if (kind === 'empty' || kind === 'empty?') { frame(g, x, y, s, 2); if (kind === 'empty?') rect(g, x + 9, y + 6, 4, 9); }
    return readMarker(g, findBoards(g)[0]);
  }
  it('■ = Black to move, □ = White, a sign inside = task', () => {
    expect(withMarker('filled')).toMatchObject({ side: 'b', task: false });
    expect(withMarker('filled?')).toMatchObject({ side: 'b', task: true });
    expect(withMarker('empty')).toMatchObject({ side: 'w', task: false });
    expect(withMarker('empty?')).toMatchObject({ side: 'w', task: true });
    expect(withMarker('none')).toBe(null);
  });
});

describe('position checks', () => {
  it('castling rights from the king and rook placement', () => {
    expect(castlingFrom({ e1: 'wK', h1: 'wR', a1: 'wR', e8: 'bK' })).toBe('KQ');
    expect(castlingFrom({ e1: 'wK', e8: 'bK', a8: 'bR' })).toBe('q');
    expect(castlingFrom({ g1: 'wK', e8: 'bK' })).toBe('-');
  });
  it('reports what makes a recognized position unplayable', () => {
    expect(positionProblems({ e1: 'wK', e8: 'bK' }, 'w')).toEqual([]);
    expect(positionProblems({ e1: 'wK' }, 'w')).toContain('нет чёрного короля');
    expect(positionProblems({ e1: 'wK', e8: 'bK', a1: 'wP' }, 'w')).toContain('пешка на a1');
    expect(positionProblems({ e1: 'wK', e8: 'bK', e2: 'wQ' }, 'w')).toContain('король стороны, которая не ходит, под шахом');
  });
});

describe('scan results -> library items', () => {
  const R = [
    { id: '60:0', page: 60, index: 0, fen: '2k5/3p3r/K3pP1P/4R3/8/8/8/8 w - - 0 1', side: 'w', task: true, valid: true },
    { id: '60:1', page: 60, index: 1, fen: 'x', side: 'b', task: false, valid: false },
    { id: '61:0', page: 61, index: 0, fen: '8/p7/2k1K3/2p5/PpP5/1P6/8/8 b - - 0 1', side: 'b', task: false, valid: true, number: '1.157' },
    { id: '61:1', page: 61, index: 1, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', side: 'w', task: false, valid: true, status: 'skipped' }
  ];
  it('valid, not skipped diagrams become puzzles with page/number in the source', () => {
    const items = scanItemsFrom(R, 'Учебник (скан)');
    expect(items.map((i) => i.id)).toEqual(['scan-60-0', 'scan-61-0']);
    expect(items[0]).toMatchObject({ type: 'puzzle', title: 'Диаграмма (стр. 61, диаграмма 1) · задание', srcPage: 61, note: 'Задание. Ход белых.' });
    expect(items[1]).toMatchObject({ title: 'Диаграмма 1.157', source: 'Учебник (скан), стр. 62, диаграмма 1.157', note: 'Ход чёрных.' });
    expect(scanBookName('Дворецкий. Учебник эндшпиля.pdf')).toBe('Дворецкий. Учебник эндшпиля (скан)');
    expect(scanTitle({ page: 0, index: 2, task: false })).toBe('Диаграмма (стр. 1, диаграмма 3)');
  });
  it('saving again updates by id, keeps progress and the coach\'s edits', () => {
    const book = { items: [] };
    expect(mergeScanItems(book, scanItemsFrom(R, 'B'))).toEqual({ added: 2, updated: 0 });
    book.items[0].stat = { n: 1 }; book.items[1].edited = true; book.items[1].title = 'Моё название';
    expect(mergeScanItems(book, scanItemsFrom(R, 'B'))).toEqual({ added: 0, updated: 1 });
    expect(book.items[0].stat).toEqual({ n: 1 });
    expect(book.items[1].title).toBe('Моё название');
  });
});
