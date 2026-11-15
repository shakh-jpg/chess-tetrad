// @ts-check
// Recording a game played over the board: the "Мои партии" book, a new game item, PGN headers.
// Pure functions (no DOM). The item is an ordinary library item of type 'game' plus `headers`
// and `source`, so everything that works for games (moves tree, variations, comments, PGN export,
// backups, assigning sets in the cloud) works for recorded games too.
//
// Stage 5 (live game coach <-> student over Realtime) will reuse this: a live game is created with
// newGameItem({ source: 'live', headers: { White, Black, Event: 'Урок' } }) and stored with
// ensureBook(books, LESSONS_BOOK) or ensureBook(books, RECORD_BOOK) — the same format.

export var RECORD_BOOK = 'Мои партии';
export var LESSONS_BOOK = 'Уроки';
export var RESULTS = ['*', '1-0', '0-1', '1/2-1/2'];
export var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Seven-tag-roster subset the coach edits.
 * @typedef {Object} GameHeaders
 * @property {string} White
 * @property {string} Black
 * @property {string} Event
 * @property {string} Date   PGN date YYYY.MM.DD ('????.??.??' if unknown)
 * @property {string} Result '*' | '1-0' | '0-1' | '1/2-1/2'
 */

/** @param {number} now @returns {string} PGN date of the local day */
export function pgnDate(now) {
  var d = new Date(now);
  return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
}

/** @param {number} now @returns {GameHeaders} */
export function defaultHeaders(now) {
  return { White: '', Black: '', Event: '', Date: pgnDate(now), Result: '*' };
}

/** @param {unknown} v @param {number} max */
function clip(v, max) { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }

/**
 * Cleans user input: trims and clips names, accepts YYYY.MM.DD / YYYY-MM-DD dates and the four PGN results
 * ('½-½' is accepted for a draw).
 * @param {Partial<GameHeaders>|null|undefined} h
 * @param {number} now
 * @returns {GameHeaders}
 */
export function normalizeHeaders(h, now) {
  h = h || {};
  var date = clip(h.Date, 10).replace(/-/g, '.');
  if (!/^(\d{4}|\?{4})\.(\d{2}|\?{2})\.(\d{2}|\?{2})$/.test(date)) date = pgnDate(now);
  var res = clip(h.Result, 7).replace('½-½', '1/2-1/2');
  if (RESULTS.indexOf(res) < 0) res = '*';
  return { White: clip(h.White, 60), Black: clip(h.Black, 60), Event: clip(h.Event, 80), Date: date, Result: res };
}

/** @param {string} r */
export function resultLabel(r) { return r === '1/2-1/2' ? '½-½' : r; }

/**
 * Title shown in the library: "Белые — Чёрные · Событие · 16.11.2026" (missing parts are skipped).
 * @param {GameHeaders} h
 */
export function titleFromHeaders(h) {
  var players = (h.White || h.Black) ? (h.White || '?') + ' — ' + (h.Black || '?') : '';
  var m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(h.Date || ''), date = m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  var parts = [players, h.Event, date].filter(Boolean);
  var title = parts.join(' · ') || 'Партия';
  return players ? title : 'Партия' + (h.Event ? ' · ' + h.Event : '') + (date ? ' · ' + date : '');
}

/**
 * New recorded game. `fen` lets the coach start from the current position.
 * @param {{id: string, now: number, fen?: string, headers?: Partial<GameHeaders>, source?: 'record'|'live'}} o
 */
export function newGameItem(o) {
  var headers = normalizeHeaders(Object.assign(defaultHeaders(o.now), o.headers || {}), o.now);
  return {
    id: o.id, type: 'game', title: titleFromHeaders(headers), startFen: o.fen || START_FEN,
    text: '', plies: 0, result: headers.Result, err: null, warn: 0,
    headers: headers, source: o.source || 'record', recorded: true, created: o.now
  };
}

/**
 * Applies edited headers to an item (title and result follow the headers).
 * @param {any} item @param {Partial<GameHeaders>} h @param {number} now
 */
export function applyHeaders(item, h, now) {
  item.headers = normalizeHeaders(h, now);
  item.title = titleFromHeaders(item.headers);
  item.result = item.headers.Result;
  return item;
}

/**
 * Finds the book with this name or creates it (as for "Уроки" / "Мои позиции").
 * @param {any[]} books @param {string} name @param {() => string} makeId @param {number} now
 * @returns {{book: any, created: boolean}}
 */
export function ensureBook(books, name, makeId, now) {
  var book = books.filter(function (b) { return b.name === name && !b.remote; })[0];
  if (book) return { book: book, created: false };
  book = { id: makeId(), name: name, created: now, items: [] };
  books.push(book);
  return { book: book, created: true };
}
