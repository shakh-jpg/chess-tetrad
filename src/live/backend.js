// Where the online lesson gets its data: the Supabase cloud (normal use) or a test backend
// (end-to-end tests inject one with a message bus between two browsers; see e2e/live.spec.js).
import { createSupabaseTransport, createBusTransport } from './transport.js';

// The cloud has not been updated yet (migration 20261118000001 not run): the functions are missing.
export function lessonsMissing(e) {
  var t = String((e && (e.message || e.code)) || e || '');
  return /start_lesson|end_lesson|my_live_lesson|public\.lessons|PGRST202|PGRST205|42883|42P01|schema cache|Could not find the function/i.test(t);
}

// cloud: { ready() -> Promise<{api, client}>, role(), profile(), onRole(cb) } (from ui/account.js)
export function cloudBackend(cloud) {
  async function api() { return (await cloud.ready()).api; }
  var client = null;
  return {
    kind: 'cloud',
    role: function () { return cloud.role(); },
    profile: function () { return cloud.profile() || {}; },
    onRole: function (cb) { cloud.onRole(cb); },
    listStudents: async function () { return (await api()).listStudents(); },
    startLesson: async function (ids) { return (await api()).startLesson(ids); },
    endLesson: async function (id) { return (await api()).endLesson(id); },
    myLiveLesson: async function () { return (await api()).myLiveLesson(); },
    myCoachLesson: async function () { return (await api()).myCoachLesson(); },
    prepare: async function () { client = (await cloud.ready()).client; },
    transport: function (id) { return createSupabaseTransport(client, id); }
  };
}

// Test backend: window.__tetradLiveTest = { role, profile, students, bus, startLesson?, ... }.
// It only changes this browser's own page; it cannot reach anyone else's lesson.
export function testBackend(t) {
  var lessonId = null;
  return {
    kind: 'test',
    role: function () { return t.role; },
    profile: function () { return t.profile || {}; },
    onRole: function () {},
    listStudents: async function () { return t.students || []; },
    startLesson: async function (ids) {
      if (t.missing) throw new Error('Could not find the function public.start_lesson');
      lessonId = t.lessonId || '11111111-2222-4333-8444-555555555555'; t.invited = ids; return { ok: true, lesson_id: lessonId };
    },
    endLesson: async function () { t.ended = true; return { ok: true }; },
    myLiveLesson: async function () { return t.offer || null; },
    myCoachLesson: async function () { return t.resume || null; },
    prepare: async function () {},
    transport: function () { return createBusTransport(t.bus); }
  };
}
