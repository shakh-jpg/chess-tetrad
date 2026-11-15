// @ts-check
// Mapping between the local library (books/items with SRS stats) and the cloud tables,
// plus the progress merge rule. Pure functions — no network, no DOM.
import { Core } from '../core/index.js';
import { Chess } from '../core/chess.js';

export var REMOTE_PREFIX = 'set-';

// ---------- merge rule (same as push_progress in SQL) ----------
// More attempts wins; on a tie the later attempt wins; otherwise keep `a`.
/**
 * @template {{n?: number, last?: number}} T
 * @param {T|null|undefined} a local
 * @param {T|null|undefined} b remote
 * @returns {T|null}
 */
export function mergeStat(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if ((b.n || 0) > (a.n || 0)) return b;
  if ((b.n || 0) === (a.n || 0) && (b.last || 0) > (a.last || 0)) return b;
  return a;
}
function sameStat(a, b) {
  if (!a || !b) return a === b;
  return a.n === b.n && (a.last || 0) === (b.last || 0) && a.box === b.box && a.res === b.res;
}

// ---------- coach -> cloud ----------
function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function dropComments(node) { node.comment = ''; node.kids.forEach(dropComments); }

// Moves, variations and NAGs always; comments only if the coach says they are their own.
// Book text, captions (item.note) and PDFs are never sent.
export function studentMovetext(item, includeComments) {
  var r = Core.parseMovetext(item.startFen, item.text || '');
  if (!includeComments) dropComments(r.root);
  return Core.toMovetext(r.root);
}

export function itemToRow(item, position, opts) {
  opts = opts || {};
  return {
    position: position,
    kind: item.type === 'puzzle' ? 'puzzle' : 'game',
    title: clip(item.title, 120),
    start_fen: item.startFen || Core.START,
    movetext: studentMovetext(item, !!opts.includeComments)
  };
}

// The "source" field is filled automatically from the book the items come from.
export function setFromBook(book, items, opts) {
  opts = opts || {};
  return {
    title: clip(opts.title || book.name || 'Набор', 120) || 'Набор',
    source: clip(book.remote && book.remote.source ? book.remote.source : book.name, 200),
    rows: items.map(function (it, i) { return itemToRow(it, i, opts); })
  };
}

// ---------- cloud -> student ----------
export function statToRow(itemId, st) {
  return {
    item_id: itemId, n: st.n || 0, ok: st.ok || 0, clean: st.clean || 0, fail: st.fail || 0,
    box: st.box || 0, last: st.last || null, due: st.due || null, res: st.res || ''
  };
}
export function rowToStat(row) {
  var t = function (v) { var x = v ? Date.parse(v) : NaN; return isNaN(x) ? 0 : x; };
  return {
    n: row.n || 0, ok: row.ok || 0, clean: row.clean || 0, fail: row.fail || 0, box: row.box || 0,
    last: t(row.last_at), due: t(row.due_at), res: row.res || ''
  };
}

// Returns null for a row that cannot be shown safely (no id or an invalid position).
export function rowToItem(row) {
  if (!row || typeof row.id !== 'string' || typeof row.start_fen !== 'string' || !new Chess().load(row.start_fen)) return null;
  var r = Core.parseMovetext(row.start_fen, String(row.movetext || ''));
  return {
    id: row.id, type: row.kind === 'game' ? 'game' : 'puzzle', title: clip(row.title, 120) || (row.kind === 'game' ? 'Партия' : 'Задача'),
    startFen: row.start_fen, text: Core.toMovetext(r.root), plies: Core.mainLine(r.root).length, result: '', err: null, warn: 0
  };
}

// Builds/updates the local book for an assigned set, merging progress from both sides.
// Returns { book, toPush } where toPush are progress rows where the local copy is newer.
export function mergeRemoteSet(local, set, progressRows, now) {
  var byItem = {};
  (progressRows || []).forEach(function (p) { byItem[p.item_id] = rowToStat(p); });
  var localItems = {};
  ((local && local.items) || []).forEach(function (it) { localItems[it.id] = it; });
  var toPush = [];
  var rows = (set.set_items || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
  var items = rows.map(function (row) {
    var it = rowToItem(row);
    if (!it) return null;
    var old = localItems[row.id], remote = byItem[row.id] || null;
    var st = mergeStat(old && old.stat, remote);
    if (st) {
      it.stat = st;
      if (st.ok > 0 || (old && old.solved)) it.solved = true;
      if (!sameStat(st, remote)) toPush.push(statToRow(row.id, st));
    }
    return it;
  }).filter(Boolean);
  var book = {
    id: REMOTE_PREFIX + set.id,
    name: clip(set.title, 120) || 'Набор',
    created: (local && local.created) || Date.parse(set.created_at) || now || Date.now(),
    remote: { setId: set.id, source: set.source || '' },
    items: items
  };
  return { book: book, toPush: toPush };
}

export function isRemoteBook(book) { return !!(book && book.remote && book.remote.setId); }

// ---------- coach overview ----------
// data: { students:[{id,nick,last_seen_at,user_id?}], assignments:[{set_id,student_id}],
//         items:[{id,set_id}], progress:[{student_id,item_id,res,due_at,n}] }
export function summarize(data, now) {
  now = now || Date.now();
  var itemsBySet = {};
  (data.items || []).forEach(function (i) { (itemsBySet[i.set_id] = itemsBySet[i.set_id] || []).push(i.id); });
  var prog = {};
  (data.progress || []).forEach(function (p) { prog[p.student_id + '|' + p.item_id] = p; });
  return (data.students || []).map(function (s) {
    var r = { id: s.id, nick: s.nick, joined: !!s.bound_at, lastSeen: s.last_seen_at ? Date.parse(s.last_seen_at) : 0,
      sets: 0, total: 0, solved: 0, clean: 0, failed: 0, due: 0, untouched: 0 };
    (data.assignments || []).forEach(function (a) {
      if (a.student_id !== s.id) return;
      r.sets++;
      (itemsBySet[a.set_id] || []).forEach(function (itemId) {
        r.total++;
        var p = prog[s.id + '|' + itemId];
        if (!p || !p.n) { r.untouched++; return; }
        if (p.res === 'fail') { r.failed++; r.due++; return; }
        r.solved++; if (p.res === 'clean') r.clean++;
        if (p.due_at && Date.parse(p.due_at) <= now) r.due++;
      });
    });
    return r;
  });
}
