// "Аккаунт" dialog: student joins with a code from the coach; coach signs in, adds students,
// assigns sets and sees progress. Hidden entirely when the cloud is not configured.
import { CONFIG } from '../sync/config.js';
import { loadClient } from '../sync/client.js';
import { createApi } from '../sync/api.js';
import { createQueue, localStorageBackend } from '../sync/queue.js';
import { createSync } from '../sync/sync.js';
import { normalizeCode, errorText, checkLogin } from '../sync/code.js';
import { setFromBook, summarize, isRemoteBook } from '../sync/model.js';
import { countLabel } from './plural.js';

// ctx: { S, Store, toast, openModal, renderAll, esc, lsGet, lsSet }
export function initAccount(ctx) {
  var btn = document.getElementById('btn-account');
  var noop = { onProgress: function () {} };
  if (!CONFIG.enabled || !btn) return noop;
  btn.hidden = false;
  var esc = ctx.esc, api = null, sync = null, readyP = null, lastAuto = 0, client = null, roleListeners = [];
  function roleChanged() { roleListeners.forEach(function (f) { try { f(sync ? sync.state.role : 'none'); } catch (e) { /* a listener must not break sync */ } }); }

  function putBook(book) {
    var i = ctx.S.books.findIndex(function (b) { return b.id === book.id; });
    if (i >= 0) {
      var wasCurrent = ctx.S.book === ctx.S.books[i];
      ctx.S.books[i] = book;
      if (wasCurrent) ctx.S.book = book;
    } else ctx.S.books.push(book);
    ctx.Store.put(JSON.parse(JSON.stringify(book)));
  }

  function ensure() {
    if (!readyP) {
      readyP = loadClient().then(function (c) {
        client = c;
        api = createApi(client, { redirectTo: location.origin + location.pathname });
        sync = createSync({
          api: api, queue: createQueue(localStorageBackend('st.syncq')),
          getBooks: function () { return ctx.S.books; }, putBook: putBook, onChange: ctx.renderAll
        });
        // the online lesson (live/live.js) follows the role: coach / student / signed out
        var refresh = sync.refreshRole, syncNow = sync.syncNow;
        sync.refreshRole = async function () { var r = await refresh(); roleChanged(); return r; };
        sync.syncNow = async function () { var r = await syncNow(); roleChanged(); return r; };
        return sync;
      }).catch(function (e) { readyP = null; throw e; });
    }
    return readyP;
  }

  async function autoSync(force) {
    if (!ctx.lsGet('st.cloud', false) || !navigator.onLine) return;
    if (!force && Date.now() - lastAuto < 60000) return;
    lastAuto = Date.now();
    try { await ensure(); await sync.syncNow(); } catch (e) { /* offline or not configured: stay local */ }
  }

  // ---------------------------------------------------------------- dialog
  function open() {
    var m = ctx.openModal('<h3>Аккаунт</h3><div id="acc-body"><p class="hint-note">Подключаюсь к облаку…</p></div>' +
      '<div class="modal-act"><button class="btn" data-close>Закрыть</button></div>', 'wide');
    var body = m.el.querySelector('#acc-body');
    ensure().then(function () { return sync.refreshRole(); }).then(function (role) {
      if (role === 'coach') renderCoach(m, body);
      else if (role === 'student') renderStudent(m, body);
      else renderSignedOut(m, body);
    }).catch(function (e) {
      body.innerHTML = '<p class="status bad">Нет связи с облаком: ' + esc(e.message || e) + '. Приложение продолжает работать без него.</p>';
    });
  }

  function status(el, cls, text) { el.className = 'status ' + cls; el.textContent = text; }
  // Network failures (offline, cloud unreachable) in plain words.
  function errMsg(e) { var t = String((e && e.message) || e || ''); return /Failed to fetch|NetworkError|Load failed|network/i.test(t) ? 'Нет связи с облаком. Проверьте интернет.' : 'Ошибка: ' + t; }

  function renderSignedOut(m, body) {
    body.innerHTML =
      '<div class="acc-grid">' +
      '<section class="acc-card"><h4>Я ученик</h4>' +
      '<div class="seg acc-tabs" role="tablist"><button class="btn on" id="acc-tab-code" role="tab">По коду</button><button class="btn" id="acc-tab-pass" role="tab">По логину и паролю</button></div>' +
      '<div id="acc-by-code"><p class="hint-note">Введите код, который дал тренер. Почта не нужна.</p>' +
      '<label class="fld">Код<input id="acc-code" type="text" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH-JKMN" maxlength="20"></label>' +
      '<button class="btn primary" id="acc-join">Войти по коду</button><p id="acc-join-st" class="status"></p></div>' +
      '<div id="acc-by-pass" hidden><p class="hint-note">Если вы уже придумали логин и пароль.</p>' +
      '<label class="fld">Логин<input id="acc-login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30"></label>' +
      '<label class="fld">Пароль<input id="acc-lpass" type="password" autocomplete="current-password" maxlength="72"></label>' +
      '<button class="btn primary" id="acc-login-go">Войти</button><p id="acc-login-st" class="status"></p>' +
      '<p class="hint-note">Забыли пароль? Попросите у тренера новый код, войдите по нему и придумайте новый пароль.</p></div></section>' +
      '<section class="acc-card"><h4>Я тренер</h4>' +
      '<label class="fld">Почта<input id="acc-email" type="email" autocomplete="username"></label>' +
      '<label class="fld">Пароль<input id="acc-pass" type="password" autocomplete="current-password"></label>' +
      '<div class="seg wrap"><button class="btn primary" id="acc-in">Войти</button><button class="btn" id="acc-up">Зарегистрироваться</button><button class="btn" id="acc-link">Ссылка на почту</button></div>' +
      '<p id="acc-coach-st" class="status"></p></section></div>' +
      '<p class="hint-note">В облаке хранятся только ник ученика, назначенные наборы (позиции и ходы) и прогресс. Книги и PDF остаются на устройстве тренера.</p>';
    var codeIn = body.querySelector('#acc-code'), jst = body.querySelector('#acc-join-st');
    function tab(pass) {
      body.querySelector('#acc-by-code').hidden = pass; body.querySelector('#acc-by-pass').hidden = !pass;
      body.querySelector('#acc-tab-code').classList.toggle('on', !pass); body.querySelector('#acc-tab-pass').classList.toggle('on', pass);
    }
    body.querySelector('#acc-tab-code').addEventListener('click', function () { tab(false); });
    body.querySelector('#acc-tab-pass').addEventListener('click', function () { tab(true); });
    body.querySelector('#acc-login-go').addEventListener('click', async function () {
      var lst = body.querySelector('#acc-login-st'), login = body.querySelector('#acc-login').value, pass = body.querySelector('#acc-lpass').value;
      if (!login.trim() || !pass) { status(lst, 'bad', 'Введите логин и пароль.'); return; }
      status(lst, '', 'Вхожу…');
      try {
        var r = await api.studentLogin(login, pass);
        if (!r || !r.ok) { status(lst, 'bad', errorText(r && r.error, r && r.message)); return; }
        ctx.lsSet('st.cloud', true);
        await sync.syncNow();
        ctx.toast('Здравствуйте, ' + r.nick + '! Ваши наборы и прогресс загружены.');
        renderStudent(m, body);
      } catch (e) { status(lst, 'bad', errMsg(e)); }
    });
    codeIn.addEventListener('input', function () { var c = normalizeCode(codeIn.value); if (c.valid) status(jst, 'good', 'Код похож на верный: ' + c.code); else status(jst, '', ''); });
    body.querySelector('#acc-join').addEventListener('click', async function () {
      status(jst, '', 'Проверяю код…');
      try {
        var r = await api.studentJoin(codeIn.value);
        if (!r || !r.ok) { status(jst, 'bad', errorText(r && r.error, r && r.message)); return; }
        ctx.lsSet('st.cloud', true);
        await sync.syncNow();
        ctx.toast('Готово: ' + r.nick + ', задания тренера загружены.');
        renderSetLogin(m, body, true);
      } catch (e) { status(jst, 'bad', errMsg(e)); }
    });
    var est = body.querySelector('#acc-coach-st');
    function creds() { return { email: body.querySelector('#acc-email').value.trim(), pass: body.querySelector('#acc-pass').value }; }
    async function afterCoachLogin() {
      var r = await api.becomeCoach(null);
      if (!r || !r.ok) { status(est, 'bad', errorText(r && r.error)); return; }
      ctx.lsSet('st.cloud', true);
      await sync.refreshRole();
      renderCoach(m, body);
    }
    body.querySelector('#acc-in').addEventListener('click', async function () {
      var c = creds(); status(est, '', 'Вхожу…');
      try { await api.coachSignIn(c.email, c.pass); await afterCoachLogin(); }
      catch (e) { status(est, 'bad', /Invalid login/i.test(e.message) ? 'Неверная почта или пароль.' : /not confirmed/i.test(e.message) ? 'Подтвердите почту по ссылке из письма.' : errMsg(e)); }
    });
    body.querySelector('#acc-up').addEventListener('click', async function () {
      var c = creds();
      if (c.pass.length < 8) { status(est, 'bad', 'Пароль — не короче 8 символов.'); return; }
      try {
        var d = await api.coachSignUp(c.email, c.pass);
        if (d && d.session) await afterCoachLogin();
        else status(est, 'good', 'Письмо отправлено. Подтвердите почту по ссылке и войдите.');
      } catch (e) { status(est, 'bad', errMsg(e)); }
    });
    body.querySelector('#acc-link').addEventListener('click', async function () {
      var c = creds();
      try { await api.sendMagicLink(c.email); status(est, 'good', 'Ссылка для входа отправлена на ' + c.email + '. Откройте её в этом же браузере.'); }
      catch (e) { status(est, 'bad', errMsg(e)); }
    });
  }

  function fmtDate(t) { return t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'; }

  function renderStudent(m, body) {
    var p = sync.state.profile || {};
    var remote = ctx.S.books.filter(isRemoteBook);
    body.innerHTML = '<p class="status good">Вы ученик: <b>' + esc(p.nick || '') + '</b>' + (p.coach_name ? ' · тренер: ' + esc(p.coach_name) : '') + '.</p>' +
      '<p class="hint-note">Наборов от тренера: ' + remote.length + '. Последняя синхронизация: ' + (sync.state.lastSync ? new Date(sync.state.lastSync).toLocaleTimeString('ru-RU') : '—') + '.</p>' +
      '<button class="btn primary" id="acc-sync">Синхронизировать сейчас</button><p id="acc-sync-st" class="status"></p>' +
      '<p class="hint-note" id="acc-my-login">Логин: …</p><button class="btn" id="acc-set-pass">Сменить пароль</button>' +
      '<p class="hint-note">Решайте задачи и без интернета — прогресс отправится тренеру, когда связь появится. Другой телефон или компьютер? Войдите там по логину и паролю: прогресс будет тот же.</p>';
    api.myStudentLogin().then(function (l) {
      var el = body.querySelector('#acc-my-login'), b = body.querySelector('#acc-set-pass');
      if (!el) return;
      el.textContent = l ? 'Ваш логин: ' + l + '. Пароль знаете только вы.' : 'Логина и пароля пока нет: войти на другом устройстве можно только по новому коду тренера.';
      b.textContent = l ? 'Сменить пароль' : 'Придумать логин и пароль';
    });
    body.querySelector('#acc-set-pass').addEventListener('click', function () { renderSetLogin(m, body, false); });
    body.querySelector('#acc-sync').addEventListener('click', async function () {
      var st = body.querySelector('#acc-sync-st'); status(st, '', 'Синхронизирую…');
      try { await sync.syncNow(); status(st, 'good', 'Готово.'); ctx.renderAll(); } catch (e) { status(st, 'bad', errMsg(e)); }
    });
  }

  // "Придумайте логин и пароль": right after joining by code, or later from the account
  function renderSetLogin(m, body, first) {
    body.innerHTML = '<section class="acc-card acc-setlogin"><h4>Придумайте логин и пароль</h4>' +
      '<p class="hint-note">С ними вы войдёте на любом телефоне или компьютере и увидите свои задачи. Почта не нужна. Пароль никому не говорите — даже тренеру.</p>' +
      '<label class="fld">Логин (латинские буквы и цифры, 3–30)<input id="acc-new-login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="Например: arman2014"></label>' +
      '<label class="fld">Пароль (не короче 8 знаков)<input id="acc-new-pass" type="password" autocomplete="new-password" maxlength="72"></label>' +
      '<label class="fld">Пароль ещё раз<input id="acc-new-pass2" type="password" autocomplete="new-password" maxlength="72"></label>' +
      '<div class="seg wrap"><button class="btn primary" id="acc-save-login">Сохранить</button><button class="btn" id="acc-skip-login">' + (first ? 'Пропустить' : 'Отмена') + '</button></div>' +
      '<p id="acc-setlogin-st" class="status"></p>' +
      (first ? '<p class="hint-note">Если пропустить: на другом устройстве войти можно будет только по новому коду от тренера. Придумать логин можно и позже: «Аккаунт → Придумать логин и пароль».</p>' : '') + '</section>';
    api.myStudentLogin().then(function (l) { var i = body.querySelector('#acc-new-login'); if (l && i && !i.value) i.value = l; });
    var st = body.querySelector('#acc-setlogin-st');
    body.querySelector('#acc-skip-login').addEventListener('click', function () { renderStudent(m, body); });
    body.querySelector('#acc-save-login').addEventListener('click', async function () {
      var login = body.querySelector('#acc-new-login').value, p1 = body.querySelector('#acc-new-pass').value, p2 = body.querySelector('#acc-new-pass2').value;
      var bad = checkLogin(login, p1, p2);
      if (bad) { status(st, 'bad', errorText(bad)); return; }
      status(st, '', 'Сохраняю…');
      try {
        var r = await api.setStudentLogin(login, p1);
        if (!r || !r.ok) { status(st, 'bad', errorText(r && r.error)); return; }
        ctx.toast('Готово! Ваш логин: ' + r.login + '. Запомните пароль.');
        renderStudent(m, body);
      } catch (e) { status(st, 'bad', /set_student_login/.test(String(e && e.message)) ? 'Вход по паролю ещё не включён в облаке. Скажите тренеру.' : errMsg(e)); }
    });
  }

  async function renderCoach(m, body) {
    body.innerHTML = '<p class="hint-note">Загружаю учеников…</p>';
    var data;
    try { data = await api.coachOverview(); } catch (e) { body.innerHTML = '<p class="status bad">' + esc(errMsg(e)) + '</p>'; return; }
    var sum = summarize(data, Date.now());
    var p = sync.state.profile || {};
    body.innerHTML = '<p class="status good">Вы тренер' + (p.display_name ? ': ' + esc(p.display_name) : '') + '.</p>' +
      '<div class="seg wrap"><button class="btn primary" id="acc-add">Добавить ученика</button><button class="btn" id="acc-assign"' + (data.students.length ? '' : ' disabled') + '>Назначить набор</button><button class="btn" id="acc-refresh">Обновить</button><button class="btn" id="acc-out">Выйти</button></div>' +
      '<div id="acc-panel"></div>' +
      '<h4>Ученики</h4>' + (sum.length ? '<div class="acc-list">' + sum.map(function (s) {
        return '<div class="acc-row" data-sid="' + esc(s.id) + '"><div class="acc-who"><b>' + esc(s.nick) + '</b><span class="hint-note">' +
          (s.joined ? 'вошёл · был ' + fmtDate(s.lastSeen) : 'ещё не ввёл код') + (s.hasPassword ? ' · есть пароль' : '') + '</span></div>' +
          '<div class="acc-stats">' + (s.total ? 'решено ' + s.solved + ' из ' + s.total + (s.failed ? ' · не решено ' + s.failed : '') + (s.due ? ' · <b class="due">пора повторить ' + s.due + '</b>' : '') : 'наборов нет') + '</div>' +
          '<div class="acc-act"><button class="btn" data-code="' + esc(s.id) + '">Новый код</button><button class="btn" data-del="' + esc(s.id) + '">Удалить</button></div></div>';
      }).join('') + '</div>' : '<p class="empty-note">Учеников пока нет.</p>') +
      '<p class="hint-note">«Новый код» нужен, если ученик сменил телефон или потерял код. Код одноразовый и действует 7 дней. «Удалить» стирает ученика и весь его прогресс из облака.</p>';
    var panel = body.querySelector('#acc-panel');
    body.querySelector('#acc-refresh').addEventListener('click', function () { renderCoach(m, body); });
    body.querySelector('#acc-out').addEventListener('click', async function () { await api.signOut(); ctx.lsSet('st.cloud', false); sync.state.role = 'none'; sync.state.profile = null; roleChanged(); renderSignedOut(m, body); });
    body.querySelector('#acc-add').addEventListener('click', function () {
      panel.innerHTML = '<div class="acc-card"><label class="fld">Ник ученика (без фамилии)<input id="acc-nick" type="text" maxlength="40" placeholder="Например: Арман"></label><button class="btn primary" id="acc-create">Создать и показать код</button><p id="acc-create-st" class="status"></p></div>';
      panel.querySelector('#acc-create').addEventListener('click', async function () {
        var st = panel.querySelector('#acc-create-st');
        try {
          var r = await api.createStudent(panel.querySelector('#acc-nick').value);
          if (!r.ok) { status(st, 'bad', errorText(r.error)); return; }
          showCode(panel, r.nick, r.code, function () { renderCoach(m, body); });
        } catch (e) { status(st, 'bad', errMsg(e)); }
      });
    });
    body.querySelectorAll('[data-code]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var sid = b.getAttribute('data-code'), s = sum.find(function (x) { return x.id === sid; });
        try { var r = await api.reissueInvite(sid); if (!r.ok) { ctx.toast(errorText(r.error)); return; } showCode(panel, s ? s.nick : '', r.code); }
        catch (e) { ctx.toast(errMsg(e)); }
      });
    });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var sid = b.getAttribute('data-del'), s = sum.find(function (x) { return x.id === sid; });
        if (!confirm('Удалить ученика «' + (s ? s.nick : '') + '» и весь его прогресс из облака? Это нельзя отменить.')) return;
        try { await api.deleteStudent(sid); renderCoach(m, body); } catch (e) { ctx.toast(errMsg(e)); }
      });
    });
    body.querySelector('#acc-assign').addEventListener('click', function () { renderAssign(panel, data, function () { renderCoach(m, body); }); });
  }

  function showCode(panel, nick, code, done) {
    panel.innerHTML = '<div class="acc-card acc-code"><p>Код для <b>' + esc(nick) + '</b>:</p><p class="acc-big mono">' + esc(code) + '</p>' +
      '<p class="hint-note">Передайте код ученику лично или в сообщении. Он одноразовый и действует 7 дней. Ученик: «Меню → Аккаунт → Я ученик».</p>' +
      '<div class="seg wrap"><button class="btn" id="acc-copy">Скопировать</button><button class="btn primary" id="acc-done">Готово</button></div></div>';
    panel.querySelector('#acc-copy').addEventListener('click', function () {
      try { navigator.clipboard.writeText(code).then(function () { ctx.toast('Код скопирован'); }); } catch (e) { ctx.toast(code); }
    });
    panel.querySelector('#acc-done').addEventListener('click', function () { panel.innerHTML = ''; if (done) done(); });
  }

  function renderAssign(panel, data, done) {
    var book = ctx.S.book;
    if (!book || isRemoteBook(book)) { panel.innerHTML = '<p class="status warn">Откройте в библиотеке свою книгу, из которой нужно взять задачи.</p>'; return; }
    panel.innerHTML = '<div class="acc-card"><h4>Набор из книги «' + esc(book.name) + '»</h4>' +
      '<label class="fld">Название набора<input id="as-title" type="text" maxlength="120" value="' + esc(book.name) + '"></label>' +
      '<div class="acc-pick-bar">' +
        '<div class="seg wrap"><button class="btn" id="as-all">Выбрать все</button><button class="btn" id="as-puz">Только задачи</button><button class="btn" id="as-none">Снять все</button></div>' +
        '<div class="acc-range">С № <input id="as-from" type="number" min="1" max="' + book.items.length + '" value="1" inputmode="numeric"> по № <input id="as-to" type="number" min="1" max="' + book.items.length + '" value="' + Math.min(50, book.items.length) + '" inputmode="numeric"> <button class="btn" id="as-range">Отметить</button></div>' +
        '<p class="hint-note" id="as-count">Выбрано: 0 из ' + book.items.length + '</p>' +
      '</div>' +
      '<div class="acc-pick">' + book.items.map(function (it, i) {
        return '<label class="chk"><input type="checkbox" data-i="' + i + '"> <span class="acc-num">' + (i + 1) + '.</span> ' + esc(it.title) + '</label>';
      }).join('') + '</div>' +
      '<p class="hint-note">Кому:</p><div class="seg wrap">' + data.students.map(function (s) {
        return '<label class="chk"><input type="checkbox" data-s="' + esc(s.id) + '" checked> ' + esc(s.nick) + '</label>';
      }).join('') + '</div>' +
      '<label class="chk"><input type="checkbox" id="as-cm"> Отправить мои комментарии к ходам</label>' +
      '<label class="chk"><input type="checkbox" id="as-sol"> Разрешить показ решения</label>' +
      '<p class="hint-note">Без этой галочки ученик не видит решение и не может включить движок, пока не решит задачу сам; вместо «Показать решение» у него кнопка «Пропустить» (задача попадёт в «не решено»).</p>' +
      '<p class="hint-note">Отправляются позиции, ходы и варианты. Комментарии — только если это ваш собственный текст, не текст книги. Источник («' + esc(book.name) + '») подставится сам.</p>' +
      '<button class="btn primary" id="as-go">Назначить</button><p id="as-st" class="status"></p></div>';
    var boxes = Array.prototype.slice.call(panel.querySelectorAll('[data-i]'));
    function recount() {
      var n = boxes.filter(function (c) { return c.checked; }).length;
      panel.querySelector('#as-count').textContent = 'Выбрано: ' + n + ' из ' + boxes.length;
    }
    function mark(pred) { boxes.forEach(function (c, i) { c.checked = pred(i); }); recount(); }
    panel.querySelector('.acc-pick').addEventListener('change', recount);
    panel.querySelector('#as-all').addEventListener('click', function () { mark(function () { return true; }); });
    panel.querySelector('#as-puz').addEventListener('click', function () { mark(function (i) { return book.items[i].type === 'puzzle'; }); });
    panel.querySelector('#as-none').addEventListener('click', function () { mark(function () { return false; }); });
    panel.querySelector('#as-range').addEventListener('click', function () {
      var a = parseInt(panel.querySelector('#as-from').value, 10), b = parseInt(panel.querySelector('#as-to').value, 10);
      if (!(a >= 1) || !(b >= 1)) { status(panel.querySelector('#as-st'), 'bad', 'Введите номера, например с 1 по 50.'); return; }
      if (a > b) { var t = a; a = b; b = t; }
      // adds the range to what is already selected (so several ranges can be combined; «Снять все» resets)
      boxes.forEach(function (c, i) { if (i + 1 >= a && i + 1 <= b) c.checked = true; });
      recount();
      status(panel.querySelector('#as-st'), '', '');
    });
    panel.querySelector('#as-go').addEventListener('click', async function () {
      var st = panel.querySelector('#as-st');
      var items = Array.prototype.filter.call(panel.querySelectorAll('[data-i]'), function (c) { return c.checked; }).map(function (c) { return book.items[+c.getAttribute('data-i')]; });
      var sids = Array.prototype.filter.call(panel.querySelectorAll('[data-s]'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-s'); });
      if (!items.length || !sids.length) { status(st, 'bad', 'Выберите задачи и хотя бы одного ученика.'); return; }
      var set = setFromBook(book, items, { title: panel.querySelector('#as-title').value, includeComments: panel.querySelector('#as-cm').checked, allowSolution: panel.querySelector('#as-sol').checked });
      status(st, '', 'Отправляю…');
      try {
        var sess = await api.session();
        await api.createSetAndAssign(sess.user.id, set, sids);
        ctx.toast('Назначено: ' + countLabel(items.length, 'запись', 'записи', 'записей') + ' · ' + countLabel(sids.length, 'ученик', 'ученика', 'учеников'));
        if (done) done();
      } catch (e) { status(st, 'bad', /allow_solution/.test(String(e && e.message)) ? 'Показ решения ещё не включён в облаке (нужно обновление, см. инструкцию). Снимите галочку «Разрешить показ решения» или обновите облако.' : errMsg(e)); }
    });
  }

  btn.addEventListener('click', open);
  window.addEventListener('online', function () { autoSync(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') autoSync(false); });
  // Returning from a magic link (?code=…) or a returning user: connect in the background.
  if (/[?&]code=/.test(location.search) || ctx.lsGet('st.cloud', false)) {
    ensure().then(function () { ctx.lsSet('st.cloud', true); return autoSync(true); }).catch(function () {});
  }

  return {
    onProgress: function (book, item) {
      if (!isRemoteBook(book)) return;
      ensure().then(function (s) { s.onProgress(book, item); }).catch(function () {});
    },
    // for the online lesson
    cloud: {
      ready: function () { return ensure().then(function () { return { api: api, client: client }; }); },
      role: function () { return sync ? sync.state.role : 'none'; },
      profile: function () { return sync ? sync.state.profile : null; },
      onRole: function (cb) { roleListeners.push(cb); }
    }
  };
}
