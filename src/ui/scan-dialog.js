// "Распознать скан": page range, progress, cancel and continue for scanned PDF / DjVu books.
// Pages are rendered one at a time (memory-friendly); the per-page processing (diagram search,
// OCR) is plugged in through ctx.processPage. Nothing leaves the device.
import { $, esc } from './util.js';
import { openModal, toast } from './dialogs.js';
import { Store } from '../storage/store.js';
import { openScanSource, fileFingerprint } from '../scan/source.js';
import { createScanJob, newScanState, pendingPages } from '../scan/scan-job.js';
import { countLabel } from './plural.js';

export var SCAN_DPI = 200;

// ctx: { processPage(img, page, file) -> Promise<results[]>, onResults(state, file) }
export function createScanDialog(ctx) {
  function stateId(fp) { return '__scan:' + fp; }

  async function open(file) {
    var m = openModal('<h3>Распознать скан</h3><div id="sc-body"><p class="hint-note">Открываю «' + esc(file.name) + '»…</p></div>', 'wide');
    var body = $('#sc-body', m.el), source = null, job = null;
    m.onclose = function () { if (job) job.cancel(); if (source) source.close(); };
    try { source = await openScanSource(file); }
    catch (e) {
      body.innerHTML = '<p class="status bad">' + esc(e.message || String(e)) + '</p><div class="modal-act"><button class="btn" data-close>Закрыть</button></div>';
      body.querySelector('[data-close]').addEventListener('click', m.close);
      return m;
    }
    var fp = fileFingerprint(file);
    var saved = await Store.get(stateId(fp));
    var state = saved && saved.state && saved.state.pages === source.pages ? saved.state : newScanState(fp, file.name, source.pages);
    renderSetup();
    return m;

    function renderSetup() {
      var done = state.done.length;
      body.innerHTML =
        '<p class="hint-note">В книге ' + countLabel(source.pages, 'страница', 'страницы', 'страниц') + '. Страницы обрабатываются по одной прямо на этом устройстве; файл никуда не отправляется. ' +
        'Можно остановить и потом продолжить с того же места.</p>' +
        (done ? '<p class="status warn">Уже обработано: ' + countLabel(done, 'страница', 'страницы', 'страниц') + ', найдено: ' + state.results.length + '.</p>' : '') +
        '<div class="row2"><label class="fld">С страницы<input id="sc-from" type="number" min="1" max="' + source.pages + '" value="1"></label>' +
        '<label class="fld">По страницу<input id="sc-to" type="number" min="1" max="' + source.pages + '" value="' + source.pages + '"></label></div>' +
        '<div class="modal-act">' + (done ? '<button class="btn" id="sc-reset">Начать заново</button>' : '') +
        '<button class="btn" data-close>Закрыть</button><button class="btn primary" id="sc-go">' + (done ? 'Продолжить' : 'Начать') + '</button></div>';
      body.querySelector('[data-close]').addEventListener('click', m.close);
      var reset = body.querySelector('#sc-reset');
      if (reset) reset.addEventListener('click', function () { state = newScanState(fp, file.name, source.pages); Store.put({ id: stateId(fp), state: state }); renderSetup(); });
      body.querySelector('#sc-go').addEventListener('click', function () {
        var from = Math.max(1, Math.min(source.pages, parseInt(body.querySelector('#sc-from').value, 10) || 1));
        var to = Math.max(from, Math.min(source.pages, parseInt(body.querySelector('#sc-to').value, 10) || source.pages));
        runRange(from - 1, to - 1);
      });
    }

    async function runRange(from, to) {
      var total = pendingPages(state, from, to).length;
      body.innerHTML = '<div class="progress"><div class="pbar"><i id="sc-fill"></i></div><p id="sc-txt">Готовлю страницы…</p></div>' +
        '<div class="modal-act"><button class="btn" id="sc-stop">Остановить</button></div>';
      var fill = body.querySelector('#sc-fill'), txt = body.querySelector('#sc-txt');
      job = createScanJob({
        source: source, state: state, dpi: SCAN_DPI,
        processPage: function (img, page) { return ctx.processPage ? ctx.processPage(img, page, file) : []; },
        save: function (st) { return Store.put({ id: stateId(fp), state: st }); }
      });
      body.querySelector('#sc-stop').addEventListener('click', function () { job.cancel(); txt.textContent = 'Останавливаю после текущей страницы…'; });
      try {
        var r = await job.run(from, to, function (p) {
          fill.style.width = (total ? p.index / total * 100 : 100) + '%';
          txt.textContent = 'Страница ' + (p.page + 1) + ' (' + p.index + ' из ' + total + ') · найдено: ' + p.found;
        });
        job = null;
        renderDone(r.finished);
      } catch (e) {
        job = null;
        body.innerHTML = '<p class="status bad">Ошибка на странице: ' + esc(e.message || String(e)) + '. Обработанное сохранено — можно продолжить.</p>' +
          '<div class="modal-act"><button class="btn" data-close>Закрыть</button><button class="btn primary" id="sc-again">Продолжить</button></div>';
        body.querySelector('[data-close]').addEventListener('click', m.close);
        body.querySelector('#sc-again').addEventListener('click', renderSetup);
      }
    }

    function renderDone(finished) {
      body.innerHTML = '<p class="status ' + (finished ? 'good' : 'warn') + '">' + (finished ? 'Готово.' : 'Остановлено.') + ' Обработано ' +
        countLabel(state.done.length, 'страница', 'страницы', 'страниц') + ' из ' + source.pages + ', найдено: ' + state.results.length + '.</p>' +
        '<div class="modal-act"><button class="btn" id="sc-more">Другие страницы</button>' +
        (state.results.length ? '<button class="btn primary" id="sc-review">Проверить найденное</button>' : '') +
        '<button class="btn" data-close>Закрыть</button></div>';
      body.querySelector('[data-close]').addEventListener('click', m.close);
      body.querySelector('#sc-more').addEventListener('click', renderSetup);
      var rv = body.querySelector('#sc-review');
      if (rv) rv.addEventListener('click', function () { if (ctx.onResults) ctx.onResults(state, file, m); else toast('Найдено: ' + state.results.length); });
    }
  }

  return { open: open };
}
