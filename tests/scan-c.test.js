// Stage C: moves from OCR text, checked by the rules from the diagram position (synthetic text).
import { describe, it, expect } from 'vitest';
import { Chess } from '../src/core/chess.js';
import { canonToken, matchMove, bestRun, tokenize, toMovetext, diagramNumber } from '../src/scan/moves.js';

describe('OCR token -> canonical spelling', () => {
  it('Russian, English, figurines, long and short, captures, castling', () => {
    expect(canonToken('Крc2—b2!')).toEqual(['Kc2-b2', 'Nc2-b2']);
    expect(canonToken('5....Лe8—e7')).toEqual(['Re8-e7']);
    expect(canonToken('Лb6:b7.')).toEqual(['Rb6:b7']);
    expect(canonToken('Фd1хh5+')).toEqual(['Qd1:h5']);
    expect(canonToken('Nxe5')).toEqual(['N:e5']);
    expect(canonToken('♘f3')).toEqual(['Nf3']);
    expect(canonToken('0—0—0')).toEqual(['O-O-O']);
    expect(canonToken('с4')).toEqual(['c4']); // Cyrillic file letter is not a bishop
    expect(canonToken('Сb5')).toEqual(['Bb5']);
    expect(canonToken('ЛаЗ')).toEqual(['Ra3']); // Cyrillic а and З from OCR
    expect(canonToken('черные')).toEqual([]);
    // typical OCR noise of Russian notation
    expect(canonToken('JIb8—D7')[0]).toBe('Rb8-D7'.replace('D', '')); // «Л» as «JI»; a broken square stays approximate
    expect(canonToken('Кр!6—!7')).toEqual(['Kf6-f7', 'Nf6-f7']);
    expect(canonToken('ЛЬ7—Ъ8')).toEqual(['Rb7-b8']);
    expect(canonToken('Лаб—сб')).toEqual(['Ra6-c6']);
  });
});

describe('the rules choose the move', () => {
  it('matches exact and approximate spellings of legal moves', () => {
    const c = new Chess('r5k1/1R6/8/8/8/8/6PP/6K1 w - - 0 1');
    expect(matchMove(c, 'Лb7—b8+')).toEqual({ san: 'Rb8+', sure: true, d: 0 });
    expect(matchMove(c, 'Лb7-b8')).toMatchObject({ san: 'Rb8+', sure: true });
    expect(matchMove(c, 'Лb7—b9')).toBe(null); // no such square
    expect(matchMove(c, '§b8')).toMatchObject({ san: 'Rb8+', sure: false }); // unreadable piece sign
    expect(matchMove(c, 'Кре1')).toBe(null); // the king cannot go there… f1/f2/h1? e1 is not adjacent to g1
  });
  it('finds the run of moves that is legal from the diagram, among prose', () => {
    const text = 'Черные ушли в «глухую оборону». 8. Крc2—b2! Точный ход! 8...Лb7—b8 9. Лc6—d6! Лb8—b7 10. Ла6—b6 и т. д.';
    const fen = '8/1r3pk1/2R5/1p6/1P6/8/1K6/8 w - - 0 1';
    const run = bestRun('8/1r3pk1/2R5/1p6/1P6/8/2K5/8 w - - 0 1', tokenize(text));
    expect(run.moves.map((m) => m.san)).toEqual(['Kb2']); // a single long move; prose ends the run
    const run2 = bestRun(fen.replace(' w ', ' b '), tokenize(text));
    expect(run2.moves.map((m) => m.san)).toEqual(['Rb8', 'Rd6', 'Rb7', 'Rb6']);
    // «Ла6—b6»: the rook stands on d6 — the closest legal move is taken and marked uncertain
    expect(run2.moves.map((m) => m.sure)).toEqual([true, true, true, false]);
  });
  it('prose is not taken for moves: a lone move or bare squares need a move number', () => {
    expect(bestRun('8/8/8/8/8/8/R7/K6k w - - 0 1', tokenize('Ла6 стоит хорошо')).moves).toEqual([]);
    expect(bestRun('8/8/8/8/8/8/R7/K6k w - - 0 1', tokenize('хотел пойти Лa2—a6, но')).moves).toEqual([]);
    expect(bestRun('8/8/8/8/8/8/R7/K6k w - - 0 1', tokenize('если пойти 1. Лa2—a6, то')).moves.map((m) => m.san)).toEqual(['Ra6']);
    expect(bestRun('6k1/8/8/8/8/8/7P/6K1 w - - 0 1', tokenize('с королями на h4 и g6 при ходе')).moves).toEqual([]);
  });
  it('joins a piece sign split off its square', () => {
    expect(tokenize('2.Ф d5 a6! 3. ♘ f3')).toEqual(['2.', 'Фd5', 'a6!', '3.', '♘f3']);
  });
  it('movetext with the move numbers of the position', () => {
    expect(toMovetext('8/8/8/8/8/8/8/8 b - - 0 8', [{ san: 'Rb8' }, { san: 'Rd6' }, { san: 'Rb7' }])).toBe('8... Rb8 9. Rd6 Rb7');
    expect(toMovetext('8/8/8/8/8/8/8/8 w - - 0 1', [{ san: 'e4' }, { san: 'e5' }])).toBe('1. e4 e5');
  });
});

describe('diagram number next to the board', () => {
  const o = { x: 200, y: 100, w: 300, h: 300 };
  it('left of the top corner («1.155») or below the board («Диагр. 107»)', () => {
    expect(diagramNumber([{ text: '1.155', x0: 140, y0: 100, x1: 195, y1: 115 }, { text: '62', x0: 300, y0: 900, x1: 320, y1: 915 }], o)).toBe('1.155');
    expect(diagramNumber([{ text: 'Диагр.', x0: 280, y0: 420, x1: 330, y1: 435 }, { text: '107', x0: 335, y0: 420, x1: 360, y1: 435 }], o)).toBe('107');
    expect(diagramNumber([{ text: 'e4', x0: 150, y0: 110, x1: 170, y1: 125 }], o)).toBe(null);
    // rank coordinates next to the board are not diagram numbers
    expect(diagramNumber([{ text: '8', x0: 185, y0: 105, x1: 195, y1: 118 }, { text: '108', x0: 335, y0: 420, x1: 360, y1: 435 }], o)).toBe('108');
  });
});
