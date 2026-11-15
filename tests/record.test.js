import { describe, it, expect } from 'vitest';
import { newGameItem, applyHeaders, normalizeHeaders, titleFromHeaders, ensureBook, defaultHeaders, pgnDate, resultLabel, RECORD_BOOK, START_FEN } from '../src/ui/record.js';
import { pgnOf, parseBackup, makeBackup } from '../src/ui/backup.js';
import { Core } from '../src/core/index.js';
import { setFromBook, isRemoteBook } from '../src/sync/model.js';

const NOW = new Date(2026, 10, 16, 18, 30).getTime(); // 16 Nov 2026, local time

describe('recording a game: creation', () => {
  it('"Мои партии" is created once and then reused', () => {
    const books = [{ id: 'x', name: 'Уроки', items: [] }];
    let n = 0;
    const a = ensureBook(books, RECORD_BOOK, () => 'b' + (++n), NOW);
    expect(a).toMatchObject({ created: true, book: { id: 'b1', name: 'Мои партии', items: [] } });
    const b = ensureBook(books, RECORD_BOOK, () => 'b' + (++n), NOW);
    expect(b.created).toBe(false);
    expect(b.book).toBe(a.book);
    expect(books.length).toBe(2);
  });
  it('a cloud set with the same name is not used as the local book', () => {
    const books = [{ id: 'set-1', name: 'Мои партии', remote: { setId: '1' }, items: [] }];
    expect(ensureBook(books, RECORD_BOOK, () => 'local', NOW).book.id).toBe('local');
  });
  it('a new game is an ordinary game item from the start position, today\'s date, result *', () => {
    const it = newGameItem({ id: 'g1', now: NOW });
    expect(it).toMatchObject({ id: 'g1', type: 'game', startFen: START_FEN, text: '', plies: 0, result: '*', recorded: true, source: 'record' });
    expect(it.headers).toEqual({ White: '', Black: '', Event: '', Date: '2026.11.16', Result: '*' });
    expect(it.title).toBe('Партия · 16.11.2026');
  });
  it('can start from the current position', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    expect(newGameItem({ id: 'g', now: NOW, fen }).startFen).toBe(fen);
  });
  it('the same format is ready for live games (stage 5)', () => {
    const it = newGameItem({ id: 'g', now: NOW, source: 'live', headers: { White: 'Тренер', Black: 'Арман', Event: 'Урок' } });
    expect(it).toMatchObject({ source: 'live', type: 'game', title: 'Тренер — Арман · Урок · 16.11.2026' });
  });
});

describe('recording a game: headers', () => {
  it('builds the title from the headers', () => {
    expect(titleFromHeaders({ White: 'Иванов', Black: 'Петров', Event: 'Первенство клуба', Date: '2026.11.16', Result: '1-0' }))
      .toBe('Иванов — Петров · Первенство клуба · 16.11.2026');
    expect(titleFromHeaders({ White: 'Иванов', Black: '', Event: '', Date: '????.??.??', Result: '*' })).toBe('Иванов — ?');
    expect(titleFromHeaders({ White: '', Black: '', Event: 'Блиц', Date: '2026.11.16', Result: '*' })).toBe('Партия · Блиц · 16.11.2026');
  });
  it('normalizes input: trims, clips, accepts ½-½ and 2026-11-16, rejects junk', () => {
    const h = normalizeHeaders({ White: '  Иванов\n ', Black: 'x'.repeat(100), Date: '2026-11-05', Result: '½-½' }, NOW);
    expect(h).toEqual({ White: 'Иванов', Black: 'x'.repeat(60), Event: '', Date: '2026.11.05', Result: '1/2-1/2' });
    expect(normalizeHeaders({ Date: 'вчера', Result: '2-0' }, NOW)).toMatchObject({ Date: '2026.11.16', Result: '*' });
    expect(normalizeHeaders({ Date: '????.??.??' }, NOW).Date).toBe('????.??.??');
    expect(resultLabel('1/2-1/2')).toBe('½-½');
    expect(defaultHeaders(NOW).Date).toBe(pgnDate(NOW));
  });
  it('editing headers updates the title and the result', () => {
    const it = newGameItem({ id: 'g', now: NOW });
    applyHeaders(it, { White: 'Иванов', Black: 'Петров', Event: '', Date: '2026.11.16', Result: '0-1' }, NOW);
    expect(it).toMatchObject({ title: 'Иванов — Петров · 16.11.2026', result: '0-1' });
  });
});

