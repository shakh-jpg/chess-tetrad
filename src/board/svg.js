// SVG board rendering and pointer-to-square mapping.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { FILES } from './position.js';
import { PIECES } from './pieces.js';

// Stage 2: pieces are SVG (cburnett set) instead of font glyphs, so they look
// the same on every device and work offline. One hidden sprite with <symbol>s
// is added to the document; boards reference it with <use href="#pc-wK">.
var SPRITE_ID = 'piece-sprite';
function pieceSpriteMarkup() {
  return '<svg id="' + SPRITE_ID + '" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>' +
    Object.keys(PIECES).map(function (k) { return '<symbol id="pc-' + k + '" viewBox="0 0 45 45">' + PIECES[k] + '</symbol>'; }).join('') +
    '</defs></svg>';
}
function ensurePieceSprite(doc) {
  doc = doc || document;
  if (doc.getElementById(SPRITE_ID)) return;
  var holder = doc.createElement('div');
  holder.innerHTML = pieceSpriteMarkup();
  doc.body.insertBefore(holder.firstChild, doc.body.firstChild);
}
// Small standalone icon (promotion dialog, position editor palette).
function pieceIcon(code) {
  return '<svg class="pico" viewBox="0 0 45 45" aria-hidden="true"><use href="#pc-' + code + '"/></svg>';
}

function boardSVG(pieces, o) {
  o = o || {};
  var fl = !!o.flipped, s = '<svg class="bd" viewBox="0 0 800 800" role="img" aria-label="Шахматная доска">';
  var ri, fi, k;
  for (ri = 0; ri < 8; ri++) for (fi = 0; fi < 8; fi++) {
    var file = fl ? 7 - fi : fi, rank = fl ? ri + 1 : 8 - ri, sq = FILES[file] + rank;
    var dark = (file + rank) % 2 === 1, x = fi * 100, y = ri * 100;
    s += '<rect x="' + x + '" y="' + y + '" width="100" height="100" class="' + (dark ? 'sd' : 'sl') + '"/>';
    if (o.last && (o.last.from === sq || o.last.to === sq)) s += '<rect x="' + x + '" y="' + y + '" width="100" height="100" class="hl-last"/>';
    if (o.sel === sq) s += '<rect x="' + x + '" y="' + y + '" width="100" height="100" class="hl-sel"/>';
    if (o.check === sq) s += '<rect x="' + x + '" y="' + y + '" width="100" height="100" class="hl-check"/>';
    if (o.hint === sq) s += '<rect x="' + x + '" y="' + y + '" width="100" height="100" class="hl-hint"/>';
    if (o.low && o.low[sq]) s += '<rect x="' + (x + 4) + '" y="' + (y + 4) + '" width="92" height="92" class="hl-low"/>';
    if (fi === 0) s += '<text x="' + (x + 6) + '" y="' + (y + 22) + '" class="co ' + (dark ? 'cl' : 'cd') + '">' + rank + '</text>';
    if (ri === 7) s += '<text x="' + (x + 94) + '" y="' + (y + 92) + '" text-anchor="end" class="co ' + (dark ? 'cl' : 'cd') + '">' + FILES[file] + '</text>';
  }
  (o.dots || []).forEach(function (d) {
    var f2 = FILES.indexOf(d.sq[0]), r2 = parseInt(d.sq[1], 10);
    var cx = (fl ? 7 - f2 : f2) * 100 + 50, cy = (fl ? r2 - 1 : 8 - r2) * 100 + 50;
    s += d.cap ? '<circle cx="' + cx + '" cy="' + cy + '" r="44" class="dot-cap"/>' : '<circle cx="' + cx + '" cy="' + cy + '" r="15" class="dot"/>';
  });
  for (k in pieces) {
    if (o.dragSq === k) continue;
    var pf = FILES.indexOf(k[0]), pr = parseInt(k[1], 10), p = pieces[k];
    var px = (fl ? 7 - pf : pf) * 100 + 50, py = (fl ? pr - 1 : 8 - pr) * 100 + 50;
    s += '<use href="#pc-' + p + '" x="' + (px - 50) + '" y="' + (py - 50) + '" width="100" height="100" class="pc ' + p[0] + '" data-sq="' + k + '"/>';
  }
  (o.marks || []).forEach(function (q) {
    var mf = FILES.indexOf(q[0]), mr = parseInt(q[1], 10);
    s += '<circle cx="' + ((fl ? 7 - mf : mf) * 100 + 50) + '" cy="' + ((fl ? mr - 1 : 8 - mr) * 100 + 50) + '" r="45" class="mark"/>';
  });
  (o.arrows || []).forEach(function (a) {
    var f1 = FILES.indexOf(a.from[0]), r1 = parseInt(a.from[1], 10), f2 = FILES.indexOf(a.to[0]), r2 = parseInt(a.to[1], 10);
    var x1 = (fl ? 7 - f1 : f1) * 100 + 50, y1 = (fl ? r1 - 1 : 8 - r1) * 100 + 50;
    var x2 = (fl ? 7 - f2 : f2) * 100 + 50, y2 = (fl ? r2 - 1 : 8 - r2) * 100 + 50;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
    s += '<g transform="translate(' + x1 + ',' + y1 + ') rotate(' + ang + ')" class="arrow ' + (a.cls || '') + '"><path d="M0,-8 L' + (len - 34) + ',-8 L' + (len - 34) + ',-24 L' + (len - 6) + ',0 L' + (len - 34) + ',24 L' + (len - 34) + ',8 L0,8Z"/></g>';
  });
  return s + '</svg>';
}
function sqFromEvent(svg, e, fl) {
  var r = svg.getBoundingClientRect();
  var fx = Math.floor((e.clientX - r.left) / r.width * 8), fy = Math.floor((e.clientY - r.top) / r.height * 8);
  if (fx < 0 || fy < 0 || fx > 7 || fy > 7) return null;
  var file = fl ? 7 - fx : fx, rank = fl ? fy + 1 : 8 - fy;
  return FILES[file] + rank;
}
function svgPoint(svg, e) {
  var r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * 800, y: (e.clientY - r.top) / r.height * 800 };
}

export { boardSVG, sqFromEvent, svgPoint, ensurePieceSprite, pieceIcon, pieceSpriteMarkup };
