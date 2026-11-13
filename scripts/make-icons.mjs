// Generates the PWA icons (PNG) from an SVG: accent-blue tile with the cburnett white knight.
// Run once: node scripts/make-icons.mjs  (output is committed in public/icons/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PIECES } from '../src/board/pieces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const BG = '#1E4FC2';          // --accent (light theme)
const LIGHT = '#E2E8EE', DARK = '#8CA1B7'; // board squares

// scale: share of the tile taken by the knight; round: corner radius (0 for maskable/apple)
function svg(scale, round) {
  const s = 512, k = s * scale, off = (s - k) / 2;
  const sq = s / 8;
  let board = '';
  for (let r = 6; r < 8; r++) for (let f = 0; f < 8; f++) board += `<rect x="${f * sq}" y="${r * sq}" width="${sq}" height="${sq}" fill="${(r + f) % 2 ? DARK : LIGHT}" opacity=".9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><clipPath id="c"><rect width="${s}" height="${s}" rx="${round}"/></clipPath></defs>
  <g clip-path="url(#c)"><rect width="${s}" height="${s}" fill="${BG}"/>${board}</g>
  <svg x="${off}" y="${off - s * 0.06}" width="${k}" height="${k}" viewBox="0 0 45 45">${PIECES.wN}</svg>
</svg>`;
}
function png(svgText, size, file) {
  const r = new Resvg(svgText, { fitTo: { mode: 'width', value: size } });
  fs.writeFileSync(path.join(out, file), r.render().asPng());
  console.log(file, fs.statSync(path.join(out, file)).size, 'bytes');
}
const normal = svg(0.78, 96), full = svg(0.78, 0), mask = svg(0.56, 0);
png(normal, 192, 'icon-192.png');
png(normal, 512, 'icon-512.png');
png(mask, 512, 'maskable-512.png');
png(full, 180, 'apple-touch-icon.png');
fs.writeFileSync(path.join(out, 'favicon.svg'), normal);
console.log('favicon.svg written');
