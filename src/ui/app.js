// Shakhmatnaya tetrad: UI (state, rendering, events, dialogs).
// Moved from the prototype's main IIFE; module-level code now, behaviour unchanged.
import { Chess as C } from '../core/chess.js';
import { Core } from '../core/index.js';
import { Engine, STOCKFISH_NAME } from '../engine/engine.js';
import { scoreText, whiteShare } from '../engine/uci.js';
import { Samples } from '../recognition/samples.js';
import { Store } from '../storage/store.js';
import { fenToMap, kingSq } from '../board/position.js';
import { PIECE, boardSVG, sqFromEvent, svgPoint, ensurePieceSprite, pieceIcon } from '../board/svg.js';
import { newStat, applyResult, bumpLog } from '../srs/srs.js';
import { createLive } from '../live/live.js';
import { sampleBook } from './sample-book.js';
import { $, $$, esc, uid, lsGet, lsSet } from './util.js';
import { S, fmt } from './state.js';
import { toast, openModal, copyText } from './dialogs.js';
import { createProgressDialog } from './progress-dialog.js';
import { createDataDialog } from './data-dialog.js';
import { createImportDialog } from './import-dialog.js';
import { createEditorDialog } from './editor-dialog.js';
import { createRecordDialog } from './record-dialog.js';
import { createScanDialog } from './scan-dialog.js';
import { processScanPage, onScanResults, setScanResultsHandler, profileName, learnBoard, recognizeAgain } from '../scan/process.js';
import { openScanReview } from './scan-review.js';
import { saveJob, getImages } from '../scan/scan-store.js';
import { scanBookName, scanItemsFrom, mergeScanItems } from '../scan/to-items.js';
import { ensureBook } from './record.js';
import { resultLabel } from './record.js';
import { pliesLabel } from './plural.js';
import { booksHTML, itemsHTML, filterItems } from './library.js';
import { movesHTML } from './moves-view.js';
import { solutionLocked } from '../sync/model.js';

  var activeEditor = null;

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
    // a coach's set without "allow the solution": always opens for solving
    if (item.type === 'puzzle' && S.root.kids.length && (!Live.isOn() || solutionLocked(book, item))) startSolve(); else { S.mode = 'analyse'; S.solve = null; }
    // a game being recorded (maybe at the board, during play): engine and its arrows are off until switched on
    if (item.recorded) S.engineOn = false;
    if (window.innerWidth < 900) S.pane = 'board';
    renderAll(); scheduleEngine();
    Live.itemLoaded();
  }
  function persist() {
    if (S.item) {
      S.item.text = Core.toMovetext(S.root);
      S.item.plies = Core.mainLine(S.root).length;
      // recorded games are written at once (closing the tab right after a move must not lose it)
      if (S.item.id !== 'live' && S.book) { if (S.item.recorded) Store.put(JSON.parse(JSON.stringify(S.book))); else Store.save(S.book); }
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
      return '<button class="pbtn ' + side + '" data-p="' + p + '" aria-label="' + p + '">' + pieceIcon(side + p.toUpperCase()) + '</button>';
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
      var sv = S.solve; // fix: ignore the delayed reply if another item / a new attempt was opened meanwhile
      setTimeout(function () {
        if (S.solve !== sv) return;
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
    if (progressHook) { try { progressHook(S.book, it); } catch (e) {} }
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
  // the solution of a puzzle from the coach's set stays hidden until it is solved
  function lockedNow() { return solutionLocked(S.book, S.item) && S.mode === 'solve' && !!S.solve && !S.solve.done; }
  function showSolution() {
    if (!S.solve || lockedNow()) return;
    if (!S.solve.done) recordResult('fail');
    S.solve.done = true; S.hint = null; S.solve.msg = 'Решение показано.';
    var path = []; var n = S.solve.node; while (n.kids[0]) { n = n.kids[0]; path.push(n); }
    var i = 0, sv = S.solve; // fix: stop the animation if another item / a new attempt was opened
    (function step() {
      if (S.solve !== sv) return;
      if (i >= path.length) { renderAll(); scheduleEngine(); return; }
      S.cur = path[i++]; S.solve.node = S.cur; renderAll(); setTimeout(step, 750);
    })();
  }
  function resetSolve() { if (S.item) { stopEngineRun(); startSolve(); renderAll(); } }
  function toAnalysis() { if (lockedNow()) return; S.mode = 'analyse'; S.hint = null; renderAll(); scheduleEngine(); }
  // "Пропустить": the puzzle counts as not solved (the coach sees it in the progress); next puzzle
  function skipPuzzle() {
    if (!S.solve || S.solve.done) return;
    recordResult('fail');
    toast('Задача пропущена. Тренер увидит её как нерешённую.');
    var was = S.item;
    nextPuzzle();
    if (S.item === was) resetSolve();
  }

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
    host.innerHTML = movesHTML(S.root, S.cur, limit, fmt); // ui/moves-view.js (escaped)
    var cur = $('.mv.cur', host);
    if (cur) { var hb = host.getBoundingClientRect(), cb = cur.getBoundingClientRect(); if (cb.top < hb.top || cb.bottom > hb.bottom) host.scrollTop += cb.top - hb.top - hb.height / 2; }
  }

  // ================= отрисовка: центр =================
  function renderStage() {
    var it = S.item;
    $('#itemtitle').textContent = it ? it.title : 'Выберите партию или задачу';
    var sub = '';
    if (it) {
      sub = (it.type === 'puzzle' ? 'Задача' : 'Партия') + (it.note ? ' · ' + it.note : '') + (it.plies ? ' · ' + pliesLabel(it.plies) : '') + (it.result && it.result !== '*' ? ' · ' + resultLabel(it.result) : '') + (it.section ? ' · ' + it.section : (S.book ? ' · ' + S.book.name : ''));
    } else sub = 'Загрузите книгу или откройте пример слева';
    $('#itemsub').textContent = sub;

    var b = $('#banner'), html = '';
    if (it && S.mode === 'solve' && S.solve) {
      var sv = S.solve, side = S.root.fen.split(' ')[1] === 'w' ? 'Белые' : 'Чёрные';
      if (sv.done) {
        html = '<div class="ban good"><strong>' + esc(sv.msg || 'Готово') + '</strong><span>Можно разобрать позицию с движком или перейти дальше.</span><div class="ban-act"><button class="btn" data-act="resetsolve">Ещё раз</button><button class="btn" data-act="analyse">Анализ</button><button class="btn primary" data-act="nextpuzzle">Следующая задача</button></div></div>';
      } else {
        var locked = solutionLocked(S.book, it);
        html = '<div class="ban"><strong>' + side + ' начинают.</strong><span>' + esc(sv.msg || 'Найдите лучший ход.') + (sv.wrong ? ' Ошибок: ' + sv.wrong + '.' : '') + (locked ? ' Разбор и движок откроются, когда задача будет решена.' : '') + '</span><div class="ban-act"><button class="btn" data-act="hint">Подсказка</button>' +
          (locked ? '<button class="btn" data-act="skip">Пропустить</button>' : '<button class="btn" data-act="solution">Показать решение</button><button class="btn" data-act="analyse">Свободный анализ</button>') + '</div></div>';
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
    var rec = $('#recbar'); if (rec) rec.hidden = !(S.item && S.item.recorded);
  }

  // ================= отрисовка: библиотека =================
  // markup: ui/library.js (escaped, testable)
  function renderLibrary() {
    $('#books').innerHTML = booksHTML(S.books, S.book && S.book.id, S.delArm);
    var ih = $('#items'), book = S.book;
    $$('.chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-f') === S.filter); });
    if (!book) { ih.innerHTML = ''; return; }
    // the coach's set without "allow the solution": no "edit moves" button (it would show the solution)
    ih.innerHTML = itemsHTML(filterItems(book.items, S.filter, S.q), S.item && S.item.id, S.q, { noEdit: solutionLocked(book, { type: 'puzzle' }) });
  }

  // ================= движок (оценка: engine/uci.js) =================
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
    var status = S.engineKind === 'stockfish' ? STOCKFISH_NAME : S.engineKind === 'fallback' ? 'Встроенный простой движок (слабее Stockfish)' : S.engineKind === 'none' ? 'Движок не удалось запустить' : 'Запуск движка…';
    var html = '<div class="eng-status">' + esc(status) + (lines[0] ? ' · глубина ' + lines[0].depth : '') + '</div>';
    lines.forEach(function (l, i) {
      html += '<div class="eng-line"><span class="eng-score">' + scoreText(l) + '</span><span class="eng-pv">' + esc(pvToSan(S.cur.fen, l.pv, 9)) + '</span><button class="icon-btn" data-addpv="' + (i + 1) + '" title="Добавить линию в партию как вариант" aria-label="Добавить линию">+</button></div>';
    });
    if (!lines.length && S.engineKind && S.engineKind !== 'none') html += '<p class="empty-note">Считаю…</p>';
    host.innerHTML = html;
    // neutral 50/50 until the engine has an evaluation for the current position
    if (bar) bar.style.height = lines[0] ? whiteShare(lines[0]).toFixed(1) + '%' : '50%';
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
    if (!S.engineOn && S.mode === 'solve' && S.solve && !S.solve.done) { toast(lockedNow() ? 'Движок откроется, когда задача будет решена.' : 'Движок недоступен, пока вы решаете задачу. Нажмите «Показать решение» или «Свободный анализ».'); return; }
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

  // ================= диалоги (ui/*-dialog.js) =================
  var Dl = null;
  var dialogCtx = {
    loadItem: loadItem, renderAll: renderAll, renderPane: renderPane, renderLibrary: renderLibrary, nextPuzzle: nextPuzzle,
    getDl: function () { return Dl; }, live: function () { return Live; },
    solutionHidden: function () { return solutionLocked(S.book, { type: 'puzzle' }); },
    setActiveEditor: function (v) { activeEditor = v; },
    openScan: function (file) { return scanDialog.open(file); }
  };
  // scanned books (ui/scan-dialog.js); page processing is plugged in by scan/process.js
  var scanDialog = createScanDialog({ processPage: processScanPage, onResults: onScanResults });
  // stage D: found diagrams go to the review screen; confirmed ones are added to «<file> (скан)»
  setScanResultsHandler(function (state, file, modal) {
    if (modal) modal.close();
    var name = scanBookName(file.name), prof = profileName(file), fp = state.fingerprint, touched = false;
    openScanReview({
      state: state, profile: prof,
      save: function (st) { return saveJob(st); },
      getImages: function (id) { return getImages(fp, id); },
      addToBook: function (results) {
        var r = ensureBook(S.books, name, function () { return uid('b'); }, Date.now());
        var res = mergeScanItems(r.book, scanItemsFrom(results, name));
        Store.put(JSON.parse(JSON.stringify(r.book)));
        touched = r.book;
        return { added: res.added, updated: res.updated, name: name };
      },
      learn: function (boardUrl, cells) { return learnBoard(prof, boardUrl, cells); },
      again: function (result, boardUrl) { return recognizeAgain(result, boardUrl, prof); },
      onClose: function () { if (touched) { S.book = touched; S.filter = 'all'; } renderAll(); }
    });
  });
  var openProgress = createProgressDialog(dialogCtx).openProgress;
  var dataDialog = createDataDialog(dialogCtx), openData = dataDialog.openData;
  var importDialog = createImportDialog(dialogCtx), openImport = importDialog.openImport, editItem = importDialog.editItem;
  var editorDialog = createEditorDialog(dialogCtx), openEditor = editorDialog.openEditor, openDiagram = editorDialog.openDiagram;
  var recordDialog = createRecordDialog({
    loadItem: loadItem, persist: persist, renderAll: renderAll,
    engineOff: function () { if (S.engineOn) { S.engineOn = false; stopEngineRun(); } }
  });

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
          ghost = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          ghost.setAttribute('class', 'pc ghost ' + d.piece[0]); ghost.setAttribute('href', '#pc-' + d.piece);
          ghost.setAttribute('width', String(PIECE)); ghost.setAttribute('height', String(PIECE));
          svg.appendChild(ghost);
        }
        var p = svgPoint(svg, e); ghost.setAttribute('x', p.x - PIECE / 2); ghost.setAttribute('y', p.y - PIECE / 2);
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
        else if (act === 'nextpuzzle') nextPuzzle(); else if (act === 'skip') skipPuzzle(); else if (act === 'flip') { S.flipped = !S.flipped; renderBoard(); }
        else if (act === 'delmove') deleteFromHere(); else if (act === 'promote') promoteVariation();
        else if (act === 'copyfen') copyText(S.cur.fen, 'FEN скопирован');
        else if (act === 'cleardraw') clearDraw();
        else if (act === 'newgame') recordDialog.openNewGame();
        else if (act === 'headers') recordDialog.openHeaders();
        return;
      }
      if (e.target.closest('#engine-toggle')) { toggleEngine(); return; }
    });
    $('#q').addEventListener('input', function (e) { S.q = e.target.value; renderLibrary(); });
    $('#notation').addEventListener('change', function (e) { S.notation = e.target.value; lsSet('st.notation', S.notation); renderAll(); });
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { S.pane = t.getAttribute('data-pane'); renderPane(); }); });
    $('#btn-import').addEventListener('click', openImport);
    $('#btn-newgame').addEventListener('click', function () { recordDialog.openNewGame(); });
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
    ensurePieceSprite();
    Store.setErrorHandler(function (op, why) {
      toast((op === 'delete' ? 'Не удалось удалить: ' : op === 'read' ? 'Не удалось прочитать библиотеку: ' : 'Не удалось сохранить: ') + why + '. Сделайте копию в «Данные».', 'warn');
    });
    bindUI();
    renderAll();
    await Store.open();
    // First launch: ask the browser to keep the library (no eviction under storage pressure).
    if (!lsGet('st.persist', null)) Store.requestPersistence().then(function (r) { lsSet('st.persist', r); });
    var allRecs = await Store.all();
    Samples.load(allRecs.filter(function (b) { return b.id === '__recog'; })[0]);
    S.books = allRecs.filter(function (b) { return String(b.id).indexOf('__') !== 0; }) /* '__recog', '__scan:…' are service records */.sort(function (a, b) { return a.created - b.created; });
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

// Resolves when the library has been loaded from storage.
export function start() {
  if (document.readyState === 'loading') {
    return new Promise(function (res) { document.addEventListener('DOMContentLoaded', function () { res(init()); }); });
  }
  return init();
}

// Stage 4: hook for the cloud sync (called after a puzzle result is recorded locally).
var progressHook = null;
export function setProgressHook(fn) { progressHook = fn; }

// What the account/sync UI needs from the app.
export function appContext() {
  return { S: S, Store: Store, toast: toast, openModal: openModal, renderAll: renderAll, esc: esc, lsGet: lsGet, lsSet: lsSet,
    exportBackup: function () { return dataDialog.exportBackup(); } };
}

export { openModal };
