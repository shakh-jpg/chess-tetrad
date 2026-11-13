// Shakhmatnaya tetrad: UI (state, rendering, events, dialogs).
// Moved from the prototype's main IIFE; module-level code now, behaviour unchanged.
import { Chess as C } from '../core/chess.js';
import { Core } from '../core/index.js';
import { Engine } from '../engine/engine.js';
import { Recog } from '../recognition/recog.js';
import { Samples } from '../recognition/samples.js';
import { Store } from '../storage/store.js';
import { FILES, GL, fenToMap, mapToFen, kingSq } from '../board/position.js';
import { boardSVG, sqFromEvent, svgPoint } from '../board/svg.js';
import { loadPdfjs, fileToText } from '../pdf-import/files.js';
import { newStat, applyResult, bumpLog, streak as srsStreak, statLabel, dayKey } from '../srs/srs.js';
import { createLive } from '../live/live.js';
import { sampleBook } from './sample-book.js';
import { $, $$, esc, uid, lsGet, lsSet } from './util.js';

  var activeEditor = null;

  // ================= состояние =================
  var S = {
    books: [], book: null, item: null, root: null, cur: null, flipped: false,
    notation: lsGet('st.notation', 'fig'), mode: 'analyse', solve: null,
    sel: null, dots: [], drag: null, engineOn: false, engineLines: {}, engineKind: null,
    filter: 'all', q: '', pane: 'board', hint: null, delArm: null, msg: null, nodes: {}
  };

  // ================= вспомогательное: позиции =================
  var FIGS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
  var RUS = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };
  function fmt(san) {
    if (!san || S.notation === 'en') return san || '';
    var M = S.notation === 'fig' ? FIGS : RUS;
    return san.replace(/^[KQRBN]/, function (c) { return M[c]; }).replace(/=([QRBN])/, function (_, c) { return '=' + M[c]; });
  }

  // ================= уведомления и окна =================
  var toastT;
  function toast(msg, kind) {
    var el = $('#toast'); el.textContent = msg; el.className = 'toast show ' + (kind || '');
    clearTimeout(toastT); toastT = setTimeout(function () { el.className = 'toast'; }, 4200);
  }
  function openModal(html, cls) {
    var back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    $('#modal-root').appendChild(back);
    var api = {
      el: back.firstChild, back: back,
      close: function () { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener('keydown', onKey); if (api.onclose) api.onclose(); }
    };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } }
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', function (e) { if (e.target === back && !cls) api.close(); });
    $$('[data-close]', back).forEach(function (b) { b.addEventListener('click', api.close); });
    return api;
  }

  // ================= загрузка партии =================
  function curItemRef() { return S.item; }
  function loadItem(book, item, silent) {
    stopEngineRun();
    S.book = book; S.item = item; S.hint = null; S.sel = null; S.dots = []; S.msg = null;
    var r = Core.parseMovetext(item.startFen, item.text || '');
    S.root = r.root; S.cur = S.root;
    S.flipped = item.startFen.split(' ')[1] === 'b' && item.type === 'puzzle';
    if (r.err && !silent) toast('Ход «' + r.err.token + '» нельзя сыграть после «' + r.err.before + '». Откройте «Править текст», чтобы исправить.', 'warn');
    lsSet('st.last', { b: book.id, i: item.id });
    if (item.type === 'puzzle' && S.root.kids.length && !Live.isOn()) startSolve(); else { S.mode = 'analyse'; S.solve = null; }
    if (window.innerWidth < 900) S.pane = 'board';
    renderAll(); scheduleEngine();
    Live.itemLoaded();
  }
  function persist() {
    if (S.item) {
      S.item.text = Core.toMovetext(S.root);
      S.item.plies = Core.mainLine(S.root).length;
      if (S.item.id !== 'live' && S.book) Store.save(S.book);
    }
    Live.treeChanged();
  }

  // ================= игра: ходы =================
  function legalMoves(fen, from) {
    return new C(fen).moves({ square: from, verbose: true });
  }
  function userSide() { return S.cur.fen.split(' ')[1]; }
  function canMoveNow() {
    if (S.mode === 'solve' && S.solve && !S.solve.done) return !S.solve.busy;
    return true;
  }
  function pieceSideAt(map, sq) { return map[sq] ? map[sq][0] : null; }

  function attemptMove(from, to) {
    var moves = legalMoves(S.cur.fen, from).filter(function (m) { return m.to === to; });
    if (!moves.length) return false;
    if (moves[0].promotion) { choosePromotion(moves[0], function (pr) { doMove({ from: from, to: to, promotion: pr }); }); return true; }
    doMove({ from: from, to: to });
    return true;
  }
  function choosePromotion(m, cb) {
    var side = m.color, wrap = $('#boardwrap'), box = document.createElement('div');
    box.className = 'promo';
    box.innerHTML = '<div class="promo-in"><span>Превратить в</span>' + ['q', 'r', 'b', 'n'].map(function (p) {
      return '<button class="pbtn ' + side + '" data-p="' + p + '" aria-label="' + p + '">' + GL[p.toUpperCase()] + '</button>';
    }).join('') + '</div>';
    wrap.appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]'); if (!b) { if (e.target === box) { box.remove(); S.sel = null; S.dots = []; renderBoard(); } return; }
      box.remove(); cb(b.getAttribute('data-p'));
    });
  }
  function doMove(mv) {
    if (S.mode === 'solve' && S.solve && !S.solve.done) return solveMove(mv);
    var res = Core.tryMove(S.cur, mv);
    if (!res) return;
    S.cur = res.node; S.sel = null; S.dots = []; S.hint = null;
    persist(); renderAll(); scheduleEngine();
  }

  // ---------- режим решения ----------
  function startSolve() {
    S.mode = 'solve';
    S.solve = { node: S.root, done: false, wrong: 0, hints: 0, busy: false, msg: '' };
    S.cur = S.root; S.hint = null;
  }
  function solveMove(mv) {
    var sol = S.solve.node.kids[0];
    var g = new C(S.cur.fen), m = g.move(mv);
    if (!m) return;
    var ok = sol && sol.san === m.san;
    var altMate = !ok && g.in_checkmate();
    if (ok || altMate) {
      S.hint = null; S.sel = null; S.dots = [];
      var node = ok ? sol : Core.addChild(S.cur, m.san, g.fen());
      S.cur = node; S.solve.node = node; S.solve.msg = altMate && !ok ? 'Тоже мат — задача решена другим путём.' : 'Верно.';
      var reply = node.kids[0];
      if (!reply) return finishSolve();
      S.solve.busy = true; renderAll();
      setTimeout(function () {
        S.cur = reply; S.solve.node = reply; S.solve.busy = false;
        if (!reply.kids[0]) finishSolve(); else renderAll();
      }, 650);
      return;
    }
    S.solve.wrong++; S.solve.msg = 'Не тот ход. Попробуйте ещё раз.';
    S.sel = null; S.dots = [];
    var svg = $('#board svg'); if (svg) { svg.classList.remove('shake'); void svg.getBoundingClientRect(); svg.classList.add('shake'); }
    renderAll();
  }
  // ---- прогресс и повторение: логика в srs/srs.js ----
  function recordResult(kind) {
    var it = S.item;
    if (!it || it.id === 'live' || it.type !== 'puzzle' || !S.solve || S.solve.rec || !S.book) return;
    S.solve.rec = true;
    var st = it.stat = it.stat || newStat(), now = Date.now();
    applyResult(st, kind, now);
    if (kind !== 'fail') it.solved = true;
    lsSet('st.log', bumpLog(lsGet('st.log', {}), now));
    Store.save(S.book);
  }
  function finishSolve() {
    S.solve.done = true; S.solve.busy = false;
    recordResult(S.solve.wrong === 0 && S.solve.hints === 0 ? 'clean' : 'help');
    S.solve.msg = 'Задача решена.';
    renderAll(); scheduleEngine();
  }
  function hintSolve() {
    if (!S.solve || S.solve.done) return;
    var sol = S.solve.node.kids[0]; if (!sol) return;
    var g = new C(S.solve.node.fen), m = g.move(sol.san);
    S.solve.hints++;
    S.hint = S.solve.hints === 1 ? { from: m.from } : { from: m.from, to: m.to };
    renderAll();
  }
  function showSolution() {
    if (!S.solve) return;
    if (!S.solve.done) recordResult('fail');
    S.solve.done = true; S.hint = null; S.solve.msg = 'Решение показано.';
    var path = []; var n = S.solve.node; while (n.kids[0]) { n = n.kids[0]; path.push(n); }
    var i = 0;
    (function step() {
      if (i >= path.length) { renderAll(); scheduleEngine(); return; }
      S.cur = path[i++]; S.solve.node = S.cur; renderAll(); setTimeout(step, 750);
    })();
  }
  function resetSolve() { if (S.item) { stopEngineRun(); startSolve(); renderAll(); } }
  function toAnalysis() { S.mode = 'analyse'; S.hint = null; renderAll(); scheduleEngine(); }

  // ================= навигация =================
  function go(node) {
    if (!node) return;
    if (Live.blocked()) { toast('Сейчас ходит только учитель.'); return; }
    S.cur = node; S.sel = null; S.dots = []; S.hint = null; renderAll(); scheduleEngine(); Live.curChanged();
  }
  function goPrev() { if (S.mode === 'solve' && !S.solve.done) return; if (S.cur.parent) go(S.cur.parent); }
  function goNext() { if (S.mode === 'solve' && !S.solve.done) return; if (S.cur.kids[0]) go(S.cur.kids[0]); }
  function goStart() { if (S.mode === 'solve' && !S.solve.done) return; go(S.root); }
  function goEnd() { if (S.mode === 'solve' && !S.solve.done) return; var n = S.cur; while (n.kids[0]) n = n.kids[0]; go(n); }
  function deleteFromHere() {
    if (!S.cur.parent || Live.blocked()) return;
    var p = S.cur.parent; Core.removeNode(S.cur); S.cur = p; persist(); renderAll(); scheduleEngine();
  }
  function promoteVariation() {
    if (!S.cur.parent || Live.blocked()) return;
    var n = S.cur; while (n.parent && n.parent.kids[0] === n) n = n.parent;
    if (n.parent) { Core.promoteNode(n); persist(); renderAll(); }
  }

  // ================= отрисовка: доска =================
  function renderBoard() {
    var host = $('#board'); if (!host) return;
    var fen = S.cur.fen, g = new C(fen), pieces = fenToMap(fen);
    var last = S.cur.parent && S.cur.san ? lastMoveOf(S.cur) : null;
    var arrows = [];
    var showEngine = S.engineOn && S.engineLines[1] && S.engineLines[1].pv && S.engineLines[1].pv[0];
    if (showEngine && (S.mode !== 'solve' || S.solve.done)) {
      var u = S.engineLines[1].pv[0]; arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), cls: 'eng' });
    }
    if (S.hint && S.hint.to) arrows.push({ from: S.hint.from, to: S.hint.to, cls: 'hint' });
    var marks = [];
    if (S.draw && S.draw.node === S.cur) {
      S.draw.arrows.forEach(function (a) { arrows.push({ from: a.from, to: a.to, cls: 'draw' }); });
      marks = S.draw.marks.slice();
    }
    if (S.dw && S.dw.to && S.dw.to !== S.dw.from) arrows.push({ from: S.dw.from, to: S.dw.to, cls: 'draw prev' });
    var check = g.in_check() ? kingSq(pieces, g.turn()) : null;
    host.innerHTML = boardSVG(pieces, {
      flipped: S.flipped, last: last, sel: S.sel, dots: S.dots, check: check,
      hint: S.hint && !S.hint.to ? S.hint.from : null, arrows: arrows, marks: marks, dragSq: S.drag && S.drag.moved ? S.drag.from : null
    });
    var st = '', turn = g.turn() === 'w' ? 'белых' : 'чёрных';
    if (g.in_checkmate()) st = 'Мат. ' + (g.turn() === 'w' ? 'Чёрные' : 'Белые') + ' выиграли.';
    else if (g.in_stalemate()) st = 'Пат. Ничья.';
    else if (g.in_draw()) st = 'Ничья.';
    else st = 'Ход ' + turn + (g.in_check() ? ' · шах' : '');
    $('#turnline').textContent = st;
    var eb2 = $('#evalbar'); if (eb2) eb2.classList.toggle('flip', S.flipped);
    host.classList.toggle('drawing', !!S.drawMode);
  }
  function lastMoveOf(node) {
    var g = new C(node.parent.fen), m = g.move(node.san);
    return m ? { from: m.from, to: m.to } : null;
  }

  // ================= отрисовка: ходы =================
  function renderMoves() {
    var host = $('#moves'); if (!host) return;
    S.nodes = {};
    var limit = null;
    if (S.mode === 'solve' && S.solve && !S.solve.done) {
      limit = {}; var n = S.cur; while (n) { limit[n.id] = 1; n = n.parent; }
    }
    function reg(n) { S.nodes[n.id] = n; n.kids.forEach(reg); } reg(S.root);
    function line(first) {
      var html = '', node = first, needNum = true;
      while (node) {
        if (limit && !limit[node.id]) break;
        var num = node.color === 'w' ? node.num + '.' : (needNum ? node.num + '…' : '');
        html += '<a class="mv' + (node === S.cur ? ' cur' : '') + '" data-id="' + node.id + '" href="#">' + (num ? '<i>' + num + '</i>' : '') + esc(fmt(node.san)) + (node.nag ? '<b class="nag">' + node.nag + '</b>' : '') + '</a> ';
        needNum = false;
        if (node.comment) { html += '<span class="cm">' + esc(node.comment) + '</span> '; needNum = true; }
        var par = node.parent;
        if (!limit && par && par.kids[0] === node && par.kids.length > 1) {
          for (var i = 1; i < par.kids.length; i++) html += '<div class="var">' + line(par.kids[i]) + '</div>';
          needNum = true;
        }
        node = node.kids[0];
      }
      return html;
    }
    if (!S.root.kids.length) host.innerHTML = '<p class="empty-note">Ходов пока нет. Сделайте ход на доске, он сохранится в этой записи.</p>';
    else if (limit && S.cur === S.root) host.innerHTML = '<p class="empty-note">Решение скрыто. Ваши ходы появятся здесь.</p>';
    else host.innerHTML = line(S.root.kids[0]);
    var cur = $('.mv.cur', host);
    if (cur) { var hb = host.getBoundingClientRect(), cb = cur.getBoundingClientRect(); if (cb.top < hb.top || cb.bottom > hb.bottom) host.scrollTop += cb.top - hb.top - hb.height / 2; }
  }

  // ================= отрисовка: центр =================
  function renderStage() {
    var it = S.item;
    $('#itemtitle').textContent = it ? it.title : 'Выберите партию или задачу';
    var sub = '';
    if (it) {
      sub = (it.type === 'puzzle' ? 'Задача' : 'Партия') + (it.note ? ' · ' + it.note : '') + (it.plies ? ' · ' + it.plies + ' полуходов' : '') + (it.result ? ' · ' + it.result : '') + (it.section ? ' · ' + it.section : (S.book ? ' · ' + S.book.name : ''));
    } else sub = 'Загрузите книгу или откройте пример слева';
    $('#itemsub').textContent = sub;

    var b = $('#banner'), html = '';
    if (it && S.mode === 'solve' && S.solve) {
      var sv = S.solve, side = S.root.fen.split(' ')[1] === 'w' ? 'Белые' : 'Чёрные';
      if (sv.done) {
        html = '<div class="ban good"><strong>' + esc(sv.msg || 'Готово') + '</strong><span>Можно разобрать позицию с движком или перейти дальше.</span><div class="ban-act"><button class="btn" data-act="resetsolve">Ещё раз</button><button class="btn" data-act="analyse">Анализ</button><button class="btn primary" data-act="nextpuzzle">Следующая задача</button></div></div>';
      } else {
        html = '<div class="ban"><strong>' + side + ' начинают.</strong><span>' + esc(sv.msg || 'Найдите лучший ход.') + (sv.wrong ? ' Ошибок: ' + sv.wrong + '.' : '') + '</span><div class="ban-act"><button class="btn" data-act="hint">Подсказка</button><button class="btn" data-act="solution">Показать решение</button><button class="btn" data-act="analyse">Свободный анализ</button></div></div>';
      }
    } else if (it && it.type === 'puzzle') {
      html = '<div class="ban"><strong>' + (S.root.kids.length ? 'Свободный анализ задачи.' : 'У задачи нет записанного решения.') + '</strong><span>' + (S.root.kids.length ? '' : 'Сыграйте решение на доске, оно сохранится. После этого можно включить режим решения.') + '</span><div class="ban-act">' + (S.root.kids.length ? '<button class="btn primary" data-act="resetsolve">Решать</button>' : '') + '</div></div>';
    }
    b.innerHTML = html;
  }
  function renderNavState() {
    var lock = S.mode === 'solve' && S.solve && !S.solve.done;
    var lb = Live.blocked();
    ['first', 'prev', 'next', 'last'].forEach(function (a) { var el = $('[data-nav="' + a + '"]'); if (el) el.disabled = lock || lb; });
    var eb = $('#engine-toggle'); if (eb) { eb.disabled = false; eb.classList.toggle('dim', lock || Live.engineBlocked()); eb.title = Live.engineBlocked() ? 'Учитель отключил движок на время урока' : (lock ? 'Движок недоступен, пока вы решаете задачу' : ''); eb.setAttribute('aria-pressed', S.engineOn ? 'true' : 'false'); eb.classList.toggle('on', S.engineOn); eb.textContent = S.engineOn ? 'Выключить' : 'Включить'; }
    var tools = $('#movetools'); if (tools) tools.hidden = lock;
  }

  // ================= отрисовка: библиотека =================
  function renderLibrary() {
    var bh = $('#books');
    if (!S.books.length) bh.innerHTML = '<p class="empty-note">Пока нет книг. Нажмите «Загрузить книгу».</p>';
    else bh.innerHTML = S.books.map(function (b) {
      var on = S.book && S.book.id === b.id, armed = S.delArm === b.id;
      return '<div class="book' + (on ? ' on' : '') + '"><button class="book-main" data-book="' + b.id + '"><span class="bk-name">' + esc(b.name) + '</span><span class="bk-n">' + b.items.length + '</span></button>' +
        '<button class="icon-btn' + (armed ? ' danger' : '') + '" data-delbook="' + b.id + '" title="Удалить книгу" aria-label="Удалить книгу">' + (armed ? 'Удалить?' : '×') + '</button></div>';
    }).join('');
    var ih = $('#items'), book = S.book;
    $$('.chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-f') === S.filter); });
    if (!book) { ih.innerHTML = ''; return; }
    var q = S.q.trim().toLowerCase();
    var list = book.items.filter(function (it) {
      if (S.filter === 'game' && it.type !== 'game') return false;
      if (S.filter === 'puzzle' && it.type !== 'puzzle') return false;
      return !q || it.title.toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) { ih.innerHTML = '<p class="empty-note">Ничего не найдено.</p>'; return; }
    var lastSec = null;
    ih.innerHTML = list.map(function (it) {
      var on = S.item && S.item.id === it.id, head = '';
      if (it.section && it.section !== lastSec && !q) head = '<div class="sec-title">' + esc(it.section) + '</div>';
      if (!q) lastSec = it.section || lastSec;
      return head + '<div class="item' + (on ? ' on' : '') + '" data-item="' + it.id + '">' +
        '<span class="tag ' + it.type + '">' + (it.type === 'puzzle' ? 'З' : 'П') + '</span>' +
        '<button class="it-main" data-open="' + it.id + '"><span class="it-title">' + esc(it.title) + '</span>' +
        '<span class="it-meta">' + (it.plies || 0) + ' п/х' + (it.err ? ' · <b class="warn">ошибка разбора</b>' : '') + statLabel(it) + '</span></button>' +
        '<button class="icon-btn" data-edit="' + it.id + '" title="Править текст ходов" aria-label="Править">✎</button>' +
        '<button class="icon-btn" data-delitem="' + it.id + '" title="Удалить" aria-label="Удалить">×</button></div>';
    }).join('');
  }

  // ================= движок =================
  function scoreText(l) {
    if (!l) return '';
    var sign = l.turn === 'w' ? 1 : -1;
    if (l.mate != null) { var m = l.mate * sign; return (m > 0 ? '+' : '−') + '#' + Math.abs(m); }
    var v = l.cp * sign / 100; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  }
  function whiteShare(l) {
    var sign = l.turn === 'w' ? 1 : -1;
    if (l.mate != null) return l.mate * sign > 0 ? 100 : 0;
    return 100 / (1 + Math.exp(-(l.cp * sign) / 400));
  }
  function pvToSan(fen, pv, n) {
    var g = new C(fen), out = [], moveNo = parseInt(fen.split(' ')[5], 10) || 1, turn = fen.split(' ')[1];
    for (var i = 0; i < pv.length && i < n; i++) {
      var u = pv[i], m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) break;
      var pre = '';
      if (turn === 'w') pre = moveNo + '. '; else if (i === 0) pre = moveNo + '… ';
      out.push(pre + fmt(m.san));
      if (turn === 'b') moveNo++;
      turn = turn === 'w' ? 'b' : 'w';
    }
    return out.join(' ');
  }
  var engRaf = 0;
  function renderEngine() {
    var host = $('#engine'), bar = $('#evalfill');
    if (!host) return;
    var lines = Object.keys(S.engineLines).sort().map(function (k) { return S.engineLines[k]; });
    if (!S.engineOn) { host.innerHTML = '<p class="empty-note">Движок выключен. Он показывает оценку позиции и лучшие продолжения.</p>'; if (bar) bar.style.height = '50%'; return; }
    var status = S.engineKind === 'stockfish' ? 'Stockfish 10' : S.engineKind === 'fallback' ? 'Встроенный простой движок (слабее Stockfish)' : S.engineKind === 'none' ? 'Движок не удалось запустить' : 'Запуск движка…';
    var html = '<div class="eng-status">' + esc(status) + (lines[0] ? ' · глубина ' + lines[0].depth : '') + '</div>';
    lines.forEach(function (l, i) {
      html += '<div class="eng-line"><span class="eng-score">' + scoreText(l) + '</span><span class="eng-pv">' + esc(pvToSan(S.cur.fen, l.pv, 9)) + '</span><button class="icon-btn" data-addpv="' + (i + 1) + '" title="Добавить линию в партию как вариант" aria-label="Добавить линию">+</button></div>';
    });
    if (!lines.length && S.engineKind && S.engineKind !== 'none') html += '<p class="empty-note">Считаю…</p>';
    host.innerHTML = html;
    if (bar && lines[0]) bar.style.height = whiteShare(lines[0]).toFixed(1) + '%';
  }
  function stopEngineRun() { try { Engine.stop(); } catch (e) {} S.engineLines = {}; }
  function scheduleEngine() {
    if (!S.engineOn) { renderEngine(); return; }
    if (S.mode === 'solve' && S.solve && !S.solve.done) return;
    S.engineLines = {}; renderEngine(); renderBoard();
    clearTimeout(scheduleEngine.t);
    scheduleEngine.t = setTimeout(function () {
      var fen = S.cur.fen, g = new C(fen);
      if (g.game_over()) { S.engineLines = {}; renderEngine(); return; }
      Engine.analyse(fen, { lines: 3, depth: 16, ms: 6000 }, function (info) {
        if (S.cur.fen !== fen) return;
        S.engineLines[info.multipv] = info;
        if (!engRaf) engRaf = requestAnimationFrame(function () { engRaf = 0; renderEngine(); renderBoard(); });
      });
    }, 220);
  }
  function toggleEngine() {
    if (!S.engineOn && S.mode === 'solve' && S.solve && !S.solve.done) { toast('Движок недоступен, пока вы решаете задачу. Нажмите «Показать решение» или «Свободный анализ».'); return; }
    if (!S.engineOn && Live.engineBlocked()) { toast('Учитель отключил движок на время урока.'); return; }
    S.engineOn = !S.engineOn;
    if (S.engineOn) {
      S.engineKind = Engine.kind; renderEngine();
      Engine.init().then(function (k) { S.engineKind = k; renderEngine(); scheduleEngine(); });
      if (window.innerWidth < 900) { S.pane = 'notes'; renderPane(); }
    } else { stopEngineRun(); renderEngine(); renderBoard(); }
    renderNavState();
  }
  function addPvLine(idx) {
    var l = S.engineLines[idx]; if (!l || Live.engineBlocked()) return;
    var g = new C(S.cur.fen), node = S.cur, first = null;
    for (var i = 0; i < l.pv.length && i < 8; i++) {
      var u = l.pv[i], m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) break;
      node = Core.addChild(node, m.san, g.fen()); if (!first) first = node;
    }
    if (first) { S.cur = first; persist(); renderAll(); scheduleEngine(); }
  }

  // ================= общий рендер =================
  function renderPane() {
    $('#layout').setAttribute('data-pane', S.pane);
    $$('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('data-pane') === S.pane ? 'true' : 'false'); });
  }
  function renderAll() {
    renderLibrary(); renderStage(); renderBoard(); renderMoves(); renderCm(); renderNavState(); renderEngine(); renderPane();
    var ns = $('#notation'); if (ns && ns.value !== S.notation) ns.value = S.notation;
  }

  // ================= комментарии и оценки ходов =================
  function renderCm() {
    var pn = $('#cmpanel'); if (!pn) return;
    var show = !!(S.cur && S.cur.parent) && !(S.mode === 'solve' && S.solve && !S.solve.done);
    pn.hidden = !show; if (!show) return;
    $$('[data-nag]', pn).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nag') === (S.cur.nag || '')); });
    var ta = $('#cmtext'); if (ta) { if (document.activeElement !== ta) ta.value = S.cur.comment || ''; ta.disabled = Live.blocked(); }
  }
  var cmTimer = null;
  function onCmInput(e) {
    if (Live.blocked() || !S.cur.parent) return;
    var node = S.cur, v = e.target.value.replace(/[{}]/g, '').replace(/\s+/g, ' ');
    node.comment = v.trim();
    clearTimeout(cmTimer); cmTimer = setTimeout(function () { persist(); renderMoves(); }, 350);
  }
  function setNag(v) {
    if (Live.blocked() || !S.cur.parent) return;
    if (S.cur.nag === v) delete S.cur.nag; else S.cur.nag = v;
    persist(); renderMoves(); renderCm();
  }

  // ================= рисование на доске =================
  function ensureDraw() { if (!S.draw || S.draw.node !== S.cur) S.draw = { node: S.cur, arrows: [], marks: [] }; return S.draw; }
  function finishDraw(e, host) {
    var d = S.dw; S.dw = null; if (!d) return;
    var svg = $('svg', host), to = svg ? sqFromEvent(svg, e, S.flipped) : null;
    if (to) {
      var dr = ensureDraw();
      if (to === d.from) { var mi = dr.marks.indexOf(to); if (mi >= 0) dr.marks.splice(mi, 1); else dr.marks.push(to); }
      else {
        var ai = -1; dr.arrows.forEach(function (a, i) { if (a.from === d.from && a.to === to) ai = i; });
        if (ai >= 0) dr.arrows.splice(ai, 1); else if (dr.arrows.length < 30) dr.arrows.push({ from: d.from, to: to });
      }
      Live.drawChanged();
    }
    renderBoard();
  }
  function clearDraw() { if (S.draw && S.draw.node === S.cur && (S.draw.arrows.length || S.draw.marks.length)) { S.draw = null; Live.drawChanged(); } renderBoard(); }
  function drawPayload() {
    if (!(S.draw && S.draw.node === S.cur) || !(S.draw.arrows.length || S.draw.marks.length)) return undefined;
    return { a: S.draw.arrows.map(function (x) { return x.from + x.to; }), m: S.draw.marks.slice() };
  }
  function applyDraw(dw) {
    var SQ = /^[a-h][1-8]$/;
    if (!dw || typeof dw !== 'object') { S.draw = null; return; }
    var a = (Array.isArray(dw.a) ? dw.a : []).slice(0, 30).filter(function (x) { return typeof x === 'string' && SQ.test(x.slice(0, 2)) && SQ.test(x.slice(2)) && x.length === 4; }).map(function (x) { return { from: x.slice(0, 2), to: x.slice(2) }; });
    var m = (Array.isArray(dw.m) ? dw.m : []).slice(0, 30).filter(function (x) { return typeof x === 'string' && SQ.test(x); });
    S.draw = (a.length || m.length) ? { node: S.cur, arrows: a, marks: m } : null;
  }

  // ================= прогресс =================
  function openProgress() {
    var now = Date.now(), tot = 0, none = 0, clean = 0, help = 0, fail = 0, due = [], rows = [];
    S.books.forEach(function (b) {
      var secs = {}, order = [];
      b.items.forEach(function (it) {
        if (it.type !== 'puzzle') return;
        tot++;
        var st = it.stat, sec = it.section || 'Без раздела';
        if (!secs[sec]) { secs[sec] = { n: 0, ok: 0 }; order.push(sec); }
        secs[sec].n++;
        if (!st) { if (it.solved) { help++; secs[sec].ok++; } else none++; return; }
        if (st.res === 'fail') { fail++; due.push({ b: b.id, i: it.id, d: st.due }); }
        else {
          secs[sec].ok++; if (st.res === 'clean') clean++; else help++;
          if (st.due <= now) due.push({ b: b.id, i: it.id, d: st.due });
        }
      });
      if (order.length) rows.push('<div class="pg-book"><strong>' + esc(b.name) + '</strong>' + order.map(function (n) {
        var x = secs[n], pc = Math.round(x.ok / x.n * 100);
        return '<div class="pg-row"><span class="pg-name">' + esc(n) + '</span><span class="pg-bar"><i style="width:' + pc + '%"></i></span><span class="pg-n">' + x.ok + ' / ' + x.n + '</span></div>';
      }).join('') + '</div>');
    });
    var log = lsGet('st.log', {}), streak = srsStreak(log, Date.now());
    due.sort(function (a, b) { return a.d - b.d; });
    var m = openModal('<h3>Прогресс</h3>' + (tot ? '<div class="pg-sum"><div><b>' + clean + '</b><span>решено сразу</span></div><div><b>' + help + '</b><span>с ошибками или подсказкой</span></div><div><b>' + fail + '</b><span>не решено</span></div><div><b>' + none + '</b><span>ещё не пробовали</span></div></div>' +
      '<p class="hint-note">Занимались сегодня: ' + (log[dayKey(Date.now())] || 0) + ' задач. Дней подряд: ' + streak + '. Прогресс хранится в этом браузере и попадает в копию библиотеки.</p>' +
      '<div class="pg-list">' + rows.join('') + '</div>' : '<p class="empty-note">Пока нет задач. Загрузите книгу с задачами, и здесь появится ваш прогресс.</p>') +
      '<div class="modal-act"><button class="btn" id="pg-reset">Сбросить прогресс</button><button class="btn" data-close>Закрыть</button><button class="btn primary" id="pg-rep"' + (due.length ? '' : ' disabled') + '>Повторить (' + due.length + ')</button></div>');
    $('#pg-rep', m.el).addEventListener('click', function () {
      S.repQ = due.map(function (x) { return { b: x.b, i: x.i }; }); m.close(); nextPuzzle();
    });
    $('#pg-reset', m.el).addEventListener('click', function () {
      if (!confirm('Стереть результаты всех задач?')) return;
      S.books.forEach(function (b) { b.items.forEach(function (it) { delete it.stat; delete it.solved; }); Store.save(b); });
      lsSet('st.log', {}); m.close(); renderLibrary(); toast('Прогресс сброшен');
    });
  }

  // ================= данные: резервная копия и PGN =================
  var Dl = null;
  function saveFile(name, text, mime) {
    if (Dl) return Dl.save({ filename: name, data: text }).then(function () { toast('Файл готов'); }, function (e) { if (!e || e.code !== 'declined') toast('Не удалось сохранить файл: ' + ((e && e.message) || 'ошибка'), 'bad'); });
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return Promise.resolve();
  }
  function safeName(n) { return String(n || 'kniga').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'kniga'; }
  function pgnOf(it, movetext) {
    var fen = it.startFen || Core.START, t = function (k, v) { return '[' + k + ' "' + String(v).replace(/[\\"]/g, ' ') + '"]'; };
    var res = it.result && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(it.result) ? it.result : '*';
    var tags = [t('Event', it.title || '?'), t('Site', '?'), t('Date', '????.??.??'), t('Round', '?'), t('White', '?'), t('Black', '?'), t('Result', res)];
    if (fen.split(' ')[0] !== Core.START.split(' ')[0]) { tags.push(t('SetUp', '1')); tags.push(t('FEN', fen)); }
    var mt = movetext || '';
    var body = (mt ? mt + ' ' : '') + res;
    return tags.join('\n') + '\n\n' + body.replace(/(.{1,90})(\s+|$)/g, '$1\n').trim() + '\n';
  }
  function exportBackup() {
    var obj = { app: 'shakhmatnaya-tetrad', v: 1, date: new Date().toISOString(), books: S.books.map(function (b) { return JSON.parse(JSON.stringify(b)); }), samples: Samples.exportAll() };
    return saveFile('shakhmatnaya-tetrad-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(obj), 'application/json');
  }
  function importBackup(text) {
    var o; try { o = JSON.parse(text); } catch (e) { return { err: 'Это не файл копии: не читается как JSON.' }; }
    if (!o || o.app !== 'shakhmatnaya-tetrad' || !Array.isArray(o.books)) return { err: 'Это не копия библиотеки «Шахматной тетради».' };
    var add = 0, rep = 0;
    o.books.forEach(function (b) {
      if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || !Array.isArray(b.items) || b.id === '__recog') return;
      b.items = b.items.filter(function (it) { return it && typeof it.id === 'string' && typeof it.title === 'string'; });
      var i = -1; S.books.forEach(function (x, k) { if (x.id === b.id) i = k; });
      if (i >= 0) { S.books[i] = b; rep++; } else { S.books.push(b); add++; }
      Store.put(JSON.parse(JSON.stringify(b)));
    });
    if (o.samples) Samples.merge(o.samples);
    S.books.sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    if (!S.book || !S.books.some(function (x) { return x === S.book; })) S.book = S.books[0] || null;
    renderAll();
    return { add: add, rep: rep };
  }
  function openData() {
    var cnt = S.books.reduce(function (n, b) { return n + b.items.length; }, 0);
    var m = openModal('<h3>Данные</h3><p class="hint-note">Библиотека хранится только в этом браузере. Если очистить данные сайта или сменить браузер, она пропадёт. Храните копию отдельно. Сейчас в библиотеке: книг ' + S.books.length + ', записей ' + cnt + '.' + (Store.persistent ? '' : ' Хранилище браузера недоступно, всё лежит только до закрытия страницы.') + '</p>' +
      '<div class="data-list">' +
      '<button class="btn primary" id="dt-backup">Скачать копию библиотеки (JSON)</button>' +
      '<label class="btn"><input id="dt-restore" type="file" accept=".json,application/json" hidden>Загрузить копию библиотеки</label>' +
      '<button class="btn" id="dt-pgn-book"' + (S.book ? '' : ' disabled') + '>PGN: вся книга «' + esc(S.book ? S.book.name : '') + '»</button>' +
      '<button class="btn" id="dt-pgn-cur"' + (S.item ? '' : ' disabled') + '>PGN: текущая запись</button></div>' +
      '<p class="hint-note">PGN сохраняется как текстовый файл (.pgn.txt). Переименуйте его в .pgn, если программа требует. Ходы, варианты, комментарии и оценки сохраняются.</p>' +
      '<div id="dt-status" class="status"></div><div class="modal-act"><button class="btn" data-close>Закрыть</button></div>');
    var st = $('#dt-status', m.el);
    $('#dt-backup', m.el).addEventListener('click', exportBackup);
    $('#dt-restore', m.el).addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        var r = importBackup(t);
        st.className = 'status ' + (r.err ? 'bad' : 'good');
        st.textContent = r.err || 'Загружено. Новых книг: ' + r.add + ', заменено: ' + r.rep + '.';
      });
    });
    $('#dt-pgn-book', m.el).addEventListener('click', function () {
      if (!S.book) return;
      var txt = S.book.items.map(function (it) { return pgnOf(it, it.text || ''); }).join('\n');
      saveFile(safeName(S.book.name) + '.pgn.txt', txt, 'text/plain');
    });
    $('#dt-pgn-cur', m.el).addEventListener('click', function () {
      if (!S.item) return;
      saveFile(safeName(S.item.title) + '.pgn.txt', pgnOf(S.item, Core.toMovetext(S.root)), 'text/plain');
    });
  }

  // ================= взаимодействие с доской =================
  function bindBoard() {
    var host = $('#board');
    host.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    host.addEventListener('pointerdown', function (e) {
      var svg = $('svg', host); if (!svg) return;
      if (e.button === 2 || (S.drawMode && e.button === 0)) {
        if (Live.blocked()) { toast('Сейчас рисует только учитель.'); return; }
        var q0 = sqFromEvent(svg, e, S.flipped); if (!q0) return;
        S.dw = { from: q0, to: null }; try { host.setPointerCapture(e.pointerId); } catch (x) {}
        e.preventDefault(); return;
      }
      if (e.button > 0) return;
      var sq = sqFromEvent(svg, e, S.flipped); if (!sq) return;
      var map = fenToMap(S.cur.fen), side = userSide();
      if (S.mode === 'solve' && S.solve && (S.solve.busy)) return;
      if (Live.blocked()) { toast('Сейчас ходит только учитель.'); return; }
      if (S.sel && S.sel !== sq && attemptMove(S.sel, sq)) { e.preventDefault(); return; }
      if (map[sq] && map[sq][0] === side && canMoveNow()) {
        S.sel = sq;
        var mv = legalMoves(S.cur.fen, sq);
        S.dots = mv.map(function (m) { return { sq: m.to, cap: !!m.captured || m.flags.indexOf('e') >= 0 }; });
        S.drag = { from: sq, piece: map[sq], moved: false, sx: e.clientX, sy: e.clientY, id: e.pointerId };
        renderBoard();
        try { host.setPointerCapture(e.pointerId); } catch (x) {}
        e.preventDefault();
      } else { S.sel = null; S.dots = []; renderBoard(); }
    });
    host.addEventListener('pointermove', function (e) {
      if (S.dw) {
        var sv = $('svg', host), q = sv ? sqFromEvent(sv, e, S.flipped) : null;
        if (q !== S.dw.to) { S.dw.to = q; renderBoard(); }
        return;
      }
      var d = S.drag; if (!d) return;
      var svg = $('svg', host); if (!svg) return;
      if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 6) { d.moved = true; renderBoard(); svg = $('svg', host); }
      if (d.moved) {
        var ghost = $('.ghost', svg);
        if (!ghost) {
          ghost = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          ghost.setAttribute('class', 'pc ghost ' + d.piece[0]); ghost.setAttribute('text-anchor', 'middle'); ghost.textContent = GL[d.piece[1]];
          svg.appendChild(ghost);
        }
        var p = svgPoint(svg, e); ghost.setAttribute('x', p.x); ghost.setAttribute('y', p.y + 28);
      }
    });
    function endDrag(e) {
      if (S.dw) { finishDraw(e, host); return; }
      var d = S.drag; if (!d) return; S.drag = null;
      var svg = $('svg', host);
      if (d.moved && svg) {
        var to = sqFromEvent(svg, e, S.flipped);
        if (to && to !== d.from && attemptMove(d.from, to)) return;
        S.sel = null; S.dots = [];
      } else if (!d.moved) { /* клик: оставляем выбор */ }
      renderBoard();
    }
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', function () { S.drag = null; S.dw = null; renderBoard(); });
  }

  // ================= события интерфейса =================
  function bindUI() {
    document.addEventListener('keydown', function (e) {
      var t = e.target; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if ($('#modal-root').children.length) return;
      if (e.key === 'ArrowLeft') { goPrev(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goNext(); e.preventDefault(); }
      else if (e.key === 'Home') { goStart(); e.preventDefault(); }
      else if (e.key === 'End') { goEnd(); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'а') { S.flipped = !S.flipped; renderBoard(); }
    });
    $('#layout').addEventListener('click', function (e) {
      var a;
      if ((a = e.target.closest('.mv'))) { e.preventDefault(); if (S.mode === 'solve' && !S.solve.done) return; go(S.nodes[a.getAttribute('data-id')]); return; }
      if ((a = e.target.closest('[data-book]'))) { S.book = S.books.filter(function (b) { return b.id === a.getAttribute('data-book'); })[0]; S.delArm = null; renderLibrary(); return; }
      if ((a = e.target.closest('[data-delbook]'))) {
        var id = a.getAttribute('data-delbook');
        if (S.delArm === id) {
          Store.del(id); S.books = S.books.filter(function (b) { return b.id !== id; });
          if (S.book && S.book.id === id) { S.book = S.books[0] || null; S.item = null; }
          S.delArm = null; toast('Книга удалена'); renderAll();
        } else { S.delArm = id; renderLibrary(); setTimeout(function () { if (S.delArm === id) { S.delArm = null; renderLibrary(); } }, 3000); }
        return;
      }
      if ((a = e.target.closest('[data-open]'))) { var it = S.book.items.filter(function (x) { return x.id === a.getAttribute('data-open'); })[0]; if (it) loadItem(S.book, it); return; }
      if ((a = e.target.closest('[data-edit]'))) { var it2 = S.book.items.filter(function (x) { return x.id === a.getAttribute('data-edit'); })[0]; if (it2) editItem(S.book, it2); return; }
      if ((a = e.target.closest('[data-delitem]'))) {
        var iid = a.getAttribute('data-delitem');
        S.book.items = S.book.items.filter(function (x) { return x.id !== iid; });
        if (S.item && S.item.id === iid) { S.item = null; S.root = Core.makeRoot(); S.cur = S.root; }
        Store.save(S.book); renderAll(); return;
      }
      if ((a = e.target.closest('[data-f]'))) { S.filter = a.getAttribute('data-f'); renderLibrary(); return; }
      if ((a = e.target.closest('[data-nag]'))) { setNag(a.getAttribute('data-nag')); return; }
      if (e.target.closest('#btn-draw')) { S.drawMode = !S.drawMode; var bd = $('#btn-draw'); bd.setAttribute('aria-pressed', String(S.drawMode)); renderBoard(); return; }
      if ((a = e.target.closest('[data-nav]'))) { var n = a.getAttribute('data-nav'); ({ first: goStart, prev: goPrev, next: goNext, last: goEnd })[n](); return; }
      if ((a = e.target.closest('[data-addpv]'))) { addPvLine(parseInt(a.getAttribute('data-addpv'), 10)); return; }
      if ((a = e.target.closest('[data-act]'))) {
        var act = a.getAttribute('data-act');
        if (act === 'hint') hintSolve(); else if (act === 'solution') showSolution();
        else if (act === 'analyse') toAnalysis(); else if (act === 'resetsolve') resetSolve();
        else if (act === 'nextpuzzle') nextPuzzle(); else if (act === 'flip') { S.flipped = !S.flipped; renderBoard(); }
        else if (act === 'delmove') deleteFromHere(); else if (act === 'promote') promoteVariation();
        else if (act === 'copyfen') copyText(S.cur.fen, 'FEN скопирован');
        else if (act === 'cleardraw') clearDraw();
        return;
      }
      if (e.target.closest('#engine-toggle')) { toggleEngine(); return; }
    });
    $('#q').addEventListener('input', function (e) { S.q = e.target.value; renderLibrary(); });
    $('#notation').addEventListener('change', function (e) { S.notation = e.target.value; lsSet('st.notation', S.notation); renderAll(); });
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { S.pane = t.getAttribute('data-pane'); renderPane(); }); });
    $('#btn-import').addEventListener('click', openImport);
    $('#btn-diagram').addEventListener('click', function () { openDiagram(); });
    $('#btn-setup').addEventListener('click', function () { openEditor(); });
    $('#btn-data').addEventListener('click', openData);
    $('#btn-progress').addEventListener('click', openProgress);
    $('#cmtext').addEventListener('input', onCmInput);
    $('#btn-theme').addEventListener('click', function () {
      var root = document.documentElement, dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.setAttribute('data-theme', dark ? 'light' : 'dark'); lsSet('st.theme', dark ? 'light' : 'dark');
    });
    bindBoard();
  }
  function copyText(t, okMsg) {
    var done = function () { toast(okMsg || 'Скопировано'); };
    try { navigator.clipboard.writeText(t).then(done, function () { toast(t); }); } catch (e) { toast(t); }
  }
  function nextPuzzle() {
    while (S.repQ && S.repQ.length) {
      var q = S.repQ.shift(), bk = S.books.filter(function (b) { return b.id === q.b; })[0], im = bk && bk.items.filter(function (x) { return x.id === q.i; })[0];
      if (bk && im && im !== S.item) return loadItem(bk, im);
    }
    if (!S.book) return;
    var list = S.book.items, i = list.indexOf(S.item), j;
    for (j = 1; j <= list.length; j++) { var it = list[(i + j) % list.length]; if (it.type === 'puzzle' && it !== S.item && !it.solved) return loadItem(S.book, it); }
    for (j = 1; j <= list.length; j++) { var it2 = list[(i + j) % list.length]; if (it2.type === 'puzzle' && it2 !== S.item) return loadItem(S.book, it2); }
    toast('Других задач в этой книге нет');
  }

  // ================= правка текста записи =================
  function editItem(book, item) {
    var m = openModal('<h3>Править запись</h3>' +
      '<label class="fld">Название<input id="ed-title" type="text" value="' + esc(item.title) + '"></label>' +
      '<div class="row2"><label class="fld">Тип<select id="ed-type"><option value="game">Партия</option><option value="puzzle">Задача</option></select></label>' +
      '<label class="fld">Начальная позиция (FEN)<input id="ed-fen" type="text" class="mono" value="' + esc(item.startFen) + '"></label></div>' +
      '<label class="fld">Ходы в алгебраической записи. Можно писать по-русски (Кf3, Ф, Л, С, Кр) и по-английски; варианты в скобках, комментарии в фигурных.' +
      (item.err && item.raw ? '<p class="status warn">Разбор остановился на «' + esc(item.err.token) + '». Ниже исходный текст из книги: исправьте ошибочный ход, и статус внизу покажет, прошёл ли разбор.</p>' : '') +
      '<textarea id="ed-text" rows="9" spellcheck="false">' + esc(item.err && item.raw ? item.raw : item.text) + '</textarea></label>' +
      '<div id="ed-status" class="status"></div>' +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="ed-save">Сохранить</button></div>');
    $('#ed-type', m.el).value = item.type;
    var ta = $('#ed-text', m.el), fenIn = $('#ed-fen', m.el), st = $('#ed-status', m.el);
    function check() {
      var f = fenIn.value.trim() || Core.START, probe = new C();
      if (!probe.load(f)) { st.className = 'status bad'; st.textContent = 'Позиция FEN записана неверно.'; return null; }
      var r = Core.parseMovetext(f, ta.value);
      if (r.err) { st.className = 'status bad'; st.textContent = 'Ход «' + r.err.token + '» нельзя сыграть после «' + r.err.before + '». Всё, что дальше, отброшено.'; }
      else { st.className = 'status good'; st.textContent = 'Разобрано ходов основной линии: ' + Core.mainLine(r.root).length + (r.warn ? '. Пропущено вариантов с ошибками: ' + r.warn : '') + '.'; }
      return { r: r, f: f };
    }
    ta.addEventListener('input', check); fenIn.addEventListener('input', check); check();
    $('#ed-save', m.el).addEventListener('click', function () {
      var c = check(); if (!c) return;
      item.title = $('#ed-title', m.el).value.trim() || item.title;
      item.type = $('#ed-type', m.el).value; item.startFen = c.f;
      item.text = Core.toMovetext(c.r.root); item.plies = Core.mainLine(c.r.root).length;
      item.err = c.r.err ? { token: c.r.err.token, ply: 0, before: c.r.err.before } : null; if (!c.r.err) item.raw = '';
      Store.save(book); m.close();
      if (S.item === item) loadItem(book, item, true); else renderLibrary();
    });
  }

  // ================= импорт книги =================

  function openImport() {
    var m = openModal('<h3>Загрузить книгу</h3>' +
      '<div id="imp-body">' +
      '<label class="drop" id="drop"><input id="imp-file" type="file" multiple accept=".pdf,.epub,.docx,.fb2,.txt,.pgn,.html,.htm,.md" hidden>' +
      '<strong>Перетащите файл сюда или нажмите для выбора</strong><span>PDF, EPUB, DOCX, FB2, TXT, PGN. Партии ищутся по записи ходов, задачи — по позиции в виде FEN.</span></label>' +
      '<details class="paste"><summary>Или вставьте текст</summary><textarea id="imp-text" rows="7" placeholder="1. e4 e5 2. Кf3 Кc6 …" spellcheck="false"></textarea><button class="btn" id="imp-go-text">Разобрать текст</button></details>' +
      '<p class="hint-note">Сканы без текстового слоя не читаются: распознавание текста с картинки здесь недоступно. Диаграммы из книг переводите кнопкой «Диаграмма».</p>' +
      '</div>', 'wide');
    var body = $('#imp-body', m.el), drop = $('#drop', m.el);
    function run(files, pasted) {
      body.innerHTML = '<div class="progress"><div class="pbar"><i id="pfill"></i></div><p id="ptxt">Читаю файл…</p></div>';
      (async function () {
        try {
          var texts = [], name = 'Моя книга', info = { pages: 0, empty: 0 }, structured = [];
          if (pasted !== undefined) { texts.push(pasted); name = 'Вставленный текст'; }
          else {
            name = files[0].name.replace(/\.[^.]+$/, '');
            for (var i = 0; i < files.length; i++) {
              var r = await fileToText(files[i], function (p, n) { $('#pfill', m.el).style.width = (p / n * 100) + '%'; $('#ptxt', m.el).textContent = 'Читаю страницы: ' + p + ' из ' + n; });
              if (r.structured) { structured = structured.concat(r.structured.items); info.diagrams = (info.diagrams || 0) + r.structured.stats.diagrams; }
              else texts.push(r.text);
              if (r.pages) { info.pages += r.pages; info.empty += r.empty; }
            }
          }
          $('#ptxt', m.el).textContent = 'Ищу партии и задачи…'; await new Promise(function (r) { setTimeout(r, 30); });
          var items = structured.length ? structured.concat(texts.length ? Core.parseBook(texts.join('\n\n')) : []) : Core.parseBook(texts.join('\n\n'));
          reviewImport(m, items, name, info);
        } catch (e) {
          body.innerHTML = '<p class="status bad">' + esc(e.message || String(e)) + '</p><div class="modal-act"><button class="btn" data-close>Закрыть</button></div>';
          $('[data-close]', m.el).addEventListener('click', m.close);
        }
      })();
    }
    $('#imp-file', m.el).addEventListener('change', function (e) { if (e.target.files.length) run(e.target.files); });
    $('#imp-go-text', m.el).addEventListener('click', function () { run(null, $('#imp-text', m.el).value); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) run(e.dataTransfer.files); });
  }

  function reviewImport(m, items, name, info) {
    var body = $('#imp-body', m.el), games = items.filter(function (i) { return i.type === 'game'; }).length, puz = items.length - games, bad = items.filter(function (i) { return i.err; }).length;
    if (!items.length) {
      body.innerHTML = '<p class="status bad">Партии и задачи не найдены.</p>' +
        '<ul class="help"><li>Для PDF проверьте, что текст выделяется мышью. У сканов текста нет' + (info.pages ? ' (страниц без текста: ' + info.empty + ' из ' + info.pages + ')' : '') + '.</li>' +
        '<li>Фигурки в книге могут быть шрифтом, который превращается в непонятные знаки. Тогда скопируйте текст в другой редактор и замените знаки на буквы или вставьте текст вручную.</li>' +
        '<li>Ходы должны идти с номерами: «1. e4 e5 2. Кf3». Позиции задач нужны в виде FEN или через кнопку «Диаграмма».</li></ul>' +
        '<div class="modal-act"><button class="btn" data-close>Закрыть</button></div>';
      $('[data-close]', m.el).addEventListener('click', m.close); return;
    }
    body.innerHTML = '<label class="fld">Название книги<input id="rv-name" type="text" value="' + esc(name) + '"></label>' +
      '<p class="status good">Найдено: партий ' + games + ', задач ' + puz + (bad ? '. С ошибками разбора: ' + bad + ' (отмечены, их можно поправить)' : '') + '.' +
      (info.diagrams ? ' Позиции прочитаны с диаграмм книги: ' + info.diagrams + '.' : '') +
      (info.empty && !info.diagrams ? ' Страниц без текста: ' + info.empty + ' из ' + info.pages + '.' : '') + '</p>' +
      '<div class="rv-list" id="rv-list">' + items.map(function (it, i) {
        return '<div class="rv-row' + (it.err ? ' bad' : '') + '" data-i="' + i + '"><input type="checkbox" checked aria-label="Добавить"><span class="tag ' + it.type + '">' + (it.type === 'puzzle' ? 'З' : 'П') + '</span>' +
          '<input class="rv-title" type="text" value="' + esc(it.title) + '"><span class="rv-meta">' + it.plies + ' п/х' + (it.err ? ' · ошибка у «' + esc(it.err.token) + '»' : '') + '</span>' +
          '<button class="icon-btn" data-rvedit="' + i + '" title="Править ходы">✎</button></div>';
      }).join('') + '</div>' +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="rv-add">Добавить в библиотеку</button></div>';
    $('[data-close]', m.el).addEventListener('click', m.close);
    $('#rv-list', m.el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-rvedit]'); if (!b) return;
      var i = parseInt(b.getAttribute('data-rvedit'), 10), it = items[i];
      var fake = { id: 'tmp', title: it.title, type: it.type, startFen: it.startFen, text: it.text, plies: it.plies };
      editItem({ id: 'tmp', items: [], name: '' }, fake);
      var tmpModal = $('#modal-root').lastChild;
      var obs = new MutationObserver(function () {
        if (!tmpModal.parentNode) {
          obs.disconnect(); Object.assign(it, { title: fake.title, type: fake.type, startFen: fake.startFen, text: fake.text, plies: fake.plies, err: fake.err || null });
          var row = $('[data-i="' + i + '"]', m.el);
          if (row) { $('.rv-title', row).value = it.title; $('.rv-meta', row).textContent = it.plies + ' п/х'; row.classList.remove('bad'); }
        }
      });
      obs.observe($('#modal-root'), { childList: true });
    });
    $('#rv-add', m.el).addEventListener('click', function () {
      var rows = $$('.rv-row', m.el), chosen = [];
      rows.forEach(function (r) {
        if ($('input[type=checkbox]', r).checked) { var it = items[parseInt(r.getAttribute('data-i'), 10)]; it.title = $('.rv-title', r).value.trim() || it.title; chosen.push(it); }
      });
      if (!chosen.length) { toast('Ничего не выбрано'); return; }
      var book = { id: uid('b'), name: $('#rv-name', m.el).value.trim() || name, created: Date.now(), items: chosen.map(function (it) { it.id = uid('i'); return it; }) };
      S.books.push(book); Store.put(JSON.parse(JSON.stringify(book)));
      S.book = book; m.close(); toast('Добавлено: ' + chosen.length + ' записей'); renderAll();
      if (window.innerWidth < 900) { S.pane = 'lib'; renderPane(); }
    });
  }

  // ================= редактор позиции =================
  function openEditor(init) {
    init = init || {};
    var E = { cells: init.fen ? fenToMap(init.fen) : fenToMap(Core.START), tool: 'wP', turn: init.fen ? init.fen.split(' ')[1] : 'w', flipped: false, low: init.low || {}, title: init.title || '' };
    var castle = init.fen ? init.fen.split(' ')[2] : 'KQkq'; if (castle === '-') castle = '';
    var pal = ['K', 'Q', 'R', 'B', 'N', 'P'];
    var m = openModal('<h3>Расстановка позиции</h3><div class="ed-grid">' +
      '<div><div id="ed-board" class="ed-board"></div><div class="palette" id="palette">' +
      ['w', 'b'].map(function (c) { return '<div class="prow">' + pal.map(function (p) { return '<button class="pal ' + c + '" data-t="' + c + p + '" aria-label="' + c + p + '">' + GL[p] + '</button>'; }).join('') + '</div>'; }).join('') +
      '<div class="prow"><button class="pal erase" data-t="x">Убрать</button><button class="pal erase" id="pe-clear-all" title="Убрать все фигуры с доски">Очистить доску</button></div></div></div>' +
      '<div class="ed-side">' +
      (init.low && Object.keys(init.low).length ? '<p class="status warn">Оранжевым отмечены клетки, в которых распознавание не уверено. Проверьте их.</p>' : '') +
      '<label class="fld">Название<input id="pe-title" type="text" placeholder="Например: Задача 14, мат в 2 хода" value="' + esc(E.title) + '"></label>' +
      '<div class="fld">Ход<div class="seg"><label><input type="radio" name="turn" value="w"> Белых</label><label><input type="radio" name="turn" value="b"> Чёрных</label></div></div>' +
      '<div class="fld">Рокировка<div class="seg wrap">' + [['K', 'O-O белых'], ['Q', 'O-O-O белых'], ['k', 'O-O чёрных'], ['q', 'O-O-O чёрных']].map(function (c) { return '<label><input type="checkbox" data-c="' + c[0] + '"> ' + c[1] + '</label>'; }).join('') + '</div></div>' +
      '<label class="fld">FEN<input id="pe-fen" type="text" class="mono" spellcheck="false"></label>' +
      '<div class="seg wrap"><button class="btn" id="pe-clear">Очистить</button><button class="btn" id="pe-start">Начальная</button><button class="btn" id="pe-flip">Перевернуть</button></div>' +
      (init.learn ? '<label class="chk"><input type="checkbox" id="pe-learn" checked> Запомнить фигуры как образцы набора «' + esc(init.learn.prof) + '»</label>' : '') +
      '<div id="pe-status" class="status"></div></div></div>' +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="pe-save">Сохранить и открыть</button></div>', 'wide');
    var boardEl = $('#ed-board', m.el), fenIn = $('#pe-fen', m.el), st = $('#pe-status', m.el);
    E.remote = !!init.live;
    function curFen() {
      var cs = $$('[data-c]', m.el).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-c'); }).join('');
      var order = 'KQkq'; cs = order.split('').filter(function (c) { return cs.indexOf(c) >= 0; }).join('');
      return mapToFen(E.cells, E.turn, cs || '-');
    }
    function validate(fen) {
      var wk = 0, bk = 0, bad = false;
      for (var k in E.cells) { if (E.cells[k] === 'wK') wk++; if (E.cells[k] === 'bK') bk++; if (E.cells[k][1] === 'P' && (k[1] === '1' || k[1] === '8')) bad = true; }
      if (wk !== 1 || bk !== 1) return 'Нужно ровно по одному королю каждого цвета.';
      if (bad) return 'Пешки не могут стоять на первой и восьмой горизонталях.';
      var c = new C(); if (!c.load(fen)) return 'Позиция не проходит проверку.';
      var other = new C(fen.replace(/ [wb] /, E.turn === 'w' ? ' b ' : ' w '));
      if (other.in_check && other.in_check()) return 'Король стороны, которая не ходит, стоит под шахом.';
      return '';
    }
    function sync(fromFen) {
      if (!fromFen) fenIn.value = curFen();
      boardEl.innerHTML = boardSVG(E.cells, { flipped: E.flipped, low: E.low });
      var err = validate(fenIn.value);
      st.className = 'status ' + (err ? 'bad' : 'good'); st.textContent = err || 'Позиция корректна.';
      $('#pe-save', m.el).disabled = !!err || !Live.canSaveSetup();
      if (!E.remote) Live.setup({ open: true, fen: fenIn.value });
    }
    function setCastle(cs) { $$('[data-c]', m.el).forEach(function (c) { c.checked = cs.indexOf(c.getAttribute('data-c')) >= 0; }); }
    function autoCastle() {
      var cs = ''; if (E.cells.e1 === 'wK') { if (E.cells.h1 === 'wR') cs += 'K'; if (E.cells.a1 === 'wR') cs += 'Q'; }
      if (E.cells.e8 === 'bK') { if (E.cells.h8 === 'bR') cs += 'k'; if (E.cells.a8 === 'bR') cs += 'q'; }
      setCastle(cs);
    }
    setCastle(castle); $$('input[name=turn]', m.el).forEach(function (r) { r.checked = r.value === E.turn; });
    if (!init.fen) { setCastle('KQkq'); }
    function setTool(t) { E.tool = t; $$('.pal', m.el).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === t); }); }
    setTool('wP');
    $('#palette', m.el).addEventListener('click', function (e) { var b = e.target.closest('.pal'); if (b && b.id !== 'pe-clear-all') setTool(b.getAttribute('data-t')); });
    boardEl.addEventListener('pointerdown', function (e) {
      if (Live.blocked()) { toast('Сейчас ходит только учитель.'); return; }
      var svg = $('svg', boardEl), sq = sqFromEvent(svg, e, E.flipped); if (!sq) return;
      if (E.tool === 'x' || E.cells[sq] === E.tool) delete E.cells[sq]; else E.cells[sq] = E.tool;
      delete E.low[sq]; autoCastle(); sync();
    });
    $$('input[name=turn]', m.el).forEach(function (r) { r.addEventListener('change', function () { E.turn = r.value; sync(); }); });
    $$('[data-c]', m.el).forEach(function (c) { c.addEventListener('change', function () { sync(); }); });
    fenIn.addEventListener('input', function () {
      var f = fenIn.value.trim(), p = new C();
      if (p.load(f)) { E.cells = fenToMap(f); E.turn = f.split(' ')[1]; setCastle(f.split(' ')[2] === '-' ? '' : f.split(' ')[2]); $$('input[name=turn]', m.el).forEach(function (r) { r.checked = r.value === E.turn; }); sync(true); }
      else { st.className = 'status bad'; st.textContent = 'FEN записан неверно.'; $('#pe-save', m.el).disabled = true; }
    });
    function clearAll() { E.cells = {}; E.low = {}; setCastle(''); sync(); }
    $('#pe-clear', m.el).addEventListener('click', clearAll);
    $('#pe-clear-all', m.el).addEventListener('click', clearAll);
    $('#pe-start', m.el).addEventListener('click', function () { E.cells = fenToMap(Core.START); E.low = {}; E.turn = 'w'; $$('input[name=turn]', m.el)[0].checked = true; setCastle('KQkq'); sync(); });
    $('#pe-flip', m.el).addEventListener('click', function () { E.flipped = !E.flipped; sync(true); });
    $('#pe-save', m.el).addEventListener('click', function () {
      var fen = curFen(), title = $('#pe-title', m.el).value.trim() || 'Позиция ' + new Date().toLocaleDateString('ru-RU');
      var lc = $('#pe-learn', m.el);
      if (init.learn && lc && lc.checked) { var na = Samples.learn(init.learn.prof, null, E.cells, init.learn.res); toast(na ? 'Запомнено образцов: ' + na : 'Все фигуры уже распознавались уверенно.'); }
      var book = S.books.filter(function (b) { return b.name === 'Мои позиции'; })[0];
      if (!book) { book = { id: uid('b'), name: 'Мои позиции', created: Date.now(), items: [] }; S.books.push(book); }
      var item = { id: uid('i'), type: 'puzzle', title: title, startFen: fen, text: '', plies: 0, result: '' };
      book.items.push(item); Store.put(JSON.parse(JSON.stringify(book)));
      m.close(); S.filter = 'all'; loadItem(book, item);
    });
    m.onclose = function () { activeEditor = null; if (!E.closing) Live.setup({ open: false }); };
    activeEditor = {
      fen: function () { return fenIn.value; },
      close: function () { E.closing = true; m.close(); },
      setFen: function (f) {
        var pl = f.split(' ');
        E.remote = true; E.cells = fenToMap(f); E.turn = pl[1] === 'b' ? 'b' : 'w'; E.low = {};
        setCastle(pl[2] && pl[2] !== '-' ? pl[2] : '');
        $$('input[name=turn]', m.el).forEach(function (r) { r.checked = r.value === E.turn; });
        fenIn.value = f; sync(true); E.remote = false;
      }
    };
    if (!Live.canSaveSetup()) { var sv = $('#pe-save', m.el); sv.hidden = true; }
    if (init.live) { E.remote = true; sync(); E.remote = false; } else sync();
    return m;
  }

  // ================= диаграмма из книги → позиция =================
  function openDiagram() {
    var m = openModal('<h3>Диаграмма из книги</h3>' +
      '<p class="hint-note">Загрузите картинку или PDF, затем обведите на странице только доску 8×8 без рамки и подписей. Распознавание приблизительное, результат всегда можно поправить.</p>' +
      '<div class="dg-bar"><label class="btn"><input id="dg-file" type="file" accept="image/*,.pdf" hidden>Выбрать файл</label>' +
      '<span class="dg-pg" id="dg-pg" hidden><button class="btn" id="dg-prev">‹</button> <span id="dg-pgn"></span> <button class="btn" id="dg-next">›</button></span>' +
      '<label class="chk"><input type="checkbox" id="dg-flip"> Диаграмма повёрнута (чёрные внизу)</label></div>' +
      '<div class="dg-bar"><label class="fld grow">Набор образцов (книга)<input id="dg-prof" list="dg-profs" type="text" placeholder="Например: Завлечение" autocomplete="off"></label>' +
      '<datalist id="dg-profs">' + Samples.names().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<span class="hint-note" id="dg-prof-info"></span><button class="btn" id="dg-prof-reset" hidden>Сбросить образцы</button></div>' +
      '<div class="dg-stage" id="dg-stage"><p class="empty-note">Файл не выбран. Можно вставить картинку из буфера обмена (Ctrl+V).</p></div>' +
      '<div id="dg-status" class="status"></div>' +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="dg-go" disabled>Распознать</button></div>', 'wide');
    var D = { src: null, rect: null, pdf: null, page: 1, sc: 1 };
    var profIn = $('#dg-prof', m.el), profInfo = $('#dg-prof-info', m.el), profReset = $('#dg-prof-reset', m.el);
    profIn.value = Samples.last || (Samples.names()[0] || '');
    function profUpd() {
      var n = profIn.value.trim(), c = n ? Samples.count(n) : 0;
      profInfo.textContent = n ? (c ? 'Образцов в наборе: ' + c + '. После исправления позиции набор пополнится.' : 'Новый набор. Исправьте позицию в редакторе, и приложение запомнит фигуры этой книги.') : 'Без названия образцы не запоминаются.';
      profReset.hidden = !c;
    }
    profIn.addEventListener('input', profUpd); profUpd();
    profReset.addEventListener('click', function () { var n = profIn.value.trim(); if (n && confirm('Удалить все образцы набора «' + n + '»?')) { Samples.reset(n); profUpd(); } });
    var stage = $('#dg-stage', m.el), status = $('#dg-status', m.el);
    function show(canvasOrImg, w, h) {
      D.src = canvasOrImg; D.rect = null; $('#dg-go', m.el).disabled = true;
      stage.innerHTML = '<div class="dg-wrap" id="dg-wrap"><canvas id="dg-cv"></canvas><div class="dg-sel" id="dg-sel" hidden></div></div>';
      var cv = $('#dg-cv', m.el); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(canvasOrImg, 0, 0, w, h);
      D.w = w; D.h = h; D.cv = cv;
      var wrap = $('#dg-wrap', m.el), sel = $('#dg-sel', m.el), start = null;
      wrap.addEventListener('pointerdown', function (e) { var r = cv.getBoundingClientRect(); start = { x: e.clientX - r.left, y: e.clientY - r.top }; wrap.setPointerCapture(e.pointerId); sel.hidden = false; upd(e); });
      wrap.addEventListener('pointermove', function (e) { if (start) upd(e); });
      wrap.addEventListener('pointerup', function (e) { if (!start) return; upd(e); start = null; finish(); });
      function upd(e) {
        var r = cv.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
        var dx = x - start.x, dy = y - start.y, side = Math.max(Math.abs(dx), Math.abs(dy));
        var x0 = dx < 0 ? start.x - side : start.x, y0 = dy < 0 ? start.y - side : start.y;
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        sel.style.left = x0 + 'px'; sel.style.top = y0 + 'px'; sel.style.width = side + 'px'; sel.style.height = side + 'px';
        D.rect = { x: x0 / r.width * D.w, y: y0 / r.height * D.h, w: side / r.width * D.w, h: side / r.height * D.h };
      }
      function finish() { var ok = D.rect && D.rect.w > 40; $('#dg-go', m.el).disabled = !ok; status.className = 'status'; status.textContent = ok ? 'Область выбрана. Сетка 8×8 должна совпадать с клетками. Если нет, обведите заново.' : 'Область слишком мала.'; }
    }
    async function renderPdf() {
      var page = await D.pdf.getPage(D.page), vp = page.getViewport({ scale: 2 });
      var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      show(cv, cv.width, cv.height); $('#dg-pgn', m.el).textContent = D.page + ' / ' + D.pdf.numPages;
    }
    async function loadFile(f) {
      status.className = 'status'; status.textContent = 'Загружаю…';
      try {
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          var pdfjsLib = await loadPdfjs();
          if (!pdfjsLib) throw new Error('Не загрузилась библиотека чтения PDF.');
          D.pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise; D.page = 1;
          $('#dg-pg', m.el).hidden = false; await renderPdf();
        } else {
          $('#dg-pg', m.el).hidden = true;
          var url = URL.createObjectURL(f), img = new Image();
          await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = url; });
          var sc = Math.min(1, 1600 / Math.max(img.width, img.height));
          show(img, Math.round(img.width * sc), Math.round(img.height * sc));
        }
        status.textContent = 'Обведите доску мышью или пальцем.';
      } catch (e) { status.className = 'status bad'; status.textContent = e.message || 'Не удалось открыть файл.'; }
    }
    $('#dg-file', m.el).addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); });
    var onPaste = function (e) { var items = (e.clipboardData && e.clipboardData.files) || []; if (items.length && /^image\//.test(items[0].type)) loadFile(items[0]); };
    document.addEventListener('paste', onPaste); m.onclose = function () { document.removeEventListener('paste', onPaste); };
    $('#dg-prev', m.el).addEventListener('click', function () { if (D.pdf && D.page > 1) { D.page--; renderPdf(); } });
    $('#dg-next', m.el).addEventListener('click', function () { if (D.pdf && D.page < D.pdf.numPages) { D.page++; renderPdf(); } });
    $('#dg-go', m.el).addEventListener('click', async function () {
      status.className = 'status'; status.textContent = 'Распознаю…';
      try {
        if (document.fonts && document.fonts.load) { try { await document.fonts.load('48px "Noto Sans Symbols 2"', '♚'); } catch (e) {} }
        var flip = $('#dg-flip', m.el).checked, prof = profIn.value.trim(), res = Recog.recognize(D.cv, D.rect, flip, prof ? Samples.list(prof) : null), cells = {}, low = {};
        res.forEach(function (r) { if (r.p) { cells[r.sq] = r.p; if (r.conf < 0.1) low[r.sq] = 1; } });
        var cs = ''; if (cells.e1 === 'wK') { if (cells.h1 === 'wR') cs += 'K'; if (cells.a1 === 'wR') cs += 'Q'; } if (cells.e8 === 'bK') { if (cells.h8 === 'bR') cs += 'k'; if (cells.a8 === 'bR') cs += 'q'; }
        var fen = mapToFen(cells, 'w', cs || '-');
        m.close();
        openEditor({ fen: fen, low: low, title: '', learn: prof ? { prof: prof, res: res } : null });
      } catch (e) { status.className = 'status bad'; status.textContent = 'Не удалось распознать: ' + (e.message || e); }
    });
  }

  // ================= совместная работа (урок): live/live.js =================
  var Live = createLive({
    S: S, toast: toast, openModal: openModal, openEditor: openEditor,
    renderAll: renderAll, renderBoard: renderBoard, renderEngine: renderEngine,
    renderNavState: renderNavState, renderLibrary: renderLibrary,
    scheduleEngine: scheduleEngine, stopEngineRun: stopEngineRun,
    drawPayload: drawPayload, applyDraw: applyDraw,
    getActiveEditor: function () { return activeEditor; },
    setDl: function (d) { Dl = d; }
  });

  // ================= запуск =================
  async function init() {
    var th = lsGet('st.theme', null); if (th) document.documentElement.setAttribute('data-theme', th);
    S.root = Core.makeRoot(); S.cur = S.root;
    var errShown = false;
    window.addEventListener('error', function (ev) {
      if (errShown) return; errShown = true;
      var t = $('#toast'); if (t) { t.textContent = 'Ошибка в приложении: ' + (ev && ev.message ? ev.message : 'неизвестная') + '. Обновите страницу.'; t.className = 'toast show bad'; }
    });
    bindUI();
    renderAll();
    await Store.open();
    var allRecs = await Store.all();
    Samples.load(allRecs.filter(function (b) { return b.id === '__recog'; })[0]);
    S.books = allRecs.filter(function (b) { return b.id !== '__recog'; }).sort(function (a, b) { return a.created - b.created; });
    if (!S.books.length) { var sb = sampleBook(); S.books.push(sb); Store.put(JSON.parse(JSON.stringify(sb))); }
    var last = lsGet('st.last', null), book = null, item = null;
    if (last) { book = S.books.filter(function (b) { return b.id === last.b; })[0]; if (book) item = book.items.filter(function (i) { return i.id === last.i; })[0]; }
    if (!book) book = S.books[0];
    S.book = book;
    if (!item) item = book.items.filter(function (i) { return i.type === 'game'; })[0] || book.items[0];
    if (item) loadItem(book, item, true); else renderAll();
    if (!Store.persistent) toast('Хранилище браузера недоступно: книги сохранятся только до закрытия страницы.', 'warn');
    window.__app = { S: S, loadItem: loadItem };
    Live.init();
  }

export function start() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
