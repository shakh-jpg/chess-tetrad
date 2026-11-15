// Storage: IndexedDB with in-memory fallback.
// Based on the prototype's Store. Stage 2 changes:
//  - write/delete errors are no longer swallowed: they resolve to false and call onError
//    (the UI shows a toast), e.g. when the disk quota is exhausted;
//  - requestPersistence() asks the browser not to evict the data (navigator.storage.persist);
//  - createStore(deps) allows tests to inject a fake indexedDB / navigator.storage.

export function describeError(e) {
  var name = e && (e.name || (e.target && e.target.error && e.target.error.name));
  if (name === 'QuotaExceededError') return 'на устройстве закончилось место для данных сайта';
  var msg = e && (e.message || (e.target && e.target.error && e.target.error.message));
  return msg || name || 'неизвестная ошибка';
}

export function createStore(deps) {
  deps = deps || {};
  var idb = deps.indexedDB !== undefined ? deps.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  var storage = deps.storage !== undefined ? deps.storage : (typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null);
  var dbName = deps.dbName || 'shakhmatnaya-tetrad';
  var db = null, mem = {}, useMem = false, timers = {}, onError = null;

  function fail(op, e) {
    if (onError) { try { onError(op, describeError(e), e); } catch (x) {} }
    return false;
  }
  function open() {
    return new Promise(function (res) {
      try {
        if (!idb) throw new Error('no indexedDB');
        var rq = idb.open(dbName, 1);
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
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function (e) { fail('read', e); res([]); };
      } catch (e) { fail('read', e); res([]); }
    });
  }
  // One record by id (e.g. a saved scan job), or null.
  function get(id) {
    if (useMem || !db) return Promise.resolve(mem[id] || null);
    return new Promise(function (res) {
      try {
        var rq = db.transaction('books').objectStore('books').get(id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function (e) { fail('read', e); res(null); };
      } catch (e) { fail('read', e); res(null); }
    });
  }
  function write(op, fn) {
    if (useMem || !db) return Promise.resolve(true);
    return new Promise(function (res) {
      var done = false;
      function ok() { if (!done) { done = true; res(true); } }
      function bad(e) { if (!done) { done = true; res(fail(op, e)); } }
      try {
        var tx = db.transaction('books', 'readwrite');
        fn(tx.objectStore('books'));
        tx.oncomplete = ok;
        tx.onerror = function (e) { bad(tx.error || e); };
        tx.onabort = function (e) { bad(tx.error || e); };
      } catch (e) { bad(e); }
    });
  }
  // Resolve to true on success, false on failure (onError has been called).
  function put(b) { mem[b.id] = b; return write('save', function (os) { os.put(b); }); }
  function del(id) { delete mem[id]; return write('delete', function (os) { os.delete(id); }); }
  function save(b) {
    clearTimeout(timers[b.id]);
    timers[b.id] = setTimeout(function () { put(JSON.parse(JSON.stringify(b))); }, 350);
  }
  // Ask the browser to keep the data (not evict it under storage pressure).
  // Resolves to 'persisted' | 'granted' | 'denied' | 'unsupported'.
  function requestPersistence() {
    if (!storage || !storage.persist) return Promise.resolve('unsupported');
    var already = storage.persisted ? storage.persisted() : Promise.resolve(false);
    return Promise.resolve(already).then(function (p) {
      if (p) return 'persisted';
      return Promise.resolve(storage.persist()).then(function (g) { return g ? 'granted' : 'denied'; });
    }).catch(function () { return 'unsupported'; });
  }
  return {
    open: open, all: all, get: get, put: put, del: del, save: save, requestPersistence: requestPersistence,
    setErrorHandler: function (fn) { onError = fn; },
    get persistent() { return !useMem && !!db; }
  };
}

var Store = createStore();

export { Store };
export default Store;
