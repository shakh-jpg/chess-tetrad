// Book file readers: PDF, EPUB, DOCX, FB2, HTML, text.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { BookPdf } from './bookpdf.js';

// pdf.js and JSZip come from npm and are loaded lazily, so the main bundle stays small.
// pdf.js is >= 4.2.67 (fix for CVE-2024-4367 / GHSA-wgrm-67xf-hhpq: a malicious PDF could run
// arbitrary JavaScript). The "legacy" build is used for older phones and browsers.
var pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    ]).then(function (m) {
      var lib = m[0].getDocument ? m[0] : m[0].default;
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = m[1].default;
      return lib;
    }).catch(function () { pdfjsP = null; return null; });
  }
  return pdfjsP;
}
async function loadJSZip() {
  var m = await import('jszip');
  return m.default || m;
}

// The only place where a PDF is opened. Options:
//  - isEvalSupported: false — never compile code from PDF data (defence in depth; pdf.js 6
//    no longer has that code path at all, older versions did);
//  - wasmUrl — image decoders (JBIG2, JPEG 2000 for scanned books) shipped with the app.
function pdfOptions(data, baseURI) {
  var base = baseURI || (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  return { data: data, isEvalSupported: false, wasmUrl: new URL('pdfjs/wasm/', base).href };
}
// Returns the loaded document, or throws with a readable message if the library is missing.
async function openPdf(data) {
  var pdfjsLib = await loadPdfjs();
  if (!pdfjsLib) throw new Error('Не загрузилась библиотека чтения PDF. Проверьте интернет и обновите страницу.');
  return pdfjsLib.getDocument(pdfOptions(data)).promise;
}

async function pdfToText(file, onProg) {
  var buf = await file.arrayBuffer();
  var doc = await openPdf(buf), out = [], empty = 0, pageItems = [];
  for (var p = 1; p <= doc.numPages; p++) {
    var page = await doc.getPage(p), tc = await page.getTextContent(), s = '', lastY = null, lastEnd = null;
    pageItems.push(tc.items.filter(function (it) { return it.str !== undefined; }).map(function (it) { return { s: it.str, x: it.transform[4], y: it.transform[5], h: it.height, w: it.width }; }));
    for (var i = 0; i < tc.items.length; i++) {
      var it = tc.items[i]; if (it.str === undefined) continue;
      var y = it.transform[5], x = it.transform[4];
      if (lastY !== null && Math.abs(y - lastY) > 3) { s += '\n'; lastEnd = null; }
      else if (lastEnd !== null && x - lastEnd > 1.2 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
      s += it.str; lastY = y; lastEnd = x + (it.width || 0);
      if (it.hasEOL) { s += '\n'; lastEnd = null; }
    }
    if (s.replace(/\s/g, '').length < 5) empty++;
    out.push(s);
    if (p % 3 === 0 || p === doc.numPages) { onProg(p, doc.numPages); await new Promise(function (r) { setTimeout(r, 0); }); }
  }
  var structured = null;
  try { if (BookPdf) { var st = BookPdf.parse(pageItems); if (st.items.length >= 3) structured = st; } } catch (e) { structured = null; }
  return { text: out.join('\n\n'), pages: doc.numPages, empty: empty, structured: structured };
}
function htmlToText(html) {
  var d = new DOMParser().parseFromString(html, 'text/html'), out = '';
  (function walk(n) {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) {
      var tag = n.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') return;
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (/^(p|div|br|h[1-6]|li|tr|section|blockquote)$/.test(tag)) out += '\n';
    }
  })(d.body || d.documentElement);
  return out;
}
async function epubToText(file) {
  var JSZip = await loadJSZip();
  var zip = await JSZip.loadAsync(await file.arrayBuffer()), names = [];
  try {
    var cont = await zip.file('META-INF/container.xml').async('string');
    var opfPath = /full-path="([^"]+)"/.exec(cont)[1];
    var opf = await zip.file(opfPath).async('string'), base = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    var man = {}; opf.replace(/<item\b[^>]*>/g, function (t) { var id = /\bid="([^"]+)"/.exec(t), hr = /\bhref="([^"]+)"/.exec(t); if (id && hr) man[id[1]] = hr[1]; return t; });
    opf.replace(/<itemref\b[^>]*idref="([^"]+)"/g, function (_, id) { if (man[id]) names.push(base + decodeURIComponent(man[id])); return _; });
  } catch (e) { names = []; }
  if (!names.length) names = Object.keys(zip.files).filter(function (n) { return /\.(x?html?)$/i.test(n); }).sort();
  var out = [];
  for (var i = 0; i < names.length; i++) { var f = zip.file(names[i]); if (f) out.push(htmlToText(await f.async('string'))); }
  return out.join('\n\n');
}
async function docxToText(file) {
  var JSZip = await loadJSZip();
  var zip = await JSZip.loadAsync(await file.arrayBuffer()), xml = await zip.file('word/document.xml').async('string');
  return xml.split('</w:p>').map(function (p) {
    p = p.replace(/<w:tab\/>/g, ' ').replace(/<w:br[^>]*\/>/g, '\n');
    var t = ''; p.replace(/<w:t[^>]*>([^<]*)<\/w:t>|(\n)/g, function (_, a, b) { t += a !== undefined ? a : '\n'; return _; });
    return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }).join('\n');
}
function fb2ToText(txt) {
  var d = new DOMParser().parseFromString(txt, 'application/xml'), out = [];
  Array.prototype.slice.call(d.querySelectorAll('p, v, subtitle, title')).forEach(function (n) { out.push(n.textContent); });
  return out.join('\n');
}
async function fileToText(file, onProg) {
  var n = file.name.toLowerCase();
  if (/\.pdf$/.test(n)) return pdfToText(file, onProg);
  if (/\.epub$/.test(n)) return { text: await epubToText(file) };
  if (/\.docx$/.test(n)) return { text: await docxToText(file) };
  if (/\.fb2$/.test(n)) return { text: fb2ToText(await file.text()) };
  if (/\.(html?|xhtml)$/.test(n)) return { text: htmlToText(await file.text()) };
  if (/\.(txt|pgn|md|text)$/.test(n) || file.type.indexOf('text') === 0) return { text: await file.text() };
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(n)) throw new Error('Картинки загружаются через кнопку «Диаграмма».');
  if (/\.(djvu?|mobi|azw3?|doc)$/.test(n)) throw new Error('Формат ' + n.slice(n.lastIndexOf('.')) + ' не читается. Сохраните книгу как PDF, EPUB или DOCX.');
  throw new Error('Неизвестный формат файла.');
}

export { loadPdfjs, openPdf, pdfOptions, pdfToText, htmlToText, epubToText, docxToText, fb2ToText, fileToText };
