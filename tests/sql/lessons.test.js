// Online lesson + allow_solution (migration 20261118000001) on PGlite.
// Supabase Auth is replaced by supabase-shim.sql, Realtime's authorization table by realtime-shim.sql:
// Realtime checks a private channel by select/insert on realtime.messages with the topic in a setting,
// which is exactly what canRead/canWrite below do.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SHIM = read('./supabase-shim.sql');
const RT = read('./realtime-shim.sql');
const INIT = read('../../supabase/migrations/20261114000001_init.sql');
const PASS = read('../../supabase/migrations/20261116000001_student_password.sql');
const LIVE = read('../../supabase/migrations/20261118000001_live_lessons.sql');

const U = {
  coach: { sub: '00000000-0000-4000-8000-0000000000a1', email: 'coach@example.com' },
  coach2: { sub: '00000000-0000-4000-8000-0000000000a2', email: 'coach2@example.com' },
  st1: { sub: '00000000-0000-4000-8000-000000000021', is_anonymous: true },
  st2: { sub: '00000000-0000-4000-8000-000000000022', is_anonymous: true },
  st3: { sub: '00000000-0000-4000-8000-000000000023', is_anonymous: true }, // the coach's student, not invited
  other: { sub: '00000000-0000-4000-8000-000000000024', is_anonymous: true }, // coach2's student
  stranger: { sub: '00000000-0000-4000-8000-000000000025', is_anonymous: true } // signed in, nobody
};
const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
let db, s1, s2, s3, sOther, lesson;

async function as(user, sql, params, topic) {
  await db.exec('reset role');
  const claims = user ? { role: 'authenticated', sub: user.sub, email: user.email || '', is_anonymous: !!user.is_anonymous } : {};
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.query("select set_config('realtime.topic', $1, false)", [topic || '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const rpc = async (user, fn, args) => {
  const keys = Object.keys(args || {});
  return (await as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => args[k]))).rows[0].r;
};
// Realtime join checks: can this user receive / send on the topic for this extension?
async function canRead(user, topic, ext) {
  await db.query('insert into realtime.messages (topic, extension, event) values ($1, $2, $3)', [topic, ext, 'probe']);
  const r = await as(user, 'select count(*)::int as n from realtime.messages where topic = $1 and extension = $2', [topic, ext], topic);
  return r.rows[0].n > 0;
}
async function canWrite(user, topic, ext) {
  try { await as(user, "insert into realtime.messages (topic, extension, event) values ($1, $2, 'x')", [topic, ext], topic); return true; }
  catch (e) { if (/row-level security|permission denied/.test(e.message)) return false; throw e; }
}
const topicC = () => 'lesson:' + lesson + ':c';
const topicS = () => 'lesson:' + lesson + ':s';

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SHIM); await db.exec(RT); await db.exec(INIT); await db.exec(PASS);
  await db.exec(LIVE); await db.exec(LIVE); // idempotent
  for (const u of Object.values(U)) await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [u.sub, u.email || null, !!u.is_anonymous]);
  await db.exec("insert into public.coach_allowlist (email) values ('coach@example.com'), ('coach2@example.com')");
  await rpc(U.coach, 'become_coach', { p_display_name: 'Тренер' });
  await rpc(U.coach2, 'become_coach', { p_display_name: 'Другой' });
  const join = async (coach, nick, dev) => {
    const r = await rpc(coach, 'create_student', { p_nick: nick });
    expect((await rpc(dev, 'redeem_invite_code', { p_code: r.code })).ok).toBe(true);
    return r.student_id;
  };
  s1 = await join(U.coach, 'Петя', U.st1); s2 = await join(U.coach, 'Маша', U.st2);
  s3 = await join(U.coach, 'Коля', U.st3); sOther = await join(U.coach2, 'Чужой', U.other);
}, 60000);

