import { describe, it, expect } from 'vitest';
import { normalizeCode, errorText } from '../src/sync/code.js';
import { readConfig } from '../src/sync/config.js';
import { mergeStat, studentMovetext, itemToRow, setFromBook, mergeRemoteSet, statToRow, rowToStat, summarize, isRemoteBook } from '../src/sync/model.js';
import { createQueue } from '../src/sync/queue.js';
import { createApi } from '../src/sync/api.js';
import { createSync } from '../src/sync/sync.js';

const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const T = Date.UTC(2026, 10, 14, 12, 0, 0);

describe('config', () => {
  it('is disabled without variables and enabled with a Supabase URL and key', () => {
    expect(readConfig({}).enabled).toBe(false);
    expect(readConfig({ VITE_SUPABASE_URL: 'https://example.com', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) }).enabled).toBe(false);
    const c = readConfig({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co/', VITE_SUPABASE_ANON_KEY: 'eyJ' + 'x'.repeat(40) });
    expect(c).toMatchObject({ enabled: true, url: 'https://abcdefgh.supabase.co' });
  });
});

describe('invite codes', () => {
  it('normalizes spacing, case and Cyrillic look-alikes', () => {
    expect(normalizeCode(' abcd efgh jkmn ')).toEqual({ code: 'ABCD-EFGH-JKMN', valid: true });
    expect(normalizeCode('АВСD-ЕFGH-JКМN')).toEqual({ code: 'ABCD-EFGH-JKMN', valid: true }); // Cyrillic А В С Е К М
    expect(normalizeCode('abcd-efgh-jk').valid).toBe(false);
    expect(normalizeCode('ABCD-EFGH-JK0O').valid).toBe(false); // 0 and O are not in the alphabet
  });
  it('explains errors in plain words', () => {
    expect(errorText('code_locked')).toMatch(/новый код/);
    expect(errorText('weird')).toMatch(/weird/);
  });
});

describe('progress merge rule', () => {
  const a = { n: 3, last: T, box: 2, res: 'clean' };
  it('more attempts wins; tie -> later attempt; otherwise keep local', () => {
    expect(mergeStat(a, { n: 4, last: T - 1 })).toMatchObject({ n: 4 });
    expect(mergeStat(a, { n: 2, last: T + 999 })).toBe(a);
    expect(mergeStat(a, { n: 3, last: T + 1 })).toMatchObject({ last: T + 1 });
    expect(mergeStat(a, { n: 3, last: T })).toBe(a);
    expect(mergeStat(null, a)).toBe(a);
    expect(mergeStat(a, null)).toBe(a);
  });
  it('is the same in both directions (order of devices does not matter)', () => {
    const b = { n: 3, last: T + 5 };
    expect(mergeStat(a, b)).toBe(b);
    expect(mergeStat(b, a)).toBe(b);
  });
  it('round-trips stats through cloud rows', () => {
    const st = { n: 2, ok: 2, clean: 1, fail: 0, box: 1, last: T, due: T + 864e5, res: 'clean' };
    const row = statToRow('i1', st);
    expect(row).toEqual({ item_id: 'i1', n: 2, ok: 2, clean: 1, fail: 0, box: 1, last: T, due: T + 864e5, res: 'clean' });
    expect(rowToStat({ ...row, last_at: new Date(T).toISOString(), due_at: new Date(T + 864e5).toISOString() })).toEqual(st);
  });
});

describe('data mapping for sets', () => {
  const book = { id: 'b1', name: 'Практикум по тактике', items: [
    { id: 'x1', type: 'puzzle', title: 'Задача 1', startFen: FEN, text: '1. Rd8# {из книги: красивый мат}', note: 'Текст из книги' },
    { id: 'x2', type: 'game', title: 'Партия', startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', text: '1. e4! {мой комментарий} e5 (1... c5 2. Nf3) 2. Nf3' }
  ] };
  it('sends moves, variations and NAGs but no comments by default (book text stays home)', () => {
    expect(studentMovetext(book.items[1], false)).toBe('1. e4! e5 (1... c5 2. Nf3) 2. Nf3');
    const row = itemToRow(book.items[0], 0, {});
    expect(row).toEqual({ position: 0, kind: 'puzzle', title: 'Задача 1', start_fen: FEN, movetext: '1. Rd8#' });
    expect(JSON.stringify(row)).not.toMatch(/книг/);
  });
  it('includes comments only when the coach ticks "my comments"', () => {
    expect(itemToRow(book.items[1], 1, { includeComments: true }).movetext).toContain('{мой комментарий}');
  });
  it('fills the source automatically from the book', () => {
    const s = setFromBook(book, book.items, { title: '' });
    expect(s.title).toBe('Практикум по тактике');
    expect(s.source).toBe('Практикум по тактике');
    expect(s.rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it('builds the student book from a set and merges progress both ways', () => {
    const set = { id: 'S1', title: 'Мат в 1', source: 'Пример', created_at: new Date(T).toISOString(), set_items: [
      { id: 'i2', position: 1, kind: 'puzzle', title: 'Б', start_fen: FEN, movetext: '1. Rd8#' },
      { id: 'i1', position: 0, kind: 'puzzle', title: 'А', start_fen: FEN, movetext: '1. Rd8#' }
    ] };
    const local = { id: 'set-S1', created: 5, items: [
      { id: 'i1', stat: { n: 5, ok: 5, box: 3, last: T, res: 'clean' }, solved: true },
      { id: 'i2', stat: { n: 1, ok: 0, box: 0, last: T, res: 'fail' } }
    ] };
    const remote = [
      { item_id: 'i1', n: 2, ok: 2, box: 1, last_at: new Date(T - 5000).toISOString(), res: 'clean' },
      { item_id: 'i2', n: 3, ok: 3, box: 2, last_at: new Date(T + 5000).toISOString(), res: 'clean' }
    ];
    const r = mergeRemoteSet(local, set, remote, T);
    expect(r.book.id).toBe('set-S1');
    expect(isRemoteBook(r.book)).toBe(true);
    expect(r.book.created).toBe(5);
    expect(r.book.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(r.book.items[0].stat.n).toBe(5);      // local newer -> kept and pushed
    expect(r.book.items[1].stat.n).toBe(3);      // cloud newer -> taken
    expect(r.book.items[1].solved).toBe(true);
    expect(r.toPush.map((x) => x.item_id)).toEqual(['i1']);
    expect(r.book.items[0]).toMatchObject({ type: 'puzzle', startFen: FEN, text: '1. Rd8#', plies: 1 });
  });

  it('summarizes progress for the coach', () => {
    const s = summarize({
      students: [{ id: 'a', nick: 'Арман', bound_at: 'x', last_seen_at: new Date(T).toISOString() }, { id: 'b', nick: 'Бота' }],
      assignments: [{ set_id: 'S', student_id: 'a' }],
      items: [{ id: '1', set_id: 'S' }, { id: '2', set_id: 'S' }, { id: '3', set_id: 'S' }, { id: '4', set_id: 'S' }],
      progress: [
        { student_id: 'a', item_id: '1', n: 1, res: 'clean', due_at: new Date(T + 864e5).toISOString() },
        { student_id: 'a', item_id: '2', n: 2, res: 'help', due_at: new Date(T - 1).toISOString() },
        { student_id: 'a', item_id: '3', n: 1, res: 'fail', due_at: new Date(T).toISOString() }
      ]
    }, T);
    expect(s[0]).toMatchObject({ nick: 'Арман', joined: true, sets: 1, total: 4, solved: 2, clean: 1, failed: 1, due: 2, untouched: 1 });
    expect(s[1]).toMatchObject({ nick: 'Бота', joined: false, sets: 0, total: 0 });
  });
});

describe('sync queue', () => {
  function memory() { let v = {}; return { load: () => JSON.parse(JSON.stringify(v)), save: (x) => { v = JSON.parse(JSON.stringify(x)); }, get: () => v }; }

  it('keeps one newest row per item and survives a restart', () => {
    const m = memory();
    const q = createQueue(m);
    q.enqueue({ item_id: 'i1', n: 1, last: T });
    q.enqueue({ item_id: 'i1', n: 2, last: T + 1 });
    q.enqueue({ item_id: 'i1', n: 1, last: T + 9 }); // older by attempts: ignored
    q.enqueue({ item_id: 'i2', n: 1, last: T });
    expect(q.size()).toBe(2);
    const q2 = createQueue(m); // app restarted offline
    expect(q2.rows().find((r) => r.item_id === 'i1').n).toBe(2);
  });

  it('removes rows after a successful send and keeps them on failure', async () => {
    const q = createQueue(memory());
    q.enqueue({ item_id: 'a', n: 1, last: T });
    q.enqueue({ item_id: 'b', n: 1, last: T });
    const bad = await q.flush(async () => { throw new Error('offline'); });
    expect(bad.error.message).toBe('offline');
    expect(q.size()).toBe(2);
    const sent = [];
    const ok = await q.flush(async (rows) => { sent.push(...rows); });
    expect(ok.sent).toBe(2);
    expect(sent.map((r) => r.item_id).sort()).toEqual(['a', 'b']);
    expect(q.size()).toBe(0);
  });

  it('does not drop a row that changed while it was being sent', async () => {
    const q = createQueue(memory());
    q.enqueue({ item_id: 'a', n: 1, last: T });
    const r = await q.flush(async () => { q.enqueue({ item_id: 'a', n: 2, last: T + 1 }); });
    expect(r.sent).toBe(1);
    expect(q.rows()).toEqual([{ item_id: 'a', n: 2, last: T + 1 }]);
  });

  it('sends in batches', async () => {
    const q = createQueue({ batchSize: 2 });
    for (let i = 0; i < 5; i++) q.enqueue({ item_id: 'i' + i, n: 1, last: T });
    const sizes = [];
    await q.flush(async (rows) => { sizes.push(rows.length); });
    expect(sizes).toEqual([2, 2, 1]);
  });
});

// Minimal fake of the supabase-js client: records calls, returns scripted results.
function fakeClient(opts) {
  opts = opts || {};
  const calls = [];
  let session = opts.session || null;
  const table = (name) => {
    const q = { name, ops: [] };
    const chain = new Proxy({}, {
      get(_, op) {
        if (op === 'then') {
          const res = (opts.tables && opts.tables[name]) || { data: [], error: null };
          return (ok, bad) => Promise.resolve(typeof res === 'function' ? res(q) : res).then(ok, bad);
        }
        return (...args) => { q.ops.push([op, ...args]); return chain; };
      }
    });
    calls.push(['from', q]);
    return chain;
  };
  return {
    calls,
    from: table,
    rpc: async (fn, args) => { calls.push(['rpc', fn, args]); return (opts.rpc && opts.rpc(fn, args)) || { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => { calls.push(['anon']); if (opts.anonError) return { error: { message: 'disabled' } }; session = { user: { id: 'anon-1' } }; return { data: { session }, error: null }; },
      signInWithPassword: async (c) => { calls.push(['password', c.email]); return { data: {}, error: null }; },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
}

describe('API: sign-in with a code', () => {
  it('signs in anonymously first, then redeems the normalized code', async () => {
    const c = fakeClient({ rpc: (fn) => fn === 'redeem_invite_code' ? { data: { ok: true, student_id: 's1', nick: 'Арман' }, error: null } : null });
    const api = createApi(c);
    const r = await api.studentJoin('abcd efgh jkmn');
    expect(r).toMatchObject({ ok: true, nick: 'Арман' });
    expect(c.calls.filter((x) => x[0] !== 'from').map((x) => x[0] === 'rpc' ? x[1] + ':' + x[2].p_code : x[0])).toEqual(['anon', 'redeem_invite_code:ABCD-EFGH-JKMN']);
  });
  it('reuses an existing session and rejects malformed codes without calling the server', async () => {
    const c = fakeClient({ session: { user: { id: 'u' } }, rpc: () => ({ data: { ok: false, error: 'code_locked' }, error: null }) });
    const api = createApi(c);
    expect(await api.studentJoin('12')).toEqual({ ok: false, error: 'invalid_code' });
    expect(c.calls.length).toBe(0);
    expect(await api.studentJoin('ABCD-EFGH-JKMN')).toEqual({ ok: false, error: 'code_locked' });
    expect(c.calls.some((x) => x[0] === 'anon')).toBe(false);
  });
  it('reports when anonymous sign-in is disabled in the project', async () => {
    const api = createApi(fakeClient({ anonError: true }));
    expect(await api.studentJoin('ABCD-EFGH-JKMN')).toMatchObject({ ok: false, error: 'anon_failed' });
  });
  it('turns Supabase errors into exceptions', async () => {
    const api = createApi(fakeClient({ rpc: () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) }));
    await expect(api.whoami()).rejects.toThrow(/permission denied/);
  });
  it('creates a set with items and assignments in the right shape', async () => {
    const inserted = {};
    const c = fakeClient({ tables: {
      sets: (q) => { inserted.sets = q.ops; return { data: { id: 'NEW' }, error: null }; },
      set_items: (q) => { inserted.items = q.ops; return { data: null, error: null }; },
      assignments: (q) => { inserted.assign = q.ops; return { data: null, error: null }; }
    } });
    const api = createApi(c);
    const id = await api.createSetAndAssign('coach-1', { title: 'T', source: 'Книга', rows: [{ position: 0, kind: 'puzzle', title: 'a', start_fen: FEN, movetext: '1. Rd8#' }] }, ['s1', 's2']);
    expect(id).toBe('NEW');
    expect(inserted.sets[0]).toEqual(['insert', { coach_id: 'coach-1', title: 'T', source: 'Книга' }]);
    expect(inserted.items[0][1]).toEqual([{ set_id: 'NEW', position: 0, kind: 'puzzle', title: 'a', start_fen: FEN, movetext: '1. Rd8#' }]);
    expect(inserted.assign[0][1]).toEqual([{ set_id: 'NEW', student_id: 's1' }, { set_id: 'NEW', student_id: 's2' }]);
  });
});

describe('sync orchestrator', () => {
  function setup(serverProgress) {
    const books = [{ id: 'local', name: 'Моя книга', items: [] }];
    const pushed = [];
    const api = {
      whoami: async () => ({ role: 'student', nick: 'Арман', student_id: 's1' }),
      fetchAssigned: async () => ({
        sets: [{ id: 'S1', title: 'Мат в 1', source: 'Пример', created_at: new Date(T).toISOString(),
          set_items: [{ id: 'i1', position: 0, kind: 'puzzle', title: 'А', start_fen: FEN, movetext: '1. Rd8#' }] }],
        progress: serverProgress || []
      }),
      pushProgress: async (rows) => { pushed.push(...rows); return rows.length; }
    };
    let changed = 0;
    const sync = createSync({ api, queue: createQueue(), getBooks: () => books,
      putBook: (b) => { const i = books.findIndex((x) => x.id === b.id); if (i >= 0) books[i] = b; else books.push(b); },
      onChange: () => changed++, now: () => T });
    return { sync, books, pushed, changed: () => changed };
  }

  it('student: downloads assigned sets as a local book, local-only books untouched', async () => {
    const { sync, books, changed } = setup();
    expect(await sync.syncNow()).toBe('student');
    expect(books.map((b) => b.id)).toEqual(['local', 'set-S1']);
    expect(books[1].items[0].title).toBe('А');
    expect(changed()).toBe(1);
  });

  it('progress made offline is queued and pushed on the next sync', async () => {
    const { sync, books, pushed } = setup();
    await sync.syncNow();
    const book = books[1], item = book.items[0];
    item.stat = { n: 1, ok: 1, clean: 1, fail: 0, box: 1, last: T, due: T + 864e5, res: 'clean' };
    expect(sync.onProgress(book, item)).toBe(true);
    expect(sync.onProgress(books[0], { id: 'z', stat: item.stat })).toBe(false); // local books are never sent
    await sync.flush();
    expect(pushed).toEqual([{ item_id: 'i1', n: 1, ok: 1, clean: 1, fail: 0, box: 1, last: T, due: T + 864e5, res: 'clean' }]);
  });

  it('newer progress from the cloud (other phone) wins locally', async () => {
    const { sync, books, pushed } = setup([{ item_id: 'i1', n: 4, ok: 4, box: 3, last_at: new Date(T).toISOString(), res: 'clean' }]);
    await sync.syncNow();
    expect(books[1].items[0].stat.n).toBe(4);
    expect(pushed).toEqual([]);
  });

  it('signed-out: role "none" without calling whoami (it is closed for the anon role)', async () => {
    let called = false;
    const s = createSync({ api: { session: async () => null, whoami: async () => { called = true; return { role: 'coach' }; } }, queue: createQueue(), getBooks: () => [], putBook: () => {} });
    expect(await s.syncNow()).toBe('none');
    expect(called).toBe(false);
  });

  it('a network error during sync is reported, not swallowed', async () => {
    const s = createSync({ api: { session: async () => ({}), whoami: async () => { throw new Error('Failed to fetch'); } }, queue: createQueue(), getBooks: () => [], putBook: () => {} });
    await expect(s.syncNow()).rejects.toThrow(/Failed to fetch/);
    expect(s.state.error.message).toBe('Failed to fetch');
  });

  it('coach or signed-out user: nothing is pulled or pushed', async () => {
    const { sync, books } = setup();
    sync.state.role = 'coach';
    const api2 = createSync({ api: { whoami: async () => ({ role: 'coach' }) }, queue: createQueue(), getBooks: () => books, putBook: () => { throw new Error('no'); } });
    expect(await api2.syncNow()).toBe('coach');
    expect((await api2.flush()).sent).toBe(0);
  });
});
