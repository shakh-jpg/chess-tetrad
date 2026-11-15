// "Прогресс" dialog: puzzle statistics, streak, review queue.
// Moved from ui/app.js (review fixes); the code inside is unchanged, app functions come through ctx.
import { $, esc, lsGet, lsSet } from './util.js';
import { toast, openModal } from './dialogs.js';
import { S } from './state.js';
import { Store } from '../storage/store.js';
import { streak as srsStreak, dayKey } from '../srs/srs.js';
import { countLabel } from './plural.js';

export function createProgressDialog(ctx) {
  var nextPuzzle = ctx.nextPuzzle, renderLibrary = ctx.renderLibrary;

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
      '<p class="hint-note">Занимались сегодня: ' + countLabel(log[dayKey(Date.now())] || 0, 'задача', 'задачи', 'задач') + '. Дней подряд: ' + streak + '. Прогресс хранится в этом браузере и попадает в копию библиотеки.</p>' +
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

  return { openProgress: openProgress };
}
