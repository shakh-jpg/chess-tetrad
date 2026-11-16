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
    else if (/^[^a-hа-яё0-9]/i.test(first) && t.length >= 3) { piece = '*'; rest = t.slice(1); }
  }
  rest = rest.split('').map(function (ch, i, a) {
    var nextIsDigit = i + 1 < a.length;
    if (FILES[ch] && nextIsDigit) return FILES[ch];
    if (DIGITS[ch] && i > 0) return DIGITS[ch];
    return ch;
  }).join('').replace(/[^a-h1-8:=QRBN-]/g, '');
  if (!/[a-h][1-8]/.test(rest)) return [];
  var out = [piece + rest];
  if (piece === 'K') out.push('N' + rest); // Latin K may be a Cyrillic К (knight)
  if (piece === 'B' && /^C/.test(t)) out.push(rest); // a Latin C might be a misread file letter
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
  var variants = canonToken(tok);
  if (!variants.length) return null;
  /** @type {any} */ var best = null;
  var bestD = Infinity, tie = false;
  chess.moves({ verbose: true }).forEach(function (/** @type {any} */ m) {
    var d = Infinity;
    moveForms(m).forEach(function (f) { variants.forEach(function (v) { d = Math.min(d, dist(v, f)); }); });
    if (d < bestD) { bestD = d; best = m; tie = false; } else if (d === bestD) tie = true;
  });
  if (!best || tie || bestD > 1) return null;
  return { san: best.san, sure: bestD === 0, d: bestD };
}

/** Split OCR text into tokens; move numbers stay as separate tokens («8.», «5...»). @param {string} text */
export function tokenize(text) {
  var toks = String(text || '').replace(/(\d+\s*\.{1,4})(?=\S)/g, '$1 ').split(/\s+/).filter(Boolean), out = [];
  for (var i = 0; i < toks.length; i++) {
    // a piece sign split off its square: «Ф d5», «♘ f3»
    if (/^[^\sa-z0-9]$/i.test(toks[i]) && i + 1 < toks.length && /^[a-hа-яё:x×—-]?[a-hа-яё!][1-8зб]/i.test(toks[i + 1])) { out.push(toks[i] + toks[i + 1]); i++; continue; }
    out.push(toks[i]);
  }
  return out;
}
function isNumber(t) { return /^\d+\s*\.{1,4}$/.test(t) || /^\.{2,4}$/.test(t); }
function isAnnotation(t) { return /^[!?+#=∓±⩲⩱∞]+$/.test(t) || /^\([!?]+\)$/.test(t); }

/**
 * The longest run of consecutive legal moves in the tokens, starting from the position.
 * Move numbers and annotations between moves are skipped; any other word ends a run.
 * @param {string} fen @param {string[]} tokens
 * @returns {{ moves: { san: string, sure: boolean, tok: string }[], start: number, sure: number }}
 */
export function bestRun(fen, tokens) {
  var best = { moves: /** @type {{ san: string, sure: boolean, tok: string }[]} */ ([]), start: -1, sure: 0 };
  var base = new Chess();
  if (!base.load(fen)) return best;
  for (var i = 0; i < tokens.length; i++) {
    if (isNumber(tokens[i]) || isAnnotation(tokens[i])) continue;
    var c = new Chess(fen), run = [], sure = 0;
    // a move number right before the first move («1.», «8...»): prose rarely has one
    var numbered = false;
    for (var b = i - 1; b >= 0 && b >= i - 2; b--) { if (isNumber(tokens[b])) { numbered = true; break; } if (!isAnnotation(tokens[b])) break; }
    if (/^\d+\s*\.+\S/.test(tokens[i])) numbered = true;
    for (var j = i; j < tokens.length; j++) {
      var t = tokens[j];
      if (isNumber(t) || isAnnotation(t)) continue;
      var mv = matchMove(c, t);
      if (!mv) break;
      c.move(mv.san);
      run.push({ san: mv.san, sure: mv.sure, tok: t });
      if (mv.sure) sure++;
    }
    // precision first (no moves is better than wrong moves): a run needs 2+ moves with at least
    // half of them read exactly, or a single exactly read long-notation move («c5—c6»)
    // squares alone («h4 и g6») and single moves are prose too often: they need a move number
    var bare = run.every(function (m) { return /^[a-h][1-8]$/.test(canonToken(m.tok)[0] || ''); });
    var ok = (run.length >= 2 && sure * 2 >= run.length && (numbered || !bare)) ||
      (run.length === 1 && run[0].sure && numbered && /\d.*-|:/.test(canonToken(run[0].tok)[0] || ''));
    if (ok && (sure > best.sure || (sure === best.sure && run.length > best.moves.length))) best = { moves: run, start: i, sure: sure };
  }
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
