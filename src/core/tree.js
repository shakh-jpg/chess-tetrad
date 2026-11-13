// Move tree: nodes, variations, movetext output.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
import { Chess as C } from './chess.js';

  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // ---------- дерево ходов ----------
  var nid = 1;
  function makeRoot(fen) {
    var f = fen || START;
    var parts = f.split(' ');
    return { id: nid++, san: null, fen: f, parent: null, kids: [], comment: '',
      color: null, num: parseInt(parts[5] || '1', 10) || 1, turn: parts[1] || 'w' };
  }
  function addChild(node, san, fenAfter) {
    for (var i = 0; i < node.kids.length; i++) if (node.kids[i].san === san) return node.kids[i];
    var turn = node.fen.split(' ')[1];
    var num = parseInt(node.fen.split(' ')[5] || '1', 10) || 1;
    var ch = { id: nid++, san: san, fen: fenAfter, parent: node, kids: [], comment: '', color: turn, num: num };
    node.kids.push(ch);
    return ch;
  }
  function tryMove(node, moveOrSan) {
    var g = new C(node.fen);
    var m = null;
    var pm = typeof moveOrSan === 'string' ? /^([a-h])([a-h])=([QRBN])$/.exec(moveOrSan) : null;
    if (pm) {
      var pc = g.moves({ verbose: true }).filter(function (x) {
        return x.piece === 'p' && x.flags.indexOf('c') >= 0 && x.from[0] === pm[1] && x.to[0] === pm[2] && (x.promotion || '').toUpperCase() === pm[3];
      });
      if (pc.length === 1) m = g.move(pc[0]);
    } else if (typeof moveOrSan === 'string' && /^[a-h][a-h]$/.test(moveOrSan)) {
      var cand = g.moves({ verbose: true }).filter(function (x) {
        return x.piece === 'p' && x.flags.indexOf('c') >= 0 && x.from[0] === moveOrSan[0] && x.to[0] === moveOrSan[1];
      });
      if (cand.length === 1) m = g.move(cand[0]);
    } else if (typeof moveOrSan === 'string') {
      m = g.move(moveOrSan);
      if (!m) {
        var mm = /^([KQRBN])?([a-h])?([1-8])?x?-?([a-h][1-8])(?:=?([QRBN]))?[+#]?$/.exec(moveOrSan);
        if (mm) {
          var pc = (mm[1] || 'P').toLowerCase();
          var c2 = g.moves({ verbose: true }).filter(function (x) {
            if (x.piece !== pc || x.to !== mm[4]) return false;
            if (mm[2] && x.from[0] !== mm[2]) return false;
            if (mm[3] && x.from[1] !== mm[3]) return false;
            if (mm[5] && (x.promotion || '').toUpperCase() !== mm[5]) return false;
            return true;
          });
          if (c2.length > 1 && !mm[5]) c2 = c2.filter(function (x) { return !x.promotion || x.promotion === 'q'; });
          if (c2.length === 1) m = g.move(c2[0]);
        }
      }
      if (!m) m = g.move(moveOrSan, { sloppy: true });
    } else m = g.move(moveOrSan, { sloppy: true });
    if (!m) return null;
    return { node: addChild(node, m.san, g.fen()), move: m };
  }
  function mainLine(root) {
    var out = [], n = root;
    while (n.kids.length) { n = n.kids[0]; out.push(n); }
    return out;
  }
  function removeNode(node) {
    if (!node.parent) return;
    var k = node.parent.kids, i = k.indexOf(node);
    if (i >= 0) k.splice(i, 1);
  }
  function promoteNode(node) {
    var p = node.parent; if (!p) return;
    var i = p.kids.indexOf(node);
    if (i > 0) { p.kids.splice(i, 1); p.kids.unshift(node); }
  }

  var NAGMAP = { '$1': '!', '$2': '?', '$3': '!!', '$4': '??', '$5': '!?', '$6': '?!' };
  // ---------- вывод в текст ходов ----------
  function moveTok(node, forceNum) {
    var sn = node.san + (node.nag || '');
    if (node.color === 'w') return node.num + '. ' + sn;
    return forceNum ? node.num + '... ' + sn : sn;
  }
  function printLine(first) {
    var parts = [], node = first, needNum = true;
    while (node) {
      parts.push(moveTok(node, needNum)); needNum = false;
      if (node.comment) { parts.push('{' + node.comment.replace(/[{}]/g, '') + '}'); needNum = true; }
      var par = node.parent;
      if (par && par.kids[0] === node && par.kids.length > 1) {
        for (var i = 1; i < par.kids.length; i++) parts.push('(' + printLine(par.kids[i]) + ')');
        needNum = true;
      }
      node = node.kids[0];
    }
    return parts.join(' ');
  }
  function toMovetext(root) {
    if (!root.kids.length) return '';
    return printLine(root.kids[0]);
  }

export { START, makeRoot, addChild, tryMove, mainLine, removeNode, promoteNode, NAGMAP, toMovetext };
