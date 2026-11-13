// Chess text tokenizer and book/PGN parser.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { Chess as C } from '../core/chess.js';
import { START, makeRoot, tryMove, NAGMAP, toMovetext } from '../core/tree.js';

  // ---------- токенизатор ----------
  var PIECE = '(?:Кр|Ф|Л|С|К|C|[KQRBN]|[♔♕♖♗♘♚♛♜♝♞])';
  var FILE = '[a-hаес]';
  var CAP = '[x:×х]';
  var PROMO = '(?:[QRBN]|Ф|Л|С|К|[♕♖♗♘♛♜♝♞])';
  var CASTLE = '[0OО](?:[-‐‑–—−][0OО]){1,2}';
  var MOVE_SRC = '(?:' + CASTLE + '[+#]?|' + PIECE + '?' + FILE + '?[1-8]?' + '(?:' + CAP + '|[-‐‑–—−])?' + FILE + '[1-8](?:=?' + PROMO + ')?(?:e\\.p\\.)?[:×]?[+#]?|' + FILE + FILE + '(?:=?' + PROMO + ')?)' + '(?![A-Za-zА-Яа-я0-9])';
  var FEN_SRC = '(?:[rnbqkpRNBQKP1-8]{1,8}\\/){7}[rnbqkpRNBQKP1-8]{1,8}\\s+[wb]\\s+(?:[KQkq]{1,4}|-)\\s+(?:[a-h][36]|-)(?:\\s+\\d+\\s+\\d+)?';
  var TAG_SRC = '\\[[A-Za-z0-9]+\\s+"[^"]*"\\]';
  var RE_SRC = [
    '(\\{[^}]*\\})',                                   // 1 комментарий
    '(\\()', '(\\))',                                  // 2,3
    '(' + TAG_SRC + ')',                               // 4
    '(' + FEN_SRC + ')',                               // 5
    '(\\d{1,3})\\s*(\\.\\s*\\.\\s*\\.|\\.\\s*…|\\.{1,3}|…)',    // 6,7 номер хода
    '(1\\/2-1\\/2|½-½|1-0|0-1|\\*)(?![\\w])',          // 8 результат
    '(' + MOVE_SRC + ')',                              // 9 ход
    '(\\$\\d+)',                                       // 10 NAG
    '([^\\s(){}]+)'                                    // 11 слово
  ].join('|');

  var FIG = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N' };
  var RUP = { 'Кр': 'K', 'Ф': 'Q', 'Л': 'R', 'С': 'B', 'К': 'N' };

  function normMove(raw) {
    var s = raw.replace(/[!?]+/g, '').replace(/e\.p\./, '');
    if (/^[0OО](?:[-‐‑–—−][0OО]){1,2}[+#]?$/.test(s)) {
      var dashes = (s.match(/[-‐‑–—−]/g) || []).length;
      return (dashes === 2 ? 'O-O-O' : 'O-O') + (/[+#]$/.test(s) ? s.slice(-1) : '');
    }
    s = s.replace(/^C/, 'B');
    s = s.replace(/^(Кр|Ф|Л|С|К)/, function (m) { return RUP[m]; });
    s = s.replace(/[♔♕♖♗♘♚♛♜♝♞]/g, function (m) { return FIG[m]; });
    s = s.replace(/а/g, 'a').replace(/е/g, 'e').replace(/с/g, 'c').replace(/х/g, 'x');
    s = s.replace(/([1-8])[:×]/, '$1');
    s = s.replace(/[:×]/g, 'x');
    s = s.replace(/([18])=?(Ф|Л|С|К)/, function (_, r, p) { return r + '=' + RUP[p]; });
    s = s.replace(/([18])=?([♕♖♗♘♛♜♝♞])/, function (_, r, p) { return r + '=' + FIG[p]; });
    s = s.replace(/([18])([QRBN])/, '$1=$2');
    s = s.replace(/^([a-h][a-h])([QRBNФЛСК])$/, function (_, a, b) { return a + '=' + (RUP[b] || b); });
    s = s.replace(/^([a-h][a-h])=?([QRBN])$/, '$1=$2');
    return s;
  }

  function cleanText(t) {
    return String(t)
      .replace(/\u00AD/g, '')                                   // мягкие переносы
      .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/(\S)-\n(?=[a-hA-ZА-Яа-я0-9])/g, '$1')            // перенос слова на новую строку
      .replace(/\b([KQRBNКФЛСC])\s+(?=[a-hаесх][1-8])/g, '$1')   // «К f3» -> «Кf3»
      .replace(/\b(Kp|Кp|Kр)(?=[a-h]?[1-8]|\s)/g, 'Кр')           // Kp с латинскими буквами
      .replace(/([a-h])\s+([1-8])(?![\d.])/g, function (m, a, b, off, str) { return /[\s(]/.test(str[off - 1] || ' ') || /[KQRBNКФЛСC]/.test(str[off - 1] || '') ? a + b : m; })
      .replace(/([.…])\s*\n\s*(?=[a-hKQRBNКФЛС])/g, '$1 ');
  }

  function tokenize(text) {
    text = cleanText(text);
    var re = new RegExp(RE_SRC, 'g'), toks = [], m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      var pos = m.index;
      if (m[1] !== undefined) toks.push({ t: 'comment', v: m[1].slice(1, -1).replace(/\s+/g, ' ').trim(), pos: pos });
      else if (m[2] !== undefined) toks.push({ t: 'open', pos: pos });
      else if (m[3] !== undefined) toks.push({ t: 'close', pos: pos });
      else if (m[4] !== undefined) {
        var tm = /\[([A-Za-z0-9]+)\s+"([^"]*)"\]/.exec(m[4]);
        toks.push({ t: 'tag', k: tm[1], v: tm[2], pos: pos });
      }
      else if (m[5] !== undefined) toks.push({ t: 'fen', v: m[5].replace(/\s+/g, ' ').trim(), pos: pos });
      else if (m[6] !== undefined) toks.push({ t: 'num', n: parseInt(m[6], 10), dots: m[7].replace(/\s/g, '').length >= 2 || m[7] === '…' ? 3 : 1, pos: pos });
      else if (m[8] !== undefined) toks.push({ t: 'result', v: m[8] === '½-½' ? '1/2-1/2' : m[8], pos: pos });
      else if (m[9] !== undefined) toks.push({ t: 'san', raw: m[9], v: normMove(m[9]), pos: pos });
      else if (m[10] !== undefined) toks.push({ t: 'nag', v: m[10], pos: pos });
      else toks.push({ t: 'word', v: m[11], pos: pos });
    }
    return toks;
  }

  // ---------- заголовок партии по тексту перед ней ----------
  function guessTitle(text, pos, fallback) {
    var before = text.slice(Math.max(0, pos - 400), pos);
    var lines = before.split(/\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      var l = lines[i].replace(/\s+/g, ' ').trim();
      if (l.length < 3) continue;
      if (/^[\d\s.,–—-]+$/.test(l)) continue;
      // Fix (stage 1): text that belongs to the previous game is never a title.
      // PGN tag lines are skipped; a line ending with a result or a numbered move line
      // is the end of the previous game, so there is no heading of our own above it.
      if (/^\[[A-Za-z0-9]+\s+"[^"]*"\]$/.test(l)) continue;
      if (/(^|\s)(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(l)) return fallback;
      if (/^(стр(аница)?\.?|page)\s*\d+/i.test(l)) continue;
      var sans = tokenize(l).filter(function (t) { return t.t === 'san'; }).length;
      if (sans >= 1 && /^\d{1,3}\s*\./.test(l)) return fallback;
      if (sans >= 2) continue;
      l = l.replace(/[:;,\s]+$/, '');
      if (l.length > 90) l = l.slice(0, 88) + '…';
      return l;
    }
    return fallback;
  }

  // ---------- построитель партии ----------
  function newGame(fen, pos) {
    var f = fen || START;
    return {
      startFen: f, root: makeRoot(f), cur: null, stack: [], depth: 0, skip: 0,
      mainMoves: 0, finished: false, err: null, warn: 0, tags: {}, tagsOpen: false,
      fenGame: f !== START, result: '', pos: pos || 0
    };
  }
  function applyTags(g) {
    var t = g.tags;
    if (t.FEN && (t.SetUp === undefined || t.SetUp === '1')) {
      var v = new C();
      if (v.load(t.FEN)) { g.startFen = t.FEN; g.root = makeRoot(t.FEN); g.fenGame = t.FEN !== START; }
    }
  }

  // Основной проход. opts.single — всё это одна партия с заданной позиции.
  function run(text, opts) {
    opts = opts || {};
    var toks = tokenize(text), games = [], g = null;
    var pendingNum = null, afterMove = false;

    function close() {
      if (g) { games.push(g); g = null; }
    }
    function begin(fen, pos) {
      close();
      g = newGame(fen, pos);
      g.cur = g.root;
      pendingNum = null; afterMove = false;
    }
    if (opts.single) {
      g = newGame(opts.startFen, 0); g.cur = g.root; afterMove = true;
    }

    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];

      if (g && g.skip) {
        if (tk.t === 'open') g.depth++;
        else if (tk.t === 'close') { g.depth--; if (g.depth < g.skip) { g.skip = 0; g.cur = g.stack.pop(); } }
        continue;
      }

      switch (tk.t) {
        case 'tag':
          if (opts.single) break;
          if (!g || !g.tagsOpen || g.mainMoves > 0 || g.finished) {
            begin(START, tk.pos); g.tagsOpen = true; g.afterTags = true;
          }
          g.tags[tk.k] = tk.v;
          if (tk.k === 'FEN') { applyTags(g); g.cur = g.root; }
          afterMove = true;
          break;

        case 'fen':
          if (opts.single) break;
          var probe = new C();
          if (!probe.load(tk.v)) break;
          begin(tk.v, tk.pos);
          break;

        case 'num':
          pendingNum = tk; afterMove = false;
          break;

        case 'result':
          if (g && g.depth === 0) { g.result = tk.v; g.finished = true; }
          pendingNum = null; afterMove = false;
          break;

        case 'comment':
          if (g && g.cur && g.cur !== g.root && tk.v) g.cur.comment = g.cur.comment ? g.cur.comment + ' ' + tk.v : tk.v;
          break;

        case 'open':
          if (g && !g.finished && !g.err && g.cur && g.cur !== g.root) {
            g.stack.push(g.cur); g.cur = g.cur.parent; g.depth++;
            pendingNum = null; afterMove = true;
          } else if (g && g.depth > 0) { g.depth++; g.skip = g.skip || g.depth; g.warn++; }
          break;

        case 'close':
          if (g && g.depth > 0) {
            g.cur = g.stack.pop(); g.depth--;
            pendingNum = null; afterMove = true;
          }
          break;

        case 'nag':
          if (g && g.cur && g.cur !== g.root && NAGMAP[tk.v]) g.cur.nag = NAGMAP[tk.v];
          break;

        case 'word':
          if (/^(!!|\?\?|!\?|\?!|!|\?)$/.test(tk.v) && g && g.cur && g.cur !== g.root) { g.cur.nag = tk.v; break; }
          if (/^[!?+#=±∓∞⩲⩱\/\-−–—]+$/.test(tk.v) || /^e\.?p\.?$/.test(tk.v)) break;
          if (/^\d{1,4}$/.test(tk.v) || /^[•·*—–-]+$/.test(tk.v)) break;
          pendingNum = null; afterMove = false;
          break;

        case 'san':
          if (!pendingNum && !afterMove) break;
          var san = tk.v;

          // начало новой партии с позиции 1.
          if (!opts.single && pendingNum && pendingNum.n === 1 && pendingNum.dots === 1 && (!g || g.depth === 0) &&
              (!g || g.finished || g.err || (g.mainMoves > 0 && !(g.tagsOpen && g.mainMoves === 0))) &&
              !(g && g.fenGame && g.mainMoves === 0) && !(g && g.tagsOpen && g.mainMoves === 0)) {
            var trial = new C();
            if (trial.move(san, { sloppy: true })) begin(START, pendingNum.pos);
          }
          if (!g || g.finished || (g.err && g.depth === 0)) { pendingNum = null; afterMove = false; break; }

          var res = tryMove(g.cur, san);
          if (!res) {
            var alts = [];
            if (/^K[a-h1-8x]/.test(san)) alts.push('N' + san.slice(1));        // латинская K вместо русского «К» (конь)
            if (/^B/.test(san)) alts.push('R' + san.slice(1));
            if (/^N/.test(san)) alts.push('K' + san.slice(1));
            if (/^[a-h][1-8]-?[a-h][1-8]/.test(san)) alts.push(san.replace('-', ''));
            if (/^Q/.test(san)) alts.push('R' + san.slice(1));
            if (/^R/.test(san)) alts.push('Q' + san.slice(1));
            for (var ai = 0; ai < alts.length && !res; ai++) res = tryMove(g.cur, alts[ai]);
            if (res) g.fixes = (g.fixes || 0) + 1;
          }
          if (res) {
            g.cur = res.node;
            if (g.depth === 0) g.mainMoves++;
            pendingNum = null; afterMove = true;
          } else {
            if (g.depth > 0) { g.warn++; g.skip = g.depth; }
            else {
              g.err = { token: tk.raw, ply: g.mainMoves + 1, pos: tk.pos,
                before: g.cur === g.root ? 'начало' : (g.cur.color === 'w' ? g.cur.num + '. ' : g.cur.num + '... ') + g.cur.san };
            }
            pendingNum = null; afterMove = false;
          }
          break;
      }
    }
    // закрыть незавершённые скобки
    if (g && g.depth > 0) { while (g.stack.length) g.cur = g.stack.pop(); g.depth = 0; g.skip = 0; }
    close();
    return { games: games, text: text };
  }

  function parseMovetext(startFen, text) {
    var r = run(text, { single: true, startFen: startFen });
    var g = r.games[0];
    return { root: g.root, err: g.err, warn: g.warn, result: g.result };
  }

  function parseBook(text, opts) {
    opts = opts || {};
    text = cleanText(text);
    var r = run(text, {});
    var items = [], n = 0;
    r.games.forEach(function (g, gi) {
      var isPuzzle = g.fenGame;
      if (!isPuzzle && g.mainMoves < 3 && !g.err) return;
      if (isPuzzle && g.mainMoves < 1 && !g.err) return;
      if (!isPuzzle && g.mainMoves === 0) return;
      n++;
      var t = g.tags;
      var title = null;
      if (t.White || t.Black) {
        title = (t.White || '?') + ' — ' + (t.Black || '?');
        if (t.Event && t.Event !== '?') title += ' (' + t.Event + (t.Date && t.Date !== '????.??.??' ? ', ' + t.Date.slice(0, 4) : '') + ')';
      } else if (t.Event && t.Event !== '?') {
        // Fix (stage 1): a tagged game without players (typical for puzzles with [FEN]) is named by its Event tag.
        title = t.Event;
      }
      if (!title) title = guessTitle(text, g.pos, (isPuzzle ? 'Задача ' : 'Партия ') + n);
      items.push({
        type: isPuzzle ? 'puzzle' : 'game',
        title: title,
        startFen: g.startFen,
        text: toMovetext(g.root),
        result: g.result,
        plies: g.mainMoves,
        err: g.err ? { token: g.err.token, ply: g.err.ply, before: g.err.before } : null,
        warn: g.warn,
        raw: g.err ? cleanText(text).slice(g.pos, r.games[gi + 1] ? r.games[gi + 1].pos : g.pos + 3000).slice(0, 4000) : ''
      });
    });
    return items;
  }

export { cleanText, tokenize, normMove, guessTitle, parseMovetext, parseBook };
