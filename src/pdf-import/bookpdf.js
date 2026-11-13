// Parser for PDF puzzle books whose diagrams are typeset with a chess font.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { Core } from '../core/index.js';
import { Chess } from '../core/chess.js';

  // коды клеток шрифта диаграмм: младший байт символа
  var CELL = {};
  'pnbrqk'.split('').forEach(function (c) { CELL[c] = ['w', c.toUpperCase()]; CELL[c.toUpperCase()] = ['w', c.toUpperCase()]; });
  'omvtwl'.split('').forEach(function (c, i) { var p = 'PNBRQK'[i]; CELL[c] = ['b', p]; CELL[c.toUpperCase()] = ['b', p]; });
  // значки фигур внутри текста (младший байт): король, ферзь, конь, слон, ладья
  var FIG = { 0xA2: 'K', 0xA3: 'Q', 0xA4: 'N', 0xA5: 'B', 0xA6: 'R' };
  var STEP = 15;

  function isPUA(code) { return code >= 0xF000 && code <= 0xF0FF; }
  function hasPUA(s) { for (var i = 0; i < s.length; i++) if (isPUA(s.charCodeAt(i))) return true; return false; }

  // ---------- диаграммы на странице ----------
  function findDiagrams(items) {
    var cells = [];
    items.forEach(function (it) {
      if (it.h < 13.5 || !hasPUA(it.s)) return;
      for (var i = 0; i < it.s.length; i++) {
        var c = it.s.charCodeAt(i);
        if (isPUA(c)) cells.push({ x: it.x + STEP * i, y: it.y, c: c & 0xFF });
      }
    });
    function at(x, y) {
      for (var i = 0; i < cells.length; i++) {
        var q = cells[i];
        if (Math.abs(q.x - x) < 3 && Math.abs(q.y - y) < 2) return q.c;
      }
      return -1;
    }
    var out = [];
    cells.forEach(function (q) {
      if (q.c !== 0x21) return;
      if (at(q.x + STEP * 9, q.y) !== 0x23) return;
      var rows = [], ok = true;
      for (var r = 1; r <= 8 && ok; r++) {
        var y = q.y - STEP * r;
        if (at(q.x, y) !== 0x24 || at(q.x + STEP * 9, y) !== 0x25) { ok = false; break; }
        var row = '';
        for (var f = 1; f <= 8; f++) { var c = at(q.x + STEP * f, y); row += (c < 0 || c === 0x20 || c === 0x2B) ? '.' : String.fromCharCode(c); }
        rows.push(row);
      }
      if (ok) out.push({ x: q.x, y: q.y, rows: rows });
    });
    return out;
  }

  function figText(it) {
    var s = '';
    for (var i = 0; i < it.s.length; i++) {
      var c = it.s.charCodeAt(i);
      if (isPUA(c)) s += FIG[c & 0xFF] || ''; else s += it.s[i];
    }
    return s;
  }

  function boardFen(rows, turn) {
    var parts = [], map = {};
    rows.forEach(function (row, r) {
      var s = '', e = 0;
      for (var f = 0; f < 8; f++) {
        var d = CELL[row[f]];
        if (!d) { e++; continue; }
        if (e) { s += e; e = 0; }
        s += d[0] === 'w' ? d[1] : d[1].toLowerCase();
        map['abcdefgh'[f] + (8 - r)] = (d[0] === 'w' ? d[1] : d[1].toLowerCase());
      }
      if (e) s += e; parts.push(s);
    });
    var cs = '';
    if (map.e1 === 'K') { if (map.h1 === 'R') cs += 'K'; if (map.a1 === 'R') cs += 'Q'; }
    if (map.e8 === 'k') { if (map.h8 === 'r') cs += 'k'; if (map.a8 === 'r') cs += 'q'; }
    return parts.join('/') + ' ' + turn + ' ' + (cs || '-') + ' - 0 1';
  }

  // ---------- строки текста страницы ----------
  function pageLines(items, boxes) {
    function inBox(it) { return boxes.some(function (b) { return it.x >= b[0] && it.x <= b[1] && it.y >= b[2] && it.y <= b[3]; }); }
    var use = items.filter(function (it) { return it.s && it.y <= 525 && !inBox(it) && !(it.h >= 13.5 && hasPUA(it.s)); });
    // опорные строки по обычному тексту
    var bases = [];
    use.forEach(function (it) {
      if (hasPUA(it.s) || !it.s.trim()) return;
      for (var i = 0; i < bases.length; i++) if (Math.abs(bases[i].y - it.y) <= 5) return;
      bases.push({ y: it.y, parts: [] });
    });
    bases.sort(function (a, b) { return b.y - a.y; });
    if (!bases.length) return [];
    use.forEach(function (it) {
      var best = null, bd = 1e9;
      bases.forEach(function (b) { var d = Math.abs(b.y - it.y); if (d < bd) { bd = d; best = b; } });
      if (best && bd <= 8) best.parts.push(it);
    });
    var lines = [];
    bases.forEach(function (b) {
      b.parts.sort(function (p, q) { return p.x - q.x; });
      var t = b.parts.map(figText).join('').replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    });
    return lines;
  }

  // ---------- квадратные скобки книги -> PGN ----------
  function bracketsToPgn(t) {
    function conv(s) {
      var out = '', i = 0;
      while (i < s.length) {
        var ch = s[i];
        if (ch === '[') {
          var d = 1, j = i + 1;
          while (j < s.length && d > 0) { if (s[j] === '[') d++; else if (s[j] === ']') d--; j++; }
          var inner = s.slice(i + 1, d === 0 ? j - 1 : j);
          if (/^\s*(\d+\s*\.|…)/.test(inner)) {
            var segs = splitTop(inner, ';');
            segs.forEach(function (sg) { out += ' (' + conv(sg).trim() + ') '; });
          } else out += ' {' + inner.replace(/[\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() + '} ';
          i = j;
        } else { out += ch; i++; }
      }
      return out;
    }
    function splitTop(s, sep) {
      var res = [], d = 0, cur = '';
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (c === '[') d++; if (c === ']') d--;
        if (c === sep && d === 0) { res.push(cur); cur = ''; } else cur += c;
      }
      res.push(cur); return res;
    }
    return conv(t).replace(/\s+/g, ' ').trim();
  }

  // ---------- основной разбор ----------
  function parse(pages, opts) {
    opts = opts || {};
    var probs = [], boxesByPage = [], firstDiagram = -1;
    pages.forEach(function (items, pno) {
      var ds = findDiagrams(items), boxes = [];
      ds.forEach(function (d) {
        boxes.push([d.x - 5, d.x + 178, d.y - STEP * 9 - 32, d.y + 20]);
        var label = null;
        items.forEach(function (it) {
          if (/^\d{1,3}$/.test(it.s.trim()) && it.h >= 10 && it.h <= 12.5 && it.y > d.y + 1 && it.y < d.y + 17 && it.x > d.x - 4 && it.x < d.x + 46) label = parseInt(it.s, 10);
        });
        var cap = '';
        items.forEach(function (it) {
          if (it.h > 10.6 || !it.s || it.y < d.y - STEP * 9 - 30 || it.y > d.y - STEP * 9 + 1 || it.x < d.x - 3 || it.x > d.x + 178) return;
          cap += figText(it);
        });
        cap = cap.replace(/\s+/g, ' ').trim();
        probs.push({ page: pno, n: label, rows: d.rows, caption: cap, x: d.x, y: d.y });
      });
      boxesByPage[pno] = boxes;
      if (ds.length && firstDiagram < 0) firstDiagram = pno;
    });
    var result = { items: [], stats: { diagrams: probs.length, entries: 0, noAnswer: 0, errors: 0 } };
    if (probs.length < 3) return result;

    // тексты после первой диаграммы
    var lines = [], sections = {}, curSection = '';
    pages.forEach(function (items, pno) {
      var ls = pageLines(items, boxesByPage[pno] || []);
      if (!(boxesByPage[pno] || []).length && ls.length && ls.length <= 3) {
        var joined = ls.join(' ');
        if (joined.length < 70 && !/^\d/.test(joined) && !/^Ответы/i.test(joined) && /[А-Яа-я]/.test(joined)) curSection = joined;
      }
      (boxesByPage[pno] || []).forEach(function (b) { });
      probs.forEach(function (p) { if (p.page === pno && sections[p.n] === undefined) sections[p.n] = curSection; });
      if (pno >= firstDiagram) ls.forEach(function (l) { lines.push({ p: pno, t: l }); });
    });

    var maxN = Math.max.apply(null, probs.map(function (p) { return p.n || 0; }));
    var entries = {}, cur = null, nxt = 1;
    var HDR = /^(\d{1,3})\.\s+(?![…]|[a-h][1-8]|[a-h]x|[KQRBN][a-h]?[1-8x])(\S.*)$/;
    lines.forEach(function (ln) {
      var m = HDR.exec(ln.t);
      if (m) {
        var num = parseInt(m[1], 10);
        if (num >= nxt && num <= nxt + 5 && num <= maxN && /[A-Za-zА-Яа-я]/.test(m[2])) {
          cur = num; nxt = num + 1;
          entries[cur] = { hdr: [m[2]], body: [], inBody: false };
          return;
        }
      }
      if (cur === null) return;
      var e = entries[cur];
      if (!e.inBody) {
        if (/^1\s*\./.test(ln.t)) { e.inBody = true; e.body.push(ln.t); } else e.hdr.push(ln.t);
      } else {
        if (/^\d+$/.test(ln.t)) return;
        e.body.push(ln.t);
      }
    });

    probs.sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
    probs.forEach(function (p) {
      var cap = p.caption, e = entries[p.n];
      var bodyText = e && e.body.length ? e.body.join(' ') : '';
      var turn = bodyText ? (/^\s*1\s*\.\s*(…|\.\s*\.\s*\.)/.test(bodyText) ? 'b' : 'w') : ((/Черн|черн|…/.test(cap)) ? 'b' : 'w');
      var fen = boardFen(p.rows, turn);
      var test = new Chess();
      if (!test.load(fen)) {
        var alt = boardFen(p.rows, turn === 'w' ? 'b' : 'w');
        if (test.load(alt)) fen = alt; else return;
      }
      var hdr = e ? e.hdr.join(' ').replace(/\s+/g, ' ').replace(/[\s.,]+$/, '') : '';
      var title = p.n + (hdr ? '. ' + hdr : '. Задача');
      var item = {
        type: 'puzzle', title: title, startFen: fen, text: '', result: '', plies: 0, err: null, warn: 0,
        section: sections[p.n] || '', note: cap.replace(/\?*$/, '').trim(), num: p.n, srcPage: p.page + 1
      };
      if (e && e.body.length) {
        result.stats.entries++;
        var body = bracketsToPgn(e.body.join(' ').replace(/\s+/g, ' ')).replace(/[·]/g, '');
        var r = Core.parseMovetext(fen, body);
        item.text = Core.toMovetext(r.root);
        item.plies = Core.mainLine(r.root).length;
        item.warn = r.warn || 0;
        if (r.err) { item.err = { token: r.err.token, ply: r.err.ply, before: r.err.before }; item.raw = body.slice(0, 4000); result.stats.errors++; }
      } else result.stats.noAnswer++;
      result.items.push(item);
    });
    return result;
  }


export const BookPdf = { parse: parse, findDiagrams: findDiagrams, bracketsToPgn: bracketsToPgn, boardFen: boardFen };
export default BookPdf;
