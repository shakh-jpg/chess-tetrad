// Position editor ("Расставить позицию") and diagram recognition ("Диаграмма").
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { Chess as C } from '../core/chess.js';
import { Core } from '../core/index.js';
import { $, $$, esc, uid } from './util.js';
import { toast, openModal } from './dialogs.js';
import { S } from './state.js';
import { Store } from '../storage/store.js';
import { Samples } from '../recognition/samples.js';
import { Recog } from '../recognition/recog.js';
import { fenToMap, mapToFen } from '../board/position.js';
import { boardSVG, sqFromEvent, pieceIcon } from '../board/svg.js';
import { openPdf } from '../pdf-import/files.js';

export function createEditorDialog(ctx) {
  var loadItem = ctx.loadItem;
  // Live is created after the dialogs; reach it lazily.
  var Live = { setup: function (d) { return ctx.live().setup(d); }, canSaveSetup: function () { return ctx.live().canSaveSetup(); }, blocked: function () { return ctx.live().blocked(); } };

  // ================= редактор позиции =================
  function openEditor(init) {
    init = init || {};
    var E = { cells: init.fen ? fenToMap(init.fen) : fenToMap(Core.START), tool: 'wP', turn: init.fen ? init.fen.split(' ')[1] : 'w', flipped: false, low: init.low || {}, title: init.title || '' };
    var castle = init.fen ? init.fen.split(' ')[2] : 'KQkq'; if (castle === '-') castle = '';
    var pal = ['K', 'Q', 'R', 'B', 'N', 'P'];
    var m = openModal('<h3>Расстановка позиции</h3><div class="ed-grid">' +
      '<div><div id="ed-board" class="ed-board"></div><div class="palette" id="palette">' +
      ['w', 'b'].map(function (c) { return '<div class="prow">' + pal.map(function (p) { return '<button class="pal ' + c + '" data-t="' + c + p + '" aria-label="' + c + p + '">' + pieceIcon(c + p) + '</button>'; }).join('') + '</div>'; }).join('') +
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
    m.onclose = function () { ctx.setActiveEditor(null); if (!E.closing) Live.setup({ open: false }); };
    ctx.setActiveEditor({
      fen: function () { return fenIn.value; },
      close: function () { E.closing = true; m.close(); },
      setFen: function (f) {
        var pl = f.split(' ');
        E.remote = true; E.cells = fenToMap(f); E.turn = pl[1] === 'b' ? 'b' : 'w'; E.low = {};
        setCastle(pl[2] && pl[2] !== '-' ? pl[2] : '');
        $$('input[name=turn]', m.el).forEach(function (r) { r.checked = r.value === E.turn; });
        fenIn.value = f; sync(true); E.remote = false;
      }
    });
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
      // A (nearly) square picture is usually just the board (a screenshot from a phone app):
      // select it whole, so on a phone it is enough to press «Распознать».
      if (Math.abs(w / h - 1) < 0.06) {
        var s = Math.min(w, h);
        D.rect = { x: 0, y: 0, w: s, h: s };
        sel.hidden = false; sel.style.left = '0px'; sel.style.top = '0px';
        sel.style.width = (s / w * 100) + '%'; sel.style.height = (s / h * 100) + '%';
        finish();
        status.textContent = 'Похоже, на картинке только доска — она выбрана целиком. Если это не так, обведите доску заново.';
      }
    }
    async function renderPdf() {
      var page = await D.pdf.getPage(D.page), vp = page.getViewport({ scale: 2 });
      var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvas: cv, canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      show(cv, cv.width, cv.height); $('#dg-pgn', m.el).textContent = D.page + ' / ' + D.pdf.numPages;
    }
    async function loadFile(f) {
      status.className = 'status'; status.textContent = 'Загружаю…';
      try {
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          D.pdf = await openPdf(await f.arrayBuffer()); D.page = 1;
          $('#dg-pg', m.el).hidden = false; await renderPdf();
        } else {
          $('#dg-pg', m.el).hidden = true;
          var url = URL.createObjectURL(f), img = new Image();
          await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = url; });
          var sc = Math.min(1, 1600 / Math.max(img.width, img.height));
          show(img, Math.round(img.width * sc), Math.round(img.height * sc));
        }
        if (!D.rect) status.textContent = 'Обведите доску мышью или пальцем.';
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

  return { openEditor: openEditor, openDiagram: openDiagram };
}
