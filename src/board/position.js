// Position helpers: FEN <-> square map.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
var FILES = 'abcdefgh';
var GL = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
function fenToMap(fen) {
  var map = {}, rows = fen.split(' ')[0].split('/');
  for (var r = 0; r < 8; r++) {
    var f = 0;
    for (var i = 0; i < rows[r].length; i++) {
      var ch = rows[r][i];
      if (/\d/.test(ch)) f += parseInt(ch, 10);
      else { map[FILES[f] + (8 - r)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; }
    }
  }
  return map;
}
function mapToFen(map, turn, castle) {
  var rows = [];
  for (var r = 8; r >= 1; r--) {
    var s = '', e = 0;
    for (var f = 0; f < 8; f++) {
      var p = map[FILES[f] + r];
      if (!p) e++; else { if (e) { s += e; e = 0; } s += p[0] === 'w' ? p[1] : p[1].toLowerCase(); }
    }
    if (e) s += e; rows.push(s);
  }
  return rows.join('/') + ' ' + (turn || 'w') + ' ' + (castle || '-') + ' - 0 1';
}
function kingSq(map, color) { for (var k in map) if (map[k] === color + 'K') return k; return null; }

export { FILES, GL, fenToMap, mapToFen, kingSq };
