// Student login + password (migration 20261116000001) on PGlite with the real pgcrypto extension
// (bcrypt via crypt/gen_salt). Supabase is replaced by the shim, as in rls.test.js.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SHIM = read('./supabase-shim.sql');
const INIT = read('../../supabase/migrations/20261114000001_init.sql');
const PASS = read('../../supabase/migrations/20261116000001_student_password.sql');

const U = {
  coach: { sub: '00000000-0000-4000-8000-0000000000aa', email: 'coach@example.com' },
  dev1: { sub: '00000000-0000-4000-8000-000000000011', is_anonymous: true }, // student 1, first device
  dev2: { sub: '00000000-0000-4000-8000-000000000012', is_anonymous: true }, // student 2
  dev3: { sub: '00000000-0000-4000-8000-000000000013', is_anonymous: true }, // student 1, new device
  bad: { sub: '00000000-0000-4000-8000-000000000014', is_anonymous: true } // someone guessing
};
let db, s1, s2;
async function as(user, sql, params) {
  await db.exec('reset role');
  const claims = user ? { role: 'authenticated', sub: user.sub, email: user.email || '', is_anonymous: !!user.is_anonymous } : {};
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const rpc = async (user, fn, args) => {
  const keys = Object.keys(args || {});
  return (await as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => args[k]))).rows[0].r;
};

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SHIM); await db.exec(INIT);
  await db.exec(PASS); await db.exec(PASS); // idempotent
  for (const u of Object.values(U)) await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [u.sub, u.email || null, !!u.is_anonymous]);
  await db.exec("insert into public.coach_allowlist (email) values ('coach@example.com')");
  await rpc(U.coach, 'become_coach', { p_display_name: 'Тренер' });
  const a = await rpc(U.coach, 'create_student', { p_nick: 'Петя' }), b = await rpc(U.coach, 'create_student', { p_nick: 'Маша' });
  s1 = a.student_id; s2 = b.student_id;
  expect((await rpc(U.dev1, 'redeem_invite_code', { p_code: a.code })).ok).toBe(true);
  expect((await rpc(U.dev2, 'redeem_invite_code', { p_code: b.code })).ok).toBe(true);
  // progress of student 1 (written directly: the progress path itself is tested in rls.test.js)
  const set = (await db.query("insert into public.sets (coach_id, title) values ($1, 'Набор') returning id", [U.coach.sub])).rows[0].id;
  const item = (await db.query("insert into public.set_items (set_id, kind, start_fen) values ($1, 'puzzle', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1') returning id", [set])).rows[0].id;
  await db.query('insert into public.progress (student_id, item_id, n, ok) values ($1, $2, 3, 2)', [s1, item]);
}, 60000);

