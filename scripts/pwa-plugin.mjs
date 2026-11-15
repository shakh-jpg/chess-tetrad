// Tiny Vite plugin: after the build, writes dist/sw.js with the list of files to precache
// and a version derived from their contents (so every new build updates the cache).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Which built files go into the offline cache. Fonts: only Latin/Cyrillic text faces and the
// chess-symbol face (other scripts are cached on first use); woff2 only (all target browsers support it).
export function selectPrecache(files) {
  return files.filter(function (f) {
    if (f === 'sw.js' || f.endsWith('.map') || f.endsWith('.txt')) return false;
    // pdf.js image decoders are needed only for scanned PDFs (coach's tool): cached on first use.
    if (f.indexOf('pdfjs/wasm/') === 0) return false;
    // DjVu decoder (scanned books, coach's tool): cached on first use as well.
    if (/^assets\/djvu_rs_bg-[^/]*\.wasm$/.test(f)) return false;
    if (/\.woff$/.test(f)) return false;
    if (/\.woff2$/.test(f)) return /-(latin|cyrillic)-\d00-(normal|italic)|symbols-2-symbols-/.test(f);
    return true;
  }).sort();
}

function walk(dir, base) {
  var out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    var p = path.join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  });
  return out;
}

export function buildServiceWorker(distDir, templatePath) {
  var files = selectPrecache(walk(distDir, distDir));
  var hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(templatePath)); // a change of the worker logic also bumps the version
  files.forEach(function (f) { hash.update(f); hash.update(fs.readFileSync(path.join(distDir, f))); });
  var version = hash.digest('hex').slice(0, 12);
  var assets = ['./'].concat(files.map(function (f) { return './' + f; }));
  var sw = fs.readFileSync(templatePath, 'utf8')
    .replace('__VERSION__', version)
    .replace('__ASSETS__', JSON.stringify(assets, null, 1));
  fs.writeFileSync(path.join(distDir, 'sw.js'), sw);
  var bytes = files.reduce(function (n, f) { return n + fs.statSync(path.join(distDir, f)).size; }, 0);
  return { version: version, count: files.length, bytes: bytes };
}

export default function pwaPlugin() {
  var outDir = 'dist', root = process.cwd();
  return {
    name: 'tetrad-sw',
    apply: 'build',
    configResolved: function (c) { root = c.root; outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle: function () {
      var r = buildServiceWorker(outDir, path.join(root, 'scripts', 'sw-template.js'));
      console.log('[tetrad-sw] precache ' + r.count + ' files, ' + (r.bytes / 1048576).toFixed(2) + ' MB, version ' + r.version);
    }
  };
}
