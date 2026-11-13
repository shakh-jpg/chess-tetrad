// Engine: Stockfish 10 (asm.js, CDN) in a worker, with a simple built-in fallback search.
// Moved verbatim from the prototype (shakhmatnaya-tetrad_artifact_2026-11-13.html); see git history.
var Engine = (function () {
  var SF_URL = 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.asm.js';
  var CJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';

  var FALLBACK = [
    "importScripts('" + CJS_URL + "');",
    "var VAL={p:100,n:320,b:335,r:500,q:900,k:0};",
    "function evalPos(g){var b=g.board(),s=0,r,c,p,v,cd;",
    " for(r=0;r<8;r++)for(c=0;c<8;c++){p=b[r][c];if(!p)continue;v=VAL[p.type];",
    "  cd=Math.abs(3.5-c)+Math.abs(3.5-r);",
    "  if(p.type==='n'||p.type==='b')v+=(7-cd)*4;",
    "  else if(p.type==='p'){var adv=p.color==='w'?(7-r):r;v+=adv*6+(cd<3?8:0);}",
    "  else if(p.type==='q')v+=(7-cd)*1;",
    "  else if(p.type==='k')v+=(cd)*(-0);",
    "  s+=p.color==='w'?v:-v;}",
    " return g.turn()==='w'?s:-s;}",
    "var nodes=0,deadline=0,stopped=false;",
    "function order(ms){return ms.sort(function(a,b){return sc(b)-sc(a);});}",
    "function sc(m){var s=0;if(m.captured)s+=10*VAL[m.captured]-VAL[m.piece]/10+1000;if(m.promotion)s+=800;return s;}",
    "function q(g,alpha,beta,d){nodes++;var st=evalPos(g);if(d<=0)return st;if(st>=beta)return beta;if(st>alpha)alpha=st;",
    " var ms=g.moves({verbose:true}).filter(function(m){return m.captured;});order(ms);",
    " for(var i=0;i<ms.length;i++){g.move(ms[i]);var v=-q(g,-beta,-alpha,d-1);g.undo();if(v>=beta)return beta;if(v>alpha)alpha=v;}",
    " return alpha;}",
    "function search(g,d,alpha,beta,ply,pv){nodes++;",
    " if((nodes&255)===0&&Date.now()>deadline)stopped=true;if(stopped)return 0;",
    " if(g.in_draw())return 0;",
    " var ms=g.moves({verbose:true});",
    " if(!ms.length)return g.in_check()?-30000+ply:0;",
    " if(d<=0)return q(g,alpha,beta,3);",
    " order(ms);var best=-Infinity,line=[];",
    " for(var i=0;i<ms.length;i++){var m=ms[i];g.move(m);var sub=[];var v=-search(g,d-1,-beta,-alpha,ply+1,sub);g.undo();",
    "  if(stopped)return 0;",
    "  if(v>best){best=v;line=[m.from+m.to+(m.promotion||'')].concat(sub);}",
    "  if(v>alpha)alpha=v;if(alpha>=beta)break;}",
    " pv.length=0;Array.prototype.push.apply(pv,line);return best;}",
    "onmessage=function(e){var d=e.data;if(d.cmd==='uci'){postMessage('uciok');return;}",
    " if(d.cmd==='go'){var g=new Chess(d.fen),turn=g.turn();stopped=false;nodes=0;deadline=Date.now()+(d.ms||2500);",
    "  var lastPv=[],lastV=0;",
    "  for(var depth=1;depth<=(d.depth||4);depth++){var pv=[];var v=search(g,depth,-40000,40000,0,pv);if(stopped)break;lastPv=pv;lastV=v;",
    "   var mate=null,cp=v;if(Math.abs(v)>29000){mate=(v>0?1:-1)*Math.ceil((30000-Math.abs(v)+1)/2);cp=null;}",
    "   postMessage({info:true,depth:depth,multipv:1,cp:cp,mate:mate,pv:lastPv,turn:turn});}",
    "  postMessage({done:true});}};"
  ].join('\n');

  var worker = null, kind = null, busy = false, pending = null, cur = null, initP = null;

  function blobUrl(code) { return URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); }

  function startStockfish() {
    return new Promise(function (res, rej) {
      var w, t;
      try { w = new Worker(blobUrl("importScripts('" + SF_URL + "');")); } catch (e) { rej(e); return; }
      t = setTimeout(function () { try { w.terminate(); } catch (e) {} rej(new Error('timeout')); }, 15000);
      w.onmessage = function (e) { if (String(e.data).indexOf('uciok') >= 0) { clearTimeout(t); res(w); } };
      w.onerror = function (err) { clearTimeout(t); try { w.terminate(); } catch (e) {} rej(err); };
      w.postMessage('uci');
    });
  }
  function startFallback() {
    return new Promise(function (res, rej) {
      var w;
      try { w = new Worker(blobUrl(FALLBACK)); } catch (e) { rej(e); return; }
      var t = setTimeout(function () { rej(new Error('timeout')); }, 15000);
      w.onmessage = function (e) { if (e.data === 'uciok') { clearTimeout(t); res(w); } };
      w.onerror = function (err) { clearTimeout(t); rej(err); };
      w.postMessage({ cmd: 'uci' });
    });
  }

  function init() {
    if (initP) return initP;
    initP = startStockfish().then(function (w) {
      worker = w; kind = 'stockfish'; wire(); return kind;
    }).catch(function () {
      return startFallback().then(function (w) { worker = w; kind = 'fallback'; wire(); return kind; });
    }).catch(function (e) { kind = 'none'; return kind; });
    return initP;
  }

  function wire() {
    worker.onmessage = function (e) {
      var d = e.data;
      if (kind === 'stockfish') {
        var line = String(d);
        if (line.indexOf('bestmove') === 0) { busy = false; if (pending) { var p = pending; pending = null; start(p); } return; }
        if (!cur || line.indexOf('info') !== 0 || line.indexOf(' pv ') < 0) return;
        var m = /depth (\d+).*?multipv (\d+) score (cp|mate) (-?\d+).*? pv (.+)$/.exec(line);
        if (!m) return;
        var val = parseInt(m[4], 10);
        cur.cb({ info: true, depth: parseInt(m[1], 10), multipv: parseInt(m[2], 10),
          cp: m[3] === 'cp' ? val : null, mate: m[3] === 'mate' ? val : null,
          pv: m[5].split(' '), turn: cur.turn });
      } else {
        if (d.done) { busy = false; if (pending) { var p2 = pending; pending = null; start(p2); } return; }
        if (d.info && cur) cur.cb(d);
      }
    };
  }

  function start(req) {
    cur = req; busy = true;
    if (kind === 'stockfish') {
      worker.postMessage('setoption name MultiPV value ' + req.lines);
      worker.postMessage('position fen ' + req.fen);
      worker.postMessage('go depth ' + req.depth + ' movetime ' + req.ms);
    } else {
      worker.postMessage({ cmd: 'go', fen: req.fen, depth: Math.min(req.depth, 4), ms: req.ms });
    }
  }

  function analyse(fen, opts, cb) {
    if (!worker) return;
    var req = { fen: fen, lines: (opts && opts.lines) || 3, depth: (opts && opts.depth) || 16, ms: (opts && opts.ms) || 5000,
      cb: cb, turn: fen.split(' ')[1] };
    if (busy) {
      pending = req; cur = null;
      if (kind === 'stockfish') worker.postMessage('stop');
      else { /* запасной поиск короткий; дождёмся окончания */ }
    } else start(req);
  }
  function stop() {
    pending = null; cur = null;
    if (worker && busy && kind === 'stockfish') worker.postMessage('stop');
  }
  return { init: init, analyse: analyse, stop: stop, get kind() { return kind; } };
})();

export { Engine };
export default Engine;
