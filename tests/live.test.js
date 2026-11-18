// Online lesson: protocol validation and the coach/student session over the in-memory transport.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Core } from '../src/core/index.js';
import * as P from '../src/live/protocol.js';
import { createLessonSession } from '../src/live/session.js';
import { createBusTransport, createMemoryBus } from '../src/live/transport.js';

const START = Core.START;

describe('protocol: validation of network messages', () => {
  const doc = { id: 'abcd1234', fen: START, type: 'game', title: 'Урок' };
  const state = (extra) => Object.assign({ doc, rev: 1, mt: '1. e4 e5', cur: [0, 0], lock: true, eng: false, flip: false }, extra);
  it('accepts a good state and normalizes it', () => {
    const m = P.parseCoachMsg('state', state({ dw: { a: ['e2e4', 'zz99', 5], m: ['d5', '<b>'] }, extra: 1 }));
    expect(m).toMatchObject({ t: 'state', rev: 1, mt: '1. e4 e5', cur: [0, 0], lock: true, eng: false, dw: { a: ['e2e4'], m: ['d5'] } });
  });
  it('rejects wrong types, bad positions, bad paths, bad moves and huge messages', () => {
    expect(P.parseCoachMsg('state', null)).toBeNull();
    expect(P.parseCoachMsg('state', [1])).toBeNull();
    expect(P.parseCoachMsg('state', state({ doc: Object.assign({}, doc, { fen: 'xxx' }) }))).toBeNull();
    expect(P.parseCoachMsg('state', state({ doc: Object.assign({}, doc, { fen: '8/8/8/8/8/8/8/8 w - - 0 1' }) }))).toBeNull(); // no kings
    expect(P.parseCoachMsg('state', state({ doc: Object.assign({}, doc, { id: '../x' }) }))).toBeNull();
    expect(P.parseCoachMsg('state', state({ cur: [0, -1] }))).toBeNull();
    expect(P.parseCoachMsg('state', state({ cur: 'x' }))).toBeNull();
    expect(P.parseCoachMsg('state', state({ rev: 1.5 }))).toBeNull();
    expect(P.parseCoachMsg('state', state({ mt: 'x'.repeat(70000) }))).toBeNull();
    expect(P.parseCoachMsg('mv', { d: 'abcd1234', rev: 2, at: [0], san: '<script>', cur: [0] })).toBeNull();
    expect(P.parseCoachMsg('mv', { d: 'abcd1234', rev: 2, at: [0], san: 'Nf3', cur: [0, 0] })).toMatchObject({ t: 'mv', san: 'Nf3' });
    expect(P.parseCoachMsg('cur', { d: 'abcd1234', rev: 2, path: new Array(700).fill(0) })).toBeNull();
    expect(P.parseCoachMsg('whatever', {})).toBeNull();
    expect(P.parseStudentMsg('mv', { d: 'abcd1234', rev: 1, at: [], san: 'e4', junk: 'x'.repeat(5000) })).toBeNull();
    expect(P.parseStudentMsg('mv', { d: 'abcd1234', rev: 1, at: [], san: 'e4' })).toEqual({ t: 'mv', d: 'abcd1234', rev: 1, at: [], san: 'e4' });
    expect(P.parseStudentMsg('state', { doc })).toBeNull(); // students cannot send the state
  });
  it('mode flags default to the safe side (only the coach moves, no engine)', () => {
    expect(P.parseCoachMsg('mode', {})).toEqual({ t: 'mode', lock: true, eng: false, flip: false });
    expect(P.parseCoachMsg('mode', { lock: 'no', eng: 'yes' })).toEqual({ t: 'mode', lock: true, eng: false, flip: false });
  });
  it('text: control characters are removed and length is clipped (escaping happens when shown)', () => {
    expect(P.cleanText('a\u0000b\nc' + String.fromCharCode(0x2028) + 'd', 100)).toBe('a b c d');
    expect(P.cleanText('x'.repeat(500), 120).length).toBe(120);
    const m = P.parseCoachMsg('state', state({ doc: Object.assign({}, doc, { title: '<img src=x onerror=alert(1)>' }) }));
    expect(m.doc.title).toBe('<img src=x onerror=alert(1)>'); // kept as text; the UI escapes it
    expect(P.cleanPresence({ r: 'c', n: 'Петя\u0007' })).toEqual({ r: 'c', n: 'Петя' });
    expect(P.cleanPresence({ r: 'admin' }).r).toBe('s');
  });
  it('trees from the network: every move must be legal', () => {
    expect(P.parseTree(START, '1. e4 e5 2. Nf3')).not.toBeNull();
    expect(P.parseTree(START, '1. e4 e5 2. Ke3')).toBeNull();
    expect(P.parseTree(START, 42)).toBeNull();
    const root = P.parseTree(START, '1. e4 e5');
    expect(P.applyMoveAt(root, [0, 0], 'Qh5')).not.toBeNull();
    expect(P.applyMoveAt(root, [0, 0], 'Qh4')).toBeNull(); // not legal for white
    expect(P.applyMoveAt(root, [5], 'e4')).toBeNull();     // no such node
  });
  it('the printed tree reads back the same (the move fast path relies on it)', () => {
    const mt = '1. e4! {мой} e5 (1... c5 2. Nf3 (2. c3 d5) d6) 2. Nf3 Nc6 3. Bb5 a6?! 4. Ba4';
    const t1 = Core.toMovetext(P.parseTree(START, mt));
    expect(Core.toMovetext(P.parseTree(START, t1))).toBe(t1);
  });
  it('book comments are not sent; comments the coach writes are', () => {
    const root = P.parseTree(START, '1. e4 {Комментарий из книги} e5 2. Nf3');
    const book = P.collectComments(root);
    expect(P.lessonMovetext(root, book)).toBe('1. e4 e5 2. Nf3');
    root.kids[0].kids[0].comment = 'мой комментарий';
    expect(P.lessonMovetext(root, book)).toBe('1. e4 e5 {мой комментарий} 2. Nf3');
    expect(root.kids[0].comment).toBe('Комментарий из книги'); // the coach still sees it
    expect(P.lessonMovetext(root, null)).toContain('Комментарий из книги');
  });
});

