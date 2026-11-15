// Live lesson (teacher board -> students). Moved verbatim from the prototype.
// Still uses window.claude.use('user' | 'room' | 'downloads'), which exists only inside claude.ai;
// in a normal browser it stays inactive. To be replaced with a Realtime backend at stage 5.
// UI functions are passed in via ctx, so the body below is unchanged.
import { Chess as C } from '../core/chess.js';
import { Core } from '../core/index.js';
import { Store } from '../storage/store.js';
import { $, uid } from '../ui/util.js';

export function createLive(ctx) {
  var S = ctx.S, toast = ctx.toast, openModal = ctx.openModal, openEditor = ctx.openEditor;
  var renderAll = ctx.renderAll, renderBoard = ctx.renderBoard, renderEngine = ctx.renderEngine;
  var renderNavState = ctx.renderNavState, renderLibrary = ctx.renderLibrary;
  var scheduleEngine = ctx.scheduleEngine, stopEngineRun = ctx.stopEngineRun;
  var drawPayload = ctx.drawPayload, applyDraw = ctx.applyDraw;
  function getEditor() { return ctx.getActiveEditor(); }

  var Live = (function () {
    var room = null, user = null, isT = false, on = false, follow = true, locked = false;
    var noEng = false, curTr = '', buf = {}, pend = null, seenSync = {}, syncN = 0, applying = false, timer = null, inited = false;
    var CH = 1400, FEN_PL = /^[rnbqkpRNBQKP1-8]{1,8}(\/[rnbqkpRNBQKP1-8]{1,8}){7}$/;
    function rid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
    function noop() {}
    function peersList() { return room ? room.peers() : []; }
    function teacherPeer() {
      var ps = peersList();
      for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (!p.isMe && p.presence && p.presence.role === 't' && p.presence.live) return p; }
      return null;
    }
    function active() { return !!room && (isT ? on : (follow && !!teacherPeer())); }
    function blocked() {
      if (!room || isT || !follow) return false;
      var t = teacherPeer(); return !!(t && t.presence.locked);
    }
    function accept(msg) {
      if (!room || msg.isMe) return false;
      if (isT) {
        if (!on) return false;
        if (!locked) return true;
        var p = peersList().filter(function (x) { return x.peer === msg.peer; })[0];
        return !!(p && p.presence && p.presence.role === 't');
      }
      return follow && !!teacherPeer();
    }
    function nodePath(n) { var p = []; while (n.parent) { p.unshift(n.parent.kids.indexOf(n)); n = n.parent; } return p; }
    function nodeAt(path) {
      var n = S.root;
      for (var i = 0; i < path.length && i < 1000; i++) { var k = n.kids[path[i]]; if (!k) break; n = k; }
      return n;
    }
    function pub() {
      if (!room) return;
      room.presence({ role: isT ? 't' : 's', live: isT ? on : false, locked: isT ? locked : false, ne: isT ? noEng : false, sync: syncN }).catch(noop);
    }

    function sendTree(keep) {
      if (!active()) return;
      if (!keep || !curTr) curTr = rid();
      var mt = Core.toMovetext(S.root), it = S.item || {}, parts = [], n = Math.max(1, Math.ceil(mt.length / CH)), i;
      for (i = 0; i < n; i++) parts.push(mt.slice(i * CH, (i + 1) * CH));
      var title = String(it.title || 'Свободная доска').slice(0, 120), type = it.type === 'puzzle' ? 'puzzle' : 'game';
      parts.forEach(function (str, idx) { room.emit('tree', { tr: curTr, i: idx, n: parts.length, s: str, fen: S.root.fen, type: type, title: title }).catch(noop); });
    }
    function sendCur() {
      if (!active() || !curTr) return;
      room.emit('cur', { tr: curTr, path: nodePath(S.cur), dw: drawPayload() }).catch(noop);
    }
    function resendAll() {
      sendTree(true); sendCur();
      if (getEditor() && getEditor().fen) setup({ open: true, fen: getEditor().fen() });
    }
    function treeChanged() {
      if (applying || !active()) return;
      if (!isT && !curTr) return;
      sendTree(false); sendCur();
    }
    function curChanged() {
      if (applying || !active()) return;
      if (!curTr) { if (isT) { sendTree(false); } else return; }
      sendCur();
    }
    function engineBlocked() {
      if (!room || isT || !follow) return false;
      var t = teacherPeer(); return !!(t && t.presence.ne);
    }
    function enforceEngine() {
      if (engineBlocked() && S.engineOn) { S.engineOn = false; stopEngineRun(); S.engineLines = {}; renderEngine(); renderBoard(); renderNavState(); toast('Учитель отключил движок на время урока.'); }
    }
    function drawChanged() { if (applying || !active() || !curTr) return; sendCur(); }
    function itemLoaded() {
      if (!inited || applying) return;
      if (isT) { if (on) { sendTree(false); sendCur(); } return; }
      if (follow && teacherPeer()) { follow = false; syncN++; pub(); bar(); toast('Вы открыли свою запись и отключились от урока.'); }
    }
    function setup(d) { if (!active() && !(isT && on)) return; if (!room) return; room.emit('setup', d).catch(noop); }

    function applyTree(tr, fen, type, title, mt) {
      applying = true;
      try {
        curTr = tr;
        stopEngineRun();
        var r = Core.parseMovetext(fen, mt);
        var item = { id: 'live', type: type, title: title, startFen: fen, text: mt, plies: Core.mainLine(r.root).length, result: '' };
        S.item = item; S.root = r.root; S.cur = r.root; S.mode = 'analyse'; S.solve = null; S.sel = null; S.dots = []; S.hint = null; S.msg = null;
        S.flipped = false;
        if (pend && pend.tr === tr) applyCur(pend);
        renderAll(); scheduleEngine();
      } finally { applying = false; }
    }
    function applyCur(d) {
      if (!Array.isArray(d.path)) return;
      var path = d.path.filter(function (x) { return typeof x === 'number' && x >= 0 && x < 500; });
      S.cur = nodeAt(path); S.sel = null; S.dots = []; S.hint = null; applyDraw(d.dw);
    }
    function onTree(m) {
      var d = m.data;
      if (!d || typeof d.tr !== 'string' || typeof d.s !== 'string' || !accept(m)) return;
      if (d.tr === curTr && !buf[d.tr]) return;
      var n = d.n | 0, i = d.i | 0;
      if (n < 1 || n > 40 || i < 0 || i >= n) return;
      if (Object.keys(buf).length > 6) buf = {};
      var b = buf[d.tr] || (buf[d.tr] = { n: n, parts: [], got: 0, fen: String(d.fen || ''), type: d.type === 'puzzle' ? 'puzzle' : 'game', title: String(d.title || 'Урок').slice(0, 120) });
      if (b.parts[i] === undefined) { b.parts[i] = d.s; b.got++; }
      if (b.got < b.n) return;
      delete buf[d.tr];
      var pl = b.fen.split(' ')[0];
      if (!FEN_PL.test(pl) || !new C().load(b.fen)) return;
      applyTree(d.tr, b.fen, b.type, b.title, b.parts.join(''));
    }
    function onCur(m) {
      var d = m.data;
      if (!d || typeof d.tr !== 'string' || !accept(m)) return;
      if (d.tr !== curTr) { pend = d; return; }
      applying = true;
      try { applyCur(d); renderAll(); scheduleEngine(); } finally { applying = false; }
    }
    function onSetup(m) {
      var d = m.data;
      if (!d || !accept(m)) return;
      if (d.open) {
        var f = String(d.fen || '').split(' '), pl = f[0];
        if (!FEN_PL.test(pl)) return;
        var full = pl + ' ' + (f[1] === 'b' ? 'b' : 'w') + ' ' + (/^[KQkq]{1,4}$/.test(f[2] || '') ? f[2] : '-') + ' - 0 1';
        if (getEditor()) getEditor().setFen(full); else openEditor({ fen: full, live: true });
      } else if (getEditor()) getEditor().close();
    }

    // ---- панель ----
    function bar() {
      var el = $('#livebar'), btn = $('#btn-live');
      if (!el) return;
      // Outside claude.ai there is no live room: the lesson button is hidden (online lessons come in stage 5).
      if (!inited) { btn.hidden = true; el.hidden = true; return; }
      if (!room) { btn.hidden = true; el.hidden = true; return; }
      var students = peersList().filter(function (p) { return !p.isMe && p.presence && p.presence.role === 's'; }).length;
      var html = '', cls = '';
      if (isT) {
        btn.hidden = false; btn.textContent = on ? 'Закончить урок' : 'Начать урок'; btn.classList.toggle('primary', !on);
        if (on) {
          html = '<span class="dot-live"></span><strong>Урок идёт</strong><span>Учеников на странице: ' + students + '.' + (locked ? ' Ходите только вы.' : ' Двигать фигуры могут оба.') + '</span>' +
            '<div class="ban-act"><button class="btn' + (locked ? ' on' : '') + '" data-live="lock" aria-pressed="' + locked + '">Только я</button><button class="btn' + (noEng ? ' on' : '') + '" data-live="noeng" aria-pressed="' + noEng + '" title="Ученик не сможет включить движок">' + (noEng ? 'Движок у ученика выключен' : 'Выключить движок ученику') + '</button></div>';
        }
      } else {
        btn.hidden = true;
        var t = teacherPeer();
        if (t && follow) {
          html = '<span class="dot-live"></span><strong>Идёт урок</strong><span>' + (t.presence.locked ? 'Сейчас ходит только учитель.' : 'Вы видите доску учителя и можете двигать фигуры вместе с ним.') + (t.presence.ne ? ' Движок отключён.' : '') + '</span>' +
            '<div class="ban-act"><button class="btn" data-live="save">Сохранить себе</button><button class="btn" data-live="leave">Отключиться</button></div>';
        } else if (t) {
          html = '<strong>Идёт урок</strong><span>Вы отключены от доски учителя.</span><div class="ban-act"><button class="btn primary" data-live="join">Подключиться</button></div>';
        }
      }
      el.hidden = !html; el.innerHTML = html;
      enforceEngine(); var et = $('#engine-toggle'); if (et) et.disabled = engineBlocked();
      renderNavState();
    }
    function saveLive() {
      if (!S.item) return;
      var book = S.books.filter(function (b) { return b.name === 'Уроки'; })[0];
      if (!book) { book = { id: uid('b'), name: 'Уроки', created: Date.now(), items: [] }; S.books.push(book); }
      var it = { id: uid('i'), type: S.item.type, title: S.item.title, startFen: S.item.startFen, text: Core.toMovetext(S.root), plies: Core.mainLine(S.root).length, result: '' };
      book.items.push(it); Store.put(JSON.parse(JSON.stringify(book)));
      toast('Сохранено в книгу «Уроки»'); renderLibrary();
    }
    function onBarClick(e) {
      var b = e.target.closest('[data-live]'); if (!b) return;
      var a = b.getAttribute('data-live');
      if (a === 'lock') { locked = !locked; pub(); bar(); toast(locked ? 'Ученик пока смотрит, ходите только вы.' : 'Ученик снова может двигать фигуры.'); }
      else if (a === 'noeng') { noEng = !noEng; pub(); bar(); toast(noEng ? 'Движок у ученика выключен.' : 'Ученик снова может включать движок.'); }
      else if (a === 'leave') { follow = false; syncN++; pub(); bar(); }
      else if (a === 'join') { follow = true; syncN++; pub(); bar(); }
      else if (a === 'save') saveLive();
    }
    function toggleLesson() {
      if (!inited) return;
      if (!room) {
        var m = openModal('<h3>Совместная работа</h3><p>Чтобы ученик двигал фигуры вместе с вами, оба открывают эту страницу, войдя в аккаунт Claude. Сейчас такой связи нет.</p>' +
          '<ul class="help"><li>Откройте страницу из своего аккаунта Claude.</li><li>В меню «Поделиться» пригласите ученика по почте и дайте право «Участник» (Contributor). Ученику хватит бесплатного аккаунта.</li><li>Публичная ссылка без входа в аккаунт даёт только просмотр без живой связи.</li></ul>' +
          '<div class="modal-act"><button class="btn primary" data-close>Понятно</button></div>');
        return;
      }
      if (!isT) return;
      on = !on; if (!on) { locked = false; noEng = false; }
      pub(); bar();
      if (on) { syncN++; pub(); curTr = ''; sendTree(false); sendCur(); toast('Урок начат. Ученики на странице увидят вашу доску.'); if (timer) clearInterval(timer); timer = setInterval(function () { if (on) resendAll(); }, 12000); }
      else { if (timer) { clearInterval(timer); timer = null; } toast('Урок закончен.'); }
    }
    async function init() {
      try { if (window.claude && window.claude.use) ctx.setDl(await window.claude.use('downloads')); } catch (e) { ctx.setDl(null); }
      try {
        if (window.claude && window.claude.use) {
          user = await window.claude.use('user');
          room = await window.claude.use('room');
        }
      } catch (e) { room = null; }
      try { isT = user ? !!(await user.canEdit()) : false; } catch (e) { isT = false; }
      inited = true;
      var lb = $('#livebar'); lb.addEventListener('click', onBarClick);
      $('#btn-live').addEventListener('click', toggleLesson);
      if (room) {
        room.on('tree', onTree, noop); room.on('cur', onCur, noop); room.on('setup', onSetup, noop);
        room.onPeers(function (ch) {
          if (isT && on) {
            var need = false;
            ch.joined.forEach(function (p) { if (!p.isMe) need = true; });
            ch.updated.forEach(function (p) {
              if (!p.isMe && p.presence && p.presence.sync && seenSync[p.peer] !== p.presence.sync) { seenSync[p.peer] = p.presence.sync; need = true; }
            });
            if (need) resendAll();
          }
          bar();
        }, noop);
        pub();
      }
      bar();
    }
    return {
      init: init, engineBlocked: engineBlocked, drawChanged: drawChanged, treeChanged: treeChanged, curChanged: curChanged, itemLoaded: itemLoaded, setup: setup, blocked: blocked,
      isOn: function () { return !!room && (isT ? on : (follow && !!teacherPeer())); },
      canSaveSetup: function () { return !room || isT || !active(); }
    };
  })();

  return Live;
}
