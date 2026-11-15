// @ts-check
// UCI helpers: parse Stockfish "info" lines and present scores from White's point of view.
// Pure functions (no DOM, no workers) so they can be unit-tested.

// Returns {info, depth, multipv, cp, mate, pv, turn} or null.
// UCI scores are from the side to move; `turn` ('w'|'b') is kept so callers can convert.
// Lines with "lowerbound"/"upperbound" are skipped: they are temporary aspiration-window
// results, not real evaluations (they made the bar and numbers jump).
/**
 * One engine line from the side-to-move's point of view.
 * @typedef {Object} EngineLine
 * @property {true} info
 * @property {number} depth
 * @property {number} multipv
 * @property {number|null} cp
 * @property {number|null} mate
 * @property {string[]} pv
 * @property {'w'|'b'|string} turn
 */
/** @param {string} line @param {'w'|'b'|string} turn @returns {EngineLine|null} */
export function parseInfo(line, turn) {
  line = String(line);
  if (line.indexOf('info') !== 0 || line.indexOf(' pv ') < 0) return null;
  if (/ (lowerbound|upperbound)( |$)/.test(line)) return null;
  var d = / depth (\d+)/.exec(line), sc = / score (cp|mate) (-?\d+)/.exec(line), pv = / pv (.+)$/.exec(line);
  if (!d || !sc || !pv) return null;
  var mp = / multipv (\d+)/.exec(line), val = parseInt(sc[2], 10);
  return {
    info: true, depth: parseInt(d[1], 10), multipv: mp ? parseInt(mp[1], 10) : 1,
    cp: sc[1] === 'cp' ? val : null, mate: sc[1] === 'mate' ? val : null,
    pv: pv[1].trim().split(/\s+/), turn: turn
  };
}

// White-POV sign for a line.
/** @param {{turn: string}} l */
function sign(l) { return l.turn === 'w' ? 1 : -1; }

// "+0.31", "−1.20", "+#3", "−#2" (White's point of view). Moved from the prototype UI.
/** @param {{cp: number|null, mate: number|null, turn: string}|null|undefined} l @returns {string} */
export function scoreText(l) {
  if (!l) return '';
  var s = sign(l);
  if (l.mate != null) { var m = l.mate * s; return (m > 0 ? '+' : '−') + '#' + Math.abs(m); }
  var v = (l.cp || 0) * s / 100; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

// White's share of the evaluation bar in percent (50 = equal). Moved from the prototype UI.
/** @param {{cp: number|null, mate: number|null, turn: string}} l @returns {number} */
export function whiteShare(l) {
  var s = sign(l);
  if (l.mate != null) return l.mate * s > 0 ? 100 : 0;
  return 100 / (1 + Math.exp(-((l.cp || 0) * s) / 400));
}
