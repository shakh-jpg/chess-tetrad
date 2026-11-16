// @ts-check
// Moves from OCR text (stage C), without OCR itself. The notation is NOT parsed directly: every
// OCR token is compared with every legal move of the current position written the ways books
// write it (Russian long «Лa1—a6», «Кр:e5», short «Лa6», English «Ra6», figurines), and the closest
// one wins. The rules decide what OCR noise cannot: Latin/Cyrillic look-alikes, «—» and «:»,
// garbled figurines. The first position is the diagram's. Moves read only approximately are
// marked uncertain.
import { Chess } from '../core/chess.js';

// piece letters -> canonical K Q R B N (pawns have none)
var RU = [['КР', 'K'], ['KР', 'K'], ['КP', 'K'], ['KP', 'K'], ['Ф', 'Q'], ['Л', 'R'], ['С', 'B'], ['К', 'N']];
var FIG = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };
// OCR look-alikes inside squares: Cyrillic letters for files, letters for digits
var FILES = { 'а': 'a', 'Ь': 'b', 'ь': 'b', 'Ъ': 'b', 'в': 'b', 'с': 'c', 'д': 'd', 'е': 'e', 'ё': 'e', 'г': 'g', 'һ': 'h', 'п': 'h', '!': 'f' };
var DIGITS = { 'З': '3', 'з': '3', 'б': '6', 'Б': '6', 'l': '1', 'I': '1', '|': '1', 'О': '0', 'O': '0', 'o': '0', 'о': '0', 'S': '5', 'Т': '7' };

/**
 * Canonical spellings of an OCR token (several when a letter is ambiguous, e.g. Latin K =
 * English king or a Cyrillic К = knight read as Latin). '*' stands for an unreadable piece sign.
 * @param {string} tok @returns {string[]}
 */