describe('lessons: start, who sees it, who can end it', () => {
  it('only a coach starts a lesson, and only with own students', async () => {
    expect(await rpc(U.st1, 'start_lesson', { p_students: [s1] })).toEqual({ ok: false, error: 'not_a_coach' });
    expect(await rpc(U.coach, 'start_lesson', { p_students: [] })).toEqual({ ok: false, error: 'no_students' });
    // someone else's student cannot be put into my lesson
    expect(await rpc(U.coach, 'start_lesson', { p_students: [s1, sOther] })).toEqual({ ok: false, error: 'not_found' });
    await expect(as(null, 'select public.start_lesson(array[]::uuid[])')).rejects.toThrow(/permission denied/);
    const r = await rpc(U.coach, 'start_lesson', { p_students: [s1, s2, s1] });
    expect(r.ok).toBe(true);
    lesson = r.lesson_id;
    const row = (await db.query('select students, status from public.lessons where id = $1', [lesson])).rows[0];
    expect(row.status).toBe('live');
    expect(row.students.sort()).toEqual([s1, s2].sort());
    expect(row.students).not.toContain(s3);
  });

  it('invited students see the lesson; the uninvited and someone else\'s student do not', async () => {
    expect(await rpc(U.st1, 'my_live_lesson', {})).toMatchObject({ lesson_id: lesson, coach_name: 'Тренер' });
    expect(await rpc(U.st2, 'my_live_lesson', {})).toMatchObject({ lesson_id: lesson });
    expect(await rpc(U.st3, 'my_live_lesson', {})).toBeNull();
    expect(await rpc(U.other, 'my_live_lesson', {})).toBeNull();
    expect(await rpc(U.stranger, 'my_live_lesson', {})).toBeNull();
    expect(await rpc(U.coach2, 'my_live_lesson', {})).toBeNull();
  });

  it('the lessons table: the coach reads own lessons; students and others read nothing and write nothing', async () => {
    expect((await as(U.coach, 'select id from public.lessons')).rows.map((r) => r.id)).toEqual([lesson]);
    expect((await as(U.coach2, 'select id from public.lessons')).rows).toEqual([]);
    expect((await as(U.st1, 'select id from public.lessons')).rows).toEqual([]);
    await expect(as(null, 'select * from public.lessons')).rejects.toThrow(/permission denied/);
    await expect(as(U.st1, "update public.lessons set status = 'ended'")).rejects.toThrow(/permission denied/);
    await expect(as(U.coach, "update public.lessons set students = array[$1::uuid]", [sOther])).rejects.toThrow(/permission denied/);
    await expect(as(U.st1, 'insert into public.lessons (coach_id, students) values ($1, array[$2::uuid])', [U.coach.sub, s1])).rejects.toThrow(/permission denied/);
    await expect(as(U.st1, 'delete from public.lessons')).rejects.toThrow(/permission denied/);
  });

  it('a student cannot end or change the lesson; another coach cannot end it', async () => {
    expect(await rpc(U.st1, 'end_lesson', { p_lesson: lesson })).toEqual({ ok: false, error: 'not_a_coach' });
    expect(await rpc(U.coach2, 'end_lesson', { p_lesson: lesson })).toEqual({ ok: false, error: 'not_found' });
    expect((await db.query('select status from public.lessons where id = $1', [lesson])).rows[0].status).toBe('live');
  });
});