describe('recording a game: moves, PGN and storage', () => {
  function recordMoves(item, sans) {
    const r = Core.parseMovetext(item.startFen, item.text);
    let n = r.root;
    for (const s of sans) n = Core.tryMove(n, s).node;
    item.text = Core.toMovetext(r.root);
    item.plies = Core.mainLine(r.root).length;
    return { root: r.root, last: n };
  }

  it('moves, a variation after "back", and deleting the last move', () => {
    const it = newGameItem({ id: 'g', now: NOW });
    const { root, last } = recordMoves(it, ['e4', 'e5', 'Nf3']);
    Core.tryMove(last.parent, 'Nc3'); // went back one move and played another: a variation
    expect(Core.toMovetext(root)).toBe('1. e4 e5 2. Nf3 (2. Nc3)');
    Core.removeNode(last.parent.kids[1]); // "Удалить ход" on the variation
    Core.removeNode(last);                // and on the last main-line move
    expect(Core.toMovetext(root)).toBe('1. e4 e5');
  });

  it('exports PGN with the real headers', () => {
    const it = newGameItem({ id: 'g', now: NOW, headers: { White: 'Иванов', Black: 'Петров', Event: 'Клуб', Result: '1-0' } });
    recordMoves(it, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    const pgn = pgnOf(it, it.text);
    expect(pgn).toBe('[Event "Клуб"]\n[Site "?"]\n[Date "2026.11.16"]\n[Round "?"]\n[White "Иванов"]\n[Black "Петров"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0\n');
    // and the PGN reads back as the same game
    const back = Core.parseBook(pgn);
    expect(back[0]).toMatchObject({ type: 'game', text: '1. e4 e5 2. Nf3 Nc6 3. Bb5', plies: 5, result: '1-0', title: 'Иванов — Петров (Клуб, 2026)' });
  });

  it('a game from a position exports SetUp/FEN; old items without headers export as before', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const it = newGameItem({ id: 'g', now: NOW, fen });
    expect(pgnOf(it, '1. Rd8#')).toContain('[SetUp "1"]\n[FEN "' + fen + '"]');
    expect(pgnOf({ title: 'Старая', startFen: Core.START, result: '' }, '1. e4')).toContain('[Event "Старая"]\n[Site "?"]\n[Date "????.??.??"]');
  });

  it('headers survive a backup round trip; broken headers are normalized', () => {
    const it = newGameItem({ id: 'g', now: NOW, headers: { White: 'Иванов', Result: '1-0' } });
    recordMoves(it, ['d4', 'd5']);
    const book = { id: 'b', name: RECORD_BOOK, created: NOW, items: [it, { ...it, id: 'h', headers: { White: 5, Result: '9-9' } }] };
    const r = parseBackup(JSON.stringify(makeBackup([book], {})));
    expect(r.books[0].items[0]).toMatchObject({ headers: it.headers, recorded: true, source: 'record', text: '1. d4 d5', result: '1-0' });
    expect(r.books[0].items[1].headers).toMatchObject({ White: '5', Result: '*' });
  });

  it('stage-4 sync treats "Мои партии" as an ordinary local book (can be assigned as a set)', () => {
    const it = newGameItem({ id: 'g', now: NOW, headers: { White: 'Иванов', Black: 'Петров' } });
    recordMoves(it, ['e4', 'c5']);
    const book = { id: 'b', name: RECORD_BOOK, items: [it] };
    expect(isRemoteBook(book)).toBe(false); // its moves are never pushed as student progress
    const set = setFromBook(book, book.items, {});
    expect(set).toMatchObject({ title: 'Мои партии', source: 'Мои партии' });
    expect(set.rows[0]).toMatchObject({ kind: 'game', start_fen: START_FEN, movetext: '1. e4 c5' });
  });
});
