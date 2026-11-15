// Copies third-party runtime files from node_modules into public/, so the app serves them
// itself (offline, no CDN). Runs before dev/build.
//  - public/engine/      Stockfish lite single-threaded build (GPL-3.0)
//  - public/pdfjs/wasm/  pdf.js image decoders for scanned PDFs (JBIG2, JPEG 2000, colour profiles)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyAll(srcDir, dstDir, files) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const [from, to] of files) {
    const a = path.join(srcDir, from), b = path.join(dstDir, to || from);
    if (!fs.existsSync(a)) { console.error('missing ' + a + ' (run npm install)'); process.exit(1); }
    if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b);
  }
}

copyAll(path.join(root, 'node_modules', 'stockfish'), path.join(root, 'public', 'engine'), [
  ['bin/stockfish-19-lite-single.js', 'stockfish-19-lite-single.js'],
  ['bin/stockfish-19-lite-single.wasm', 'stockfish-19-lite-single.wasm'],
  ['Copying.txt', 'COPYING-stockfish.txt']
]);

const wasmSrc = path.join(root, 'node_modules', 'pdfjs-dist', 'wasm');
const wanted = fs.readdirSync(wasmSrc).filter((f) => /^(jbig2|openjpeg|qcms)|^LICENSE_(JBIG2|OPENJPEG|QCMS|PDFJS_JBIG2|PDFJS_OPENJPEG|PDFJS_QCMS)$/.test(f));
copyAll(wasmSrc, path.join(root, 'public', 'pdfjs', 'wasm'), wanted.map((f) => [f, f]));

console.log('engine files ready in public/engine; pdf.js decoders in public/pdfjs/wasm');
