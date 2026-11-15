// @ts-check
// Library backup (JSON) and PGN export. Pure functions.
// A backup file is untrusted input (it can be edited or come from someone else):
// every field is type-checked, clipped and normalized before it reaches the library.
import { Chess } from '../core/chess.js';
import { Core } from '../core/index.js';
import { normalizeHeaders } from './record.js';

export var BACKUP_APP = 'shakhmatnaya-tetrad';

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function int(v, min, max) { var n = Math.floor(Number(v)); return isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function validFen(f) { return typeof f === 'string' && f.length <= 100 && new Chess().load(f); }

export function sanitizeStat(st) {
  if (!st || typeof st !== 'object') return undefined;
  var big = 1e15;
  return {
    n: int(st.n, 0, 1e6), ok: int(st.ok, 0, 1e6), clean: int(st.clean, 0, 1e6), fail: int(st.fail, 0, 1e6),
    box: int(st.box, 0, 5), last: int(st.last, 0, big), due: int(st.due, 0, big),
    res: st.res === 'clean' || st.res === 'help' || st.res === 'fail' ? st.res : ''
  };
}

// Returns a clean item or null (unusable: no id/title or an invalid start position).
export function sanitizeItem(it) {
  if (!it || typeof it.id !== 'string' || !it.id || it.id.length > 100 || typeof it.title !== 'string') return null;
  var fen = it.startFen === undefined ? Core.START : it.startFen;
  if (!validFen(fen)) return null;
  /** @type {Record<string, any>} */
  var out = {
    id: it.id, type: it.type === 'puzzle' ? 'puzzle' : 'game', title: str(it.title, 300), startFen: fen,
    text: str(it.text, 100000), plies: int(it.plies, 0, 10000),
    result: /^(1-0|0-1|1\/2-1\/2|\*)$/.test(it.result || '') ? it.result : '',
    warn: int(it.warn, 0, 10000), err: null
  };
  if (it.err && typeof it.err === 'object') out.err = { token: str(it.err.token, 100), ply: int(it.err.ply, 0, 10000), before: str(it.err.before, 100) };
  ['note', 'section', 'raw'].forEach(function (k) { if (typeof it[k] === 'string') out[k] = str(it[k], k === 'raw' ? 4000 : 300); });
  if (typeof it.num === 'number') out.num = int(it.num, 0, 100000);
  if (typeof it.srcPage === 'number') out.srcPage = int(it.srcPage, 0, 100000);
  var st = sanitizeStat(it.stat); if (st) out.stat = st;
  if (it.solved === true) out.solved = true;
  // recorded games (ui/record.js): PGN headers and origin
  if (it.headers && typeof it.headers === 'object') { out.headers = normalizeHeaders(it.headers, Date.now()); out.result = out.headers.Result; }
  if (it.recorded === true) out.recorded = true;
  if (it.source === 'record' || it.source === 'live') out.source = it.source;
  if (typeof it.created === 'number') out.created = int(it.created, 0, 1e15);
  return out;
}

export function sanitizeBook(b) {
  if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 100 || b.id.indexOf('__') === 0) return null;
  if (typeof b.name !== 'string' || !Array.isArray(b.items)) return null;
  var items = [], skipped = 0;
  b.items.forEach(function (it) { var c = sanitizeItem(it); if (c) items.push(c); else skipped++; });
  var out = { id: b.id, name: str(b.name, 200) || 'Книга', created: int(b.created, 0, 1e15), items: items };
  if (b.sample === true) out.sample = true;
  if (b.remote && typeof b.remote === 'object' && typeof b.remote.setId === 'string') {
    out.remote = { setId: str(b.remote.setId, 100), source: str(b.remote.source, 200) };
  }
  return { book: out, skipped: skipped };
}

// text -> { err } | { books: [...], samples, skipped }
export function parseBackup(text) {
  var o;
  try { o = JSON.parse(text); } catch (e) { return { err: 'Это не файл копии: не читается как JSON.' }; }
  if (!o || o.app !== BACKUP_APP || !Array.isArray(o.books)) return { err: 'Это не копия библиотеки «Шахматной тетради».' };
  var books = [], skipped = 0;
  o.books.forEach(function (b) {
    var r = sanitizeBook(b);
    if (!r) { skipped++; return; }
    books.push(r.book); skipped += r.skipped;
  });
  return { books: books, samples: o.samples && typeof o.samples === 'object' ? o.samples : null, skipped: skipped };
}

export function makeBackup(books, samples, now) {
  return { app: BACKUP_APP, v: 1, date: new Date(now || Date.now()).toISOString(), books: JSON.parse(JSON.stringify(books)), samples: samples };
}

// ---------- PGN export (moved from the prototype UI) ----------
export function safeName(n) {
  return String(n || 'kniga').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'kniga';
}
// Recorded games carry real headers (White, Black, Event, Date, Result); other items keep the old tags.
export function pgnOf(it, movetext) {
  var fen = it.startFen || Core.START, t = function (k, v) { return '[' + k + ' "' + String(v).replace(/[\\"]/g, ' ') + '"]'; };
  var h = it.headers || {};
  var r0 = h.Result || it.result;
  var res = r0 && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(r0) ? r0 : '*';
  var tags = [t('Event', h.Event || it.title || '?'), t('Site', '?'), t('Date', h.Date || '????.??.??'), t('Round', '?'),
    t('White', h.White || '?'), t('Black', h.Black || '?'), t('Result', res)];
  if (fen.split(' ')[0] !== Core.START.split(' ')[0]) { tags.push(t('SetUp', '1')); tags.push(t('FEN', fen)); }
  var mt = movetext || '';
  var body = (mt ? mt + ' ' : '') + res;
  return tags.join('\n') + '\n\n' + body.replace(/(.{1,90})(\s+|$)/g, '$1\n').trim() + '\n';
}
