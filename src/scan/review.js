// @ts-check
// Review of recognized diagrams (stage D), the part without UI: statuses, filters, edits,
// "confident" results, one-click piece choices and when to learn from the coach's corrections.
import { mapToFen, fenToMap } from '../board/position.js';
import { castlingFrom, positionProblems } from './recognize.js';

/**
 * @typedef {{ id: string, page: number, index: number, fen: string, side: string, sideKnown?: boolean,
 *   task: boolean, valid: boolean, problems?: string[], low?: string[], conf?: number,
 *   alts?: Object<string, string>, status?: string, edited?: boolean, learned?: boolean }} Result
 */

// Measured on real books (local checks): boards that pass the rules with mean confidence >= 0.11
// and at most 4 uncertain squares were exact in 4 cases of 5. So "confident" boards are shown
// to the coach as a grid to look over, never confirmed blindly.
export var CONFIDENT = { conf: 0.11, low: 4 };
// learn the book's pieces after this many boards corrected by the coach
export var LEARN_EVERY = 3;

/** @param {Result} r */
export function isConfident(r) {
  return !!r.valid && (r.status || 'new') === 'new' && !r.edited && (r.conf || 0) >= CONFIDENT.conf && (r.low || []).length <= CONFIDENT.low;
}

/** @param {Result[]} results */
export function reviewCounts(results) {
  var c = { total: results.length, confirmed: 0, skipped: 0, left: 0, bad: 0, confident: 0 };
  results.forEach(function (r) {
    var s = r.status || 'new';
    if (s === 'confirmed') c.confirmed++; else if (s === 'skipped') c.skipped++; else { c.left++; if (!r.valid) c.bad++; }
    if (isConfident(r)) c.confident++;
  });
  return c;
}

/** Filters: 'todo' not reviewed yet, 'bad' breaks the rules, 'done' confirmed, 'skipped', 'all'. @param {Result} r @param {string} f */
export function matchesFilter(r, f) {
  var s = r.status || 'new';
  if (f === 'todo') return s === 'new';
  if (f === 'bad') return s === 'new' && !r.valid;
  if (f === 'done') return s === 'confirmed';
  if (f === 'skipped') return s === 'skipped';
  return true;
}

/** @param {Result} r @returns {Object<string, string>} */
export function cellsOf(r) { return /** @type {Object<string, string>} */ (fenToMap(r.fen)); }

/**
 * Applies the coach's edit (pieces, side to move, task mark). The result stays unconfirmed.
 * @param {Result} r @param {Object<string, string>} cells @param {string} side @param {boolean} task
 */
export function editResult(r, cells, side, task) {
  var before = cellsOf(r);
  var changed = Object.keys(Object.assign({}, before, cells)).filter(function (sq) { return before[sq] !== cells[sq]; });
  r.fen = mapToFen(cells, side, castlingFrom(cells));
  r.side = side; r.sideKnown = true; r.task = !!task;
  r.problems = positionProblems(cells, side); r.valid = !r.problems.length;
  r.low = (r.low || []).filter(function (sq) { return changed.indexOf(sq) < 0; });
  if (changed.length) { r.edited = true; r.learned = false; }
  return r;
}

/**
 * One click on a square: the next likely piece for it. The order: the recognizer's candidates
 * for this square in its colour, the first candidate in the other colour, then empty, and around.
 * Squares read as empty have no candidates (the palette places pieces there).
 * @param {Result} r @param {string} sq @param {string|undefined} current piece now on the square
 * @returns {string|null|undefined} next piece, null = empty, undefined = no candidates
 */
export function nextChoice(r, sq, current) {
  var alts = (r.alts || {})[sq];
  if (!alts) return undefined;
  var c = alts[0], types = alts.slice(1).split('');
  /** @type {(string|null)[]} */ var seq = types.map(function (t) { return c + t; });
  seq.push((c === 'w' ? 'b' : 'w') + types[0]);
  seq.push(null);
  var i = seq.indexOf(current === undefined ? null : current);
  return seq[(i + 1) % seq.length];
}

/** Ranked candidates of recognized squares, compact: { e4: 'wNKP' } (colour + types, best first). @param {any[]} raw */
export function altsFrom(raw) {
  /** @type {Object<string, string>} */ var out = {};
  raw.forEach(function (x) {
    if (!x.p) return;
    var sc = x.scores || {}, types = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; });
    types = [x.p[1]].concat(types.filter(function (t) { return t !== x.p[1]; })).slice(0, 3);
    out[x.sq] = x.p[0] + types.join('');
  });
  return out;
}

/** @param {Result} r */
export function confirmResult(r) { if (!r.valid) return false; r.status = 'confirmed'; return true; }
/** @param {Result} r */
export function skipResult(r) { r.status = 'skipped'; return true; }

/** Corrected and confirmed boards whose pieces were not learned yet. @param {Result[]} results */
export function toLearn(results) {
  return results.filter(function (r) { return r.status === 'confirmed' && r.edited && !r.learned; });
}
