// @vitest-environment happy-dom
// Untrusted text (book, PGN, backup file, cloud set) must be shown as text, never become markup.
import { describe, it, expect } from 'vitest';
import { booksHTML, itemsHTML, filterItems } from '../src/ui/library.js';
import { movesHTML } from '../src/ui/moves-view.js';
import { parseBackup } from '../src/ui/backup.js';
import { boardSVG } from '../src/board/svg.js';
import { fenToMap } from '../src/board/position.js';
import { mergeRemoteSet } from '../src/sync/model.js';
import { Core } from '../src/core/index.js';

const IMG = '<img src=x onerror="window.__pwned=1">';
const SCRIPT = '<script>window.__pwned=1</script>';
const BREAK = '" onmouseover="window.__pwned=1" x="';
const EVIL = IMG + SCRIPT + BREAK;
const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

// Renders markup like innerHTML does and reports anything executable.
function render(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  const all = [...host.querySelectorAll('*')];
  return {
    host,
    tags: all.filter((e) => /^(img|script|iframe|object|embed)$/i.test(e.tagName)).map((e) => e.tagName),
    handlers: all.flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.tagName + '@' + a.name)),
    text: host.textContent
  };
}
function expectInert(html, mustShow) {
  const r = render(html);
  expect(r.tags).toEqual([]);
  expect(r.handlers).toEqual([]);
  expect(window.__pwned).toBeUndefined();
  if (mustShow) expect(r.text).toContain(mustShow);
  return r;
}

describe('library: book names, titles, sections, ids', () => {
  const book = { id: 'b' + BREAK, name: 'Книга ' + EVIL, items: [
    { id: 'i' + BREAK, type: 'puzzle' + BREAK, title: 'Задача ' + EVIL, section: 'Раздел ' + SCRIPT, plies: '3' + IMG, stat: { n: 1, res: 'clean', due: 0 } }
  ] };
  it('book list shows the name as text', () => {
    expectInert(booksHTML([book], book.id, book.id), 'Книга <img');
  });
  it('item list shows title and section as text; type/plies cannot inject', () => {
    const r = expectInert(itemsHTML(filterItems(book.items, 'all', ''), null, ''), 'Задача <img');
    expect(r.text).toContain('Раздел <script>');
    expect(r.host.querySelector('.tag').className).toBe('tag game'); // unknown type -> game
    expect(r.host.querySelector('.item').getAttribute('data-item')).toBe('i' + BREAK); // kept as data, not markup
  });
});

describe('PGN from a book: tags and comments', () => {
  it('a game whose title and comment contain markup renders as text', () => {
    const pgn = '[Event "' + IMG.replace(/"/g, "'") + '"]\n[White "' + SCRIPT + '"]\n[Black "B"]\n\n1. e4 {' + EVIL.replace(/[{}]/g, '') + '} e5 2. Nf3 Nc6 3. Bb5 *';
    const items = Core.parseBook(pgn);
    expect(items.length).toBe(1);
    expectInert(itemsHTML(items.map((x, i) => ({ ...x, id: 'g' + i })), null, ''), SCRIPT);
    const r = Core.parseMovetext(items[0].startFen, items[0].text);
    expectInert(movesHTML(r.root, r.root.kids[0], null, (s) => s), '<img src=x');
  });
});

describe('backup file (JSON from someone else)', () => {
  it('drops broken items and normalizes fields; a FEN with markup is rejected', () => {
    const text = JSON.stringify({ app: 'shakhmatnaya-tetrad', books: [
      { id: 'ok', name: EVIL, items: [
        { id: 'a', title: EVIL, type: 'puzzle', startFen: FEN, text: '1. Rd8# {' + IMG + '}', plies: 1 },
        { id: 'b', title: 'bad fen', startFen: '"><img src=x onerror=alert(1)> w - - 0 1' },
        { id: 7, title: 'bad id' }
      ] },
      { id: '__recog', name: 'x', items: [] }
    ] });
    const r = parseBackup(text);
    expect(r.books.map((b) => b.id)).toEqual(['ok']);
    expect(r.books[0].items.map((i) => i.id)).toEqual(['a']);
    expect(r.skipped).toBe(3);
    expectInert(booksHTML(r.books, null, null), '<script>');
    expectInert(itemsHTML(r.books[0].items, null, ''), '<img');
  });
  it('rejects files that are not backups', () => {
    expect(parseBackup('not json').err).toBeTruthy();
    expect(parseBackup('{"app":"other","books":[]}').err).toBeTruthy();
  });
});

describe('board: a malicious FEN cannot inject into the SVG', () => {
  it('only real squares and piece codes are rendered', () => {
    // A square map as it would come from a broken position: bad keys and bad piece codes.
    const map = { 'a1" onload="window.__pwned=1': 'wK', e1: 'w" onload="window.__pwned=1', e8: 'bK', h1: 'wR' };
    const svg = boardSVG(map, {});
    const r = render(svg);
    expect(r.tags).toEqual([]);
    expect(r.handlers).toEqual([]);
    expect([...r.host.querySelectorAll('use')].map((u) => u.getAttribute('data-sq')).sort()).toEqual(['e8', 'h1']);
    expect(Object.keys(fenToMap(FEN)).length).toBe(9); // normal positions are unaffected (k, 3 p, 3 P, R, K)
  });
});

describe('cloud set: title and items from the database', () => {
  it('set title and item titles are text; rows with an invalid FEN are skipped', () => {
    const set = { id: 'S', title: 'Набор ' + EVIL, source: SCRIPT, set_items: [
      { id: 'i1', position: 0, kind: 'puzzle', title: 'Т ' + IMG, start_fen: FEN, movetext: '1. Rd8#' },
      { id: 'i2', position: 1, kind: 'puzzle', title: 'x', start_fen: '<script>', movetext: '' }
    ] };
    const { book } = mergeRemoteSet(null, set, [], 1);
    expect(book.items.map((i) => i.id)).toEqual(['i1']);
    expectInert(booksHTML([book], null, null), 'Набор <img');
    expectInert(itemsHTML(book.items, null, ''), 'Т <img');
  });
});
