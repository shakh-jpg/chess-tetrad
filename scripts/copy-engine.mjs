// Copies the Stockfish lite single-threaded build (GPL-3.0) from node_modules into public/engine/,
// so it is served by the app itself (offline, no CDN). Runs before dev/build/test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'stockfish');
const dst = path.join(root, 'public', 'engine');
const files = [
  ['bin/stockfish-19-lite-single.js', 'stockfish-19-lite-single.js'],
  ['bin/stockfish-19-lite-single.wasm', 'stockfish-19-lite-single.wasm'],
  ['Copying.txt', 'COPYING-stockfish.txt']
];
fs.mkdirSync(dst, { recursive: true });
for (const [from, to] of files) {
  const a = path.join(src, from), b = path.join(dst, to);
  if (!fs.existsSync(a)) { console.error('missing ' + a + ' (run npm install)'); process.exit(1); }
  const sa = fs.statSync(a);
  if (!fs.existsSync(b) || fs.statSync(b).size !== sa.size) fs.copyFileSync(a, b);
}
console.log('engine files ready in public/engine');
