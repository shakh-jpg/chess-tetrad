// Compares the modular parser with the original prototype code, run as-is in a sandbox.
// Proves that moving the code into modules did not change parsing behaviour.
// Skipped automatically when the prototype snapshot is not next to the repository.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Core } from '../src/core/index.js';
import { BookPdf } from '../src/pdf-import/bookpdf.js';

const PROTO = fileURLToPath(new URL('../../original/shakhmatnaya-tetrad_artifact_2026-11-13.html', import.meta.url));
const has = fs.existsSync(PROTO);

function loadPrototype() {
  const html = fs.readFileSync(PROTO, 'utf8');
  const chessStart = html.indexOf('<script>', html.indexOf('</style>')) + '<script>'.length;
  const chessSrc = html.slice(chessStart, html.indexOf('</script>', chessStart));
  const coreSrc = html.slice(html.indexOf('/* Ядро:'), html.indexOf('/* Движок:'));
  const ctx = vm.createContext({});
  vm.runInContext(chessSrc, ctx);
  vm.runInContext(coreSrc, ctx);
  return { Core: ctx.ChessCore, BookPdf: ctx.BookPdf };
}

const CORPUS = [
  // sample book of the prototype
  'Андерсен — Кизерицкий, Лондон 1851\n1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0\n\nЛегаль — Сен-Бри, Париж 1750\n1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 {Чёрные не заметили ловушки} 5.Nxe5 Bxd1 6.Bxf7+ Ke7 7.Nd5# 1-0\n\nПозиция с вариантом (тест разбора)\n6k1/6pp/8/8/8/8/1Q4PP/R5K1 w - - 0 1\nРешение: 1. Лa7 h6 (1... Крf8 2. Фb8#) 2. Фb8#',
  // PGN with tags, variations, NAGs
  '[Event "Test"]\n[White "Ivanov"]\n[Black "Petrov"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Main} (3... Nf6 4. O-O $1 Nxe4 (4... Be7 5. Re1)) 4. Ba4 Nf6 5. O-O Be7 1-0',
  // Russian book text with Cyrillic letters, dashes and soft hyphens
  'Партия 3\n1. е2-е4 е7-е5 2. Кg1-f3 Кb8-c6 3. Сf1-c4 Сf8-c5 4. c2-c3 Кg8-f6 5. d2-d4 е5:d4 6. c3:d4 Сc5-b4+ 7. Кb1-c3 Кf6:е4 8. 0-0 Сb4:c3 9. d4-d5 Сc3-f6 10. Лf1-е1 Кc6-е7 11. Л:е4 d7-d6 12. Сc1-g5 С:g5 13. К:g5 h7-h6',
  // figurine notation, ellipsis, results
  '1. e4 c5 2. ♘f3 d6 3. d4 c×d4 4. ♘×d4 ♘f6 5. ♘c3 a6 6. ♗g5 e6 7. f4 ♕b6 8. ♕d2 ♕×b2 9. ♖b1 ♕a3 ½-½',
  // broken move in the main line and in a variation
  'Ошибочная партия\n1. e4 e5 2. Nf3 Nc6 (2... Ke3 3. d4) 3. Bb5 a6 4. Bxe8 Nf6 5. O-O',
  // FEN puzzle with black to move and promotion
  'Задача 9. Чёрные начинают\n8/8/8/8/8/2k5/1p6/1K6 b - - 0 1\n1... Kb3 2. Ka1 b1=Q+'
];

describe.skipIf(!has)('equivalence with the prototype', () => {
  const P = has ? loadPrototype() : null;

  it('parseBook gives identical results', () => {
    for (const txt of CORPUS) expect(Core.parseBook(txt)).toEqual(P.Core.parseBook(txt));
  });

  it('parseMovetext + toMovetext give identical movetext', () => {
    for (const txt of CORPUS) {
      const a = Core.parseMovetext(Core.START, txt), b = P.Core.parseMovetext(P.Core.START, txt);
      expect(Core.toMovetext(a.root)).toBe(P.Core.toMovetext(b.root));
      expect(a.err).toEqual(b.err);
      expect(a.warn).toBe(b.warn);
    }
  });

  it('differs from the prototype only in the fixed title bug', () => {
    const txt = '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n\n[SetUp "1"]\n[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"]\n\n1. Rd8# 1-0';
    const a = Core.parseBook(txt), b = P.Core.parseBook(txt);
    expect(b[1].title).toBe('[Result "1-0"]'); // the old bug
    expect(a[1].title).toBe('Задача 2');
    expect({ ...a[1], title: '' }).toEqual({ ...b[1], title: '' });
    expect(a[0]).toEqual(b[0]);
  });

  it('tokenizer and bracket conversion are identical', () => {
    for (const txt of CORPUS) {
      expect(Core.tokenize(txt)).toEqual(P.Core.tokenize(txt));
      expect(BookPdf.bracketsToPgn(txt)).toBe(P.BookPdf.bracketsToPgn(txt));
    }
  });
});
