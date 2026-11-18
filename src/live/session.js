// Online lesson session: the coach's board is the source of truth, students follow it.
// No DOM here: the app passes its state object S and a few hooks, so the whole exchange can be
// tested in Node with the in-memory transport (tests/live.test.js).
//
// Coach -> students ('c' channel): state (everything, only when someone (re)connects or a new
//   record is opened), mv (one move: tiny), tree (other edits: movetext), cur (current move,
//   arrows), mode (who moves, engine, board side), end.
// Students -> coach ('s' channel): hello (please send the state), mv / go (only when the coach
//   lets students move). The coach checks every request with chess.js and applies it; students
//   never apply each other's requests, so every board stays identical to the coach's.
import { Core } from '../core/index.js';
import { Chess } from '../core/chess.js';
import * as P from './protocol.js';

/**
 * @param {{ role: 'c'|'s', transport: any, S: any, me: {k: string, n: string}, coachName?: string, hooks: any }} o
 * hooks: applied(kind), info(), toast(text), engineOff(), applyDraw(dw), drawPayload(), isOwnItem(), ended(reason)
 */
export function createLessonSession(o) {
  var S = o.S, T = o.transport, H = o.hooks, isCoach = o.role === 'c';
  var st = {
    role: o.role, status: 'connecting', open: false, members: [], coachHere: false,
    lock: true, eng: false, rev: 0, doc: null, synced: false, coach: o.coachName || '', ended: false
  };
  var mirror = null, lastMt = '', bookComments = null, applying = false;
  var docs = {}, order = [], seen = {};
  var curTimer = null, stateTimer = null, lastState = 0, lastHello = 0;
  if (o.me && o.me.n) seen[o.me.n] = true;

  function draw() { return H.drawPayload ? H.drawPayload() : undefined; }
  function snapshotDoc() {
    if (st.doc && docs[st.doc.id] && S.root) {
      docs[st.doc.id].mt = Core.toMovetext(S.root);
      docs[st.doc.id].fen = S.root.fen;
    }
  }
  function addDoc(d, extra) {
    if (!docs[d.id]) { docs[d.id] = Object.assign({ id: d.id, title: d.title, type: d.type, fen: d.fen, mt: '' }, extra || {}); order.push(d.id); }
  }

  // ------------------------------------------------------------ coach
  function statePayload() {
    return { doc: st.doc, rev: st.rev, mt: lastMt, cur: P.nodePath(S.cur), dw: draw(), lock: st.lock, eng: st.eng, flip: !!S.flipped, coach: st.coach };
  }
  function sendState() {
    clearTimeout(stateTimer); stateTimer = null; lastState = Date.now();
    if (st.open && st.doc) T.sendCoach('state', statePayload());
  }
  // many students may say hello at once (after a network break): one state message for all
  function scheduleState() {
    if (stateTimer) return;
    stateTimer = setTimeout(sendState, Math.max(200, 1000 - (Date.now() - lastState)));
  }
  // the coach opened another record (or started the lesson). The previous record was saved by
  // itemLeaving(), called before the app replaced its tree.
  function docChanged() {
    if (!isCoach || !st.open) return;
    var it = S.item;
    st.doc = { id: P.docId(), fen: S.root.fen, type: it && it.type === 'puzzle' ? 'puzzle' : 'game', title: P.cleanText(it ? it.title : '', P.LIMITS.title) || 'Свободная доска' };
    addDoc(st.doc, { recorded: !!(it && it.recorded), mt: Core.toMovetext(S.root) });
    // a book's own comments are not sent to students (only the coach's)
    bookComments = H.isOwnItem && H.isOwnItem() ? null : P.collectComments(S.root);
    lastMt = P.lessonMovetext(S.root, bookComments);
    if (lastMt.length > P.LIMITS.bigMsg - 2000) { H.toast('Запись слишком большая для урока: ученики увидят только позицию.'); lastMt = ''; }
    mirror = P.parseTree(st.doc.fen, lastMt);
    st.rev++;
    sendState();
  }
  function treeChanged() {
    if (!isCoach || !st.open || applying || !st.doc) return;
    var mt = P.lessonMovetext(S.root, bookComments);
    if (mt === lastMt) { curChanged(); return; }
    if (mt.length > P.LIMITS.bigMsg - 2000) return;
    st.rev++;
    var c = S.cur, one = null;
    // the usual case — one new move — goes as a tiny 'mv' message
    if (mirror && c && c.parent && c.san) {
      var at = P.nodePath(c.parent);
      if (P.applyMoveAt(mirror, at, c.san) && Core.toMovetext(mirror) === mt) one = { at: at, san: c.san };
    }
    lastMt = mt;
    clearTimeout(curTimer);
    if (one) T.sendCoach('mv', { d: st.doc.id, rev: st.rev, at: one.at, san: one.san, cur: P.nodePath(S.cur), dw: draw() });
    else {
      mirror = P.parseTree(st.doc.fen, mt);
      T.sendCoach('tree', { d: st.doc.id, rev: st.rev, mt: mt, cur: P.nodePath(S.cur), dw: draw() });
    }
  }
  function curChanged() {
    if (!st.open || applying || !st.doc) return;
    if (isCoach) {
      clearTimeout(curTimer);
      curTimer = setTimeout(function () { if (st.open && st.doc) T.sendCoach('cur', { d: st.doc.id, rev: st.rev, path: P.nodePath(S.cur), dw: draw() }); }, 60);
    } else if (st.synced && !st.lock) {
      T.sendStudent('go', { d: st.doc.id, rev: st.rev, at: P.nodePath(S.cur) });
    }
  }
  function sendMode() { if (isCoach && st.open) T.sendCoach('mode', { lock: st.lock, eng: st.eng, flip: !!S.flipped }); }
  function onStudent(evt, payload) {
    var m = P.parseStudentMsg(evt, payload);
    if (!m || !st.doc) return;
    if (m.t === 'hello') { scheduleState(); return; }
    // the coach decides: requests only when students may move, and only for the current version
    if (st.lock || m.d !== st.doc.id || m.rev !== st.rev) return;
    var at = P.nodeAt(S.root, m.at);
    if (!at) return;
    if (m.t === 'go') {
      applying = true;
      try { S.cur = at; S.sel = null; S.dots = []; H.applied('cur'); } finally { applying = false; }
      curChanged();
      return;
    }
    var g = new Chess(at.fen), mv = g.move(m.san);
    if (!mv) return; // not legal
    applying = true;
    try { S.cur = Core.addChild(at, mv.san, g.fen()); S.sel = null; S.dots = []; H.applied('move'); } finally { applying = false; }
    treeChanged();
  }

  // ------------------------------------------------------------ student
  function resync() {
    var t = Date.now();
    if (t - lastHello < 1500) return;
    lastHello = t;
    T.sendStudent('hello', {});
  }
  function setCur(path, dw) {
    S.cur = P.nodeAt(S.root, path) || S.root; S.sel = null; S.dots = []; S.hint = null;
    if (H.applyDraw) H.applyDraw(dw);
  }
  function applyMode(m) {
    st.lock = m.lock; st.eng = m.eng; S.flipped = m.flip;
    if (!st.eng && H.engineOff) H.engineOff();
  }
  function syncItem() {
    if (S.item && S.item.id === 'live') { S.item.text = Core.toMovetext(S.root); S.item.plies = Core.mainLine(S.root).length; }
  }
  function applyState(m) {
    var root = P.parseTree(m.doc.fen, m.mt);
    if (!root) return; // an illegal move somewhere: the whole message is rejected
    if (st.doc && st.doc.id !== m.doc.id) snapshotDoc();
    st.doc = m.doc; st.rev = m.rev; st.synced = true;
    if (m.coach) st.coach = m.coach;
    addDoc(m.doc);
    S.item = { id: 'live', type: m.doc.type, title: m.doc.title, startFen: m.doc.fen, text: '', plies: 0, result: '' };
    S.root = root; S.mode = 'analyse'; S.solve = null;
    setCur(m.cur, m.dw);
    applyMode(m);
    syncItem();
    H.applied('state');
  }
  function onCoach(evt, payload) {
    var m = P.parseCoachMsg(evt, payload);
    if (!m || isCoach) return;
    if (m.t === 'end') { finish('ended'); return; }
    if (m.t === 'mode') { applyMode(m); H.applied('mode'); return; }
    if (m.t === 'state') { applyState(m); return; }
    if (!st.synced || !st.doc || m.d !== st.doc.id) { resync(); return; }
    if (m.t === 'cur') {
      if (m.rev !== st.rev) { if (m.rev > st.rev) resync(); return; }
      setCur(m.path, m.dw); H.applied('cur'); return;
    }
    if (m.rev !== st.rev + 1) { if (m.rev > st.rev) resync(); return; } // a message was lost
    if (m.t === 'mv') {
      if (!P.applyMoveAt(S.root, m.at, m.san)) { resync(); return; }
    } else {
      var root = P.parseTree(st.doc.fen, m.mt);
      if (!root) { resync(); return; }
      S.root = root;
    }
    st.rev = m.rev;
    setCur(m.cur, m.dw);
    syncItem();
    H.applied('tree');
  }
  // the student's move: a request to the coach; the board changes when the coach confirms it
  function proposeMove(mv) {
    if (isCoach || !st.open || !st.synced || st.lock) return false;
    var g = new Chess(S.cur.fen), m = g.move(mv);
    if (m) T.sendStudent('mv', { d: st.doc.id, rev: st.rev, at: P.nodePath(S.cur), san: m.san });
    return true;
  }

  // ------------------------------------------------------------ both
  function onStatus(s) {
    var was = st.status;
    st.status = s;
    if (s === 'online' && was !== 'online') {
      if (isCoach) { if (st.doc) scheduleState(); } else { lastHello = 0; resync(); }
    }
    H.info();
  }
  function onPresence(list) {
    var was = st.coachHere;
    st.members = (list || []).map(P.cleanPresence).filter(Boolean);
    st.coachHere = st.members.some(function (m) { return m.r === 'c'; });
    st.members.forEach(function (m) { seen[m.n] = true; });
    if (!isCoach && st.coachHere && !was && st.open) { lastHello = 0; resync(); }
    H.info();
  }
  function close() {
    if (!st.open) return;
    snapshotDoc();
    st.open = false;
    clearTimeout(curTimer); clearTimeout(stateTimer); stateTimer = null;
    try { T.close(); } catch (e) { /* already closed */ }
  }
  function finish(reason) {
    if (st.ended) return;
    close();
    st.ended = true;
    if (H.ended) H.ended(reason);
  }
  function snapshot() {
    snapshotDoc();
    return {
      coach: st.coach, participants: Object.keys(seen),
      docs: order.map(function (id) { return docs[id]; }).filter(function (d) { return d && (d.mt || d.fen !== Core.START); })
    };
  }

  return {
    state: st,
    start: async function () {
      st.open = true;
      await T.open({ role: o.role, meta: { r: o.role, n: P.cleanText(o.me && o.me.n, P.LIMITS.nick) || (isCoach ? 'Тренер' : 'Ученик'), k: (o.me && o.me.k) || '' },
        onCoach: onCoach, onStudent: onStudent, onPresence: onPresence, onStatus: onStatus });
      if (isCoach) docChanged();
    },
    docChanged: docChanged, treeChanged: treeChanged, curChanged: curChanged,
    itemLeaving: function () { if (st.open) snapshotDoc(); },
    setMode: function (m) {
      if (!isCoach) return;
      if (typeof m.lock === 'boolean') st.lock = m.lock;
      if (typeof m.eng === 'boolean') st.eng = m.eng;
      sendMode();
    },
    flipChanged: sendMode,
    proposeMove: proposeMove,
    // coach: end for everyone; student: leave
    end: function () { if (isCoach && st.open) T.sendCoach('end', {}); finish(isCoach ? 'ended' : 'left'); },
    snapshot: snapshot,
    resync: function () { lastHello = 0; resync(); }
  };
}
