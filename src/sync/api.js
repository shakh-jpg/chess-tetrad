// Thin API over a Supabase client. The client is injected (a fake one in tests).
// All calls go through Row Level Security; nothing here needs a privileged key.
import { normalizeCode } from './code.js';

function unwrap(res) {
  if (res && res.error) { var e = new Error(res.error.message || String(res.error)); e.code = res.error.code; throw e; }
  return res ? res.data : null;
}

export function createApi(client, opts) {
  opts = opts || {};
  var redirectTo = opts.redirectTo || null;
  async function rpc(fn, args) { return unwrap(await client.rpc(fn, args || {})); }
  async function session() { var r = await client.auth.getSession(); return (r && r.data && r.data.session) || null; }

  return {
    session: session,
    whoami: function () { return rpc('whoami'); },
    onAuthChange: function (cb) { return client.auth.onAuthStateChange(function (ev, s) { cb(ev, s); }); },

    // ---- coach ----
    coachSignIn: async function (email, password) {
      return unwrap(await client.auth.signInWithPassword({ email: email, password: password }));
    },
    coachSignUp: async function (email, password) {
      return unwrap(await client.auth.signUp({ email: email, password: password, options: redirectTo ? { emailRedirectTo: redirectTo } : {} }));
    },
    sendMagicLink: async function (email) {
      return unwrap(await client.auth.signInWithOtp({ email: email, options: Object.assign({ shouldCreateUser: true }, redirectTo ? { emailRedirectTo: redirectTo } : {}) }));
    },
    becomeCoach: function (name) { return rpc('become_coach', { p_display_name: name || null }); },
    signOut: async function () { return unwrap(await client.auth.signOut()); },

    listStudents: async function () {
      // has_password comes with the 20261116 migration; before it is run, list without it
      var r = await client.from('students').select('id, nick, bound_at, last_seen_at, created_at, has_password').order('created_at');
      if (r.error && /has_password/.test(r.error.message || '')) r = await client.from('students').select('id, nick, bound_at, last_seen_at, created_at').order('created_at');
      return unwrap(r);
    },
    createStudent: function (nick) { return rpc('create_student', { p_nick: nick }); },
    reissueInvite: function (studentId) { return rpc('reissue_invite', { p_student_id: studentId }); },
    deleteStudent: async function (studentId) { return unwrap(await client.from('students').delete().eq('id', studentId)); },
    renameStudent: async function (studentId, nick) { return unwrap(await client.from('students').update({ nick: nick }).eq('id', studentId)); },

    // set = { title, source, rows: [{position, kind, title, start_fen, movetext}] }
    createSetAndAssign: async function (coachId, set, studentIds) {
      var row = { coach_id: coachId, title: set.title, source: set.source };
      // allow_solution comes with the 20261118 migration; it is sent only when the coach ticks it
      if (set.allowSolution) row.allow_solution = true;
      var created = unwrap(await client.from('sets').insert(row).select('id').single());
      var setId = created.id;
      if (set.rows.length) unwrap(await client.from('set_items').insert(set.rows.map(function (r) { return Object.assign({ set_id: setId }, r); })));
      if (studentIds.length) unwrap(await client.from('assignments').insert(studentIds.map(function (sid) { return { set_id: setId, student_id: sid }; })));
      return setId;
    },
    coachOverview: async function () {
      var r = await Promise.all([
        client.from('students').select('id, nick, bound_at, last_seen_at, created_at, has_password').order('created_at'),
        client.from('sets').select('id, title, source, created_at').order('created_at'),
        client.from('assignments').select('set_id, student_id, assigned_at'),
        client.from('set_items').select('id, set_id'),
        client.from('progress').select('student_id, item_id, n, res, due_at, last_at')
      ]);
      // before the 20261116 migration there is no has_password column
      if (r[0].error && /has_password/.test(r[0].error.message || '')) r[0] = await client.from('students').select('id, nick, bound_at, last_seen_at, created_at').order('created_at');
      return { students: unwrap(r[0]), sets: unwrap(r[1]), assignments: unwrap(r[2]), items: unwrap(r[3]), progress: unwrap(r[4]) };
    },

    // ---- student ----
    // Signs in anonymously if needed, then redeems the invite code. Returns {ok, error?, student_id, nick, coach_name}.
    studentJoin: async function (input) {
      var c = normalizeCode(input);
      if (!c.valid) return { ok: false, error: 'invalid_code' };
      if (!(await session())) {
        var a = await client.auth.signInAnonymously();
        if (a && a.error) return { ok: false, error: 'anon_failed', message: a.error.message };
      }
      return rpc('redeem_invite_code', { p_code: c.code });
    },
    // Login + password (no e-mail): a new anonymous session takes over the student. Same answer as studentJoin.
    studentLogin: async function (login, pass) {
      if (!(await session())) {
        var a = await client.auth.signInAnonymously();
        if (a && a.error) return { ok: false, error: 'anon_failed', message: a.error.message };
      }
      return rpc('student_login', { p_login: String(login || '').trim(), p_password: pass });
    },
    setStudentLogin: function (login, pass) { return rpc('set_student_login', { p_login: String(login || '').trim(), p_password: pass }); },
    myStudentLogin: async function () { try { return await rpc('my_student_login', {}); } catch (e) { return null; } },
    fetchAssigned: async function () {
      var items = 'set_items(id, position, kind, title, start_fen, movetext)';
      var r = await Promise.all([
        client.from('sets').select('id, title, source, created_at, allow_solution, ' + items),
        client.from('progress').select('item_id, n, ok, clean, fail, box, last_at, due_at, res')
      ]);
      // before the 20261118 migration there is no allow_solution column (the solution stays hidden)
      if (r[0].error && /allow_solution/.test(r[0].error.message || '')) r[0] = await client.from('sets').select('id, title, source, created_at, ' + items);
      return { sets: unwrap(r[0]) || [], progress: unwrap(r[1]) || [] };
    },
    pushProgress: function (rows) { return rpc('push_progress', { p_rows: rows }); },

    // ---- online lesson (migration 20261118000001) ----
    startLesson: function (studentIds) { return rpc('start_lesson', { p_students: studentIds }); },
    endLesson: function (lessonId) { return rpc('end_lesson', { p_lesson: lessonId }); },
    // student: { lesson_id, coach_name, started_at } or null
    myLiveLesson: function () { return rpc('my_live_lesson', {}); },
    // coach: the lesson that is still running (after a page reload), or null
    myCoachLesson: async function () {
      var since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      var rows = unwrap(await client.from('lessons').select('id, students, started_at').eq('status', 'live').gt('started_at', since).order('started_at', { ascending: false }).limit(1));
      return rows && rows[0] ? { lesson_id: rows[0].id, students: rows[0].students, started_at: rows[0].started_at } : null;
    }
  };
}
