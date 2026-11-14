// Runs the real migration in PGlite (Postgres compiled to WASM) and checks Row Level Security
// from the point of view of a coach, another coach, students and anonymous callers.
// Supabase itself is replaced by a small shim (auth.uid/auth.jwt, anon/authenticated roles).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SHIM = read('./supabase-shim.sql');
const MIGRATION = read('../../supabase/migrations/20261114000001_init.sql');

const U = {
  coachA: { sub: '00000000-0000-4000-8000-00000000000a', email: 'coach.a@example.com' },
  coachB: { sub: '00000000-0000-4000-8000-00000000000b', email: 'coach.b@example.com' },
  stranger: { sub: '00000000-0000-4000-8000-00000000000c', email: 'stranger@example.com' },
  anon1: { sub: '00000000-0000-4000-8000-000000000001', is_anonymous: true },
  anon2: { sub: '00000000-0000-4000-8000-000000000002', is_anonymous: true },
  anon3: { sub: '00000000-0000-4000-8000-000000000003', is_anonymous: true },
  anon4: { sub: '00000000-0000-4000-8000-000000000004', is_anonymous: true }
};
const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

let db;
async function as(user, sql, params) {
  await db.exec('reset role');
  const claims = user ? { role: 'authenticated', sub: user.sub, email: user.email || '', is_anonymous: !!user.is_anonymous } : {};
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const rpc = async (user, fn, args) => {
  const keys = Object.keys(args || {});
  const r = await as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => args[k]));
  return r.rows[0].r;
};
const rows = async (user, sql, params) => (await as(user, sql, params)).rows;

let s1, s2, s3, setA, itemA1, itemA2, setB, itemB1, code1, code2;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // must be idempotent
  for (const u of Object.values(U)) {
    await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [u.sub, u.email || null, !!u.is_anonymous]);
  }
  await db.exec("insert into public.coach_allowlist (email) values ('coach.a@example.com'), ('coach.b@example.com')");
}, 60000);

describe('coach registration', () => {
  it('rejects users not on the allowlist and anonymous users', async () => {
    expect(await rpc(U.stranger, 'become_coach', { p_display_name: 'X' })).toEqual({ ok: false, error: 'not_allowed' });
    expect(await rpc(U.anon1, 'become_coach', { p_display_name: 'X' })).toEqual({ ok: false, error: 'not_signed_in' });
    expect(await rpc(null, 'ping', {})).toBe('ok');
    await expect(as(null, 'select public.become_coach()')).rejects.toThrow(/permission denied/);
  });
  it('lets allowlisted users become coaches (idempotent)', async () => {
    expect(await rpc(U.coachA, 'become_coach', { p_display_name: 'Тренер А' })).toEqual({ ok: true });
    expect(await rpc(U.coachA, 'become_coach', { p_display_name: 'Тренер А' })).toEqual({ ok: true });
    expect(await rpc(U.coachB, 'become_coach', { p_display_name: 'Тренер Б' })).toEqual({ ok: true });
    expect((await rpc(U.coachA, 'whoami', {})).role).toBe('coach');
    expect((await rpc(U.stranger, 'whoami', {})).role).toBe('none');
  });
});

