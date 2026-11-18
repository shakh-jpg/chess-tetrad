// @ts-check
// Online lesson: message formats and validation. Pure functions (no network, no DOM).
//
// Two channels per lesson (see supabase/migrations/20261118000001_live_lessons.sql):
//   'c' — the coach's channel: only the coach can send (Realtime policies), students receive.
//   's' — the students' channel: students send requests, only the coach receives them.
// Everything that arrives over the network is untrusted: every message is type-checked and
// size-limited here, positions are checked with chess.js, moves are replayed with chess.js
// (an illegal move rejects the whole message), and text is clipped and stripped of control
// characters. The UI escapes it again when it shows it.
import { Chess } from '../core/chess.js';
import { Core } from '../core/index.js';

export var LIMITS = { bigMsg: 60000, smallMsg: 4000, path: 600, kid: 100, title: 120, nick: 40, arrows: 30 };

var DOC_ID = /^[a-z0-9]{4,24}$/;
var SAN = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;
var SQ = /^[a-h][1-8]$/;

/** @param {unknown} v @param {number} max */
export function cleanText(v, max) {
  // \s also covers the line/paragraph separators U+2028/U+2029
  return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function isInt(v, min, max) { return typeof v === 'number' && Math.floor(v) === v && v >= min && v <= max; }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function size(p) { try { return JSON.stringify(p).length; } catch (e) { return Infinity; } }

/** @param {unknown} p @returns {number[]|null} */
export function cleanPath(p) {
  if (!Array.isArray(p) || p.length > LIMITS.path) return null;
  for (var i = 0; i < p.length; i++) if (!isInt(p[i], 0, LIMITS.kid)) return null;
  return p.slice();
}

/** Path of a node from the root: child indexes. @param {any} node */
export function nodePath(node) {
  var p = [];
  while (node && node.parent) { p.unshift(node.parent.kids.indexOf(node)); node = node.parent; }
  return p;
}
/** Node at a path, or null if the path does not exist. @param {any} root @param {number[]} path */
export function nodeAt(root, path) {
  var n = root;
  for (var i = 0; i < path.length; i++) { n = n.kids[path[i]]; if (!n) return null; }
  return n;
}

/** Arrows and marked squares: {a: ['e2e4'], m: ['d5']} or undefined. @param {unknown} dw */
export function cleanDraw(dw) {
  if (!isObj(dw)) return undefined;
  var d = /** @type {any} */ (dw);
  var a = (Array.isArray(d.a) ? d.a : []).slice(0, LIMITS.arrows).filter(function (/** @type {unknown} */ x) {
    return typeof x === 'string' && x.length === 4 && SQ.test(x.slice(0, 2)) && SQ.test(x.slice(2));
  });
  var m = (Array.isArray(d.m) ? d.m : []).slice(0, LIMITS.arrows).filter(function (/** @type {unknown} */ x) { return typeof x === 'string' && SQ.test(x); });
  return a.length || m.length ? { a: a, m: m } : undefined;
}

/** @param {unknown} fen */
export function validFen(fen) {
  if (typeof fen !== 'string' || fen.length > 100 || !/^[rnbqkpRNBQKP1-8/]+ [wb] [KQkq-]+ (?:[a-h][36]|-) \d+ \d+$/.test(fen)) return false;
  var placement = fen.split(' ')[0];
  // exactly one king of each colour (chess.js 0.10 alone accepts a board without kings)
  if ((placement.match(/K/g) || []).length !== 1 || (placement.match(/k/g) || []).length !== 1) return false;
  return !!new Chess().load(fen);
}

/**
 * Parses movetext from the network: every move must be legal (chess.js), otherwise null.
 * @param {string} fen @param {unknown} mt
 */
export function parseTree(fen, mt) {
  if (typeof mt !== 'string' || mt.length > LIMITS.bigMsg) return null;
  var r = Core.parseMovetext(fen, mt);
  if (r.err) return null;
  return r.root;
}

/**
 * Plays a move at a path; null if the path does not exist or the move is not legal there.
 * @param {any} root @param {number[]} path @param {string} san
 */
export function applyMoveAt(root, path, san) {
  var at = nodeAt(root, path);
  if (!at || typeof san !== 'string' || !SAN.test(san)) return null;
  var g = new Chess(at.fen), m = g.move(san);
  if (!m) return null;
  return Core.addChild(at, m.san, g.fen());
}

/**
 * Movetext of the tree for the students. Comments that came from a book (bookComments: node id ->
 * original comment) are left out; comments the coach wrote or changed are sent.
 * @param {any} root @param {Record<string, string>|null} bookComments
 */
export function lessonMovetext(root, bookComments) {
  if (!bookComments) return Core.toMovetext(root);
  /** @param {any} n @param {any} parent */
  function clone(n, parent) {
    var c = Object.assign({}, n, { parent: parent, kids: [] });
    if (n.comment && bookComments && bookComments[n.id] === n.comment) c.comment = '';
    c.kids = n.kids.map(function (/** @type {any} */ k) { return clone(k, c); });
    return c;
  }
  return Core.toMovetext(clone(root, null));
}
/** Comments present when a book item is opened in the lesson. @param {any} root */
export function collectComments(root) {
  /** @type {Record<string, string>} */
  var out = {};
  (function walk(n) { if (n.comment) out[n.id] = n.comment; n.kids.forEach(walk); })(root);
  return out;
}

// ---------------------------------------------------------------- coach -> students ('c')
/**
 * @param {string} evt @param {unknown} payload
 * @returns {any} a clean message or null
 */
export function parseCoachMsg(evt, payload) {
  if (!isObj(payload)) return null;
  var p = /** @type {any} */ (payload), n = size(p);
  if (evt === 'state') {
    if (n > LIMITS.bigMsg + 2000) return null;
    if (!isObj(p.doc) || !DOC_ID.test(p.doc.id) || !validFen(p.doc.fen) || !isInt(p.rev, 0, 1e9)) return null;
    if (typeof p.mt !== 'string') return null;
    var cur = cleanPath(p.cur);
    if (!cur) return null;
    return {
      t: 'state', doc: { id: p.doc.id, fen: p.doc.fen, type: p.doc.type === 'puzzle' ? 'puzzle' : 'game', title: cleanText(p.doc.title, LIMITS.title) || 'Урок' },
      rev: p.rev, mt: p.mt, cur: cur, dw: cleanDraw(p.dw),
      lock: p.lock !== false, eng: p.eng === true, flip: p.flip === true, coach: cleanText(p.coach, 60)
    };
  }
  if (n > (evt === 'tree' ? LIMITS.bigMsg : LIMITS.smallMsg)) return null;
  if (evt === 'mode') return { t: 'mode', lock: p.lock !== false, eng: p.eng === true, flip: p.flip === true };
  if (evt === 'end') return { t: 'end' };
  if (!DOC_ID.test(p.d) || !isInt(p.rev, 0, 1e9)) return null;
  var path = cleanPath(evt === 'cur' ? p.path : p.cur);
  if (!path) return null;
  if (evt === 'cur') return { t: 'cur', d: p.d, rev: p.rev, path: path, dw: cleanDraw(p.dw) };
  if (evt === 'mv') {
    var at = cleanPath(p.at);
    if (!at || typeof p.san !== 'string' || !SAN.test(p.san)) return null;
    return { t: 'mv', d: p.d, rev: p.rev, at: at, san: p.san, cur: path, dw: cleanDraw(p.dw) };
  }
  if (evt === 'tree') {
    if (typeof p.mt !== 'string') return null;
    return { t: 'tree', d: p.d, rev: p.rev, mt: p.mt, cur: path, dw: cleanDraw(p.dw) };
  }
  return null;
}

// ---------------------------------------------------------------- students -> coach ('s')
/** @param {string} evt @param {unknown} payload */
export function parseStudentMsg(evt, payload) {
  if (!isObj(payload) || size(payload) > LIMITS.smallMsg) return null;
  var p = /** @type {any} */ (payload);
  if (evt === 'hello') return { t: 'hello' };
  if (!DOC_ID.test(p.d) || !isInt(p.rev, 0, 1e9)) return null;
  var path = cleanPath(p.at);
  if (!path) return null;
  if (evt === 'go') return { t: 'go', d: p.d, rev: p.rev, at: path };
  if (evt === 'mv' && typeof p.san === 'string' && SAN.test(p.san)) return { t: 'mv', d: p.d, rev: p.rev, at: path, san: p.san };
  return null;
}

/** Presence entry: {r: 'c'|'s', n: nick}. @param {unknown} meta */
export function cleanPresence(meta) {
  if (!isObj(meta)) return null;
  var m = /** @type {any} */ (meta);
  return { r: m.r === 'c' ? 'c' : 's', n: cleanText(m.n, LIMITS.nick) || '—' };
}

/** Short random id for a lesson document. */
export function docId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
