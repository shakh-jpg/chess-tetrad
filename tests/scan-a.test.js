// Stage A of scan import: DjVu container handling and the resumable page job.
// The DjVu files here are synthetic containers built in the test (no book pages).
import { describe, it, expect } from 'vitest';
import { parseDjvu, pageChunkIds, buildPage } from '../src/scan/djvu-split.js';
import { createScanJob, newScanState, pendingPages } from '../src/scan/scan-job.js';

const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
function chunk(id, data) {
  const pad = data.length & 1, out = new Uint8Array(8 + data.length + pad);
  out.set(enc(id), 0); new DataView(out.buffer).setUint32(4, data.length); out.set(data, 8); return out;
}
function form(kind, parts) {
  const body = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(12 + body);
  out.set(enc('FORM'), 0); new DataView(out.buffer).setUint32(4, 4 + body); out.set(enc(kind), 8);
  let o = 12; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function file(top) { const out = new Uint8Array(4 + top.length); out.set(enc('AT&T'), 0); out.set(top, 4); return out; }
const INFO = new Uint8Array(10);
// INCL names in CP1251-like bytes (as in real scanned books)
const nameA = Uint8Array.from([0xd1, 0xf2, 0x5f, 0x31, 0x2e, 0x64, 0x6a, 0x62, 0x7a]); // "Ст_1.djbz"
const nameB = Uint8Array.from([0xd1, 0xf2, 0x5f, 0x32, 0x2e, 0x64, 0x6a, 0x62, 0x7a]);
function bundled(dirmFlag) {
  const dictA = form('DJVI', [chunk('Djbz', enc('DICT-A'))]);
  const dictB = form('DJVI', [chunk('Djbz', enc('DICT-B'))]);
  const page = (incl, sj) => form('DJVU', [chunk('INFO', INFO), chunk('INCL', incl), chunk('Sjbz', enc(sj))]);
  return file(form('DJVM', [chunk('DIRM', Uint8Array.from([dirmFlag, 0, 4])), dictA, page(nameA, 'P1'), page(nameA, 'P2'), dictB, page(nameB, 'P3')]));
}

describe('DjVu container (scan import, stage A)', () => {
  it('splits a bundled book into standalone pages with the shared dictionary inlined', () => {
    const d = parseDjvu(bundled(0x81));
    expect(d).toMatchObject({ pages: 3, kind: 'bundled' });
    const p3 = d.pageBytes(2);
    expect(pageChunkIds(p3)).toEqual(['INFO', 'Djbz', 'Sjbz']); // INCL replaced by the dictionary itself
    const text = String.fromCharCode(...p3);
    expect(text.startsWith('AT&TFORM')).toBe(true);
    expect(text).toContain('DICT-B');
    expect(text).not.toContain('DICT-A');
    expect(String.fromCharCode(...d.pageBytes(1))).toContain('DICT-A');
  });
  it('passes a single-page DjVu through unchanged', () => {
    const one = file(form('DJVU', [chunk('INFO', INFO), chunk('Sjbz', enc('X'))]));
    const d = parseDjvu(one);
    expect(d.pages).toBe(1);
    expect(d.pageBytes(0)).toBe(one);
  });
  it('explains unsupported or broken files', () => {
    expect(() => parseDjvu(enc('%PDF-1.4 ...'))).toThrow(/не файл DjVu/);
    expect(() => parseDjvu(bundled(0x01))).toThrow(/indirect/);
    const cut = bundled(0x81).subarray(0, 60);
    expect(() => parseDjvu(cut)).toThrow();
  });
  it('builds valid IFF sizes', () => {
    const p = buildPage([chunk('INFO', INFO)]);
    expect(new DataView(p.buffer).getUint32(8)).toBe(p.length - 12);
  });
});

describe('scan job: one page at a time, cancel and continue', () => {
  const img = { width: 1, height: 1, gray: new Uint8ClampedArray(1) };
  function fakeSource(n, rendered) { return { pages: n, renderPage: async (i) => { rendered.push(i); return img; } }; }
  const noPause = async () => {};

  it('processes the chosen range and records results and progress', async () => {
    const rendered = [], saves = [], progress = [];
    const st = newScanState('fp', 'book.djvu', 10);
    const job = createScanJob({ source: fakeSource(10, rendered), state: st, dpi: 200, pause: noPause,
      processPage: (im, p) => (p % 2 ? [{ page: p }] : []), save: (s) => saves.push(s.done.length) });
    const r = await job.run(2, 5, (p) => progress.push(p.index + '/' + p.total + ':' + p.found));
    expect(r.finished).toBe(true);
    expect(rendered).toEqual([2, 3, 4, 5]);
    expect(st.done).toEqual([2, 3, 4, 5]);
    expect(st.results).toEqual([{ page: 3 }, { page: 5 }]);
    expect(saves).toEqual([1, 2, 3, 4]); // saved after every page
    expect(progress).toEqual(['1/4:0', '2/4:1', '3/4:1', '4/4:2']);
  });

  it('cancel stops after the current page; a new run continues where it stopped', async () => {
    const rendered = [];
    const st = newScanState('fp', 'b', 6);
    let job;
    job = createScanJob({ source: fakeSource(6, rendered), state: st, dpi: 200, pause: noPause, save: () => {},
      processPage: (im, p) => { if (p === 2) job.cancel(); return [{ page: p }]; } });
    const r1 = await job.run(0, 5);
    expect(r1.finished).toBe(false);
    expect(st.done).toEqual([0, 1, 2]);
    expect(pendingPages(st, 0, 5)).toEqual([3, 4, 5]);
    const job2 = createScanJob({ source: fakeSource(6, rendered), state: st, dpi: 200, pause: noPause, save: () => {}, processPage: (im, p) => [{ page: p }] });
    const r2 = await job2.run(0, 5);
    expect(r2.finished).toBe(true);
    expect(rendered).toEqual([0, 1, 2, 3, 4, 5]); // nothing rendered twice
    expect(st.results.map((x) => x.page)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('an error on a page keeps what was done before', async () => {
    const st = newScanState('fp', 'b', 3);
    const job = createScanJob({ source: { pages: 3, renderPage: async (i) => { if (i === 1) throw new Error('bad page'); return img; } },
      state: st, dpi: 200, pause: noPause, save: () => {}, processPage: () => [] });
    await expect(job.run(0, 2)).rejects.toThrow('bad page');
    expect(st.done).toEqual([0]);
  });
});
