// Review of a scanned book (stage D): the diagram from the book next to the recognized board.
// The coach fixes pieces (one click cycles through the likely pieces of a square, or the palette
// puts any piece), sets the side to move, then confirms or skips. Confident boards can be looked
// over as a grid and confirmed together. Every few corrected boards the app learns the pieces of
// this book and recognizes the unchecked boards again. Everything stays on the device.
import { $, $$, esc } from './util.js';
import { openModal, toast } from './dialogs.js';
import { boardSVG, sqFromEvent, pieceIcon } from '../board/svg.js';
import { countLabel } from './plural.js';
import {
  isConfident, reviewCounts, matchesFilter, cellsOf, editResult, nextChoice,
  confirmResult, skipResult, toLearn, LEARN_EVERY
} from '../scan/review.js';
import { toMovetext } from '../scan/moves.js';
import { movesFor } from '../scan/process.js';

var FILTERS = [['todo', 'Не проверенные'], ['bad', 'С ошибками'], ['done', 'Подтверждённые'], ['skipped', 'Пропущенные'], ['all', 'Все']];

/**
 * @param {{
 *   state: { results: any[], name: string }, profile: string,
 *   save: (state: any) => any,
 *   getImages: (id: string) => Promise<{ view: string, board: string }|null>,
 *   addToBook: (results: any[]) => { added: number, updated: number, name: string },
 *   learn: (boardUrl: string, cells: Object<string, string>) => Promise<number>,
 *   again: (result: any, boardUrl: string) => Promise<any>,
 *   onClose?: () => void
 * }} o
 */