// ---------------------------------------------------------------- session over the memory bus
function makeS(mt, fen) {
  const r = Core.parseMovetext(fen || START, mt || '');
  return { root: r.root, cur: r.root, item: { id: 'x1', type: 'game', title: 'Партия', startFen: fen || START, text: mt || '' }, flipped: false, mode: 'analyse', solve: null, sel: null, dots: [] };
}
function hooks(extra) {
  return Object.assign({ applied: vi.fn(), info: vi.fn(), toast: vi.fn(), engineOff: vi.fn(), applyDraw: vi.fn(), drawPayload: () => undefined, isOwnItem: () => true, ended: vi.fn() }, extra);
}
const text = (S) => Core.toMovetext(S.root);
const path = (S) => P.nodePath(S.cur);

describe('lesson session (coach -> students)', () => {
  let bus, sent, coach, cS, students;
  beforeEach(async () => {
    vi.useFakeTimers();
    bus = createMemoryBus();
    sent = [];
    const post = bus.post;
    bus.post = (m) => { if (m.evt) sent.push(m.ch + ':' + m.evt); post(m); };
    cS = makeS('1. e4 e5');
    coach = createLessonSession({ role: 'c', transport: createBusTransport(bus), S: cS, me: { k: 'c', n: 'Тренер' }, coachName: 'Тренер', hooks: hooks() });
    await coach.start();
    expect(coach.state.hide).toBe(true); // a record with moves ahead opens with the solution hidden
    coach.setHidden(false);              // these tests are about the full tree
    students = [];
    for (const nick of ['Петя', 'Маша']) {
      const S = makeS('');
      const h = hooks();
      const s = createLessonSession({ role: 's', transport: createBusTransport(bus), S, me: { k: nick, n: nick }, hooks: h });
      await s.start();
      students.push({ s, S, h });
    }
    vi.advanceTimersByTime(1100); // hello -> one state for both
  });
  afterEach(() => { vi.useRealTimers(); });

  it('students get the coach\'s board when they join; presence lists everyone', () => {
    for (const { S, s } of students) {
      expect(text(S)).toBe('1. e4 e5');
      expect(S.item.id).toBe('live');
      expect(s.state.synced).toBe(true);
      expect(s.state.coachHere).toBe(true);
    }
    expect(coach.state.members.map((m) => m.n).sort()).toEqual(['Маша', 'Петя', 'Тренер']);
    expect(sent.filter((x) => x === 'c:state').length).toBeLessThanOrEqual(2); // not one per student
  });

  it('a coach move goes as a small "mv" message and lands on every board', () => {
    cS.cur = cS.root.kids[0].kids[0];
    cS.cur = Core.tryMove(cS.cur, 'Nf3').node;
    sent.length = 0;
    coach.treeChanged();
    expect(sent).toEqual(['c:mv']);
    for (const { S } of students) { expect(text(S)).toBe('1. e4 e5 2. Nf3'); expect(path(S)).toEqual([0, 0, 0]); }
  });

  it('variations, comments and navigation are mirrored; current move follows the coach', () => {
    const e4 = cS.root.kids[0];
    cS.cur = Core.tryMove(e4, 'c5').node; coach.treeChanged();               // a variation
    e4.comment = 'Главный ход'; coach.treeChanged();                         // a comment -> 'tree'
    cS.cur = cS.root; coach.curChanged(); vi.advanceTimersByTime(100);       // navigation
    for (const { S } of students) {
      expect(text(S)).toBe('1. e4 {Главный ход} 1... e5 (1... c5)');
      expect(S.cur).toBe(S.root);
    }
  });

  it('by default only the coach moves: student requests are refused', () => {
    const p = students[0];
    expect(p.s.proposeMove({ from: 'g1', to: 'f3' })).toBe(false);
    expect(text(cS)).toBe('1. e4 e5');
  });

  it('when the coach allows it, a student\'s legal move is applied by the coach and reaches everyone', () => {
    coach.setMode({ lock: false });
    const p = students[0], m = students[1];
    expect(p.S.flipped).toBe(false);
    p.S.cur = p.S.root.kids[0].kids[0];
    expect(p.s.proposeMove({ from: 'g1', to: 'f3' })).toBe(true);
    expect(text(cS)).toBe('1. e4 e5 2. Nf3');
    expect(text(m.S)).toBe('1. e4 e5 2. Nf3');
    expect(text(p.S)).toBe('1. e4 e5 2. Nf3');
  });

  it('forged or stale student requests are ignored; a student cannot write to the coach channel', () => {
    coach.setMode({ lock: false });
    const before = text(cS);
    bus.post({ ch: 's', evt: 'mv', payload: { d: coach.state.doc.id, rev: coach.state.rev, at: [0, 0], san: 'Ke3' }, from: 'x', role: 's' }); // illegal
    bus.post({ ch: 's', evt: 'mv', payload: { d: coach.state.doc.id, rev: coach.state.rev - 1, at: [0, 0], san: 'Nf3' }, from: 'x', role: 's' }); // stale
    bus.post({ ch: 's', evt: 'mv', payload: { d: 'zzzz9999', rev: coach.state.rev, at: [0, 0], san: 'Nf3' }, from: 'x', role: 's' }); // other record
    bus.post({ ch: 's', evt: 'mode', payload: { lock: true }, from: 'x', role: 's' }); // not a student request
    expect(text(cS)).toBe(before);
    // a student pretending to be the coach on the coach's channel (the Realtime policies refuse it)
    bus.post({ ch: 'c', evt: 'tree', payload: { d: coach.state.doc.id, rev: 99, mt: '1. d4', cur: [0] }, from: 'x', role: 's' });
    for (const { S } of students) expect(text(S)).toBe(before);
  });

  it('engine: off for students by default; the coach can allow it; board side follows the coach', () => {
    for (const { s, h } of students) { expect(s.state.eng).toBe(false); expect(h.engineOff).toHaveBeenCalled(); }
    coach.setMode({ eng: true });
    cS.flipped = true; coach.flipChanged();
    for (const { s, S } of students) { expect(s.state.eng).toBe(true); expect(S.flipped).toBe(true); }
  });

  it('a lost connection: after reconnecting the student gets the full state again', () => {
    const tr = createBusTransport(bus);
    // re-create Petya with a transport we can break
    const S = makeS('');
    const s = createLessonSession({ role: 's', transport: tr, S, me: { k: 'p2', n: 'Петя' }, hooks: hooks() });
    return s.start().then(() => {
      vi.advanceTimersByTime(1100);
      expect(text(S)).toBe('1. e4 e5');
      tr.drop();
      cS.cur = Core.tryMove(cS.root.kids[0].kids[0], 'Nf3').node; coach.treeChanged();
      cS.cur = Core.tryMove(cS.cur, 'Nc6').node; coach.treeChanged();
      expect(text(S)).toBe('1. e4 e5'); // missed
      tr.restore();
      vi.advanceTimersByTime(1100);
      expect(text(S)).toBe('1. e4 e5 2. Nf3 Nc6');
      expect(path(S)).toEqual([0, 0, 0, 0]);
    });
  });

  it('a gap in the move numbers asks for the state instead of applying a wrong tree', () => {
    const p = students[0];
    const rev = p.s.state.rev;
    bus.post({ ch: 'c', evt: 'mv', payload: { d: coach.state.doc.id, rev: rev + 5, at: [0, 0], san: 'Nf3', cur: [0, 0, 0] }, from: 'c?', role: 'c' });
    expect(text(p.S)).toBe('1. e4 e5');
    vi.advanceTimersByTime(1100);
    expect(text(p.S)).toBe('1. e4 e5'); // the coach's state wins
  });

  it('book comments are not sent when the coach opens a book record', async () => {
    // isOwnItem() says "no" for a record from a book
    const c2bus = createMemoryBus();
    const c2S = makeS('1. d4 {текст книги} d5');
    const c2 = createLessonSession({ role: 'c', transport: createBusTransport(c2bus), S: c2S, me: { k: 'c', n: 'Т' }, hooks: hooks({ isOwnItem: () => false }) });
    await c2.start();
    c2.setHidden(false);
    const sS = makeS('');
    const s2 = createLessonSession({ role: 's', transport: createBusTransport(c2bus), S: sS, me: { k: 's', n: 'С' }, hooks: hooks() });
    await s2.start();
    vi.advanceTimersByTime(1100);
    expect(text(sS)).toBe('1. d4 d5');
    expect(text(c2S)).toContain('текст книги');
  });

  it('a new record opened by the coach replaces the board; the end of the lesson keeps every record', () => {
    cS.cur = Core.tryMove(cS.root.kids[0].kids[0], 'Nf3').node; coach.treeChanged();
    coach.itemLeaving(); // the app calls it before it opens another record
    const r = Core.parseMovetext('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', '1. Rd8#');
    cS.item = { id: 'p1', type: 'puzzle', title: 'Задача', startFen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' };
    cS.root = r.root; cS.cur = r.root;
    coach.docChanged();
    const p = students[0];
    expect(p.S.item.type).toBe('puzzle');
    expect(text(p.S)).toBe(''); // the puzzle opens with the solution hidden
    coach.setHidden(false);
    expect(text(p.S)).toBe('1. Rd8#');
    coach.end();
    for (const { h } of students) expect(h.ended).toHaveBeenCalledWith('ended');
    const snap = p.s.snapshot();
    expect(snap.docs.map((d) => d.mt)).toEqual(['1. e4 e5 2. Nf3', '1. Rd8#']);
    expect(snap.participants).toEqual(expect.arrayContaining(['Петя', 'Маша', 'Тренер']));
    expect(coach.snapshot().docs.map((d) => d.mt)).toEqual(['1. e4 e5 2. Nf3', '1. Rd8#']);
  });
});

// ---------------------------------------------------------------- Supabase transport (fake client)
import { createSupabaseTransport } from '../src/live/transport.js';
import { lessonsMissing } from '../src/live/backend.js';

function fakeRealtime() {
  const channels = [];
  return {
    channels,
    realtime: { setAuth: vi.fn(async () => {}) },
    channel(topic, opts) {
      const ch = { topic, opts, handlers: [], sent: [], tracked: null, removed: false, status: null,
        on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; },
        subscribe(cb) { this.statusCb = cb; return this; },
        send(m) { this.sent.push(m); return Promise.resolve('ok'); },
        track(meta) { this.tracked = meta; return Promise.resolve('ok'); },
        presenceState() { return { a: [{ r: 'c', n: 'Тренер' }], b: [{ r: 's', n: 'Петя' }] }; },
        emit(type, payload) { this.handlers.filter((h) => h.type === type).forEach((h) => h.cb(payload)); }
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.removed = true; }
  };
}

describe('Supabase transport', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  it('uses two private channels per lesson and routes messages by role', async () => {
    const client = fakeRealtime();
    const t = createSupabaseTransport(client, ID);
    const got = { coach: [], student: [], presence: [], status: [] };
    await t.open({ role: 's', meta: { r: 's', n: 'Петя', k: 's1' },
      onCoach: (e, p) => got.coach.push(e), onStudent: (e) => got.student.push(e), onPresence: (l) => got.presence.push(l), onStatus: (s) => got.status.push(s) });
    expect(client.realtime.setAuth).toHaveBeenCalled();
    const [c, s] = client.channels;
    expect(c.topic).toBe('lesson:' + ID + ':c');
    expect(s.topic).toBe('lesson:' + ID + ':s');
    expect(c.opts.config.private).toBe(true);
    expect(s.opts.config.private).toBe(true);
    expect(s.opts.config.presence.key).toBe('s1');
    c.statusCb('SUBSCRIBED'); expect(got.status.at(-1)).toBe('connecting');
    s.statusCb('SUBSCRIBED'); expect(got.status.at(-1)).toBe('online');
    expect(s.tracked).toEqual({ r: 's', n: 'Петя', k: 's1' });
    c.emit('broadcast', { event: 'mv', payload: { x: 1 } });
    s.emit('broadcast', { event: 'mv', payload: { x: 1 } }); // other students' requests are not for students
    s.emit('presence', {});
    expect(got.coach).toEqual(['mv']);
    expect(got.student).toEqual([]);
    expect(got.presence[0].map((m) => m.n)).toEqual(['Тренер', 'Петя']);
    t.sendStudent('hello', {});
    expect(s.sent).toEqual([{ type: 'broadcast', event: 'hello', payload: {} }]);
    s.statusCb('CHANNEL_ERROR', new Error('Unauthorized: you do not have permissions to read from this Channel topic'));
    expect(got.status.at(-1)).toBe('denied');
    t.close();
    expect(c.removed && s.removed).toBe(true);
    t.sendCoach('mv', {}); // after close: nothing is sent
    expect(c.sent).toEqual([]);
  });
  it('the coach receives students\' requests and sends on the coach channel', async () => {
    const client = fakeRealtime();
    const t = createSupabaseTransport(client, ID);
    const got = [];
    await t.open({ role: 'c', meta: { r: 'c', n: 'Т', k: 'coach' }, onCoach: () => got.push('coach?'), onStudent: (e) => got.push(e), onPresence: () => {}, onStatus: () => {} });
    const [c, s] = client.channels;
    s.emit('broadcast', { event: 'mv', payload: {} });
    c.emit('broadcast', { event: 'state', payload: {} });
    expect(got).toEqual(['mv']);
    t.sendCoach('state', { a: 1 });
    expect(c.sent[0]).toEqual({ type: 'broadcast', event: 'state', payload: { a: 1 } });
  });
  it('recognizes "the cloud is not updated yet" errors', () => {
    expect(lessonsMissing(new Error('Could not find the function public.start_lesson(p_students) in the schema cache'))).toBe(true);
    expect(lessonsMissing({ code: 'PGRST202' })).toBe(true);
    expect(lessonsMissing(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('lesson session: "Решение: скрыто / показано"', () => {
  const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
  let bus, cS, coach, sS, stu, wire;
  beforeEach(async () => {
    vi.useFakeTimers();
    bus = createMemoryBus();
    wire = [];
    const post = bus.post;
    bus.post = (m) => { if (m.ch === 'c' && m.payload) wire.push(JSON.stringify(m.payload)); post(m); };
    cS = makeS('1. Rd8# (1. Rd7 h6 2. Rd8+) 1-0', FEN);
    cS.item.type = 'puzzle';
    coach = createLessonSession({ role: 'c', transport: createBusTransport(bus), S: cS, me: { k: 'c', n: 'Т' }, hooks: hooks({ isOwnItem: () => false }) });
    await coach.start();
    sS = makeS('');
    stu = createLessonSession({ role: 's', transport: createBusTransport(bus), S: sS, me: { k: 's', n: 'С' }, hooks: hooks() });
    await stu.start();
    vi.advanceTimersByTime(1100);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('hidden by default for a record with moves ahead: the student gets no future moves at all', () => {
    expect(coach.state.hide).toBe(true);
    expect(stu.state.hide).toBe(true);
    expect(sS.item.type).toBe('puzzle');
    expect(text(sS)).toBe('');
    // nothing of the solution went over the wire (not even in the full state)
    expect(wire.join(' ')).not.toMatch(/Rd8|Rd7/);
    // the coach's own list shows the same part
    expect(Object.keys(coach.visibleIds())).toEqual([String(cS.root.id)]);
  });

  it('"показано" sends the whole tree at once; "скрыто" takes it back', () => {
    coach.setHidden(false);
    expect(stu.state.hide).toBe(false);
    expect(text(sS)).toBe('1. Rd8# (1. Rd7 h6 2. Rd8+)');
    expect(coach.visibleIds()).toBeNull();
    coach.setHidden(true);
    expect(text(sS)).toBe('');
    expect(stu.state.hide).toBe(true);
  });

  it('while hidden: moves up to the current one are shown; moves made in the lesson are shown', () => {
    // the coach steps into the variation: that path becomes visible, the main solution does not
    cS.cur = cS.root.kids[1].kids[0]; coach.curChanged(); vi.advanceTimersByTime(100);
    expect(text(sS)).toBe('1. Rd7 h6');
    expect(P.nodePath(sS.cur)).toEqual([0, 0]);
    // back to the start: hidden again
    cS.cur = cS.root; coach.curChanged(); vi.advanceTimersByTime(100);
    expect(text(sS)).toBe('');
    // a new move made in the lesson stays visible
    cS.cur = Core.tryMove(cS.root, 'g3').node; coach.treeChanged();
    cS.cur = cS.root; coach.curChanged(); vi.advanceTimersByTime(100);
    expect(text(sS)).toBe('1. g3');
  });

  it("a student's request uses the student's (visible) tree; guessing the solution reveals that move only", () => {
    coach.setMode({ lock: false });
    cS.cur = Core.tryMove(cS.root, 'g3').node; coach.treeChanged();         // visible: 1. g3
    cS.cur = cS.root; coach.curChanged(); vi.advanceTimersByTime(100);
    expect(text(sS)).toBe('1. g3');
    sS.cur = sS.root;
    stu.proposeMove({ from: 'd1', to: 'd8' });                                // the right move
    expect(cS.cur).toBe(cS.root.kids[0]);                                     // the coach's existing node
    expect(text(sS)).toBe('1. Rd8# (1. g3)');
    expect(text(sS)).not.toMatch(/Rd7/);
    expect(text(cS)).toBe('1. Rd8# (1. Rd7 h6 2. Rd8+) (1. g3)');            // the coach's tree is untouched
  });

  it('after the lesson: the coach keeps the full record, the student what was shown', () => {
    cS.cur = cS.root.kids[0]; coach.curChanged(); vi.advanceTimersByTime(100);
    coach.end();
    expect(coach.snapshot().docs[0].mt).toBe('1. Rd8# (1. Rd7 h6 2. Rd8+)');
    expect(stu.snapshot().docs[0].mt).toBe('1. Rd8#');
  });

  it('protocol: the "view" message is validated like the others', () => {
    expect(P.parseCoachMsg('view', { d: 'abcd1234', rev: 3, hide: true, mt: '', cur: [] })).toMatchObject({ t: 'view', hide: true });
    expect(P.parseCoachMsg('view', { d: 'abcd1234', rev: 3, hide: 'yes', mt: '', cur: [] })).toBeNull();
    expect(P.parseCoachMsg('view', { d: 'abcd1234', rev: 3, hide: false, mt: 5, cur: [] })).toBeNull();
    expect(P.parseCoachMsg('view', { d: 'abcd1234', rev: 3, hide: false, mt: 'x'.repeat(70000), cur: [] })).toBeNull();
    expect(P.parseCoachMsg('state', { doc: { id: 'abcd1234', fen: FEN }, rev: 1, mt: '', cur: [], hide: 1 }).hide).toBe(false);
    expect(P.parseStudentMsg('view', { d: 'abcd1234', rev: 1, at: [], hide: false })).toBeNull(); // students cannot switch it
  });
});
