// "Новая партия" and "Заголовки" dialogs for recording a game over the board.
// The game itself is an ordinary 'game' item (analysis mode: moves, variations, comments),
// stored in the "Мои партии" book; see ui/record.js for the format.
import { Core } from '../core/index.js';
import { esc, uid } from './util.js';
import { toast, openModal } from './dialogs.js';
import { S } from './state.js';
import { Store } from '../storage/store.js';
import { RECORD_BOOK, RESULTS, ensureBook, newGameItem, applyHeaders, defaultHeaders, resultLabel } from './record.js';

// ctx: { loadItem(book, item), persist(), renderAll(), engineOff() }
export function createRecordDialog(ctx) {
  function fields(h, withResult) {
    return '<div class="row2"><label class="fld">Белые<input id="rh-white" type="text" maxlength="60" autocomplete="off" value="' + esc(h.White) + '"></label>' +
      '<label class="fld">Чёрные<input id="rh-black" type="text" maxlength="60" autocomplete="off" value="' + esc(h.Black) + '"></label></div>' +
      '<div class="row2"><label class="fld">Событие<input id="rh-event" type="text" maxlength="80" placeholder="Например: первенство клуба, тур 3" value="' + esc(h.Event) + '"></label>' +
      '<label class="fld">Дата<input id="rh-date" type="text" maxlength="10" inputmode="numeric" placeholder="ГГГГ.ММ.ДД" value="' + esc(h.Date) + '"></label></div>' +
      (withResult ? '<label class="fld">Результат<select id="rh-result">' + RESULTS.map(function (r) {
        return '<option value="' + r + '"' + (r === h.Result ? ' selected' : '') + '>' + (r === '*' ? '* (партия идёт / неизвестно)' : resultLabel(r)) + '</option>';
      }).join('') + '</select></label>' : '');
  }
  function read(el) {
    var v = function (id) { var x = el.querySelector(id); return x ? x.value : ''; };
    return { White: v('#rh-white'), Black: v('#rh-black'), Event: v('#rh-event'), Date: v('#rh-date'), Result: v('#rh-result') || '*' };
  }

  // New recorded game: from the start position, or from the current position of the open item.
  function openNewGame() {
    var canFromHere = !!(S.cur && S.cur.fen && S.cur.fen.split(' ')[0] !== Core.START.split(' ')[0]);
    var m = openModal('<h3>Новая партия</h3>' +
      '<p class="hint-note">Ходы записываются, пока вы двигаете фигуры. Сохраняется после каждого хода. Движок выключен — включите его сами, если нужен.</p>' +
      fields(defaultHeaders(Date.now()), false) +
      (canFromHere ? '<label class="chk"><input type="checkbox" id="rh-here"> Начать с текущей позиции на доске</label>' : '') +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="rh-start">Начать запись</button></div>');
    m.el.querySelector('#rh-start').addEventListener('click', function () {
      var now = Date.now(), here = m.el.querySelector('#rh-here');
      var item = newGameItem({ id: uid('i'), now: now, fen: here && here.checked ? S.cur.fen : undefined, headers: read(m.el) });
      var r = ensureBook(S.books, RECORD_BOOK, function () { return uid('b'); }, now);
      r.book.items.push(item);
      Store.put(JSON.parse(JSON.stringify(r.book)));
      m.close();
      S.filter = 'all';
      ctx.engineOff();
      ctx.loadItem(r.book, item);
      toast('Запись начата: «' + item.title + '». Делайте ходы на доске.');
    });
    var first = m.el.querySelector('#rh-white'); if (first) first.focus();
    return m;
  }

  function openHeaders() {
    var it = S.item;
    if (!it || !it.recorded) return null;
    var m = openModal('<h3>Заголовки партии</h3>' + fields(it.headers || defaultHeaders(Date.now()), true) +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="rh-save">Сохранить</button></div>');
    m.el.querySelector('#rh-save').addEventListener('click', function () {
      applyHeaders(it, read(m.el), Date.now());
      m.close();
      ctx.persist();
      ctx.renderAll();
    });
    return m;
  }

  return { openNewGame: openNewGame, openHeaders: openHeaders };
}
