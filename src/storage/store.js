// Storage: IndexedDB with in-memory fallback.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
var Store = (function () {
  var db = null, mem = {}, useMem = false, timers = {};
  function open() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('shakhmatnaya-tetrad', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('books', { keyPath: 'id' }); };
        rq.onsuccess = function () { db = rq.result; res(); };
        rq.onerror = rq.onblocked = function () { useMem = true; res(); };
      } catch (e) { useMem = true; res(); }
    });
  }
  function all() {
    if (useMem || !db) return Promise.resolve(Object.keys(mem).map(function (k) { return mem[k]; }));
    return new Promise(function (res) {
      try {
        var rq = db.transaction('books').objectStore('books').getAll();
        rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { res([]); };
      } catch (e) { res([]); }
    });
  }
  function put(b) {
    mem[b.id] = b;
    if (useMem || !db) return Promise.resolve();
    return new Promise(function (res) {
      try { var tx = db.transaction('books', 'readwrite'); tx.objectStore('books').put(b); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); }
    });
  }
  function del(id) {
    delete mem[id];
    if (useMem || !db) return Promise.resolve();
    return new Promise(function (res) {
      try { var tx = db.transaction('books', 'readwrite'); tx.objectStore('books').delete(id); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); }
    });
  }
  function save(b) {
    clearTimeout(timers[b.id]);
    timers[b.id] = setTimeout(function () { put(JSON.parse(JSON.stringify(b))); }, 350);
  }
  return { open: open, all: all, put: put, del: del, save: save, get persistent() { return !useMem && !!db; } };
})();

export { Store };
export default Store;
