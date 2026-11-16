// @ts-check
// Scan results -> library items. Each diagram becomes a 'puzzle' item with its position;
// the page and diagram number go into the source note. Diagrams marked with "?" are tasks.

/**
 * @typedef {{ id: string, page: number, index: number, fen: string, side: string, task: boolean,
 *   valid: boolean, number?: string, moves?: string, movesList?: { san: string, sure: boolean }[], status?: string, checked?: boolean }} ScanResult
 */

/** @param {string} file @returns {string} */
export function scanBookName(file) { return String(file || 'Скан').replace(/\.[^.]+$/, '').slice(0, 80) + ' (скан)'; }

/**
 * @param {ScanResult} r
 * @param {string} source book name for the note
 */
export function scanTitle(r, source) {
  var num = r.number ? r.number : 'стр. ' + (r.page + 1) + ', диаграмма ' + (r.index + 1);
  return (r.number ? 'Диаграмма ' + num : 'Диаграмма (' + num + ')') + (r.task ? ' · задание' : '') +
    (r.status === 'confirmed' ? '' : ' · не проверено');
}

/**
 * Only valid (playable), not skipped results become items. Ids are stable (page:index) so saving
 * twice updates instead of duplicating. A position the coach has not confirmed on the review
 * screen is marked "не проверено": a playable position may still have misread pieces.
 * @param {ScanResult[]} results @param {string} source
 */
export function scanItemsFrom(results, source) {
  return results.filter(function (r) { return r.valid && r.status !== 'skipped'; }).map(function (r) {
    return {
      id: 'scan-' + r.page + '-' + r.index, type: 'puzzle', title: scanTitle(r, source), startFen: r.fen,
      text: r.moves || '', plies: (r.movesList || []).length, result: '', err: null, warn: 0,
      note: (r.status === 'confirmed' ? '' : 'Распознано автоматически, не проверено. ') + (r.task ? 'Задание. ' : '') + (r.side === 'b' ? 'Ход чёрных.' : 'Ход белых.'),
      unchecked: r.status !== 'confirmed',
      section: 'Стр. ' + (r.page + 1), srcPage: r.page + 1, num: r.index + 1,
      source: source + ', стр. ' + (r.page + 1) + (r.number ? ', диаграмма ' + r.number : '')
    };
  });
}

/**
 * Adds/updates items of a scan book (by id) keeping the coach's own changes to existing items.
 * @param {{ items: any[] }} book @param {any[]} items
 * @returns {{ added: number, updated: number }}
 */
export function mergeScanItems(book, items) {
  var added = 0, updated = 0;
  items.forEach(function (it) {
    var i = book.items.findIndex(function (x) { return x.id === it.id; });
    if (i < 0) { book.items.push(it); added++; }
    else if (!book.items[i].edited) { book.items[i] = Object.assign({}, book.items[i], it, { stat: book.items[i].stat, solved: book.items[i].solved }); updated++; }
  });
  book.items.sort(function (a, b) { return (a.srcPage || 0) - (b.srcPage || 0) || (a.num || 0) - (b.num || 0); });
  return { added: added, updated: updated };
}
