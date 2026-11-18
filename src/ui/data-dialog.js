// "Данные" dialog: library backup (JSON) and PGN export.
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { Core } from '../core/index.js';
import { $, esc, lsGet, lsSet } from './util.js';
import { toast, openModal } from './dialogs.js';
import { S } from './state.js';
import { Store } from '../storage/store.js';
import { Samples } from '../recognition/samples.js';
import { parseBackup, makeBackup, pgnOf, safeName } from './backup.js';

export function createDataDialog(ctx) {
  var renderAll = ctx.renderAll;

  // ================= данные: резервная копия и PGN =================
  function saveFile(name, text, mime) {
    var Dl = ctx.getDl();
    if (Dl) return Dl.save({ filename: name, data: text }).then(function () { toast('Файл готов'); }, function (e) { if (!e || e.code !== 'declined') toast('Не удалось сохранить файл: ' + ((e && e.message) || 'ошибка'), 'bad'); });
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return Promise.resolve();
  }
  // backup/PGN helpers: ui/backup.js (input from backup files is sanitized there)
  function exportBackup() {
    var obj = makeBackup(S.books, Samples.exportAll());
    return saveFile('shakhmatnaya-tetrad-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(obj), 'application/json')
      .then(function () { lsSet('st.backupAt', Date.now()); });
  }
  function importBackup(text) {
    var r = parseBackup(text);
    if (r.err) return r;
    var add = 0, rep = 0;
    r.books.forEach(function (b) {
      var i = -1; S.books.forEach(function (x, k) { if (x.id === b.id) i = k; });
      if (i >= 0) { S.books[i] = b; rep++; } else { S.books.push(b); add++; }
      Store.put(JSON.parse(JSON.stringify(b)));
    });
    if (r.samples) Samples.merge(r.samples);
    S.books.sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    if (!S.book || !S.books.some(function (x) { return x === S.book; })) S.book = S.books[0] || null;
    renderAll();
    return { add: add, rep: rep, skipped: r.skipped };
  }
  function openData() {
    // a coach's set with hidden solutions is not exported to PGN (it would show the solutions)
    var hidden = !!(ctx.solutionHidden && ctx.solutionHidden());
    var cnt = S.books.reduce(function (n, b) { return n + b.items.length; }, 0);
    var m = openModal('<h3>Данные</h3><p class="hint-note">Библиотека хранится только в этом браузере. Если очистить данные сайта или сменить браузер, она пропадёт. Храните копию отдельно. Сейчас в библиотеке: книг ' + S.books.length + ', записей ' + cnt + '.' + (Store.persistent ? '' : ' Хранилище браузера недоступно, всё лежит только до закрытия страницы.') +
      (/^(persisted|granted)$/.test(lsGet('st.persist', '')) ? ' Браузер разрешил хранить библиотеку постоянно.' : (Store.persistent ? ' Браузер может удалить данные, если на устройстве мало места.' : '')) + '</p>' +
      '<div class="data-list">' +
      '<button class="btn primary" id="dt-backup">Скачать копию библиотеки (JSON)</button>' +
      '<label class="btn"><input id="dt-restore" type="file" accept=".json,application/json" hidden>Загрузить копию библиотеки</label>' +
      '<button class="btn" id="dt-pgn-book"' + (S.book && !hidden ? '' : ' disabled') + '>PGN: вся книга «' + esc(S.book ? S.book.name : '') + '»</button>' +
      '<button class="btn" id="dt-pgn-cur"' + (S.item && !hidden ? '' : ' disabled') + '>PGN: текущая запись</button></div>' +
      (hidden ? '<p class="hint-note">Набор тренера с закрытыми решениями в PGN не выгружается.</p>' : '') +
      '<p class="hint-note">PGN сохраняется как текстовый файл (.pgn.txt). Переименуйте его в .pgn, если программа требует. Ходы, варианты, комментарии и оценки сохраняются.</p>' +
      '<div id="dt-status" class="status"></div><div class="modal-act"><button class="btn" data-close>Закрыть</button></div>');
    var st = $('#dt-status', m.el);
    $('#dt-backup', m.el).addEventListener('click', exportBackup);
    $('#dt-restore', m.el).addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        var r = importBackup(t);
        st.className = 'status ' + (r.err ? 'bad' : 'good');
        st.textContent = r.err || 'Загружено. Новых книг: ' + r.add + ', заменено: ' + r.rep + '.' + (r.skipped ? ' Пропущено записей с ошибками: ' + r.skipped + '.' : '');
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

  return { openData: openData, exportBackup: exportBackup, importBackup: importBackup, saveFile: saveFile };
}
