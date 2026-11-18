// Online lesson (coach's board -> students) over Supabase Realtime. Stage 5.
// Replaces the prototype's window.claude.use('room') version (it worked only inside claude.ai;
// it is in the git history). The exchange itself is in session.js (no DOM), the channels in
// transport.js, the cloud calls in backend.js; this file is the panel, the dialogs and the
// connection to the app (the same functions app.js called before: blocked, treeChanged, ...).
import { Core } from '../core/index.js';
import { Store } from '../storage/store.js';
import { $, esc, uid, lsGet, lsSet } from '../ui/util.js';
import { ensureBook, newGameItem, LESSONS_BOOK, RECORD_BOOK } from '../ui/record.js';
import { createLessonSession } from './session.js';
import { cleanText } from './protocol.js';
import { cloudBackend, testBackend, lessonsMissing } from './backend.js';

var OWN_BOOKS = [LESSONS_BOOK, RECORD_BOOK, 'Мои позиции'];
var STORE_KEY = 'st.lesson';
var POLL_MS = 45000;
var NOT_ENABLED = 'Онлайн-урок ещё не включён в облаке. Нужно обновление облака (инструкция «Обновление: онлайн-урок»).';

export function createLive(ctx) {
  var S = ctx.S, toast = ctx.toast, openModal = ctx.openModal;
  var backend = null, session = null, lesson = null, offer = null, resume = null;
  var inited = false, pollTimer = null, saveTimer = null, engineToastShown = false, polling = false, leaveMsg = '', endedIds = {}, peek = false;

  function role() { return backend ? backend.role() : 'none'; }
  function studentIn() { return !!(session && session.state.role === 's' && session.state.open); }
  function coachIn() { return !!(session && session.state.role === 'c' && session.state.open); }

  // ------------------------------------------------------------ saving the lesson
  function dateLabel(t) { var d = new Date(t); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear(); }
  function storeSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { if (session && lesson) lsSet(STORE_KEY, { id: lesson.id, role: lesson.role, snap: session.snapshot() }); }, 1500);
  }
  // docs of an earlier session of the same lesson (page reload, reconnection) + the current ones
  function mergeSnap(a, b) {
    if (!a) return b; if (!b) return a;
    var byId = {};
    a.docs.forEach(function (d) { byId[d.id] = d; });
    b.docs.forEach(function (d) { byId[d.id] = d; });
    var ids = a.docs.map(function (d) { return d.id; });
    b.docs.forEach(function (d) { if (ids.indexOf(d.id) < 0) ids.push(d.id); });
    var who = a.participants.slice();
    b.participants.forEach(function (n) { if (who.indexOf(n) < 0) who.push(n); });
    return { coach: b.coach || a.coach, participants: who, docs: ids.map(function (id) { return byId[id]; }) };
  }
  // Every record of the lesson goes to «Уроки» (format of «Записать партию»: headers, source 'live').
  // The coach's games recorded during the lesson are already in «Мои партии» and stay there.
  function saveSnap(snap, asCoach) {
    var now = Date.now(), book = null, last = null, n = 0;
    var who = cleanText((snap.participants || []).join(', '), 70);
    (snap.docs || []).forEach(function (d) {
      if (asCoach && d.recorded) return;
      if (!d.mt && d.fen === Core.START) return;
      var r = Core.parseMovetext(d.fen, d.mt || '');
      book = ensureBook(S.books, LESSONS_BOOK, function () { return uid('b'); }, now).book;
      var it = newGameItem({ id: uid('i'), now: now, fen: d.fen, source: 'live', headers: { Event: cleanText('Онлайн-урок' + (who ? ' · ' + who : ''), 80) } });
      it.type = d.type === 'puzzle' ? 'puzzle' : 'game';
      it.title = cleanText(d.title, 100) + ' · урок ' + dateLabel(now);
      it.text = Core.toMovetext(r.root); it.plies = Core.mainLine(r.root).length;
      it.recorded = false;
      book.items.push(it); last = it; n++;
    });
    if (book) Store.put(JSON.parse(JSON.stringify(book)));
    return { n: n, book: book, last: last };
  }

  function finishLesson(reason, opts) {
    opts = opts || {};
    var s = session, l = lesson;
    if (!s || !l) return;
    session = null; lesson = null;
    clearTimeout(saveTimer);
    // an ended lesson is not offered again (the server may answer a little later)
    if (reason === 'ended') { endedIds[l.id] = true; if (offer && offer.lesson_id === l.id) offer = null; }
    var stored = lsGet(STORE_KEY, null);
    var snap = mergeSnap(stored && stored.id === l.id ? stored.snap : null, s.snapshot());
    lsSet(STORE_KEY, null);
    var r = saveSnap(snap, l.role === 'c');
    if (l.role === 'c') backend.endLesson(l.id).catch(function () { /* ends by itself after 12 hours */ });
    // the student keeps analysing the saved copy (the live board is not stored anywhere)
    if (l.role === 's' && opts.loadCopy !== false && r.last && S.item && S.item.id === 'live') ctx.loadItem(r.book, r.last, true);
    var where = r.n ? ' Ходы сохранены в книгу «' + LESSONS_BOOK + '».' : '';
    if (reason === 'ended') toast((l.role === 'c' ? 'Урок закончен.' : 'Тренер закончил урок.') + where);
    else if (reason === 'left') toast((leaveMsg || 'Вы вышли из урока.') + where);
    leaveMsg = '';
    ctx.renderAll();
    bar();
  }

  // ------------------------------------------------------------ hooks for the session
  function isOwnItem() {
    var it = S.item;
    if (!it || it.recorded || it.source === 'live') return true;
    return !!(S.book && !S.book.remote && OWN_BOOKS.indexOf(S.book.name) >= 0);
  }
  function hooks(asCoach) {
    return {
      applied: function (kind) {
        if (asCoach && kind === 'move') ctx.saveItem();
        if (!asCoach && kind === 'state') { engineToastShown = false; if (window.innerWidth < 900) S.pane = 'board'; }
        ctx.renderAll(); ctx.scheduleEngine();
        if (kind === 'state' || kind === 'mode') bar();
        storeSoon();
      },
      info: bar,
      toast: toast,
      engineOff: function () {
        if (asCoach || !S.engineOn) return;
        S.engineOn = false; ctx.stopEngineRun(); ctx.renderEngine(); ctx.renderBoard(); ctx.renderNavState();
        if (!engineToastShown) { engineToastShown = true; toast('Тренер выключил движок на время урока.'); }
      },
      applyDraw: ctx.applyDraw,
      drawPayload: ctx.drawPayload,
      isOwnItem: isOwnItem,
      ended: function (reason) { finishLesson(reason); }
    };
  }

  // ------------------------------------------------------------ coach
  async function beginCoach(id) {
    await backend.prepare();
    var p = backend.profile();
    if (S.mode === 'solve') { S.mode = 'analyse'; S.solve = null; S.hint = null; }
    lesson = { id: id, role: 'c' };
    session = createLessonSession({ role: 'c', transport: backend.transport(id), S: S, me: { k: 'coach', n: p.display_name || 'Тренер' }, coachName: p.display_name || 'Тренер', hooks: hooks(true) });
    await session.start();
    ctx.renderAll(); bar();
  }
  function openStart() {
    var m = openModal('<h3>Онлайн-урок</h3><div id="lv-body"><p class="hint-note">Загружаю учеников…</p></div>' +
      '<div class="modal-act"><button class="btn" data-close>Отмена</button><button class="btn primary" id="lv-go" disabled>Начать урок</button></div>');
    var body = m.el.querySelector('#lv-body'), go = m.el.querySelector('#lv-go');
    backend.listStudents().then(function (list) {
      list = list || [];
      if (!list.length) { body.innerHTML = '<p class="status warn">Учеников пока нет. Добавьте их в «Аккаунт → Добавить ученика».</p>'; return; }
      body.innerHTML = '<p class="hint-note">Кого позвать на урок? Им придёт приглашение в приложении. Ученики увидят вашу доску: ходы, варианты, стрелки и ваши комментарии. Текст книг не отправляется.</p>' +
        '<div class="lv-pick">' + list.map(function (s) {
          return '<label class="chk"><input type="checkbox" data-s="' + esc(s.id) + '"' + (s.bound_at !== null ? ' checked' : '') + '> ' + esc(s.nick) + (s.bound_at ? '' : ' <span class="hint-note">(ещё не вошёл)</span>') + '</label>';
        }).join('') + '</div><p id="lv-st" class="status"></p>';
      go.disabled = false;
    }).catch(function (e) { body.innerHTML = '<p class="status bad">' + esc(lessonsMissing(e) ? NOT_ENABLED : 'Нет связи с облаком. Проверьте интернет.') + '</p>'; });
    go.addEventListener('click', async function () {
      var ids = Array.prototype.filter.call(body.querySelectorAll('[data-s]'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-s'); });
      var st = body.querySelector('#lv-st');
      if (!ids.length) { st.className = 'status bad'; st.textContent = 'Выберите хотя бы одного ученика.'; return; }
      go.disabled = true; st.className = 'status'; st.textContent = 'Начинаю…';
      try {
        var r = await backend.startLesson(ids);
        if (!r || !r.ok) { st.className = 'status bad'; st.textContent = r && r.error === 'not_found' ? 'Ученик не найден. Обновите список.' : 'Не удалось начать урок.'; go.disabled = false; return; }
        m.close();
        await beginCoach(r.lesson_id);
        toast('Урок начат. Приглашённые ученики увидят «Присоединиться».');
      } catch (e) {
        st.className = 'status bad'; st.textContent = lessonsMissing(e) ? NOT_ENABLED : 'Нет связи с облаком. Проверьте интернет.'; go.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------ student
  async function join() {
    if (!offer || session) return;
    try { await backend.prepare(); } catch (e) { toast('Нет связи с облаком. Проверьте интернет.'); return; }
    var p = backend.profile();
    lesson = { id: offer.lesson_id, role: 's' };
    session = createLessonSession({ role: 's', transport: backend.transport(offer.lesson_id), S: S, me: { k: 's' + Math.random().toString(36).slice(2, 10), n: p.nick || 'Ученик' }, coachName: offer.coach_name || '', hooks: hooks(false) });
    await session.start();
    bar();
  }
  async function poll() {
    if (!backend || polling) return;
    var r = role();
    if (r !== 'student' && r !== 'coach') { offer = null; resume = null; bar(); return; }
    polling = true;
    try {
      if (r === 'student') {
        offer = await backend.myLiveLesson();
        if (offer && (typeof offer.lesson_id !== 'string' || endedIds[offer.lesson_id])) offer = null;
        // the lesson ended while we did not hear it (no network): save what we have
        if (studentIn() && (!offer || offer.lesson_id !== lesson.id)) session.end();
        var stored = lsGet(STORE_KEY, null);
        if (stored && stored.role === 's' && !session && (!offer || offer.lesson_id !== stored.id)) {
          var res = saveSnap(stored.snap, false); lsSet(STORE_KEY, null);
          if (res.n) { toast('Прошлый урок сохранён в книгу «' + LESSONS_BOOK + '».'); ctx.renderAll(); }
        }
      } else if (!session) {
        resume = await backend.myCoachLesson();
      }
    } catch (e) { /* offline or the cloud is not updated yet: no lesson */ }
    finally { polling = false; }
    bar();
  }

  // ------------------------------------------------------------ the panel
  function names(list, r) {
    var out = [];
    list.forEach(function (m) { if (m.r === r && out.indexOf(m.n) < 0) out.push(m.n); });
    return out;
  }
  function bar() {
    var el = $('#livebar'), btn = $('#btn-live');
    if (!el || !btn) return;
    var r = role(), html = '';
    btn.hidden = !(r === 'coach' && inited);
    btn.textContent = coachIn() ? 'Закончить урок' : 'Начать урок';
    btn.classList.toggle('primary', !coachIn());
    if (coachIn()) {
      var s = session.state, kids = names(s.members, 's');
      var net = s.status === 'denied' ? ' Нет доступа к каналу урока: проверьте настройки облака.' : s.status !== 'online' ? ' Нет связи, переподключаюсь…' : '';
      html = '<span class="dot-live"></span><strong>Урок идёт</strong><span class="lv-who">' + (kids.length ? 'В уроке: ' + esc(kids.join(', ')) + '.' : 'Ученики ещё не подключились.') + esc(net) + '</span>' +
        '<div class="ban-act lv-act"><span class="seg lv-seg" role="group" aria-label="Кто двигает фигуры"><span class="lv-lbl">Двигает:</span>' +
        '<button class="btn' + (s.lock ? ' on' : '') + '" data-live="lock" aria-pressed="' + s.lock + '">Ходит только тренер</button>' +
        '<button class="btn' + (!s.lock ? ' on' : '') + '" data-live="unlock" aria-pressed="' + !s.lock + '">Тренер и ученики</button></span>' +
        '<button class="btn' + (s.eng ? ' on' : '') + '" data-live="eng" aria-pressed="' + s.eng + '">' + (s.eng ? 'Движок ученикам: можно' : 'Движок ученикам: нельзя') + '</button>' +
        '<button class="btn' + (s.hide ? ' on' : '') + '" data-live="hide" aria-pressed="' + s.hide + '">' + (s.hide ? 'Решение: скрыто' : 'Решение: показано') + '</button>' +
        (s.hide ? '<button class="btn' + (peek ? ' on' : '') + '" data-live="peek" aria-pressed="' + peek + '" title="Только на вашем экране">' + (peek ? 'Спрятать у меня' : 'Показать мне') + '</button>' : '') +
        '<button class="btn" data-live="end">Закончить урок</button></div>';
    } else if (studentIn()) {
      var t = session.state, msg = [];
      if (!t.synced) msg.push('Загружаю доску тренера…');
      msg.push(t.lock ? 'Сейчас ходит только тренер.' : 'Можно ходить вместе с тренером.');
      if (!t.eng) msg.push('Движок выключен тренером.');
      if (t.hide) msg.push('Решение скрыто.');
      if (t.status === 'denied') msg.push('Нет доступа к уроку.');
      else if (t.status !== 'online') msg.push('Нет связи, переподключаюсь…');
      else if (!t.coachHere) msg.push('Тренер сейчас не на связи.');
      html = '<span class="dot-live"></span><strong>Идёт урок' + (t.coach ? ' · ' + esc(t.coach) : '') + '</strong><span class="lv-who">' + esc(msg.join(' ')) + '</span>' +
        '<div class="ban-act"><button class="btn" data-live="leave">Выйти из урока</button></div>';
    } else if (r === 'student' && offer) {
      html = '<span class="dot-live"></span><strong>Тренер' + (offer.coach_name ? ' ' + esc(cleanText(offer.coach_name, 60)) : '') + ' начал урок</strong><span>Его доска появится у вас на экране.</span>' +
        '<div class="ban-act"><button class="btn primary" data-live="join">Присоединиться</button></div>';
    } else if (r === 'coach' && resume) {
      html = '<strong>Урок не закончен</strong><span>Продолжите его или закончите для всех.</span>' +
        '<div class="ban-act"><button class="btn primary" data-live="resume">Продолжить урок</button><button class="btn" data-live="endold">Закончить</button></div>';
    }
    el.hidden = !html; el.innerHTML = html;
    var et = $('#engine-toggle'); if (et) et.disabled = engineBlocked();
    ctx.renderNavState();
  }
  async function onBarClick(e) {
    var b = e.target.closest('[data-live]'); if (!b) return;
    var a = b.getAttribute('data-live');
    if (a === 'lock' || a === 'unlock') {
      if (!coachIn()) return;
      session.setMode({ lock: a === 'lock' }); bar();
      toast(a === 'lock' ? 'Ходит только тренер.' : 'Ученики тоже могут двигать фигуры.');
    } else if (a === 'eng') {
      if (!coachIn()) return;
      session.setMode({ eng: !session.state.eng }); bar();
      toast(session.state.eng ? 'Ученики могут включить движок.' : 'Движок у учеников выключен.');
    } else if (a === 'hide') {
      if (!coachIn()) return;
      session.setHidden(!session.state.hide); peek = false; ctx.renderAll(); bar();
      toast(session.state.hide ? 'Решение скрыто у всех.' : 'Решение показано всем.');
    } else if (a === 'peek') {
      if (!coachIn()) return;
      peek = !peek; ctx.renderAll(); bar();
    } else if (a === 'end') { if (coachIn()) session.end(); }
    else if (a === 'leave') { if (studentIn()) session.end(); }
    else if (a === 'join') { join().catch(function () { toast('Не удалось подключиться к уроку.'); }); }
    else if (a === 'resume') {
      var id = resume && resume.lesson_id; resume = null;
      if (id) beginCoach(id).then(function () { toast('Урок продолжается.'); }).catch(function () { toast('Не удалось продолжить урок.'); });
    } else if (a === 'endold') {
      var old = resume; resume = null; bar();
      if (old) {
        backend.endLesson(old.lesson_id).catch(function () {});
        var stored = lsGet(STORE_KEY, null);
        if (stored && stored.id === old.lesson_id) { saveSnap(stored.snap, true); lsSet(STORE_KEY, null); ctx.renderAll(); }
        toast('Урок закончен.');
      }
    }
  }
  function toggleLesson() {
    if (role() !== 'coach') return;
    if (coachIn()) session.end(); else openStart();
  }

  // ------------------------------------------------------------ app hooks
  function blocked() { return studentIn() && (session.state.lock || !session.state.synced); }
  function editBlocked() { return studentIn(); }
  function engineBlocked() { return studentIn() && !session.state.eng; }
  function setBackend(b) {
    backend = b;
    if (b.onRole) b.onRole(function () { poll(); bar(); });
    bar(); poll();
  }

  function init() {
    // claude.ai file saving (the prototype ran there); elsewhere a normal download is used
    try { if (window.claude && window.claude.use) window.claude.use('downloads').then(ctx.setDl, function () { ctx.setDl(null); }); } catch (e) { ctx.setDl(null); }
    inited = true;
    $('#livebar').addEventListener('click', onBarClick);
    $('#btn-live').addEventListener('click', toggleLesson);
    var t = window.__tetradLiveTest;
    if (t && typeof t === 'object' && t.bus) { t.poll = poll; setBackend(testBackend(t)); }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('online', function () { poll(); if (studentIn()) session.resync(); });
    pollTimer = setInterval(function () { if (document.visibilityState === 'visible' && !coachIn()) poll(); }, POLL_MS);
    bar();
  }

  return {
    init: init,
    setCloud: function (cloud) { if (!backend && cloud) setBackend(cloudBackend(cloud)); },
    engineBlocked: engineBlocked,
    // the coach's move list while the solution is hidden (null: show everything)
    visibleIds: function () { return coachIn() && !peek ? session.visibleIds() : null; },
    blocked: blocked,
    editBlocked: editBlocked,
    isOn: function () { return coachIn() || (studentIn() && session.state.synced); },
    canSaveSetup: function () { return !studentIn(); },
    setup: function () { /* the position editor is not mirrored; a saved position opens as a new record and is sent */ },
    treeChanged: function () { if (coachIn()) { session.treeChanged(); storeSoon(); } },
    curChanged: function () { if (session) session.curChanged(); },
    drawChanged: function () { if (coachIn()) session.curChanged(); },
    flipChanged: function () { if (coachIn()) session.flipChanged(); },
    // before the app replaces the board with another record: the lesson keeps the old one
    itemLeaving: function () { if (coachIn()) session.itemLeaving(); },
    itemLoaded: function () {
      if (!inited) return;
      if (coachIn()) { session.docChanged(); peek = false; storeSoon(); ctx.renderAll(); bar(); return; }
      if (studentIn()) { leaveMsg = 'Вы открыли свою запись и вышли из урока (вернуться — «Присоединиться»).'; session.end(); }
    },
    // the student's move during the lesson is a request to the coach
    interceptMove: function (mv) {
      if (!studentIn()) return false;
      if (!session.proposeMove(mv)) toast('Сейчас ходит только тренер.');
      return true;
    },
    _poll: poll,
    _pollTimer: function () { return pollTimer; }
  };
}