describe('student login and password', () => {
  it('a student sets a login and a password; rules for both; logins are unique', async () => {
    expect(await rpc(U.dev1, 'set_student_login', { p_login: 'ab', p_password: 'secret123' })).toEqual({ ok: false, error: 'bad_login' });
    expect(await rpc(U.dev1, 'set_student_login', { p_login: 'petya_1', p_password: 'secret123' })).toEqual({ ok: false, error: 'bad_login' });
    expect(await rpc(U.dev1, 'set_student_login', { p_login: 'Petya2014', p_password: 'short' })).toEqual({ ok: false, error: 'bad_password' });
    expect(await rpc(U.dev1, 'set_student_login', { p_login: 'Petya2014', p_password: 'secret123' })).toEqual({ ok: true, login: 'petya2014' });
    expect(await rpc(U.dev2, 'set_student_login', { p_login: 'PETYA2014', p_password: 'other1234' })).toEqual({ ok: false, error: 'login_taken' });
    expect(await rpc(U.dev1, 'my_student_login', {})).toBe('petya2014');
  });
  it('only for the current student: a coach or a stranger cannot set anyone\'s password', async () => {
    expect(await rpc(U.coach, 'set_student_login', { p_login: 'masha', p_password: 'hacked123' })).toEqual({ ok: false, error: 'not_student' });
    expect(await rpc(U.bad, 'set_student_login', { p_login: 'masha', p_password: 'hacked123' })).toEqual({ ok: false, error: 'not_student' });
    // a coach session cannot sign in as a student (it would become the student's device)
    expect(await rpc(U.coach, 'student_login', { p_login: 'masha', p_password: 'whatever1' })).toEqual({ ok: false, error: 'coach_cannot_join' });
    // Masha sets her own; Petya's call changes only Petya
    expect((await rpc(U.dev2, 'set_student_login', { p_login: 'masha', p_password: 'masha12345' })).ok).toBe(true);
    expect((await rpc(U.dev1, 'set_student_login', { p_login: 'petya2014', p_password: 'secret123' })).ok).toBe(true);
    expect((await rpc(U.bad, 'student_login', { p_login: 'masha', p_password: 'masha12345' })).ok).toBe(true);
    expect((await rpc(U.dev2, 'student_login', { p_login: 'masha', p_password: 'masha12345' })).ok).toBe(true); // Masha takes her device back
  });
  it('wrong password and unknown login give the same answer', async () => {
    expect(await rpc(U.dev3, 'student_login', { p_login: 'petya2014', p_password: 'wrongpass' })).toEqual({ ok: false, error: 'invalid_login' });
    expect(await rpc(U.dev3, 'student_login', { p_login: 'nobody', p_password: 'secret123' })).toEqual({ ok: false, error: 'invalid_login' });
  });
  it('the right password moves the student to the new device; progress stays', async () => {
    const r = await rpc(U.dev3, 'student_login', { p_login: 'PETYA2014', p_password: 'secret123' });
    expect(r).toMatchObject({ ok: true, student_id: s1, nick: 'Петя', coach_name: 'Тренер' });
    expect(await rpc(U.dev3, 'whoami', {})).toMatchObject({ role: 'student', student_id: s1 });
    expect((await rpc(U.dev1, 'whoami', {})).role).not.toBe('student'); // the old device lost access
    expect((await db.query('select n, ok from public.progress where student_id = $1', [s1])).rows).toEqual([{ n: 3, ok: 2 }]);
  });
  it('limits wrong attempts per login and per session', async () => {
    for (let i = 0; i < 10; i++) await rpc(U.bad, 'student_login', { p_login: 'masha', p_password: 'guess' + i });
    expect(await rpc(U.bad, 'student_login', { p_login: 'masha', p_password: 'masha12345' })).toEqual({ ok: false, error: 'too_many_attempts' });
    // the login is locked for others too, for a while (guessing from many sessions)
    expect(await rpc(U.dev2, 'student_login', { p_login: 'masha', p_password: 'masha12345' })).toEqual({ ok: false, error: 'too_many_attempts' });
  });
  it('the hash and the attempts are not readable through the API; the coach sees only "has a password"', async () => {
    await expect(as(U.dev3, 'select * from public.student_logins')).rejects.toThrow(/permission denied/);
    await expect(as(U.coach, 'select * from public.student_logins')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select * from public.login_attempts')).rejects.toThrow(/permission denied/);
    await expect(as(null, "select public.student_login('a', 'b')")).rejects.toThrow(/permission denied/);
    const st = (await as(U.coach, 'select nick, has_password from public.students order by nick')).rows;
    expect(st).toEqual([{ nick: 'Маша', has_password: true }, { nick: 'Петя', has_password: true }]);
    const hash = (await db.query('select password_hash from public.student_logins where student_id = $1', [s1])).rows[0].password_hash;
    expect(hash).toMatch(/^\$2a\$10\$/); // bcrypt, cost 10
  });
  it('deleting a student deletes the login and the hash', async () => {
    await db.query('delete from public.students where id = $1', [s2]);
    expect((await db.query("select count(*)::int as n from public.student_logins where login = 'masha'")).rows[0].n).toBe(0);
  });
});
