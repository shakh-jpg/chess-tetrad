// @ts-check
// Minimal DjVu container (IFF) reader: splits a bundled multi-page DjVu into single-page documents.
//
// Why: many scanned books store shared JB2 dictionaries (Djbz) in separate components referenced
// by INCL chunks whose names are in a legacy code page (e.g. "…Страница_010_0001.djbz" in CP1251).
// The decoder we use (djvu-rs) renders such pages blank because it cannot resolve those names.
// We inline the referenced dictionary into each page, which is also memory-friendly: only one page
// lives in the decoder at a time.
//
// Dictionary lookup: INCL names are matched to DJVI components by order of first appearance
// (djvm writes each shared dictionary before the first page that uses it). When the counts do not
// match, the most recent preceding DJVI component is used.

/**
 * @typedef {{ id: string, off: number, len: number, data: Uint8Array }} Chunk
 * @typedef {{ kind: string, off: number, len: number }} Component
 */

/** @param {Uint8Array} b @param {number} o @param {number} n */
function str(b, o, n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; }
/** @param {Uint8Array} b @param {number} o */
function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }

/** @param {Uint8Array} b @param {number} start @param {number} end @returns {Chunk[]} */
function readChunks(b, start, end) {
  /** @type {Chunk[]} */ var out = [];
  var o = start;
  while (o + 8 <= end) {
    var id = str(b, o, 4), len = u32(b, o + 4);
    if (o + 8 + len > b.length) throw new Error('Файл DjVu повреждён или обрезан.');
    out.push({ id: id, off: o, len: len, data: b.subarray(o + 8, o + 8 + len) });
    o += 8 + len + (len & 1);
  }
  return out;
}

/** @param {string} id @param {Uint8Array} data */
function chunkBytes(id, data) {
  var pad = data.length & 1, out = new Uint8Array(8 + data.length + pad);
  for (var i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  out[4] = (data.length >>> 24) & 255; out[5] = (data.length >>> 16) & 255; out[6] = (data.length >>> 8) & 255; out[7] = data.length & 255;
  out.set(data, 8);
  return out;
}

/** Builds "AT&T FORM:DJVU" around the given chunks. @param {Uint8Array[]} parts */
export function buildPage(parts) {
  var body = parts.reduce(function (n, p) { return n + p.length; }, 0);
  var out = new Uint8Array(16 + body);
  out.set([0x41, 0x54, 0x26, 0x54, 0x46, 0x4f, 0x52, 0x4d], 0);
  var size = 4 + body;
  out[8] = (size >>> 24) & 255; out[9] = (size >>> 16) & 255; out[10] = (size >>> 8) & 255; out[11] = size & 255;
  out.set([0x44, 0x4a, 0x56, 0x55], 12);
  var o = 16;
  parts.forEach(function (p) { out.set(p, o); o += p.length; });
  return out;
}

/**
 * Parses a DjVu file. Returns the page count and a function that builds a standalone page.
 * @param {Uint8Array} b
 * @returns {{ pages: number, kind: 'single' | 'bundled', pageBytes: (i: number) => Uint8Array }}
 */
export function parseDjvu(b) {
  if (b.length < 16 || str(b, 0, 4) !== 'AT&T' || str(b, 4, 4) !== 'FORM') throw new Error('Это не файл DjVu.');
  var top = str(b, 12, 4), end = Math.min(b.length, 12 + u32(b, 8));
  if (top === 'DJVU') return { pages: 1, kind: 'single', pageBytes: function () { return b; } };
  if (top !== 'DJVM') throw new Error('Неизвестный вид файла DjVu (' + top + ').');

  /** @type {Component[]} */ var comps = [];
  var bundled = true;
  readChunks(b, 16, end).forEach(function (c) {
    if (c.id === 'DIRM' && c.len > 0 && !(c.data[0] & 0x80)) bundled = false;
    if (c.id === 'FORM') comps.push({ kind: str(b, c.off + 8, 4), off: c.off, len: c.len });
  });
  if (!bundled) throw new Error('Многофайловый (indirect) DjVu не поддерживается. Нужен один файл .djvu.');
  /** @param {Component} c */
  var inner = function (c) { return readChunks(b, c.off + 12, c.off + 8 + c.len); };
  var dicts = comps.filter(function (c) { return c.kind === 'DJVI'; });
  var pagesC = comps.filter(function (c) { return c.kind === 'DJVU'; });
  if (!pagesC.length) throw new Error('В файле DjVu нет страниц.');

  // INCL name -> dictionary component, by order of first appearance
  /** @type {Map<string, Component>} */ var byName = new Map();
  var names = [];
  pagesC.forEach(function (pc) {
    inner(pc).forEach(function (ch) { if (ch.id === 'INCL') { var k = str(ch.data, 0, ch.data.length); if (names.indexOf(k) < 0) names.push(k); } });
  });
  var orderOk = names.length === dicts.length;
  if (orderOk) names.forEach(function (k, i) { byName.set(k, dicts[i]); });

  /** @param {Component} pc @returns {Component|undefined} */
  function precedingDict(pc) { var d; dicts.forEach(function (x) { if (x.off < pc.off) d = x; }); return d; }

  return {
    pages: pagesC.length,
    kind: 'bundled',
    pageBytes: function (i) {
      var pc = pagesC[i];
      if (!pc) throw new Error('Нет страницы ' + (i + 1) + '.');
      /** @type {Uint8Array[]} */ var parts = [];
      inner(pc).forEach(function (ch) {
        if (ch.id !== 'INCL') { parts.push(chunkBytes(ch.id, ch.data)); return; }
        var name = str(ch.data, 0, ch.data.length);
        var d = (orderOk && byName.get(name)) || precedingDict(pc);
        var djbz = d && inner(d).filter(function (x) { return x.id === 'Djbz'; })[0];
        if (djbz) parts.push(chunkBytes('Djbz', djbz.data));
      });
      return buildPage(parts);
    }
  };
}

/** For tests: list chunk ids of a standalone page. @param {Uint8Array} page */
export function pageChunkIds(page) {
  return readChunks(page, 16, Math.min(page.length, 12 + u32(page, 8))).map(function (c) { return c.id; });
}