export function openScanReview(o) {
  var R = o.state.results;
  var V = { filter: 'todo', list: [], pos: 0, tool: 'cycle', cells: {}, busy: false };
  var m = openModal('<h3>Проверка скана</h3><div id="sr-body" class="sr"></div>', 'wide sr-modal');
  var body = $('#sr-body', m.el), saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { o.save(o.state); }, 300); }
  m.onclose = function () { clearTimeout(saveTimer); o.save(o.state); document.removeEventListener('keydown', onKey); if (o.onClose) o.onClose(); };

  function refilter() {
    V.list = [];
    R.forEach(function (r, i) { if (matchesFilter(r, V.filter)) V.list.push(i); });
    V.pos = Math.min(V.pos, Math.max(0, V.list.length - 1));
  }
  function cur() { return V.list.length ? R[V.list[V.pos]] : null; }

  // ---------- single diagram view
  function renderShell() {
    var pal = ['K', 'Q', 'R', 'B', 'N', 'P'];
    body.innerHTML =
      '<div class="sr-top"><span id="sr-count" class="hint-note"></span>' +
      '<label class="sr-filter">Показать <select id="sr-filter">' + FILTERS.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === V.filter ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn" id="sr-bulk"></button></div>' +
      '<div class="sr-main" id="sr-main">' +
      '<figure class="sr-img"><img id="sr-view" alt="Диаграмма в книге"><figcaption id="sr-where"></figcaption></figure>' +
      '<div class="sr-edit"><div id="sr-board" class="ed-board sr-board"></div>' +
      '<div class="palette" id="sr-pal">' +
      '<div class="prow"><button class="pal erase" data-t="cycle" title="Щелчок по фигуре меняет её на следующую похожую">↻ Похожие</button>' +
      pal.map(function (p) { return '<button class="pal w" data-t="w' + p + '" aria-label="w' + p + '">' + pieceIcon('w' + p) + '</button>'; }).join('') + '</div>' +
      '<div class="prow"><button class="pal erase" data-t="x">Убрать</button>' +
      pal.map(function (p) { return '<button class="pal b" data-t="b' + p + '" aria-label="b' + p + '">' + pieceIcon('b' + p) + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="sr-side"><div class="fld">Ход<div class="seg"><label><input type="radio" name="sr-turn" value="w"> Белых</label><label><input type="radio" name="sr-turn" value="b"> Чёрных</label></div></div>' +
      '<label class="chk"><input type="checkbox" id="sr-task"> Задание (в книге стоит «?»)</label>' +
      '<div class="fld">Ходы из текста книги<div id="sr-moves" class="sr-moves"></div><button class="btn" id="sr-nomoves" hidden>Без ходов</button></div>' +
      '<div id="sr-status" class="status"></div><div id="sr-learn" class="hint-note"></div>' +
      '<button class="btn" id="sr-learn-now" hidden></button></div></div>' +
      '<div class="modal-act sr-act"><button class="btn" id="sr-prev" aria-label="Предыдущая">‹</button>' +
      '<button class="btn" id="sr-skip">Пропустить</button><button class="btn primary" id="sr-ok">Подтвердить</button>' +
      '<button class="btn" id="sr-next" aria-label="Следующая">›</button><button class="btn" data-close>Закрыть</button></div>';
    $('[data-close]', body).addEventListener('click', m.close);
    $('#sr-filter', body).addEventListener('change', function (e) { V.filter = e.target.value; V.pos = 0; refilter(); renderItem(); });
    $('#sr-bulk', body).addEventListener('click', renderBulk);
    $('#sr-pal', body).addEventListener('click', function (e) { var b = e.target.closest('.pal'); if (b) setTool(b.getAttribute('data-t')); });
    $('#sr-board', body).addEventListener('pointerdown', onBoard);
    $$('input[name=sr-turn]', body).forEach(function (r) { r.addEventListener('change', function () { edit(); }); });
    $('#sr-task', body).addEventListener('change', function () { edit(); });
    $('#sr-prev', body).addEventListener('click', function () { go(-1); });
    $('#sr-next', body).addEventListener('click', function () { go(1); });
    $('#sr-ok', body).addEventListener('click', confirmCur);
    $('#sr-skip', body).addEventListener('click', skipCur);
    $('#sr-learn-now', body).addEventListener('click', function () { learnNow(true); });
    $('#sr-nomoves', body).addEventListener('click', function () { var r = cur(); if (!r) return; r.moves = ''; r.movesList = []; r.noMoves = true; r.status = 'new'; renderMoves(r); renderCounts(); saveSoon(); });
    setTool(V.tool);
  }
  function setTool(t) { V.tool = t; $$('#sr-pal .pal', body).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === t); }); }

  function renderCounts() {
    var c = reviewCounts(R);
    $('#sr-count', body).textContent = 'Найдено: ' + c.total + ' · подтверждено: ' + c.confirmed + ' · пропущено: ' + c.skipped + ' · осталось: ' + c.left + (c.bad ? ' (с ошибками: ' + c.bad + ')' : '');
    var bulk = $('#sr-bulk', body); bulk.textContent = 'Уверенные: ' + c.confident; bulk.disabled = !c.confident;
    var pend = toLearn(R).length, ln = $('#sr-learn-now', body);
    ln.hidden = !pend; ln.textContent = 'Запомнить фигуры книги сейчас (' + pend + ')';
  }

  function renderItem() {
    if (!$('#sr-main', body)) return; // the grid of confident boards is shown
    renderCounts();
    var r = cur(), main = $('#sr-main', body);
    $$('.sr-act button:not([data-close])', body).forEach(function (b) { b.disabled = !r; });
    if (!r) {
      main.hidden = true;
      var note = $('#sr-empty', body) || document.createElement('p');
      note.id = 'sr-empty'; note.className = 'empty-note';
      note.textContent = V.filter === 'todo' ? 'Все найденные диаграммы проверены.' : 'Здесь пусто.';
      if (!note.parentNode) main.parentNode.insertBefore(note, main);
      return;
    }
    var empty = $('#sr-empty', body); if (empty) empty.remove();
    main.hidden = false;
    V.cells = cellsOf(r);
    $('#sr-where', body).textContent = 'Стр. ' + (r.page + 1) + ', диаграмма ' + (r.index + 1) + ' на странице · ' + (V.pos + 1) + ' из ' + V.list.length +
      (r.status === 'confirmed' ? ' · подтверждена' : r.status === 'skipped' ? ' · пропущена' : '');
    $$('input[name=sr-turn]', body).forEach(function (x) { x.checked = x.value === r.side; });
    $('#sr-task', body).checked = !!r.task;
    var img = $('#sr-view', body); img.removeAttribute('src');
    var want = r.id; V.text = null;
    o.getImages(r.id).then(function (im) { var c = cur(); if (c && c.id === want && im) { img.src = im.view; V.text = im.text || ''; renderMoves(r); } });
    drawBoard(r); renderStatus(r); renderMoves(r);
  }
  // moves found in the page text; uncertain ones (read approximately) are highlighted
  function renderMoves(r) {
    var el = $('#sr-moves', body), list = r.movesList || [];
    $('#sr-nomoves', body).hidden = !list.length;
    if (!list.length) { el.textContent = V.text === '' ? 'Текст страницы не читался.' : r.noMoves ? 'Ходы убраны.' : 'Не найдены.'; return; }
    var k = 0;
    el.innerHTML = toMovetext(r.fen, list).split(' ').map(function (t) {
      if (/^\d+\.+$/.test(t)) return esc(t);
      var m = list[k++];
      return m && !m.sure ? '<mark title="Прочитан неточно, сверьте с книгой">' + esc(t) + '</mark>' : esc(t);
    }).join(' ');
  }
  function drawBoard(r) {
    var low = {}; (r.low || []).forEach(function (sq) { low[sq] = 1; });
    $('#sr-board', body).innerHTML = boardSVG(V.cells, { low: low });
  }
  function renderStatus(r) {
    var st = $('#sr-status', body);
    var lowN = (r.low || []).length;
    if (!r.valid) { st.className = 'status bad'; st.textContent = 'Так не бывает: ' + (r.problems || []).join(', ') + '. Поправьте фигуры.'; }
    else { st.className = 'status ' + (lowN ? 'warn' : 'good'); st.textContent = lowN ? 'Позиция возможна. Оранжевые клетки распознаны неуверенно, сверьте их с книгой.' : 'Позиция возможна. Сверьте с книгой.'; }
    $('#sr-ok', body).disabled = !r.valid;
  }

  function onBoard(e) {
    var r = cur(); if (!r || V.busy) return;
    var sq = sqFromEvent($('svg', $('#sr-board', body)), e, false); if (!sq) return;
    if (V.tool === 'cycle') {
      var n = nextChoice(r, sq, V.cells[sq]);
      if (n === undefined) { toast('Здесь фигура не распознана. Выберите фигуру на палитре и щёлкните по клетке.'); return; }
      if (n) V.cells[sq] = n; else delete V.cells[sq];
    } else if (V.tool === 'x' || V.cells[sq] === V.tool) delete V.cells[sq];
    else V.cells[sq] = V.tool;
    edit();
  }
  function edit() {
    var r = cur(); if (!r) return;
    var side = ($$('input[name=sr-turn]', body).filter(function (x) { return x.checked; })[0] || { value: 'w' }).value;
    editResult(r, V.cells, side, $('#sr-task', body).checked);
    r.status = 'new'; // an edited diagram is confirmed again (that updates it in the book)
    // the moves depend on the position: look for them in the page text again
    if (V.text && !r.noMoves) { if (r.valid) Object.assign(r, movesFor(r.fen, V.text, true)); else { r.moves = ''; r.movesList = []; } }
    drawBoard(r); renderStatus(r); renderMoves(r); renderCounts(); saveSoon();
  }
  function go(d) { if (!V.list.length) return; V.pos = (V.pos + d + V.list.length) % V.list.length; renderItem(); }
  // after confirm/skip: the next diagram. If the item left the filter, the next one is already at this place.
  function advance(id) {
    var ri = R.findIndex(function (x) { return x.id === id; }), at = V.pos;
    refilter();
    var k = V.list.indexOf(ri);
    V.pos = k >= 0 ? Math.min(k + 1, V.list.length - 1) : Math.min(at, Math.max(0, V.list.length - 1));
    renderItem();
  }
  async function confirmCur() {
    var r = cur(); if (!r || V.busy) return;
    if (!confirmResult(r)) { renderStatus(r); return; }
    var res = o.addToBook([r]);
    saveSoon();
    toast((res.added ? 'Добавлено' : 'Обновлено') + ' в книге «' + res.name + '».');
    advance(r.id);
    await learnNow(false);
  }
  function skipCur() { var r = cur(); if (!r || V.busy) return; skipResult(r); saveSoon(); advance(r.id); }

  // ---------- learning the pieces of this book
  async function learnNow(force) {
    var pend = toLearn(R);
    if (!pend.length || (!force && pend.length < LEARN_EVERY)) { renderCounts(); return; }
    V.busy = true;
    var info = $('#sr-learn', body), added = 0;
    try {
      info.textContent = 'Запоминаю фигуры этой книги…';
      for (var i = 0; i < pend.length; i++) {
        var im = await o.getImages(pend[i].id);
        if (im && im.board) added += await o.learn(im.board, cellsOf(pend[i]));
        pend[i].learned = true;
      }
      var again = R.filter(function (r) { return (r.status || 'new') === 'new' && !r.edited; }), changed = 0;
      for (var k = 0; k < again.length; k++) {
        if (k % 4 === 0) { info.textContent = 'Распознаю заново непроверенные: ' + k + ' из ' + again.length + '…'; await new Promise(function (res) { setTimeout(res, 0); }); }
        var im2 = await o.getImages(again[k].id);
        if (!im2 || !im2.board) continue;
        var upd = await o.again(again[k], im2.board);
        if (upd.fen !== again[k].fen) changed++;
        Object.assign(again[k], upd);
      }
      info.textContent = 'Фигуры книги запомнены (новых образцов: ' + added + '). Непроверенные распознаны заново, изменилось: ' + changed + '.';
      o.save(o.state);
    } catch (e) {
      info.textContent = 'Не получилось дообучиться: ' + (e && e.message || e);
    }
    V.busy = false;
    renderItem();
  }

  // ---------- confident boards as a grid
  function renderBulk() {
    if (V.busy) { toast('Подождите: приложение запоминает фигуры книги.'); return; }
    var list = R.filter(isConfident);
    body.innerHTML = '<p class="hint-note">Эти позиции распознаны уверенно и проходят проверку правил. Уверенные тоже иногда ошибаются (примерно 1 из 5), поэтому сверьте их с книгой. ' +
      'Снимите отметку с неверных (их можно поправить по одной).</p>' +
      '<div class="sr-grid" id="sr-grid">' + list.map(function (r) {
        return '<label class="sr-card" data-id="' + esc(r.id) + '"><input type="checkbox" checked>' +
          '<span class="sr-pair"><img alt="Диаграмма в книге"><span class="sr-mini">' + boardSVG(cellsOf(r), {}) + '</span></span>' +
          '<span class="hint-note">Стр. ' + (r.page + 1) + ', диаграмма ' + (r.index + 1) + ' · ход ' + (r.side === 'b' ? 'чёрных' : 'белых') + '</span></label>';
      }).join('') + '</div>' +
      '<div class="modal-act"><button class="btn" id="sr-back">Назад</button><button class="btn primary" id="sr-bulk-ok"></button></div>';
    var grid = $('#sr-grid', body), okBtn = $('#sr-bulk-ok', body);
    function upd() { var n = $$('input:checked', grid).length; okBtn.textContent = 'Подтвердить отмеченные: ' + n; okBtn.disabled = !n; }
    grid.addEventListener('change', upd); upd();
    $$('.sr-card', grid).forEach(function (card) {
      var id = card.getAttribute('data-id');
      o.getImages(id).then(function (im) { if (im) $('img', card).src = im.view; });
    });
    $('#sr-back', body).addEventListener('click', function () { renderShell(); refilter(); renderItem(); });
    okBtn.addEventListener('click', function () {
      var ids = $$('.sr-card', grid).filter(function (c) { return $('input', c).checked; }).map(function (c) { return c.getAttribute('data-id'); });
      var chosen = R.filter(function (r) { return ids.indexOf(r.id) >= 0 && confirmResult(r); });
      var res = chosen.length ? o.addToBook(chosen) : { added: 0, updated: 0, name: '' };
      o.save(o.state);
      toast('Подтверждено: ' + chosen.length + (res.name ? '. В книге «' + res.name + '» добавлено: ' + res.added + (res.updated ? ', обновлено: ' + res.updated : '') : '') + '.');
      renderShell(); refilter(); renderItem();
    });
  }

  function onKey(e) {
    if (!body.isConnected || $('#sr-grid', body) || /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { confirmCur(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  renderShell(); refilter();
  if (!V.list.length) { V.filter = 'all'; refilter(); $('#sr-filter', body).value = 'all'; }
  renderItem();
  if (R.length) toast(countLabel(R.length, 'диаграмма', 'диаграммы', 'диаграмм') + ' к проверке.');
  return m;
}