export function canonToken(tok) {
  var t = String(tok || '').trim();
  t = t.replace(/^[([]+/, '').replace(/[)\],;!?+#.…]+$/, '');
  t = t.replace(/^\d+\s*\.+\s*/, ''); // a glued move number: «5....Лe8—e7»
  t = t.replace(/^(J[lIТT1|]|JІ)/, 'Л'); // «Л» read as «Jl», «JI», «JT»
  t = t.replace(/!(?=\d)/g, 'f').replace(/[!?]+/g, ''); // «Кр!6» = «Крf6»
  if (!t) return [];
  t = t.replace(/[—–−‒-]/g, '-').replace(/[:×хx](?=[a-hа-яё]|$)/gi, ':');
  if (/^[0OoО]-[0OoО](-[0OoО])?$/.test(t)) return [t.length > 3 ? 'O-O-O' : 'O-O'];
  var piece = '', rest = t, first = t[0];
  if (FIG[first] !== undefined) { piece = FIG[first]; rest = t.slice(1); }
  else {
    var up = t.slice(0, 2).toUpperCase();
    var capital = first !== first.toLowerCase();
    var ru = capital && RU.filter(function (p) { return up.indexOf(p[0]) === 0; })[0];
    if (ru) { piece = ru[1]; rest = t.slice(ru[0].length); }
    else if (/^[KQRBN]/.test(t)) { piece = t[0]; rest = t.slice(1); }
    else if (/^[^a-hа-яё0-9:-]/i.test(first) && t.length >= 3) { piece = '*'; rest = t.slice(1); }
    // a figurine read as a digit (English OCR with a whitelist): «2b6», «5:e4», «4xf4»
    else if (/^\d[a-hx:1]/.test(t) && t.length >= 3) { piece = '*'; rest = t.slice(1); }
    else if (/^\d{2,3}[a-hx:][a-h1-8]/.test(t)) { piece = '*'; rest = t.replace(/^\d+/, ''); } // «57e4», «00xd2»
    else if (/^\d[0-9][1-8]$/.test(t)) { piece = '*'; rest = t.slice(1); } // «542» = ♖d2 (file read as a digit)
  }
  rest = rest.split('').map(function (ch, i, a) {
    var nextIsDigit = i + 1 < a.length;
    if (FILES[ch] && nextIsDigit) return FILES[ch];
    if (DIGITS[ch] && i > 0) return DIGITS[ch];
    return ch;
  }).join('').replace(/[^a-h1-8:=QRBN-]/g, '');
  rest = rest.replace(/([1-8])[a-h]+$/, '$1'); // junk letters after the square («xa3d»)
  // a file letter read as a digit in a two-digit "square": «15» = f5, «46» = d6, «66» = b6, «04» = d4
  var DF = { '1': 'f', '4': 'd', '6': 'b', '0': 'd' };
  if (/^[0146][1-8]$/.test(rest) || (/^[0146][1-8]/.test(rest) && piece)) rest = DF[rest[0]] + rest.slice(1);
  if (!/[a-h][1-8]/.test(rest)) return [];
  var out = [piece + rest];
  if (piece === 'K') out.push('N' + rest); // Latin K may be a Cyrillic К (knight)
  if (piece === 'B' && /^C/.test(t)) out.push(rest); // a Latin C might be a misread file letter
  if (!piece && /^[a-h]?:?[a-h][1-8]/.test(rest)) out.push('*' + rest); // a figurine lost by the OCR: «2.d5» = «2.♔d5»
  return out;
}

/** Canonical spellings of a legal move (chess.js verbose move). @param {any} m @returns {string[]} */
export function moveForms(m) {
  if (m.flags.indexOf('k') >= 0) return ['O-O'];
  if (m.flags.indexOf('q') >= 0) return ['O-O-O'];
  var p = m.piece === 'p' ? '' : m.piece.toUpperCase(), cap = m.flags.indexOf('c') >= 0 || m.flags.indexOf('e') >= 0;
  var promo = m.promotion ? m.promotion.toUpperCase() : '';
  var san = m.san.replace(/[+#]/g, '').replace('x', ':');
  var forms = [p + m.from + (cap ? ':' : '-') + m.to + promo, san, san.replace('=', '')];
  if (p) forms.push(p + (cap ? ':' : '') + m.to);           // «Л:a6», «Лa6»
  if (cap) forms.push(p + m.from + m.to + promo);            // capture sign lost
  if (!p && cap) forms.push(m.from[0] + ':' + m.to, m.from[0] + m.to[0]); // «e:d5», «ed»
  return forms.filter(function (f, i, a) { return a.indexOf(f) === i; });
}

/** Edit distance with '*' (unreadable piece sign) matching any piece letter at half cost. */
function dist(a, b) {
  var m = a.length, n = b.length, d = [];
  for (var i = 0; i <= m; i++) { d[i] = [i]; }
  for (var j = 0; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
    var sub = a[i - 1] === b[j - 1] ? 0 : (a[i - 1] === '*' && /[KQRBN]/.test(b[j - 1]) ? 0.5 : 1);
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
  }
  return d[m][n];
}

/**
 * The legal move a token means, or null. sure: exact spelling and only one such move.
 * @param {any} chess position @param {string} tok
 * @returns {{ san: string, sure: boolean, d: number } | null}
 */
export function matchMove(chess, tok) {
  var all = matchAll(chess, tok);
  if (!all.length || all.length > 1) return null;
  return all[0];
}

/**
 * All legal moves at the smallest distance (<= 1) from the token: one = a match, several = a tie
 * that the following moves may resolve. @param {any} chess @param {string} tok
 * @returns {{ san: string, sure: boolean, d: number }[]}
 */
export function matchAll(chess, tok) {
  var variants = canonToken(tok);
  if (!variants.length) return [];
  /** @type {any[]} */ var best = [];
  var bestD = Infinity;
  chess.moves({ verbose: true }).forEach(function (/** @type {any} */ m) {
    var d = Infinity;
    moveForms(m).forEach(function (f) { variants.forEach(function (v) { d = Math.min(d, dist(v, f)); }); });
    if (d < bestD) { bestD = d; best = [m]; } else if (d === bestD) best.push(m);
  });
  if (!best.length || bestD > 1) return [];
  // an unreadable piece sign (figurine) with an exact square: the rules leave a single move,
  // which is as good as reading the sign
  var sure = best.length === 1 && (bestD === 0 || (bestD === 0.5 && variants.some(function (v) { return v[0] === '*'; })));
  return best.map(function (m) { return { san: m.san, sure: sure, d: bestD }; });
}

/** Split OCR text into tokens; move numbers stay as separate tokens («8.», «5...»). @param {string} text */
export function tokenize(text) {
  var toks = String(text || '').replace(/(\d+\s*\.{1,4})(?=[^\s.])/g, '$1 ').split(/\s+/).filter(Boolean), out = [];
  for (var i = 0; i < toks.length; i++) {
    // a piece sign split off its square: «Ф d5», «♘ f3»
    // «17.» «2.» «d3!»: a one-digit "number" right after a move number is a figurine
    if (/^\d\.$/.test(toks[i]) && i > 0 && isNumber(toks[i - 1]) && i + 1 < toks.length && /^[a-hx:1][a-h1-8]/.test(toks[i + 1])) { out.push(toks[i][0] + toks[i + 1]); i++; continue; }
    var sign = /^[^\sa-z0-9]$/i.test(toks[i]) || /^\d$/.test(toks[i]); // a lone digit is a figurine read by OCR
    if (sign && i + 1 < toks.length && /^[a-hа-яё:x×—-]?[a-hа-яё!][1-8зб]/i.test(toks[i + 1])) { out.push(toks[i] + toks[i + 1]); i++; continue; }
    out.push(toks[i]);
  }
  return out;
}
function isNumber(t) { return /^\d+\s*\.{1,4}$/.test(t) || /^\.{2,4}$/.test(t); }
function isAnnotation(t) { return /^[!?+#=∓±⩲⩱∞]+$/.test(t) || /^\([!?]+\)$/.test(t); }

/** The move number right before token i («16...», «17.»), or 0. @param {string[]} tokens @param {number} i */
function numberBefore(tokens, i) {
  for (var b = i - 1; b >= 0 && b >= i - 2; b--) {
    var m = /^(\d+)\s*\.+$/.exec(tokens[b]);
    if (m) return +m[1];
    if (!isAnnotation(tokens[b])) break;
  }
  return 0;
}

/** Consecutive legal moves from token i (move numbers and annotations skipped). */
function scanRun(fen, tokens, i) {
  var c = new Chess(fen), run = [], sure = 0, j = i;
  for (; j < tokens.length; j++) {
    var t = tokens[j];
    if (isNumber(t) || isAnnotation(t)) continue;
    var all = matchAll(c, t), mv = all.length === 1 ? all[0] : null;
    // a tie (e.g. «c8»: ♖c8 or ♔c8): the candidate after which the next moves read on
    if (all.length > 1) mv = settleTie(c, all, tokens, j + 1);
    if (!mv) break;
    c.move(mv.san);
    run.push({ san: mv.san, sure: mv.sure, tok: t });
    if (mv.sure) sure++;
  }
  return { moves: run, sure: sure, num: numberBefore(tokens, i), end: j, fen: c.fen() };
}

/** How many of the next tokens read as legal moves after a candidate; the unique best wins. */
function settleTie(c, all, tokens, from) {
  /** @type {any} */ var best = null;
  var bestN = 0, tie = false;
  all.forEach(function (cand) {
    var cc = new Chess(c.fen()); cc.move(cand.san);
    var n = 0;
    for (var j = from; j < tokens.length && n < 6; j++) {
      if (isNumber(tokens[j]) || isAnnotation(tokens[j])) continue;
      var m = matchAll(cc, tokens[j])[0]; // nested ties: any candidate, only the reach counts
      if (!m) break;
      cc.move(m.san); n++;
    }
    if (n > bestN) { bestN = n; best = cand; tie = false; } else if (n === bestN) tie = true;
  });
  return best && !tie && bestN >= 1 ? { san: best.san, sure: false, d: best.d } : null;
}

/**
 * The longest run of consecutive legal moves in the tokens, starting from the position.
 * Move numbers and annotations between moves are skipped; any other word ends a run.
 * @param {string} fen @param {string[]} tokens
 * @returns {{ moves: { san: string, sure: boolean, tok: string }[], start: number, sure: number, num: number, end: number, fen: string }}
 */
export function bestRun(fen, tokens) {
  var best = { moves: /** @type {{ san: string, sure: boolean, tok: string }[]} */ ([]), start: -1, sure: 0, num: 0, end: -1, fen: fen };
  var base = new Chess();
  if (!base.load(fen)) return best;
  for (var i = 0; i < tokens.length; i++) {
    if (isNumber(tokens[i]) || isAnnotation(tokens[i])) continue;
    var r = scanRun(fen, tokens, i), run = r.moves, sure = r.sure, numbered = r.num > 0;
    // precision first (no moves is better than wrong moves): a run needs 2+ moves with at least
    // half of them read exactly, or a single exactly read long-notation move («c5—c6»)
    // squares alone («h4 и g6») and single moves are prose too often: they need a move number
    var bare = run.every(function (m) { return /^[a-h][1-8]$/.test(canonToken(m.tok)[0] || ''); });
    var ok = (run.length >= 2 && sure * 2 >= run.length && (numbered || !bare)) ||
      (run.length === 1 && run[0].sure && numbered && /\d.*-|:|\*/.test(canonToken(run[0].tok)[0] || ''));
    if (ok && (sure > best.sure || (sure === best.sure && run.length > best.moves.length))) best = { moves: run, start: i, sure: sure, num: r.num, end: r.end, fen: r.fen };
  }
  return best;
}

/**
 * Next step of a line at the expected move number: the moves written there if they are legal
 * from pos, or — when the move there is unreadable — the legal move after which the text goes
 * on best (a "bridge", marked uncertain). @returns {any} null if nothing fits
 */
function nextStep(pos, tokens, from, expNum) {
  for (var k = from; k < tokens.length; k++) {
    if (isNumber(tokens[k]) || isAnnotation(tokens[k])) continue;
    if (expNum && numberBefore(tokens, k) !== expNum) continue;
    if (!expNum && numberBefore(tokens, k) === 0) continue;
    var r = scanRun(pos.fen(), tokens, k);
    if (r.moves.length && r.moves[0].sure && r.sure * 2 >= r.moves.length) return r;
    // bridge over an unreadable move: the continuation must be read exactly (2+ moves)
    // the text goes on at the next move number (junk of the unreadable move is skipped)
    var k2 = k + 1;
    // after White's unreadable move Black's reply follows directly (no number): skip junk only
    if (pos.turn() === 'w') { while (k2 < tokens.length && k2 < k + 4 && !canonToken(tokens[k2]).length) k2++; }
    else if (expNum) {
      var nextNum = pos.turn() === 'w' ? expNum : expNum + 1;
      for (k2 = k + 1; k2 < tokens.length && k2 < k + 8; k2++) if (!isNumber(tokens[k2]) && !isAnnotation(tokens[k2]) && numberBefore(tokens, k2) === nextNum) break;
    }
    /** @type {any} */ var best = null;
    var bestS = 0;
    pos.moves({ verbose: true }).forEach(function (/** @type {any} */ m) {
      var c = new Chess(pos.fen()); c.move(m.san);
      var rr = scanRun(c.fen(), tokens, k2);
      var s = rr.moves.length >= 2 && rr.moves[0].sure && rr.sure * 2 >= rr.moves.length ? rr.sure : 0;
      // closer to what OCR saw wins a tie (e.g. «2d3» = a piece to d3)
      var close = Math.min.apply(null, moveForms(m).map(function (f) { return Math.min.apply(null, canonToken(tokens[k]).concat(['?']).map(function (v) { return dist(v, f); })); }));
      var score = s ? s * 10 - close : 0;
      if (score > bestS) { bestS = score; best = { m: m, rr: rr }; }
    });
    if (best && bestS >= 18) {
      best.rr.moves.unshift({ san: best.m.san, sure: false, tok: tokens[k] });
      return best.rr;
    }
    if (expNum) return null; // the numbered place is there but nothing fits
  }
  return null;
}

/**
 * Moves of a diagram through the commentary: a line from the diagram position, continued
 * further on where the text goes on legally with the expected move number
 * («17.♗d3! Белым удается… 17...♗xd3 18.♕xd3»); an unreadable move in between is bridged by
 * the rules (see nextStep). Variations rarely pass these checks.
 * @param {string} fen @param {string[]} tokens
 */
export function readMoves(fen, tokens) {
  var base = new Chess();
  var none = { moves: [], start: -1, sure: 0, num: 0, end: -1, fen: fen };
  if (!base.load(fen)) return none;
  var firstSide = fen.split(' ')[1];
  // a line from a start run, continued at the expected move numbers
  function chainFrom(first) {
    var moves = first.moves.slice(), pos = new Chess(fen), end = first.end, startNum = first.num || 0;
    moves.forEach(function (m) { pos.move(m.san); });
    while (startNum && moves.length < 400) {
      var idx = moves.length + (firstSide === 'b' ? 1 : 0), expNum = startNum + Math.floor(idx / 2);
      var next = nextStep(pos, tokens, end, expNum);
      if (!next || !next.moves.length) break;
      next.moves.forEach(function (m) { pos.move(m.san); moves.push(m); });
      end = next.end;
    }
    return { moves: moves, start: first.start, sure: moves.filter(function (m) { return m.sure; }).length, num: first.num, end: end, fen: pos.fen() };
  }
  // candidates: the best run, and every numbered place where the first move reads exactly
  var cands = [], b0 = bestRun(fen, tokens);
  if (b0.moves.length) cands.push(b0);
  for (var k = 0; k < tokens.length; k++) {
    if (isNumber(tokens[k]) || isAnnotation(tokens[k]) || !numberBefore(tokens, k)) continue;
    var r = scanRun(fen, tokens, k);
    if (r.moves.length && r.moves[0].sure && r.sure * 2 >= r.moves.length) cands.push(Object.assign(r, { start: k }));
  }
  var best = none;
  cands.forEach(function (c) {
    var ch = chainFrom(c);
    // a chain must be worth it: 2+ exact moves (a single exact long move only from bestRun)
    if ((ch.sure >= 2 || c === b0) && ch.sure > best.sure) best = ch;
  });
  return best;
}

/**
 * Movetext for the library item: «1... Лb8 2. Лd6» with the move numbers of the position.
 * @param {string} fen @param {{ san: string }[]} moves
 */
export function toMovetext(fen, moves) {
  var parts = fen.split(' '), side = parts[1], num = parseInt(parts[5], 10) || 1, out = [];
  moves.forEach(function (m, i) {
    if (side === 'w') out.push(num + '. ' + m.san);
    else out.push((i === 0 ? num + '... ' : '') + m.san);
    if (side === 'b') num++;
    side = side === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}

/**
 * Diagram number printed next to a board («1.155», «Диагр. 107», «107»): the OCR word closest
 * to the board's left or bottom edge that looks like a number.
 * @param {{ text: string, x0: number, y0: number, x1: number, y1: number }[]} words
 * @param {{ x: number, y: number, w: number, h: number }} o board outer rect
 */
export function diagramNumber(words, o) {
  var best = null, bestD = Infinity;
  words.forEach(function (w) {
    var m = /^(\d{1,2}\.\d{1,3}|\d{1,4})\.?$/.exec(w.text.replace(/[^\d.]/g, ''));
    if (!m || !/\d/.test(w.text) || /[a-h]/.test(w.text)) return;
    if (/^[1-8]$/.test(m[1])) return; // a rank coordinate printed next to the board
    var cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, d = Infinity;
    var leftOf = w.x1 <= o.x + 4 && w.x1 > o.x - o.w * 0.25 && cy > o.y - 4 && cy < o.y + o.h * 0.35;
    var below = cy > o.y + o.h && cy < o.y + o.h * 1.3 && cx > o.x - o.w * 0.1 && cx < o.x + o.w * 1.1;
    if (leftOf) d = (o.x - w.x1) + Math.abs(cy - o.y) * 0.5;
    else if (below) d = (cy - o.y - o.h) + 10;
    if (d < bestD) { bestD = d; best = m[1]; }
  });
  return best;
}

/** Looks like part of a move record: a move number, a square, castling, or a lone sign (figurine). @param {string} t */
export function movey(t) {
  // «66!»: a square with a garbled file letter (italic b read as 6)
  return /\d\.|[a-hа-яё!][1-8зб]|^[0OО]-[0OО]|^[^\wА-Яа-яё]{1,2}$|^\d[1-8][!?+#]*[,;.]?$/.test(t);
}

/**
 * Stretches of a page with moves, for a second OCR pass (English, moves alphabet only): words in
 * reading order are split into lines, and each line into runs of move-like words (a stray word
 * inside is tolerated). Returns rectangles in page pixels, in reading order.
 * @param {{ text: string, x0: number, y0: number, x1: number, y1: number }[]} words
 * @returns {{ x0: number, y0: number, x1: number, y1: number, n: number, numbered?: boolean }[]}
 */
export function moveSpans(words) {
  var spans = [], cur = null, gap = 0, prev = null;
  // one word is enough when it is a numbered move («16...♗f5?»)
  function close() { if (cur && (cur.n >= 2 || cur.numbered)) spans.push(cur); cur = null; gap = 0; }
  words.forEach(function (w) {
    var h = w.y1 - w.y0;
    var newLine = !prev || w.x0 < prev.x0 || Math.abs((w.y0 + w.y1) / 2 - (prev.y0 + prev.y1) / 2) > h * 0.7;
    if (newLine) close();
    prev = w;
    if (movey(w.text)) {
      if (!cur) cur = { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, n: 0 };
      cur.x0 = Math.min(cur.x0, w.x0); cur.y0 = Math.min(cur.y0, w.y0); cur.x1 = Math.max(cur.x1, w.x1); cur.y1 = Math.max(cur.y1, w.y1);
      cur.n++; gap = 0;
      if (/^\d+\.+\S/.test(w.text)) cur.numbered = true;
    } else if (cur && ++gap > 1) close();
  });
  close();
  return spans;
}
