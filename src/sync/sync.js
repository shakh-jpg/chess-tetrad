// Sync orchestrator. IndexedDB stays the main storage; the cloud receives a queue of progress
// rows and sends down the sets assigned to the student. Works only when the cloud is configured.
import { mergeRemoteSet, statToRow, isRemoteBook, REMOTE_PREFIX } from './model.js';

// deps: { api, queue, getBooks(), putBook(book), removeBook?(id), onChange(), now() }
export function createSync(deps) {
  var api = deps.api, queue = deps.queue;
  var now = deps.now || Date.now;
  var state = { role: 'none', profile: null, lastSync: 0, error: null };
  var flushTimer = null;

  async function refreshRole() {
    try {
      // Not signed in: no request (whoami is not available to the anon role).
      if (api.session && !(await api.session())) { state.profile = null; state.role = 'none'; state.error = null; return state.role; }
      state.profile = await api.whoami(); state.role = (state.profile && state.profile.role) || 'none'; state.error = null;
    } catch (e) { state.error = e; throw e; }
    return state.role;
  }

  // Student: download assigned sets and merge progress both ways.
  async function pull() {
    var data = await api.fetchAssigned();
    var books = deps.getBooks();
    var byId = {};
    books.forEach(function (b) { byId[b.id] = b; });
    var changed = 0;
    data.sets.forEach(function (set) {
      var rowsForSet = data.progress.filter(function (p) { return (set.set_items || []).some(function (i) { return i.id === p.item_id; }); });
      var r = mergeRemoteSet(byId[REMOTE_PREFIX + set.id] || null, set, rowsForSet, now());
      r.toPush.forEach(function (row) { queue.enqueue(row); });
      deps.putBook(r.book);
      changed++;
    });
    state.lastSync = now();
    if (changed && deps.onChange) deps.onChange();
    return changed;
  }

  async function flush() {
    if (state.role !== 'student' || !queue.size()) return { sent: 0 };
    var r = await queue.flush(function (rows) { return api.pushProgress(rows); });
    if (r.error) state.error = r.error;
    return r;
  }

  function scheduleFlush(delay) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush().catch(function () {}); }, delay == null ? 1500 : delay);
  }

  return {
    state: state,
    refreshRole: refreshRole,
    pull: pull,
    flush: flush,
    // Full round: who am I -> (student) pull + push.
    syncNow: async function () {
      await refreshRole();
      if (state.role === 'student') { await pull(); await flush(); }
      return state.role;
    },
    // Called by the UI after a puzzle result was recorded locally.
    onProgress: function (book, item) {
      if (!isRemoteBook(book) || !item || !item.stat) return false;
      queue.enqueue(statToRow(item.id, item.stat));
      if (state.role === 'student') scheduleFlush();
      return true;
    }
  };
}
