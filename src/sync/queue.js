// @ts-check
// Offline-first sync queue for progress rows. One pending row per item (newest by the merge rule);
// persisted (localStorage by default) so nothing is lost when the app is closed offline.
// The "newer" rule is the same as mergeStat() in model.js and push_progress() in SQL.

export function createQueue(opts) {
  opts = opts || {};
  var load = opts.load || function () { return {}; };
  var save = opts.save || function () {};
  var batchSize = opts.batchSize || 200;
  var pending = load() || {};
  var busy = false;

  function persist() { try { save(pending); } catch (e) {} }

  return {
    enqueue: function (row) {
      var cur = pending[row.item_id];
      // keep whichever is newer by the shared rule: more attempts, then the later attempt
      if (!cur || row.n > cur.n || (row.n === cur.n && (row.last || 0) >= (cur.last || 0))) {
        pending[row.item_id] = row;
      }
      persist();
    },
    size: function () { return Object.keys(pending).length; },
    rows: function () { return Object.keys(pending).map(function (k) { return pending[k]; }); },
    // send(rows) -> Promise; rows that were not replaced meanwhile are removed after success.
    flush: async function (send) {
      if (busy) return { skipped: true };
      var keys = Object.keys(pending);
      if (!keys.length) return { sent: 0 };
      busy = true;
      var sent = 0;
      try {
        for (var i = 0; i < keys.length; i += batchSize) {
          var chunkKeys = keys.slice(i, i + batchSize);
          var chunk = chunkKeys.map(function (k) { return pending[k]; });
          await send(chunk);
          chunkKeys.forEach(function (k, j) { if (pending[k] === chunk[j]) delete pending[k]; });
          sent += chunk.length;
          persist();
        }
        return { sent: sent };
      } catch (e) {
        return { sent: sent, error: e };
      } finally {
        busy = false;
      }
    }
  };
}

export function localStorageBackend(key) {
  return {
    load: function () { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; } },
    save: function (v) { localStorage.setItem(key, JSON.stringify(v)); }
  };
}
