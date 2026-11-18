// @ts-check
// Library panel markup (books and items). Pure functions: data in, HTML string out.
// Every value that can come from a book, PGN, backup file or the cloud is escaped or normalized:
// ids and names via esc(), the item type is reduced to 'puzzle' | 'game', counts to numbers.
import { esc } from './util.js';
import { statLabel } from '../srs/srs.js';

export function itemType(it) { return it && it.type === 'puzzle' ? 'puzzle' : 'game'; }
function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }

export function booksHTML(books, currentId, delArm) {
  if (!books.length) return '<p class="empty-note">Пока нет книг. Нажмите «Загрузить книгу».</p>';
  return books.map(function (b) {
    var on = currentId === b.id, armed = delArm === b.id, id = esc(b.id);
    return '<div class="book' + (on ? ' on' : '') + '"><button class="book-main" data-book="' + id + '"><span class="bk-name">' + esc(b.name) + '</span><span class="bk-n">' + num((b.items || []).length) + '</span></button>' +
      '<button class="icon-btn' + (armed ? ' danger' : '') + '" data-delbook="' + id + '" title="Удалить книгу" aria-label="Удалить книгу">' + (armed ? 'Удалить?' : '×') + '</button></div>';
  }).join('');
}

export function filterItems(items, filter, q) {
  q = String(q || '').trim().toLowerCase();
  return items.filter(function (it) {
    if (filter === 'game' && itemType(it) !== 'game') return false;
    if (filter === 'puzzle' && itemType(it) !== 'puzzle') return false;
    return !q || String(it.title || '').toLowerCase().indexOf(q) >= 0;
  });
}

// list: already filtered items; currentId: id of the open item; q: search text (sections are hidden while searching)
// opts.noEdit: no "edit moves" button (a coach's set where the solution is hidden)
export function itemsHTML(list, currentId, q, opts) {
  var noEdit = !!(opts && opts.noEdit);
  if (!list.length) return '<p class="empty-note">Ничего не найдено.</p>';
  var searching = !!String(q || '').trim(), lastSec = null;
  return list.map(function (it) {
    var on = currentId === it.id, head = '', id = esc(it.id), type = itemType(it);
    if (it.section && it.section !== lastSec && !searching) head = '<div class="sec-title">' + esc(it.section) + '</div>';
    if (!searching) lastSec = it.section || lastSec;
    return head + '<div class="item' + (on ? ' on' : '') + '" data-item="' + id + '">' +
      '<span class="tag ' + type + '">' + (type === 'puzzle' ? 'З' : 'П') + '</span>' +
      '<button class="it-main" data-open="' + id + '"><span class="it-title">' + esc(it.title) + '</span>' +
      '<span class="it-meta">' + num(it.plies) + ' п/х' + (it.err ? ' · <b class="warn">ошибка разбора</b>' : '') + statLabel(it) + '</span></button>' +
      (noEdit ? '' : '<button class="icon-btn" data-edit="' + id + '" title="Править текст ходов" aria-label="Править">✎</button>') +
      '<button class="icon-btn" data-delitem="' + id + '" title="Удалить" aria-label="Удалить">×</button></div>';
  }).join('');
}
