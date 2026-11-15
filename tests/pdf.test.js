import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { pdfOptions } from '../src/pdf-import/files.js';

const pkg = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const ver = (v) => v.split('.').map(Number);
const atLeast = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; };

describe('pdf.js security (CVE-2024-4367 / GHSA-wgrm-67xf-hhpq)', () => {
  it('uses pdf.js 4.2.67 or newer', () => {
    const installed = pkg('../node_modules/pdfjs-dist/package.json').version;
    expect(atLeast(ver(installed), [4, 2, 67])).toBe(true);
    expect(pkg('../package.json').dependencies['pdfjs-dist']).toBe(installed);
  });
  it('every PDF is opened with eval disabled and local image decoders', () => {
    const o = pdfOptions(new Uint8Array([1]), 'https://shakh-jpg.github.io/chess-tetrad/');
    expect(o.isEvalSupported).toBe(false);
    expect(o.wasmUrl).toBe('https://shakh-jpg.github.io/chess-tetrad/pdfjs/wasm/');
  });
  it('no other code calls getDocument directly', () => {
    const src = ['../src/ui/app.js', '../src/pdf-import/files.js', '../src/pdf-import/bookpdf.js']
      .map((p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
    expect((src.match(/getDocument\(/g) || []).length).toBe(1); // only inside openPdf()
  });
});
