// User piece samples for diagram recognition, one set per book.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { Store } from '../storage/store.js';

var Samples = (function () {
  var KEY = '__recog', data = { id: KEY, created: 0, profiles: {}, last: '' }, MAXP = 8;
  function load(rec) { if (rec && rec.profiles) data = rec; }
  function persist() { Store.put(JSON.parse(JSON.stringify(data))); }
  function names() { return Object.keys(data.profiles); }
  function list(name) { return data.profiles[name] || []; }
  function count(name) { return list(name).length; }
  // известные результаты распознавания → образцы (по одному набору на книгу)
  function learn(name, feats, cells, res) {
    var arr = data.profiles[name] = data.profiles[name] || [], added = 0;
    res.forEach(function (r) {
      if (!r.f) return;
      var exp = cells[r.sq] || null;
      if (r.p === exp && r.conf >= 0.2) return;           // и так уверенно распознаётся
      var dup = arr.some(function (m) { return m.p === exp && Math.abs(m.asp - r.f.asp) < 0.03 && Math.abs(m.rel - r.f.rel) < 0.03 && Math.abs((m.dr || 0) - r.f.dr) < 0.1 && m.bits.every(function (v, i) { return Math.abs(v - r.f.bits[i]) < 0.12; }); });
      if (dup) return;
      var same = arr.filter(function (m) { return m.p === exp; });
      if (same.length >= MAXP) arr.splice(arr.indexOf(same[0]), 1);
      arr.push({ p: exp, bits: r.f.bits, asp: r.f.asp, rel: r.f.rel, dr: r.f.dr }); added++;
    });
    data.last = name; persist(); return added;
  }
  function reset(name) { delete data.profiles[name]; persist(); }
  function exportAll() { return JSON.parse(JSON.stringify(data.profiles)); }
  function merge(profiles) {
    if (!profiles || typeof profiles !== 'object') return;
    Object.keys(profiles).forEach(function (n) {
      var arr = profiles[n]; if (!Array.isArray(arr)) return;
      data.profiles[n] = arr.filter(function (m) { return m && Array.isArray(m.bits) && m.bits.length === 256 && typeof m.asp === 'number' && typeof m.rel === 'number'; }).slice(0, 120);
    });
    persist();
  }
  return { exportAll: exportAll, merge: merge, load: load, names: names, list: list, count: count, learn: learn, reset: reset, get last() { return data.last; }, setLast: function (n) { data.last = n; persist(); } };
})();

export { Samples };
export default Samples;
