// Move list markup (main line, variations, NAGs, comments). Pure: tree in, HTML string out.
// Comments come from books/PGN/backups/the cloud, so every text value is escaped.
import { esc } from './util.js';

// root: tree root; cur: current node; limit: set of visible node ids (solve mode) or null;
// fmt: SAN formatter (figurine / Russian / English).
export function movesHTML(root, cur, limit, fmt) {
  if (!root.kids.length) return '<p class="empty-note">Ходов пока нет. Сделайте ход на доске, он сохранится в этой записи.</p>';
  if (limit && cur === root) return '<p class="empty-note">Решение скрыто. Ваши ходы появятся здесь.</p>';
  function line(first) {
    var html = '', node = first, needNum = true;
    while (node) {
      if (limit && !limit[node.id]) break;
      var num = node.color === 'w' ? node.num + '.' : (needNum ? node.num + '…' : '');
      html += '<a class="mv' + (node === cur ? ' cur' : '') + '" data-id="' + esc(node.id) + '" href="#">' + (num ? '<i>' + esc(num) + '</i>' : '') +
        esc(fmt(node.san)) + (node.nag ? '<b class="nag">' + esc(node.nag) + '</b>' : '') + '</a> ';
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
  return line(root.kids[0]);
}
