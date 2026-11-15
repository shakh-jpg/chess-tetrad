// Web Worker for scanned books: decodes DjVu pages (djvu-rs, MIT) one at a time and returns
// grayscale pixels. Keeps the main thread responsive; only one page is in memory at once.
import initDjvu, { WasmDocument } from 'djvu-rs';
import { parseDjvu } from './djvu-split.js';

var djvu = null, ready = null;

// djvu-rs picks the SIMD or the scalar build itself; Vite bundles both .wasm files as assets.
function ensureDecoder() {
  if (!ready) ready = initDjvu();
  return ready;
}

function toGray(rgba, n) {
  var g = new Uint8ClampedArray(n);
  for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return g;
}

async function handle(msg) {
  if (msg.cmd === 'open-djvu') {
    await ensureDecoder();
    djvu = parseDjvu(new Uint8Array(msg.bytes));
    return { pages: djvu.pages };
  }
  if (msg.cmd === 'render') {
    if (!djvu) throw new Error('Файл не открыт.');
    var doc = WasmDocument.from_bytes(djvu.pageBytes(msg.page));
    try {
      var page = doc.page(0);
      var w = page.width_at(msg.dpi), h = page.height_at(msg.dpi);
      var rgba = page.render(msg.dpi);
      page.free();
      var gray = toGray(rgba, w * h);
      return { width: w, height: h, gray: gray, transfer: [gray.buffer] };
    } finally { doc.free(); }
  }
  if (msg.cmd === 'close') { djvu = null; return { ok: true }; }
  throw new Error('Неизвестная команда: ' + msg.cmd);
}

self.onmessage = function (e) {
  var msg = e.data;
  handle(msg).then(function (res) {
    var transfer = res.transfer || []; delete res.transfer;
    self.postMessage({ id: msg.id, ok: true, result: res }, transfer);
  }, function (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  });
};