describe('Realtime channels of the lesson (private, policies on realtime.messages)', () => {
  it('coach: reads and writes the coach channel, reads proposals and presence', async () => {
    expect(await canRead(U.coach, topicC(), 'broadcast')).toBe(true);
    expect(await canWrite(U.coach, topicC(), 'broadcast')).toBe(true);
    expect(await canRead(U.coach, topicS(), 'broadcast')).toBe(true);
    expect(await canRead(U.coach, topicS(), 'presence')).toBe(true);
    expect(await canWrite(U.coach, topicS(), 'presence')).toBe(true);
  });

  it('invited student: reads the coach channel but cannot write to it (cannot become the leader)', async () => {
    expect(await canRead(U.st1, topicC(), 'broadcast')).toBe(true);
    expect(await canWrite(U.st1, topicC(), 'broadcast')).toBe(false);
    expect(await canWrite(U.st1, topicC(), 'presence')).toBe(false);
    // students' channel: sends proposals, does not read other students' proposals; presence both ways
    expect(await canWrite(U.st1, topicS(), 'broadcast')).toBe(true);
    expect(await canRead(U.st1, topicS(), 'broadcast')).toBe(false);
    expect(await canRead(U.st2, topicS(), 'presence')).toBe(true);
    expect(await canWrite(U.st2, topicS(), 'presence')).toBe(true);
  });

  it('strangers: the uninvited student, someone else\'s student, another coach, any signed-in user — nothing', async () => {
    for (const u of [U.st3, U.other, U.coach2, U.stranger]) {
      for (const t of [topicC(), topicS()]) {
        for (const ext of ['broadcast', 'presence']) {
          expect(await canRead(u, t, ext)).toBe(false);
          expect(await canWrite(u, t, ext)).toBe(false);
        }
      }
    }
  });

  it('other topics and malformed topics are closed', async () => {
    for (const t of ['lesson:' + lesson + ':x', 'lesson:' + lesson, 'room-1', "lesson:' or 1=1 --:c", 'LESSON:' + lesson + ':c']) {
      expect(await canRead(U.coach, t, 'broadcast')).toBe(false);
      expect(await canWrite(U.coach, t, 'broadcast')).toBe(false);
    }
  });

  it('after the lesson ends nobody can join its channels', async () => {
    expect(await rpc(U.coach, 'end_lesson', { p_lesson: lesson })).toEqual({ ok: true });
    expect(await canRead(U.st1, topicC(), 'broadcast')).toBe(false);
    expect(await canWrite(U.coach, topicC(), 'broadcast')).toBe(false);
    expect(await rpc(U.st1, 'my_live_lesson', {})).toBeNull();
  });

  it('a new lesson ends the previous one; a lesson older than 12 hours closes by itself', async () => {
    const a = (await rpc(U.coach, 'start_lesson', { p_students: [s1] })).lesson_id;
    const b = (await rpc(U.coach, 'start_lesson', { p_students: [s2] })).lesson_id;
    expect((await db.query('select status from public.lessons where id = $1', [a])).rows[0].status).toBe('ended');
    expect(await rpc(U.st1, 'my_live_lesson', {})).toBeNull(); // s1 was only in the ended lesson
    expect(await rpc(U.st2, 'my_live_lesson', {})).toMatchObject({ lesson_id: b });
    await db.query("update public.lessons set started_at = now() - interval '13 hours' where id = $1", [b]);
    expect(await rpc(U.st2, 'my_live_lesson', {})).toBeNull();
    expect(await canRead(U.st2, 'lesson:' + b + ':c', 'broadcast')).toBe(false);
  });

  it('deleting the coach deletes their lessons', async () => {
    const n = (await db.query('select count(*)::int as n from public.lessons where coach_id = $1', [U.coach2.sub])).rows[0].n;
    expect(n).toBe(0);
    const c = (await rpc(U.coach2, 'start_lesson', { p_students: [sOther] })).lesson_id;
    await db.query('delete from auth.users where id = $1', [U.coach2.sub]);
    expect((await db.query('select count(*)::int as n from public.lessons where id = $1', [c])).rows[0].n).toBe(0);
  });
});

describe('sets.allow_solution', () => {
  let setYes, setNo;
  it('the coach sets it when assigning and can change it later', async () => {
    setYes = (await as(U.coach, "insert into public.sets (coach_id, title, allow_solution) values ($1, 'С решением', true) returning id", [U.coach.sub])).rows[0].id;
    setNo = (await as(U.coach, "insert into public.sets (coach_id, title) values ($1, 'Без решения') returning id", [U.coach.sub])).rows[0].id;
    await as(U.coach, "insert into public.set_items (set_id, kind, start_fen, movetext) values ($1, 'puzzle', $2, '1. Rd8#'), ($3, 'puzzle', $2, '1. Rd8#')", [setYes, FEN, setNo]);
    await as(U.coach, 'insert into public.assignments (set_id, student_id) values ($1, $2), ($3, $2)', [setYes, s1, setNo]);
    expect((await as(U.coach, 'update public.sets set allow_solution = false where id = $1', [setYes])).affectedRows).toBe(1);
    expect((await as(U.coach, 'update public.sets set allow_solution = true where id = $1', [setYes])).affectedRows).toBe(1);
  });
  it('the student reads it only for own sets and cannot change it', async () => {
    const mine = (await as(U.st1, 'select title, allow_solution from public.sets order by title')).rows;
    expect(mine).toEqual([{ title: 'Без решения', allow_solution: false }, { title: 'С решением', allow_solution: true }]);
    expect((await as(U.st2, 'select allow_solution from public.sets')).rows).toEqual([]);
    expect((await as(U.stranger, 'select allow_solution from public.sets')).rows).toEqual([]);
    expect((await as(U.st1, 'update public.sets set allow_solution = true where id = $1', [setNo])).affectedRows).toBe(0);
    expect((await db.query('select allow_solution from public.sets where id = $1', [setNo])).rows[0].allow_solution).toBe(false);
  });
});