describe('students and invite codes', () => {
  it('coach creates students and gets one-time codes', async () => {
    const r1 = await rpc(U.coachA, 'create_student', { p_nick: 'Ученик 1' });
    const r2 = await rpc(U.coachA, 'create_student', { p_nick: 'Ученик 2' });
    const r3 = await rpc(U.coachB, 'create_student', { p_nick: 'Чужой' });
    expect(r1.ok).toBe(true);
    expect(r1.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r1.code).not.toMatch(/[01OIL]/);
    s1 = r1.student_id; s2 = r2.student_id; s3 = r3.student_id; code1 = r1.code; code2 = r2.code;
    expect(await rpc(U.anon1, 'create_student', { p_nick: 'x' })).toEqual({ ok: false, error: 'not_a_coach' });
    expect(await rpc(U.coachA, 'create_student', { p_nick: '   ' })).toEqual({ ok: false, error: 'bad_nick' });
  });

  it('codes are not stored in plain text and invites are not readable through the API', async () => {
    const inv = (await db.query('select code_prefix, code_hash from public.student_invites where student_id = $1', [s1])).rows[0];
    expect(code1.startsWith(inv.code_prefix)).toBe(true);
    expect(inv.code_hash).not.toContain(code1.replace(/-/g, '').slice(4));
    await expect(as(U.coachA, 'select * from public.student_invites')).rejects.toThrow(/permission denied/);
    await expect(as(U.anon1, 'select * from public.coach_allowlist')).rejects.toThrow(/permission denied/);
  });

  it('coach sees only own students; nobody can insert students directly', async () => {
    expect((await rows(U.coachA, 'select nick from public.students order by nick')).map((r) => r.nick)).toEqual(['Ученик 1', 'Ученик 2']);
    expect((await rows(U.coachB, 'select nick from public.students')).map((r) => r.nick)).toEqual(['Чужой']);
    expect(await rows(U.anon1, 'select * from public.students')).toEqual([]);
    await expect(as(U.coachA, "insert into public.students (coach_id, nick) values ($1, 'x')", [U.coachA.sub])).rejects.toThrow(/permission denied/);
  });

  it('wrong codes fail and five wrong tries lock the code', async () => {
    expect(await rpc(U.anon3, 'redeem_invite_code', { p_code: 'nonsense' })).toEqual({ ok: false, error: 'invalid_code' });
    const prefix = code2.slice(0, 4);
    const wrong = prefix + '-2222-2222';
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await rpc(U.anon3, 'redeem_invite_code', { p_code: wrong })).error);
    expect(results).toEqual(['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'code_locked']);
    // even the right code is refused now; the coach must issue a new one
    expect(await rpc(U.anon3, 'redeem_invite_code', { p_code: code2 })).toEqual({ ok: false, error: 'code_locked' });
    const re = await rpc(U.coachA, 'reissue_invite', { p_student_id: s2 });
    expect(re.ok).toBe(true);
    code2 = re.code;
  });

  it('a right code binds the anonymous device to the student (code is single-use, any formatting)', async () => {
    const loose = ' ' + code1.toLowerCase().replace(/-/g, ' ') + ' ';
    const r = await rpc(U.anon1, 'redeem_invite_code', { p_code: loose });
    expect(r).toMatchObject({ ok: true, student_id: s1, nick: 'Ученик 1', coach_name: 'Тренер А' });
    expect(await rpc(U.anon4, 'redeem_invite_code', { p_code: code1 })).toEqual({ ok: false, error: 'invalid_code' });
    expect(await rpc(U.anon2, 'redeem_invite_code', { p_code: code2 })).toMatchObject({ ok: true, student_id: s2 });
    expect(await rpc(U.anon1, 'whoami', {})).toMatchObject({ role: 'student', student_id: s1, nick: 'Ученик 1' });
    expect((await rows(U.anon1, 'select id, nick from public.students')).map((x) => x.id)).toEqual([s1]);
  });

  it('a student cannot rebind or rename itself', async () => {
    await expect(as(U.anon1, 'update public.students set user_id = $1', [U.anon2.sub])).rejects.toThrow(/permission denied/);
    const r = await as(U.anon1, "update public.students set nick = 'hack'");
    expect(r.affectedRows).toBe(0);
  });

  it('a coach cannot join as a student', async () => {
    const re = await rpc(U.coachB, 'reissue_invite', { p_student_id: s3 });
    expect(await rpc(U.coachA, 'redeem_invite_code', { p_code: re.code })).toEqual({ ok: false, error: 'coach_cannot_join' });
    expect(await rpc(U.coachA, 'reissue_invite', { p_student_id: s3 })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('sets, assignments, progress', () => {
  it('coach creates sets and assigns them to own students only', async () => {
    setA = (await rows(U.coachA, "insert into public.sets (coach_id, title, source) values ($1, 'Мат в 1', 'Пример') returning id", [U.coachA.sub]))[0].id;
    const items = await rows(U.coachA, `insert into public.set_items (set_id, position, kind, title, start_fen, movetext)
      values ($1, 0, 'puzzle', 'З1', $2, '1. Rd8#'), ($1, 1, 'puzzle', 'З2', $2, '1. Rd8#') returning id`, [setA, FEN]);
    itemA1 = items[0].id; itemA2 = items[1].id;
    await as(U.coachA, 'insert into public.assignments (set_id, student_id) values ($1, $2)', [setA, s1]);
    setB = (await rows(U.coachB, "insert into public.sets (coach_id, title) values ($1, 'Чужой набор') returning id", [U.coachB.sub]))[0].id;
    itemB1 = (await rows(U.coachB, "insert into public.set_items (set_id, kind, start_fen) values ($1, 'puzzle', $2) returning id", [setB, FEN]))[0].id;

    await expect(as(U.coachA, 'insert into public.assignments (set_id, student_id) values ($1, $2)', [setA, s3])).rejects.toThrow(/row-level security/);
    await expect(as(U.coachA, 'insert into public.assignments (set_id, student_id) values ($1, $2)', [setB, s1])).rejects.toThrow(/row-level security/);
    await expect(as(U.coachA, "insert into public.sets (coach_id, title) values ($1, 'x')", [U.coachB.sub])).rejects.toThrow(/row-level security/);
    await expect(as(U.anon1, "insert into public.sets (coach_id, title) values ($1, 'x')", [U.anon1.sub])).rejects.toThrow(/row-level security/);
    expect(await rows(U.coachB, 'select * from public.sets where id = $1', [setA])).toEqual([]);
  });

  it('a student sees only sets assigned to them', async () => {
    expect((await rows(U.anon1, 'select title from public.sets')).map((r) => r.title)).toEqual(['Мат в 1']);
    expect((await rows(U.anon1, 'select id from public.set_items order by position')).map((r) => r.id)).toEqual([itemA1, itemA2]);
    expect(await rows(U.anon2, 'select * from public.sets')).toEqual([]);
    expect(await rows(U.anon2, 'select * from public.set_items')).toEqual([]);
    expect(await rows(U.anon3, 'select * from public.set_items')).toEqual([]);
    expect((await rows(U.anon1, 'select student_id from public.assignments')).map((r) => r.student_id)).toEqual([s1]);
    await expect(as(U.anon1, 'insert into public.assignments (set_id, student_id) values ($1, $2)', [setB, s1])).rejects.toThrow(/row-level security/);
  });

  it('progress: student writes own rows for assigned items; merge keeps the row with more attempts', async () => {
    const t = Date.UTC(2026, 10, 14, 10, 0, 0);
    const push = (user, list) => rpc(user, 'push_progress', { p_rows: JSON.stringify(list) });
    expect(await push(U.anon1, [
      { item_id: itemA1, n: 2, ok: 2, clean: 1, fail: 0, box: 1, last: t, due: t + 864e5, res: 'clean' },
      { item_id: itemB1, n: 1, ok: 1, box: 1, last: t, res: 'clean' } // not assigned: ignored
    ])).toBe(1);
    expect(await push(U.anon1, [{ item_id: itemA1, n: 1, ok: 1, box: 0, last: t + 5000, res: 'help' }])).toBe(0); // stale
    expect(await push(U.anon1, [{ item_id: itemA1, n: 3, ok: 3, clean: 2, box: 2, last: t + 9000, res: 'clean' }])).toBe(1);
    expect(await push(U.anon1, [{ item_id: itemA1, n: 3, ok: 3, clean: 2, box: 2, last: t + 1000, res: 'help' }])).toBe(0); // tie, older
    const mine = await rows(U.anon1, 'select item_id, n, box, res from public.progress');
    expect(mine).toEqual([{ item_id: itemA1, n: 3, box: 2, res: 'clean' }]);
    await expect(push(U.anon3, [{ item_id: itemA1, n: 9 }])).rejects.toThrow(/not_a_student/);
    await expect(as(U.anon1, 'insert into public.progress (student_id, item_id, n) values ($1, $2, 5)', [s2, itemA1])).rejects.toThrow(/row-level security/);
  });

  it('coach reads progress of own students only; other students see nothing', async () => {
    expect((await rows(U.coachA, 'select student_id, n from public.progress'))).toEqual([{ student_id: s1, n: 3 }]);
    expect(await rows(U.coachB, 'select * from public.progress')).toEqual([]);
    expect(await rows(U.anon2, 'select * from public.progress')).toEqual([]);
    expect(await rows(U.stranger, 'select * from public.progress')).toEqual([]);
  });

  it('new phone: a new code moves the student (and progress) to the new device; the old one loses access', async () => {
    const re = await rpc(U.coachA, 'reissue_invite', { p_student_id: s1 });
    expect(await rpc(U.anon4, 'redeem_invite_code', { p_code: re.code })).toMatchObject({ ok: true, student_id: s1 });
    expect((await rows(U.anon4, 'select n from public.progress'))).toEqual([{ n: 3 }]);
    expect(await rows(U.anon1, 'select * from public.progress')).toEqual([]);
    expect(await rows(U.anon1, 'select * from public.sets')).toEqual([]);
    expect((await rpc(U.anon1, 'whoami', {})).role).toBe('none');
  });

  it('anon (not signed in) has no table access at all', async () => {
    for (const t of ['coaches', 'students', 'sets', 'set_items', 'assignments', 'progress']) {
      await expect(as(null, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('deleting a student removes their progress and assignments (privacy: delete on request)', async () => {
    await as(U.coachA, 'delete from public.students where id = $1', [s1]);
    expect((await db.query('select count(*)::int c from public.progress where student_id = $1', [s1])).rows[0].c).toBe(0);
    expect((await db.query('select count(*)::int c from public.assignments where student_id = $1', [s1])).rows[0].c).toBe(0);
    const r = await as(U.coachB, 'delete from public.students where id = $1', [s2]);
    expect(r.affectedRows).toBe(0);
  });
});
