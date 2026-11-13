import { describe, it, expect } from 'vitest';
import { Core } from '../src/core/index.js';
import { BookPdf } from '../src/pdf-import/bookpdf.js';
import { sampleBook } from '../src/ui/sample-book.js';

const { parseBook, parseMovetext, toMovetext, mainLine, normMove, START } = Core;

describe('PGN and book text parsing', () => {
  it('parses variations, NAGs and comments from PGN', () => {
    const r = parseMovetext(START, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Main} (3... Nf6 4. O-O $1 Nxe4) 4. Ba4 Nf6 5. O-O Be7 1-0');
    expect(r.err).toBe(null);
    expect(r.result).toBe('1-0');
    expect(toMovetext(r.root)).toBe('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Main} (3... Nf6 4. O-O! Nxe4) 4. Ba4 Nf6 5. O-O Be7');
  });

  it('accepts textual NAGs (!, ?!, !!) after moves', () => {
    const r = parseMovetext(START, '1. e4! e5?! 2. Qh5!! Nc6');
    const ml = mainLine(r.root);
    expect(ml.map((n) => n.nag || '')).toEqual(['!', '?!', '!!', '']);
  });

  it('reads Russian notation, Cyrillic file letters and 0-0', () => {
    const r = parseMovetext(START, '1. е4 е5 2. Кf3 Кc6 3. Сc4 Сc5 4. 0-0 Кf6 5. Лe1 0-0 6. c3 d6 7. d4 Сb6 8. Фd3 Крh8');
    expect(r.err).toBe(null);
    expect(toMovetext(r.root)).toBe('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. Re1 O-O 6. c3 d6 7. d4 Bb6 8. Qd3 Kh8');
  });

  it('normalizes single moves', () => {
    expect(normMove('Кf3')).toBe('Nf3');
    expect(normMove('Крe2')).toBe('Ke2');
    expect(normMove('е8Ф')).toBe('e8=Q');
    expect(normMove('0-0-0')).toBe('O-O-O');
    expect(normMove('♘f3')).toBe('Nf3');
  });

  it('reports the first unplayable move with context', () => {
    const r = parseMovetext(START, '1. e4 e5 2. Ke3');
    expect(r.err).toMatchObject({ token: 'Ke3', before: '1... e5' });
  });

  it('splits a pasted PGN with several games and a [FEN] puzzle', () => {
    const txt = [
      '[Event "Test"]', '[White "Ivanov"]', '[Black "Petrov"]', '[Result "1-0"]', '',
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0', '',
      '[Event "Mate in one"]', '[SetUp "1"]', '[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"]', '',
      '1. Rd8# 1-0', '',
      'Петров — Сидоров',
      '1. е4 е5 2. Кf3 Кc6 3. Сc4 Сc5 *'
    ].join('\n');
    const items = parseBook(txt);
    expect(items.map((i) => [i.type, i.title, i.plies, i.err])).toEqual([
      ['game', 'Ivanov — Petrov (Test)', 6, null],
      ['puzzle', 'Mate in one', 1, null],
      ['game', 'Петров — Сидоров', 6, null]
    ]);
    expect(items[1].startFen).toBe('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    expect(items[0].result).toBe('1-0');
  });

  // Regression for the stage-0 bug: the puzzle got the title '[Result "1-0"]' from the previous game.
  it('never takes a PGN tag line of the previous game as a title', () => {
    const txt = [
      '[White "A"]', '[Black "B"]', '[Result "1-0"]', '',
      '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0', '',
      '[SetUp "1"]', '[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"]', '',
      '1. Rd8# 1-0'
    ].join('\n');
    const items = parseBook(txt);
    expect(items[1].type).toBe('puzzle');
    expect(items[1].title).toBe('Задача 2');
  });

  it('does not take the tail of the previous game ("23. Be7# 1-0") as a title', () => {
    const txt = 'Game one\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5\n4. b4 1-0\n\n6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1\n1. Rd8#';
    const items = parseBook(txt);
    expect(items[1].title).toBe('Задача 2');
  });

  it('still uses a free-text heading right above a game', () => {
    const items = parseBook('Задача 7. Мат в один ход\n6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1\nРешение: 1. Лd8#');
    expect(items[0].title).toBe('Задача 7. Мат в один ход');
    expect(items[0].text).toBe('1. Rd8#');
  });

  it('parses the built-in sample book without errors', () => {
    const b = sampleBook();
    expect(b.items.length).toBe(6);
    expect(b.items.filter((i) => i.err)).toEqual([]);
    expect(b.items.map((i) => i.type)).toEqual(['game', 'game', 'puzzle', 'puzzle', 'puzzle', 'puzzle']);
    expect(b.items[0].plies).toBe(45);
    // NOTE: sample "Задача 4" ends with 2. Qb8+ (not mate: Kh7). Content question for the coach, left as is.
    expect(b.items[5].text).toBe('1. Ra7 h6 (1... Kf8 2. Qb8#) 2. Qb8+');
  });
});

describe('book brackets -> PGN', () => {
  it('turns [moves] into variations and [text] into comments', () => {
    expect(BookPdf.bracketsToPgn('1. Rd8+ [1. Qe8+? Kh7] Kh7 [weak; 1... Qf8 2. Rxf8#]'))
      .toBe('1. Rd8+ (1. Qe8+? Kh7) Kh7 {weak; 1... Qf8 2. Rxf8#}');
    expect(BookPdf.bracketsToPgn('1. e4 [1. d4 d5; 1. c4 e5] e5'))
      .toBe('1. e4 (1. d4 d5) (1. c4 e5) e5');
  });

  it('builds a FEN from diagram font rows', () => {
    // Font cells: 'pnbrqk' (any case) are white pieces, 'omvtwl' are black P N B R Q K.
    const rows = ['....l...', 'oooo....', '........', '........', '........', '........', '....p...', 'r...k..r'];
    expect(BookPdf.boardFen(rows, 'b')).toBe('4k3/pppp4/8/8/8/8/4P3/R3K2R b KQ - 0 1');
  });
});
