// Book import (files / pasted text), review of found games and puzzles, editing an item's moves.
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { Chess as C } from '../core/chess.js';
import { Core } from '../core/index.js';
import { $, $$, esc, uid } from './util.js';
import { toast, openModal } from './dialogs.js';
import { S } from './state.js';
import { Store } from '../storage/store.js';
import { fileToText } from '../pdf-import/files.js';
import { countLabel } from './plural.js';
import { itemType } from './library.js';

export function createImportDialog(ctx) {
  var loadItem = ctx.loadItem, renderAll = ctx.renderAll, renderPane = ctx.renderPane, renderLibrary = ctx.renderLibrary;

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
        return '<div class="rv-row' + (it.err ? ' bad' : '') + '" data-i="' + i + '"><input type="checkbox" checked aria-label="Добавить"><span class="tag ' + itemType(it) + '">' + (itemType(it) === 'puzzle' ? 'З' : 'П') + '</span>' +
          '<input class="rv-title" type="text" value="' + esc(it.title) + '"><span class="rv-meta">' + (Number(it.plies) || 0) + ' п/х' + (it.err ? ' · ошибка у «' + esc(it.err.token) + '»' : '') + '</span>' +
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
      S.book = book; m.close(); toast('Добавлено: ' + countLabel(chosen.length, 'запись', 'записи', 'записей')); renderAll();
      if (window.innerWidth < 900) { S.pane = 'lib'; renderPane(); }
    });
  }

  return { openImport: openImport, editItem: editItem };
}
