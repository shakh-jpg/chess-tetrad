// Stage C: moves from OCR text, checked by the rules from the diagram position (synthetic text).
import { describe, it, expect } from 'vitest';
import { Chess } from '../src/core/chess.js';
import { canonToken, matchMove, bestRun, readMoves, tokenize, toMovetext, diagramNumber } from '../src/scan/moves.js';

describe('OCR token -> canonical spelling', () => {
  it('Russian, English, figurines, long and short, captures, castling', () => {
    expect(canonToken('Крc2—b2!')).toEqual(['Kc2-b2', 'Nc2-b2']);
    expect(canonToken('5....Лe8—e7')).toEqual(['Re8-e7']);
    expect(canonToken('Лb6:b7.')).toEqual(['Rb6:b7']);
    expect(canonToken('Фd1хh5+')).toEqual(['Qd1:h5']);
    expect(canonToken('Nxe5')).toEqual(['N:e5']);
    expect(canonToken('♘f3')).toEqual(['Nf3']);
    expect(canonToken('0—0—0')).toEqual(['O-O-O']);
    expect(canonToken('с4')).toEqual(['c4', '*c4']); // Cyrillic file letter is not a bishop; *c4 = a figurine lost by OCR
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
    expect(matchMove(c, '§b8')).toMatchObject({ san: 'Rb8+', sure: true, d: 0.5 }); // unreadable sign, only one move to b8
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

describe('figurines from an English OCR pass', () => {
  // 1.157-like position, Black to move: king c6, pawns; White king e6
  const fen = '8/p7/2k1K3/2p5/PpP5/1P6/8/8 b - - 0 1';
  it('a digit in place of a figurine is "some piece"; the rules pick it', () => {
    expect(canonToken('2b6')).toEqual(['*b6']);
    const run = bestRun(fen, tokenize('1...2b6! 2.4 d5 a6! 3.2d6'));
    expect(run.moves.map((m) => m.san)).toEqual(['Kb6', 'Kd5', 'a6', 'Kd6']);
    expect(run.moves.every((m) => m.sure)).toBe(true); // a single legal move to each square
  });
});

describe('stretches of moves for the second OCR pass', async () => {
  const { moveSpans } = await import('../src/scan/moves.js');
  const W = (text, x0, y0) => ({ text, x0, y0, x1: x0 + 10 * text.length, y1: y0 + 20 });
  it('keeps runs of move-like words per line, drops prose', () => {
    const words = [W('Потеря', 0, 0), W('пешки', 70, 0), W('кажется', 130, 0),
      W('1...®', 0, 30), W('66!', 60, 30), W('2.Ф', 100, 30), W('d5', 140, 30), W('и', 170, 30), W('пешка', 190, 30), W('неуязвима', 260, 30),
      W('3.46?!', 0, 60), W('\\е5,', 70, 60)];
    const s = moveSpans(words);
    expect(s.length).toBe(2);
    expect(s[0]).toMatchObject({ x0: 0, y0: 30, x1: 160, n: 4 });
    expect(s[1]).toMatchObject({ x0: 0, y0: 60, n: 2 });
  });
});

describe('a game through the commentary (figurine book, English OCR pass)', () => {
  // synthetic text in the style of the second OCR pass: figurines lost or read as digits
  const fen = '2kr2r1/1p3p1p/p1n1bp2/q2Pp3/2B5/P1N5/P1PQ1PPP/3RK2R b K - 0 1';
  const text = '16... 215? 16... 2xg2! 17. 2d3! 3 17... 2xd3 18. xd3 5d4 19. 0-0 b8 20. h1 xa3 21. f4';
  it('reads on across comments, bridges ties, digits for figurines and files', () => {
    const r = readMoves(fen, tokenize(text));
    expect(r.moves.map((m) => m.san)).toEqual(['Bf5', 'Bd3', 'Bxd3', 'Qxd3', 'Nd4', 'O-O', 'Kb8', 'Kh1', 'Qxa3', 'f4']);
    expect(r.moves[1].sure).toBe(false); // «2d3»: ♗d3 or ♕d3 — chosen by what follows, marked uncertain
  });
});
