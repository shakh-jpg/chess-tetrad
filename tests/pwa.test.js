import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { selectPrecache } from '../scripts/pwa-plugin.mjs';
import { isIOS } from '../src/pwa/pwa.js';
import { boardSVG, pieceSpriteMarkup, pieceIcon } from '../src/board/svg.js';
import { PIECES } from '../src/board/pieces.js';

describe('offline cache list', () => {
  const files = [
    'index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-a.js', 'assets/index-a.js.map',
    'engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm', 'engine/COPYING-stockfish.txt',
    'assets/literata-latin-400-normal-x.woff2', 'assets/literata-cyrillic-400-italic-x.woff2',
    'assets/literata-latin-400-normal-x.woff', 'assets/literata-greek-400-normal-x.woff2',
    'assets/ibm-plex-sans-latin-ext-400-normal-x.woff2', 'assets/noto-sans-symbols-2-symbols-400-normal-x.woff2'
  ];
  it('includes shell, engine and text fonts; skips sw.js, maps, licenses, woff and other scripts', () => {
    expect(selectPrecache(files)).toEqual([
      'assets/index-a.js', 'assets/literata-cyrillic-400-italic-x.woff2', 'assets/literata-latin-400-normal-x.woff2',
      'assets/noto-sans-symbols-2-symbols-400-normal-x.woff2',
      'engine/stockfish-19-lite-single.js', 'engine/stockfish-19-lite-single.wasm',
      'index.html', 'manifest.webmanifest'
    ]);
  });
});

describe('web app manifest', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  it('has the fields browsers need for installation', () => {
    expect(m.name).toBe('Шахматная тетрадь');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('./');
    const sizes = m.icons.map((i) => i.sizes + ':' + i.purpose);
    expect(sizes).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const i of m.icons) expect(fs.existsSync(new URL('../public/' + i.src, import.meta.url))).toBe(true);
  });
});

describe('install hint', () => {
  it('detects iPhone, iPad (desktop UA) and not Android', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});

describe('SVG pieces', () => {
  it('has all 12 cburnett pieces, with no scripts or event handlers', () => {
    expect(Object.keys(PIECES).sort()).toEqual(['bB', 'bK', 'bN', 'bP', 'bQ', 'bR', 'wB', 'wK', 'wN', 'wP', 'wQ', 'wR']);
    const all = Object.values(PIECES).join('');
    expect(all).not.toMatch(/<script|\son\w+=/i);
    expect((pieceSpriteMarkup().match(/<symbol /g) || []).length).toBe(12);
  });
  it('the board references sprite symbols instead of font glyphs', () => {
    const s = boardSVG({ e1: 'wK', e8: 'bK' }, {});
    expect(s).toContain('<use href="#pc-wK" x="400" y="700"');
    expect(s).toContain('<use href="#pc-bK" x="400" y="0"');
    expect(s).not.toMatch(/♚|♔/);
    expect(boardSVG({ e1: 'wK' }, { flipped: true })).toContain('<use href="#pc-wK" x="300" y="0"');
    expect(pieceIcon('wQ')).toContain('#pc-wQ');
  });
});
