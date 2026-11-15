// @ts-check
// Gentle reminder to download a backup when the library lives only in this browser.
// Shown when the cloud is not connected, the library has the user's own data and
// no backup was made for REMIND_DAYS days. "Позже" postpones it for SNOOZE_DAYS days.
import { lsGet, lsSet } from './util.js';

export var REMIND_DAYS = 14;
export var SNOOZE_DAYS = 3;
var DAY = 864e5;

/**
 * @param {{now: number, backupAt: number, firstRun: number, snoozeUntil: number, cloud: boolean, hasUserData: boolean}} s
 * @returns {boolean}
 */
export function shouldRemindBackup(s) {
  if (s.cloud || !s.hasUserData) return false;
  if (s.snoozeUntil && s.now < s.snoozeUntil) return false;
  var since = Math.max(s.backupAt || 0, s.firstRun || 0);
  return s.now - since >= REMIND_DAYS * DAY;
}

/**
 * True if the library has something besides the untouched sample book.
 * @param {Array<{sample?: boolean, items: Array<{stat?: object}>}>} books
 */
export function hasUserData(books) {
  return books.some(function (b) { return !b.sample || b.items.some(function (it) { return !!it.stat; }); });
}

/**
 * Shows the reminder bar if needed.
 * @param {{books: any[], cloud: boolean, makeBackup: () => Promise<any>, now?: number}} opts
 * @returns {HTMLElement|null}
 */
export function maybeRemindBackup(opts) {
  var now = opts.now || Date.now();
  var firstRun = lsGet('st.firstRun', 0);
  if (!firstRun) { lsSet('st.firstRun', now); firstRun = now; }
  var show = shouldRemindBackup({
    now: now, backupAt: lsGet('st.backupAt', 0), firstRun: firstRun, snoozeUntil: lsGet('st.backupSnooze', 0),
    cloud: opts.cloud, hasUserData: hasUserData(opts.books)
  });
  if (!show || document.querySelector('.backup-bar')) return null;
  var el = document.createElement('div');
  el.className = 'pwa-bar backup-bar'; el.setAttribute('role', 'status');
  el.innerHTML = '<span></span><button class="btn primary" data-bk="save"></button><button class="btn" data-bk="later"></button>';
  /** @type {HTMLElement} */ (el.querySelector('span')).textContent = 'Библиотека хранится только в этом браузере. Сделайте резервную копию — это один файл.';
  /** @type {HTMLElement} */ (el.querySelector('[data-bk="save"]')).textContent = 'Сделать копию';
  /** @type {HTMLElement} */ (el.querySelector('[data-bk="later"]')).textContent = 'Позже';
  el.addEventListener('click', function (e) {
    var b = /** @type {HTMLElement} */ (e.target).closest('[data-bk]');
    if (!b) return;
    if (b.getAttribute('data-bk') === 'save') opts.makeBackup().then(function () { el.remove(); }, function () {});
    else { lsSet('st.backupSnooze', Date.now() + SNOOZE_DAYS * DAY); el.remove(); }
  });
  document.body.appendChild(el);
  return el;
}
